/**
 * Rotated refresh token subdocument
 *
 * Cada vez que se canjea un refresh token se emite uno nuevo y el anterior se
 * anota aquí junto con su reemplazo. Durante el periodo de gracia
 * (REFRESH_GRACE_SECONDS) el token anotado sigue siendo canjeable y devuelve
 * ese mismo reemplazo, en vez de cerrar la sesión.
 *
 * Sin esto, dos pestañas que descubren el access token expirado a la vez se
 * pisan: la primera rota el token y la segunda llega con uno que ya no existe.
 *
 * Compartido por User y Business, que tienen el mismo flujo de sesión.
 */
import { Schema } from 'mongoose';

export interface IRotatedRefreshToken {
    /** El refresh token que se canjeó */
    token: string;
    /** El refresh token que se emitió en su lugar */
    replacedBy: string;
    /** Cuándo ocurrió la rotación — marca el inicio del periodo de gracia */
    rotatedAt: Date;
}

export const rotatedRefreshTokenSchema = new Schema<IRotatedRefreshToken>(
    {
        token: { type: String, required: true },
        replacedBy: { type: String, required: true },
        rotatedAt: { type: Date, required: true },
    },
    { _id: false }
);
