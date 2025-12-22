import { Request, Response, NextFunction } from 'express';
import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import * as userService from '../services/user.service';
import * as businessService from '../services/business.service';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const authenticate: RequestHandler = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'missing token' });
    const token = auth.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET) as any;
        const id = payload.sub as string;

        // Try to find as user first
        let user = await userService.findUserById(id);
        if (user) {
            req.user = user;
            return next();
        }

        // If not found as user, try as business
        const business = await businessService.findBusinessById(id);
        if (business) {
            // Attach business to req.business
            req.business = business;
            // Also attach to req.user for backward compatibility with existing code
            // This allows controllers to use (req as any).user.id for both users and businesses
            (req as any).user = business;
            return next();
        }

        // Neither user nor business found
        return res.status(401).json({ message: 'invalid token' });
    } catch (err) {
        return res.status(401).json({ message: 'invalid token' });
    }
};

export const requireVerification = (req: Request, res: Response, next: NextFunction) => {
    // Asumimos que 'authenticate' ya corrió y req.user existe
    const user = (req as any).user;

    if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    if (!user.isVerified) {
        return res.status(403).json({
            message: 'Email verification required',
            code: 'VERIFICATION_REQUIRED' // Código útil para el frontend
        });
    }

    next();
};
