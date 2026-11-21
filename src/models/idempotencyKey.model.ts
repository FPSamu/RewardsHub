import { Schema, model, Document } from 'mongoose';

/**
 * Registro de una petición con Idempotency-Key (ver idempotency.middleware.ts).
 *
 * scope = `${actorId}:${method}:${ruta}`: la misma llave de dos negocios, o en
 * dos endpoints, son registros distintos. Se borra solo a las 24 h (TTL).
 */
export interface IIdempotencyKey extends Document {
    scope: string;
    key: string;
    requestHash: string;
    status: 'in_progress' | 'completed';
    responseStatus?: number;
    responseBody?: unknown;
    createdAt: Date;
    /** Cuándo la tomó la petición en curso; sirve para retomar una que murió a medias. */
    lockedAt: Date;
}

const idempotencyKeySchema = new Schema<IIdempotencyKey>(
    {
        scope: { type: String, required: true },
        key: { type: String, required: true },
        requestHash: { type: String, required: true },
        status: { type: String, enum: ['in_progress', 'completed'], required: true },
        responseStatus: { type: Number },
        responseBody: { type: Schema.Types.Mixed },
        createdAt: { type: Date, default: Date.now, expires: 24 * 3600 },
        lockedAt: { type: Date, default: Date.now },
    },
    { timestamps: false, minimize: false }
);

idempotencyKeySchema.index({ scope: 1, key: 1 }, { unique: true });

export const IdempotencyKeyModel = model<IIdempotencyKey>('IdempotencyKey', idempotencyKeySchema);
