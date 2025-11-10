import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import * as businessService from '../services/business.service';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const authenticateBusiness: RequestHandler = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'missing token' });
    const token = auth.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET) as any;
        const bizId = payload.sub as string;
        const biz = await businessService.findBusinessById(bizId);
        if (!biz) return res.status(401).json({ message: 'invalid token' });
        req.business = biz;
        return next();
    } catch (err) {
        return res.status(401).json({ message: 'invalid token' });
    }
};
