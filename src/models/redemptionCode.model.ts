import { Schema, model, Document, Types } from 'mongoose';

export interface IRedemptionCode extends Document {
    code: string;
    businessId: Types.ObjectId;
    amount: number; // Monto de la compra en dinero
    pointsEstimate: number; // Puntos estimados al momento de generar
    isRedeemed: boolean;
    redeemedBy?: Types.ObjectId;
    redeemedAt?: Date;
    expiresAt: Date;
    createdAt: Date;
}

const redemptionCodeSchema = new Schema<IRedemptionCode>(
    {
        code: { type: String, required: true, unique: true, index: true, uppercase: true },
        businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
        amount: { type: Number, required: true },
        pointsEstimate: { type: Number, required: true },
        isRedeemed: { type: Boolean, default: false },
        redeemedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        redeemedAt: { type: Date },
        expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL Index para limpieza auto
    },
    { timestamps: true }
);

export const RedemptionCodeModel = model<IRedemptionCode>('RedemptionCode', redemptionCodeSchema);