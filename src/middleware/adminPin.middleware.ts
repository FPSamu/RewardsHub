import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

/**
 * Requires a valid admin PIN token (issued by POST /business/admin-pin/verify).
 * Must run AFTER authenticateBusiness so req.business is set.
 * The frontend sends the token in the x-admin-token header.
 */
export const requireAdminPin: RequestHandler = (req, res, next) => {
    const token = req.headers['x-admin-token'] as string | undefined;
    if (!token) {
        res.status(403).json({ message: 'Se requiere verificación de PIN de administrador' });
        return;
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET) as any;
        if (payload.type !== 'admin_pin') throw new Error('wrong token type');

        // Make sure the token belongs to the authenticated business
        if (payload.sub !== (req as any).business?.id) {
            res.status(403).json({ message: 'PIN token no válido para este negocio' });
            return;
        }

        next();
    } catch {
        res.status(403).json({ message: 'PIN de administrador expirado o inválido. Vuelve a verificar tu PIN.' });
    }
};
