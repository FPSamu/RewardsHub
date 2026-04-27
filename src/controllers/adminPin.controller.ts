/**
 * Admin PIN controllers
 *
 * generatePin  — platform admin generates a temp PIN for a business and emails it
 * verifyPin    — business verifies their PIN; returns whether it's temporary
 * changePin    — business changes their PIN (required on first use of temp PIN)
 */
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { BusinessModel } from '../models/business.model';
import { sendAdminPinEmail } from '../services/email.service';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const ADMIN_TOKEN_EXPIRY = '30m';

const SALT_ROUNDS = 10;

/** Generates a random alphanumeric PIN of given length */
const generateRandomPin = (length = 8): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

/**
 * POST /business/admin-pin/generate
 * Header: x-admin-secret
 * Body: { businessId }
 */
export const generatePin = async (req: Request, res: Response): Promise<void> => {
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && req.headers['x-admin-secret'] !== adminSecret) {
        res.status(403).json({ message: 'Forbidden' });
        return;
    }

    const { businessId } = req.body;
    if (!businessId) {
        res.status(400).json({ message: 'businessId is required' });
        return;
    }

    const business = await BusinessModel.findById(businessId);
    if (!business) {
        res.status(404).json({ message: 'Business not found' });
        return;
    }

    const tempPin = generateRandomPin();
    const pinHash = await bcrypt.hash(tempPin, SALT_ROUNDS);

    business.adminPinHash = pinHash;
    business.isAdminPinTemporary = true;
    await business.save();

    await sendAdminPinEmail(business.email, business.username, tempPin);

    console.log(`🔑 [AdminPin] Temp PIN generated for business: ${business.username} (${business.email})`);
    res.json({ message: `PIN temporal generado y enviado a ${business.email}` });
};

/**
 * POST /business/admin-pin/verify
 * Auth: business JWT
 * Body: { pin }
 */
export const verifyPin = async (req: Request, res: Response): Promise<void> => {
    const business = req.business;
    if (!business) {
        res.status(401).json({ message: 'not authenticated' });
        return;
    }

    const { pin } = req.body;
    if (!pin) {
        res.status(400).json({ message: 'pin is required' });
        return;
    }

    const doc = await BusinessModel.findById(business.id).select('+adminPinHash +isAdminPinTemporary');
    if (!doc?.adminPinHash) {
        res.status(404).json({ message: 'Este negocio no tiene un PIN de administrador configurado' });
        return;
    }

    const valid = await bcrypt.compare(String(pin), doc.adminPinHash);
    if (!valid) {
        res.status(401).json({ message: 'PIN incorrecto' });
        return;
    }

    const isTemporary = doc.isAdminPinTemporary ?? false;

    // Issue a short-lived admin token the frontend must send as x-admin-token
    // on all write operations (rewards, systems, business profile updates).
    const adminToken = jwt.sign(
        { sub: business.id, type: 'admin_pin' },
        JWT_SECRET,
        { expiresIn: ADMIN_TOKEN_EXPIRY }
    );

    res.json({ success: true, isTemporary, adminToken });
};

/**
 * POST /business/admin-pin/change
 * Auth: business JWT
 * Body: { currentPin, newPin }
 */
export const changePin = async (req: Request, res: Response): Promise<void> => {
    const business = req.business;
    if (!business) {
        res.status(401).json({ message: 'not authenticated' });
        return;
    }

    const { currentPin, newPin } = req.body;
    if (!currentPin || !newPin) {
        res.status(400).json({ message: 'currentPin y newPin son requeridos' });
        return;
    }

    if (String(newPin).length < 6) {
        res.status(400).json({ message: 'El nuevo PIN debe tener al menos 6 caracteres' });
        return;
    }

    const doc = await BusinessModel.findById(business.id).select('+adminPinHash');
    if (!doc?.adminPinHash) {
        res.status(404).json({ message: 'Este negocio no tiene un PIN configurado' });
        return;
    }

    const valid = await bcrypt.compare(String(currentPin), doc.adminPinHash);
    if (!valid) {
        res.status(401).json({ message: 'PIN actual incorrecto' });
        return;
    }

    doc.adminPinHash = await bcrypt.hash(String(newPin), SALT_ROUNDS);
    doc.isAdminPinTemporary = false;
    await doc.save();

    console.log(`🔑 [AdminPin] PIN changed for business: ${doc.username}`);
    res.json({ message: 'PIN actualizado correctamente' });
};

/**
 * POST /business/admin-pin/reset
 * Auth: business JWT
 * Body: { password }
 * Verifies the account password, generates a new temp PIN, and emails it.
 */
export const resetPin = async (req: Request, res: Response): Promise<void> => {
    const business = req.business;
    if (!business) {
        res.status(401).json({ message: 'not authenticated' });
        return;
    }

    const { password } = req.body;
    if (!password) {
        res.status(400).json({ message: 'password is required' });
        return;
    }

    const doc = await BusinessModel.findById(business.id).select('+passHash +adminPinHash');
    if (!doc) {
        res.status(404).json({ message: 'Business not found' });
        return;
    }

    const validPassword = await bcrypt.compare(String(password), doc.passHash);
    if (!validPassword) {
        res.status(401).json({ message: 'Contraseña incorrecta' });
        return;
    }

    const tempPin = generateRandomPin();
    doc.adminPinHash = await bcrypt.hash(tempPin, SALT_ROUNDS);
    doc.isAdminPinTemporary = true;
    await doc.save();

    await sendAdminPinEmail(doc.email, doc.username, tempPin);

    console.log(`🔑 [AdminPin] PIN reset for business: ${doc.username} (${doc.email})`);
    res.json({ message: `PIN temporal enviado a ${doc.email}` });
};
