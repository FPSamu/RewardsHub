/**
 * Pass service — generates Apple Wallet (.pkpass) and Google Wallet (save JWT)
 * passes for a user's loyalty card.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { Types } from 'mongoose';
import { PKPass } from 'passkit-generator';
import sharp from 'sharp';
import jwt from 'jsonwebtoken';
import { UserModel } from '../models/user.model';
import { UserPointsModel } from '../models/userPoints.model';
import { RewardModel } from '../models/reward.model';
import { BusinessModel } from '../models/business.model';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RedeemableBusiness {
    name: string;
}

export interface UserPassData {
    id: string;
    name: string;
    /** The string encoded in the QR (same value the frontend uses: the user's MongoDB _id) */
    qrValue: string;
    /** Businesses where the user already has at least one reward ready to redeem */
    redeemableBusinesses: RedeemableBusiness[];
}

// ---------------------------------------------------------------------------
// Shared business logic: build the data needed for both wallet types
// ---------------------------------------------------------------------------

export async function getUserPassData(userId: string): Promise<UserPassData> {
    const user = await UserModel.findById(userId).lean();
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

    const qrValue = userId;
    const username = (user as any).username as string;

    const userPoints = await UserPointsModel.findOne({
        userId: new Types.ObjectId(userId),
    }).lean();

    if (!userPoints || userPoints.businessPoints.length === 0) {
        return { id: userId, name: username, qrValue, redeemableBusinesses: [] };
    }

    const businessIds = userPoints.businessPoints.map((bp) => bp.businessId);

    const rewards = await RewardModel.find({
        businessId: { $in: businessIds },
        isActive: true,
    }).lean();

    // Quick lookup: businessId → { points, stamps }
    const progressMap = new Map(
        userPoints.businessPoints.map((bp) => [
            bp.businessId.toString(),
            { points: bp.points, stamps: bp.stamps },
        ])
    );

    // Collect IDs of businesses where the user has at least one reward ready to redeem
    const redeemableIds = new Set<string>();

    for (const reward of rewards) {
        const businessIdStr = reward.businessId.toString();
        const userValues = progressMap.get(businessIdStr);
        if (!userValues) continue;

        const isPoints = !!reward.pointsRequired;
        const required = (isPoints ? reward.pointsRequired : reward.stampsRequired) ?? 0;
        const current = isPoints ? userValues.points : userValues.stamps;

        if (required > 0 && current >= required) {
            redeemableIds.add(businessIdStr);
        }
    }

    // Fetch business names for the redeemable ones
    const redeemableBusinesses: RedeemableBusiness[] = [];
    if (redeemableIds.size > 0) {
        const businesses = await BusinessModel.find({
            _id: { $in: Array.from(redeemableIds) },
        })
            .select('name')
            .lean();

        for (const b of businesses) {
            redeemableBusinesses.push({ name: (b as any).name ?? 'Negocio' });
        }
    }

    return { id: userId, name: username, qrValue, redeemableBusinesses };
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function fetchBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch image: HTTP ${res.statusCode}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

const LOGO_URL = 'https://rewards-hub-app.s3.us-east-2.amazonaws.com/app/RewardsHubPNG.png';

// In-memory cache — generated once per process lifetime
let _stripCache: Buffer | null = null;
let _logoCache: Buffer | null = null;

/** Call this to bust the strip cache (e.g. after config changes in dev) */
export function clearPassImageCache() { _stripCache = null; _logoCache = null; }

async function getLogoBuffer(): Promise<Buffer> {
    if (_logoCache) return _logoCache;
    _logoCache = await fetchBuffer(LOGO_URL);
    return _logoCache;
}

/**
 * Generates a 750×246 strip image:
 *   – #FFB733 background
 *   – RewardsHub logo centered (max 140 px tall)
 *   – "rewardshub.cloud" text below
 *
 * The result is cached in memory so it's only generated once.
 */
async function generateStripImage(): Promise<Buffer> {
    if (_stripCache) return _stripCache;

    const stripW = 750;
    const stripH = 246;

    // Resize logo to fit within 220×140, preserving aspect ratio
    const logoRaw = await getLogoBuffer();
    const logoResized = await sharp(logoRaw)
        .resize({ width: 220, height: 140, fit: 'inside', withoutEnlargement: false })
        .toBuffer();

    const logoMeta = await sharp(logoResized).metadata();
    const logoW = logoMeta.width ?? 220;
    const logoH = logoMeta.height ?? 140;

    // Center logo horizontally; leave room for text below
    const logoLeft = Math.round((stripW - logoW) / 2);
    const logoTop = Math.round((stripH - logoH) / 2) - 22;

    // SVG text layer: "rewardshub.cloud" centered
    const textTop = logoTop + logoH + 14;
    const textSvg = Buffer.from(
        `<svg width="${stripW}" height="56" xmlns="http://www.w3.org/2000/svg">` +
        `<text x="${stripW / 2}" y="44" ` +
        `text-anchor="middle" ` +
        `font-size="40" font-weight="bold" ` +
        `font-family="Helvetica Neue,Helvetica,Arial,sans-serif" ` +
        `fill="white">rewardshub.cloud</text>` +
        `</svg>`
    );

    // Transparent background — the pass's backgroundColor (#FFB733) shows through,
    // making all 3 sections (header, strip, barcode) the same uniform color.
    // Only the logo and white text are opaque.
    _stripCache = await sharp({
        create: {
            width: stripW,
            height: stripH,
            channels: 4,          // RGBA — alpha=0 means fully transparent
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite([
            { input: logoResized, top: logoTop, left: logoLeft },
            { input: textSvg,    top: textTop,  left: 0 },
        ])
        .png()
        .toBuffer();

    return _stripCache;
}

// ---------------------------------------------------------------------------
// Apple Wallet
// ---------------------------------------------------------------------------

/**
 * 1×1 red pixel PNG — used as placeholder when real brand images haven't been
 * dropped into assets/pass-images/. Replace with proper 29×29, 58×58, etc.
 */
const PLACEHOLDER_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==',
    'base64'
);

function readFileOrNull(filePath: string): Buffer | null {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
}

/**
 * Reads a certificate from a file path, falling back to an environment variable
 * that contains the PEM content directly (useful for cloud deployments like Render
 * where files can't be persisted).
 */
function readCertFromFileOrEnv(filePath: string, envVar: string): Buffer | null {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
    const envValue = process.env[envVar];
    if (envValue) return Buffer.from(envValue.replace(/\\n/g, '\n'));
    return null;
}

function readImageOrPlaceholder(imagesDir: string, name: string): Buffer {
    const p = path.join(imagesDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p) : PLACEHOLDER_PNG;
}

export async function generateApplePassBuffer(userId: string): Promise<Buffer> {
    // --- Check env config ---
    const passTypeIdentifier = process.env.APPLE_PASS_TYPE_ID;
    const teamIdentifier = process.env.APPLE_TEAM_ID;
    if (!passTypeIdentifier || !teamIdentifier) {
        throw Object.assign(
            new Error(
                'Apple Wallet not configured. Set APPLE_PASS_TYPE_ID and APPLE_TEAM_ID environment variables.'
            ),
            { status: 503 }
        );
    }

    // --- Read certificates (file path first, env var fallback for cloud deployments) ---
    const certsDir = path.resolve(process.env.APPLE_CERTS_DIR || './certs/apple');
    const wwdr = readCertFromFileOrEnv(
        process.env.APPLE_WWDR_PATH || path.join(certsDir, 'wwdr.pem'),
        'APPLE_WWDR_PEM'
    );
    const signerCert = readCertFromFileOrEnv(
        process.env.APPLE_SIGNER_CERT_PATH || path.join(certsDir, 'signerCert.pem'),
        'APPLE_SIGNER_CERT_PEM'
    );
    const signerKey = readCertFromFileOrEnv(
        process.env.APPLE_SIGNER_KEY_PATH || path.join(certsDir, 'signerKey.pem'),
        'APPLE_SIGNER_KEY_PEM'
    );

    if (!wwdr || !signerCert || !signerKey) {
        throw Object.assign(
            new Error(
                'Apple Wallet certificates not found. Place wwdr.pem, signerCert.pem, signerKey.pem in ./certs/apple/ or set APPLE_*_PATH env vars.'
            ),
            { status: 503 }
        );
    }

    // --- Build pass content ---
    const data = await getUserPassData(userId);

    const passJson = {
        formatVersion: 1,
        passTypeIdentifier,
        teamIdentifier,
        serialNumber: userId,
        organizationName: 'RewardsHub',
        description: 'RewardsHub — Tarjeta de Lealtad',
        foregroundColor: 'rgb(90, 55, 0)',      // dark brown — readable on #FFB733
        backgroundColor: 'rgb(255, 183, 51)',   // #FFB733
        labelColor: 'rgb(139, 90, 0)',           // medium brown for labels
        storeCard: {
            headerFields: [
                { key: 'member_name', label: 'MIEMBRO', value: data.name },
            ],
            primaryFields: [
                { key: 'spacer', label: '', value: '' },
            ],
            backFields: [
                {
                    key: 'info',
                    label: 'INFORMACIÓN',
                    value:
                        'Presenta este código QR en los negocios afiliados a RewardsHub para acumular puntos y canjear recompensas.',
                },
                {
                    key: 'website',
                    label: 'WEB',
                    value: 'rewardshub.cloud',
                    attributedValue: '<a href="https://rewardshub.cloud">rewardshub.cloud</a>',
                },
            ],
        },
        barcodes: [
            {
                message: data.qrValue,
                format: 'PKBarcodeFormatQR',
                messageEncoding: 'iso-8859-1',
                altText: data.name,
            },
        ],
    };

    // --- Generate images ---
    const logoBuffer = await getLogoBuffer().catch(() => PLACEHOLDER_PNG);
    // strip.png has a transparent background so Apple's backgroundColor (#FFB733) shows
    // uniformly across all 3 sections — no color bands. Only logo + white text are visible.
    const stripBuffer = await generateStripImage().catch(() => PLACEHOLDER_PNG);

    // Transparent 1×1 PNG for logo.png — avoids duplicating the logo in the header corner
    // since the strip already shows it centered.
    const transparentPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
    );

    const pass = new PKPass({
        'pass.json':    Buffer.from(JSON.stringify(passJson)),
        'icon.png':     logoBuffer,
        'icon@2x.png':  logoBuffer,
        'logo.png':     transparentPng,
        'logo@2x.png':  transparentPng,
        'strip.png':    stripBuffer,
        'strip@2x.png': stripBuffer,
    });

    const certPassword = process.env.APPLE_CERT_PASSWORD;
    pass.certificates = {
        wwdr,
        signerCert,
        signerKey,
        // omit signerKeyPassphrase entirely when empty — passkit-generator rejects empty strings
        ...(certPassword ? { signerKeyPassphrase: certPassword } : {}),
    };

    return pass.getAsBuffer();
}

// ---------------------------------------------------------------------------
// Google Wallet
// ---------------------------------------------------------------------------

interface ServiceAccount {
    client_email: string;
    private_key: string;
}

/**
 * Builds a "Save to Wallet" JWT.
 * Redirect the user to `https://pay.google.com/gp/v/save/{token}`.
 */
export function generateGooglePassJwt(data: UserPassData): string {
    const saPath = path.resolve(
        process.env.GOOGLE_SERVICE_ACCOUNT || './certs/google/service-account.json'
    );

    if (!fs.existsSync(saPath)) {
        throw Object.assign(
            new Error(
                'Google Wallet service account not configured. Place service-account.json in ./certs/google/ or set GOOGLE_SERVICE_ACCOUNT env var.'
            ),
            { status: 503 }
        );
    }

    const issuerId = process.env.GOOGLE_ISSUER_ID;
    if (!issuerId) {
        throw Object.assign(
            new Error('Google Wallet not configured. Set GOOGLE_ISSUER_ID environment variable.'),
            { status: 503 }
        );
    }

    const classSuffix = process.env.GOOGLE_CLASS_ID || 'rewardshub_loyalty_card';
    const sa: ServiceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));

    const classId = `${issuerId}.${classSuffix}`;
    const objectId = `${issuerId}.user_${data.id}`;

    const { redeemableBusinesses } = data;
    const redeemableText =
        redeemableBusinesses.length === 1
            ? `${redeemableBusinesses[0].name} — Recompensas disponibles`
            : redeemableBusinesses.length > 1
            ? 'Tienes recompensas disponibles'
            : '—';

    const logoUri =
        'https://rewards-hub-app.s3.us-east-2.amazonaws.com/app/logoRewardsHub.png';

    const loyaltyClass = {
        id: classId,
        issuerName: 'RewardsHub',
        programName: 'RewardsHub Loyalty',
        programLogo: {
            sourceUri: { uri: logoUri },
            contentDescription: {
                defaultValue: { language: 'es', value: 'RewardsHub' },
            },
        },
        reviewStatus: 'UNDER_REVIEW',
    };

    const loyaltyObject: Record<string, unknown> = {
        id: objectId,
        classId,
        state: 'ACTIVE',
        accountId: data.id,
        accountName: data.name,
        loyaltyPoints: {
            balance: { string: redeemableText },
            label: 'Recompensas',
        },
        barcode: {
            type: 'QR_CODE',
            value: data.qrValue,
            alternateText: data.name,
        },
        heroImage: {
            sourceUri: { uri: logoUri },
        },
    };

    const jwtPayload = {
        iss: sa.client_email,
        aud: 'google',
        typ: 'savetowallet',
        iat: Math.floor(Date.now() / 1000),
        payload: {
            loyaltyClasses: [loyaltyClass],
            loyaltyObjects: [loyaltyObject],
        },
        origins: [(process.env.FRONTEND_URL || 'https://rewardshub.cloud').replace(/\/$/, '')],
    };

    return jwt.sign(jwtPayload, sa.private_key, { algorithm: 'RS256' });
}
