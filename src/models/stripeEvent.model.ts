import { Schema, model, Document } from 'mongoose';

/**
 * Eventos de Stripe ya recibidos (deduplicación del webhook por event.id).
 *
 * Stripe entrega "al menos una vez": el mismo evento puede llegar dos veces
 * (reintentos, o dos instancias detrás del ALB). El _id es el event.id, así
 * que el segundo insert falla por llave duplicada y no se procesa otra vez.
 * Se borran solos a los 30 días (Stripe deja de reintentar a los 3).
 */
export interface IStripeEvent extends Document<string> {
    _id: string;
    type: string;
    status: 'processing' | 'processed';
    receivedAt: Date;
    processedAt?: Date;
}

const stripeEventSchema = new Schema<IStripeEvent>(
    {
        _id: { type: String, required: true },
        type: { type: String, required: true },
        status: { type: String, enum: ['processing', 'processed'], required: true },
        receivedAt: { type: Date, default: Date.now, expires: 30 * 24 * 3600 },
        processedAt: { type: Date },
    },
    { timestamps: false, _id: false }
);

export const StripeEventModel = model<IStripeEvent>('StripeEvent', stripeEventSchema);
