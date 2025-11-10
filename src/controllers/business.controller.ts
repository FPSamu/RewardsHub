import { Request, Response } from 'express';
import * as businessService from '../services/business.service';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;
const ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || '7d';

export const register = async (req: Request, res: Response) => {
    const { name, email, password } = req.body as { name: string; email: string; password: string };
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'name, email and password are required' });
    }

    const existing = await businessService.findBusinessByEmail(email);
    if (existing) return res.status(409).json({ message: 'email already used' });

    const biz = await businessService.createBusiness(name, email, password);
    const accessToken = (jwt as any).sign({ sub: biz.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: biz.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    await businessService.addRefreshToken(biz.id, refreshToken);
    return res.status(201).json({ business: { id: biz.id, name: biz.name, email: biz.email, createdAt: biz.createdAt }, token: accessToken, refreshToken });
};

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ message: 'email and password required' });

    const biz = await businessService.findBusinessByEmail(email);
    if (!biz) return res.status(401).json({ message: 'invalid credentials' });

    const ok = await businessService.verifyPassword(password, biz.passHash);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });

    const accessToken = (jwt as any).sign({ sub: biz.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: biz.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    await businessService.addRefreshToken(biz.id, refreshToken);
    return res.json({ token: accessToken, refreshToken });
};

export const refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET) as any;
        const bizId = payload.sub as string;
        const ok = await businessService.hasRefreshToken(bizId, refreshToken);
        if (!ok) return res.status(401).json({ message: 'invalid refresh token' });

        await businessService.removeRefreshToken(bizId, refreshToken);
        const newAccess = (jwt as any).sign({ sub: bizId }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
        const newRefresh = (jwt as any).sign({ sub: bizId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
        await businessService.addRefreshToken(bizId, newRefresh);
        return res.json({ token: newAccess, refreshToken: newRefresh });
    } catch (err) {
        return res.status(401).json({ message: 'invalid refresh token' });
    }
};

export const logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET) as any;
        const bizId = payload.sub as string;
        await businessService.removeRefreshToken(bizId, refreshToken);
        return res.json({ ok: true });
    } catch (err) {
        return res.json({ ok: true });
    }
};

export const me = (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });
    return res.json({ id: biz.id, name: biz.name, email: biz.email, createdAt: biz.createdAt });
};
