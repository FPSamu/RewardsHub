import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Model } from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;
const ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || '7d';

export type AccountRole = 'user' | 'business';

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

export interface RefreshPayload {
    sub: string;
    role: AccountRole;
}

// ── JWT ──────────────────────────────────────────────────────────────────────

export const issueTokenPair = (id: string, role: AccountRole): TokenPair => {
    const accessToken = (jwt as any).sign({ sub: id, role }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: id, role }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    return { accessToken, refreshToken };
};

export const verifyRefreshToken = (token: string): RefreshPayload => {
    return jwt.verify(token, REFRESH_SECRET) as RefreshPayload;
};

export const verifyAccessToken = (token: string): RefreshPayload => {
    return jwt.verify(token, JWT_SECRET) as RefreshPayload;
};

// ── Refresh token storage ─────────────────────────────────────────────────────

export const addRefreshToken = async (model: Model<any>, id: string, token: string): Promise<void> => {
    await model.findByIdAndUpdate(id, { $push: { refreshTokens: token } }).exec();
};

export const removeRefreshToken = async (model: Model<any>, id: string, token: string): Promise<void> => {
    await model.findByIdAndUpdate(id, { $pull: { refreshTokens: token } }).exec();
};

export const hasRefreshToken = async (model: Model<any>, id: string, token: string): Promise<boolean> => {
    const doc = await model.findOne({ _id: id, refreshTokens: token }).exec();
    return !!doc;
};

// ── Email verification ────────────────────────────────────────────────────────

export const generateVerificationToken = async (model: Model<any>, id: string): Promise<string> => {
    const token = crypto.randomBytes(32).toString('hex');
    await model.findByIdAndUpdate(id, { verificationToken: token }).exec();
    return token;
};

// ── Password reset ────────────────────────────────────────────────────────────

export const generatePasswordResetToken = async (model: Model<any>, email: string): Promise<string | null> => {
    const doc = await model.findOne({ email: email.toLowerCase() }).exec();
    if (!doc) return null;

    const token = crypto.randomBytes(32).toString('hex');
    doc.resetPasswordToken = token;
    doc.resetPasswordExpires = new Date(Date.now() + 3_600_000); // 1 hour
    await doc.save();
    return token;
};

export const resetPassword = async (model: Model<any>, token: string, newPassword: string): Promise<boolean> => {
    const doc = await model.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() },
    }).exec();

    if (!doc) return false;

    doc.passHash = await bcrypt.hash(newPassword, 10);
    doc.resetPasswordToken = undefined;
    doc.resetPasswordExpires = undefined;
    await doc.save();
    return true;
};
