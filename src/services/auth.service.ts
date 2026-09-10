import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Model } from 'mongoose';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;
// Se aceptan los dos nombres: `render.yaml` y despliegues antiguos usan
// JWT_*_IN, mientras que .env local usa ACCESS_/REFRESH_EXPIRES. Leer solo uno
// hacía que cambiar el TTL desde el dashboard no tuviera ningún efecto.
const ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || process.env.JWT_REFRESH_EXPIRES_IN || '7d';
// Ventana durante la cual un refresh token ya rotado se sigue aceptando. Cubre
// la carrera de dos pestañas que descubren el access token expirado a la vez:
// la segunda llega con el token que la primera acaba de rotar, y sin esto se
// quedaba sin sesión. Solo aplica a rotaciones — el logout invalida al instante.
const REFRESH_GRACE_MS = parseInt(process.env.REFRESH_GRACE_SECONDS || '30', 10) * 1000;

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

export const issueAccessToken = (id: string, role: AccountRole): string =>
    (jwt as any).sign({ sub: id, role }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });

export const issueTokenPair = (id: string, role: AccountRole): TokenPair => {
    const accessToken = issueAccessToken(id, role);
    // El `jti` hace único cada refresh token. Sin él, dos emisiones para la
    // misma cuenta dentro del mismo segundo salen idénticas (el `iat` del JWT
    // solo tiene precisión de segundos) y la rotación se queda en nada — justo
    // en la carrera de dos pestañas, que es cuando más importa.
    const refreshToken = (jwt as any).sign(
        { sub: id, role, jti: crypto.randomUUID() },
        REFRESH_SECRET,
        { expiresIn: REFRESH_EXPIRES }
    );
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

/**
 * Canjea `oldToken` por `newToken` y deja constancia de la rotación para el
 * periodo de gracia, además de podar las anotaciones ya caducadas.
 *
 * Se hace con un update pipeline (una sola escritura) porque quitar y añadir en
 * dos pasos deja una ventana en la que la cuenta no tiene ningún token válido —
 * justo la carrera que este mecanismo viene a resolver.
 */
export const rotateRefreshToken = async (
    model: Model<any>,
    id: string,
    oldToken: string,
    newToken: string
): Promise<void> => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - REFRESH_GRACE_MS);

    await model.findByIdAndUpdate(id, [
        {
            $set: {
                refreshTokens: {
                    $concatArrays: [
                        {
                            $filter: {
                                input: { $ifNull: ['$refreshTokens', []] },
                                cond: { $ne: ['$$this', oldToken] },
                            },
                        },
                        [newToken],
                    ],
                },
                rotatedRefreshTokens: {
                    $concatArrays: [
                        {
                            $filter: {
                                input: { $ifNull: ['$rotatedRefreshTokens', []] },
                                cond: { $gt: ['$$this.rotatedAt', cutoff] },
                            },
                        },
                        [{ token: oldToken, replacedBy: newToken, rotatedAt: now }],
                    ],
                },
            },
        },
    ]).exec();
};

/**
 * Para un refresh token que ya no está activo, devuelve el que lo sustituyó si
 * la rotación cae dentro del periodo de gracia; si no, null.
 *
 * Sigue la cadena por si hubo varias rotaciones seguidas, y solo da por bueno
 * un reemplazo que siga activo — así un logout invalida la cadena entera y no
 * se puede resucitar una sesión cerrada.
 */
export const resolveGracedRefreshToken = async (
    model: Model<any>,
    id: string,
    token: string
): Promise<string | null> => {
    const doc = await model
        .findById(id)
        .select('refreshTokens rotatedRefreshTokens')
        .lean()
        .exec();
    if (!doc) return null;

    const active: string[] = (doc as any).refreshTokens || [];
    const rotations: Array<{ token: string; replacedBy: string; rotatedAt: Date }> =
        (doc as any).rotatedRefreshTokens || [];
    const cutoff = Date.now() - REFRESH_GRACE_MS;

    let current = token;
    // Cota para no dar vueltas si los datos vinieran con un ciclo.
    for (let hop = 0; hop < 5; hop++) {
        const record = rotations.find((r) => r.token === current);
        if (!record) return null;
        if (new Date(record.rotatedAt).getTime() < cutoff) return null;
        if (active.includes(record.replacedBy)) return record.replacedBy;
        current = record.replacedBy;
    }
    return null;
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
