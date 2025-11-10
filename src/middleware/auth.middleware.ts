import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import * as userService from '../services/user.service';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const authenticate: RequestHandler = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'missing token' });
    const token = auth.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET) as any;
        const userId = payload.sub as string;
        const user = await userService.findUserById(userId);
        if (!user) return res.status(401).json({ message: 'invalid token' });
        // attach user to request so controllers can use it
        (req as any).user = user;
        return next();
    } catch (err) {
        return res.status(401).json({ message: 'invalid token' });
    }
};
