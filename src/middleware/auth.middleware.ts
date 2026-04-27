import { Request, Response, NextFunction } from 'express';
import { RequestHandler } from 'express';
import { verifyAccessToken } from '../services/auth.service';
import * as userService from '../services/user.service';
import * as businessService from '../services/business.service';

/**
 * Generic middleware: verifies the Bearer token, reads `role` from the payload,
 * and resolves the account in a single DB query.
 *
 * - role === 'business' → populates req.business (and req.user as alias)
 * - role === 'user'     → populates req.user
 * - no role (legacy token without role field) → falls back to double-lookup
 */
export const authenticate: RequestHandler = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'missing token' });

    try {
        const payload = verifyAccessToken(auth.slice(7));
        const { sub: id, role } = payload;

        if (role === 'business') {
            const business = await businessService.findBusinessById(id);
            if (!business) return res.status(401).json({ message: 'invalid token' });
            req.business = business;
            (req as any).user = business; // backward-compat alias
            return next();
        }

        if (role === 'user') {
            const user = await userService.findUserById(id);
            if (!user) return res.status(401).json({ message: 'invalid token' });
            req.user = user;
            return next();
        }

        // Legacy tokens without role: try user first, then business
        const user = await userService.findUserById(id);
        if (user) { req.user = user; return next(); }

        const business = await businessService.findBusinessById(id);
        if (business) { req.business = business; (req as any).user = business; return next(); }

        return res.status(401).json({ message: 'invalid token' });
    } catch {
        return res.status(401).json({ message: 'invalid token' });
    }
};

/**
 * Requires that the token belongs to a business account.
 * Must run after (or replace) `authenticate` on business-only routes.
 */
export const requireBusiness: RequestHandler = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'missing token' });

    try {
        const payload = verifyAccessToken(auth.slice(7));
        const business = await businessService.findBusinessById(payload.sub);
        if (!business) return res.status(401).json({ message: 'invalid token' });
        req.business = business;
        return next();
    } catch {
        return res.status(401).json({ message: 'invalid token' });
    }
};

export const requireVerification = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ message: 'Authentication required' });
    if (!user.isVerified) {
        return res.status(403).json({ message: 'Email verification required', code: 'VERIFICATION_REQUIRED' });
    }
    next();
};
