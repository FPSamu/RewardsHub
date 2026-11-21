import { Schema, model, Document, Types } from 'mongoose';

/**
 * Agregados diarios de transacciones por negocio (P2.3). Un día = día UTC.
 *
 * Dos tipos de fila por (negocio, día):
 * - kind 'business': todo el negocio. Se escribe SIEMPRE, aunque el día no
 *   tenga movimiento: su existencia significa "este día ya está calculado".
 * - kind 'branch': una por sucursal con movimiento. branchId null = las
 *   transacciones sin sucursal, igual que el `$group _id: null` de las
 *   estadísticas en vivo (por eso el "todo el negocio" no puede ser branchId null).
 *
 * Reglas (las mismas de businessStats.service.ts):
 * - pointsAdded / stampsAdded / addCount: transacciones 'add'.
 * - revenueAllAdds: Σ purchaseAmount de toda 'add' (serie diaria y KPIs).
 * - revenueWithPoints: Σ purchaseAmount de 'add' con puntos > 0 (getBusinessStats).
 * - redeemCount / pointsRedeemed / stampsRedeemed: transacciones 'redeem'.
 * - newClients: clientes cuya PRIMERA transacción con el negocio fue ese día,
 *   contados en la sucursal de esa primera transacción.
 */
export interface IDailyStat extends Document {
    businessId: Types.ObjectId;
    kind: 'business' | 'branch';
    branchId: Types.ObjectId | null;
    day: string; // YYYY-MM-DD (UTC)
    txCount: number;
    addCount: number;
    subtractCount: number;
    redeemCount: number;
    pointsAdded: number;
    stampsAdded: number;
    pointsRedeemed: number;
    stampsRedeemed: number;
    revenueWithPoints: number;
    revenueAllAdds: number;
    newClients: number;
    /** Solo en filas 'business' (no se puede sumar entre sucursales). */
    uniqueClients?: number;
    computedAt: Date;
}

const counter = { type: Number, default: 0 };

const dailyStatSchema = new Schema<IDailyStat>(
    {
        businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
        kind: { type: String, enum: ['business', 'branch'], required: true },
        branchId: { type: Schema.Types.ObjectId, default: null },
        day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
        txCount: counter,
        addCount: counter,
        subtractCount: counter,
        redeemCount: counter,
        pointsAdded: counter,
        stampsAdded: counter,
        pointsRedeemed: counter,
        stampsRedeemed: counter,
        revenueWithPoints: counter,
        revenueAllAdds: counter,
        newClients: counter,
        uniqueClients: { type: Number },
        computedAt: { type: Date, required: true },
    },
    { timestamps: false }
);

dailyStatSchema.index({ businessId: 1, kind: 1, branchId: 1, day: 1 }, { unique: true });
// Réplica a DynamoDB (job replicate-dynamo): lee en orden (computedAt, _id) desde el checkpoint
dailyStatSchema.index({ computedAt: 1, _id: 1 });

export const DailyStatModel = model<IDailyStat>('DailyStat', dailyStatSchema, 'daily_stats');
