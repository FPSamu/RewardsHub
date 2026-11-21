import { Schema, model, Document } from 'mongoose';

/**
 * Resultado de una corrida de conciliación (job 'reconcile-balances', P3.3).
 * Solo reporta: arreglar es scripts/reconcile-fix.ts, que corre una persona.
 */
export type ReconcileProblem = 'ledger_mismatch' | 'negative' | 'total_mismatch' | 'missing_entry';

export interface ReconcileIssue {
    /**
     * - 'system': saldo de un sistema (userpoints.businessPoints[].rewardSystems[]) vs Σ del historial.
     * - 'business_total': businessPoints[].points/stamps vs Σ de sus sistemas.
     */
    kind: 'system' | 'business_total';
    userId: string;
    businessId: string;
    rewardSystemId?: string;
    stored: { points: number; stamps: number } | null;
    expected: { points: number; stamps: number };
    problems: ReconcileProblem[];
}

export interface OrphanRewardIssue {
    transactionId: string;
    type: string;
    rewardId: string;
    businessId: string;
}

export interface IReconciliationRun extends Document {
    runKey: string;
    params?: Record<string, unknown>;
    /** Saldos revisados (entradas de sistema + totales por negocio). */
    checked: number;
    mismatchCount: number;
    countsByProblem: Partial<Record<ReconcileProblem, number>>;
    /** Primeras 100 diferencias (lo que el script de arreglo puede corregir). */
    sample: ReconcileIssue[];
    orphanRewardCount: number;
    orphanRewardSample: OrphanRewardIssue[];
    startedAt: Date;
    finishedAt?: Date;
}

const reconciliationRunSchema = new Schema<IReconciliationRun>(
    {
        runKey: { type: String, required: true, unique: true },
        params: { type: Schema.Types.Mixed },
        checked: { type: Number, default: 0 },
        mismatchCount: { type: Number, default: 0 },
        countsByProblem: { type: Schema.Types.Mixed, default: {} },
        sample: { type: Schema.Types.Mixed, default: [] },
        orphanRewardCount: { type: Number, default: 0 },
        orphanRewardSample: { type: Schema.Types.Mixed, default: [] },
        startedAt: { type: Date, required: true },
        finishedAt: { type: Date },
    },
    { timestamps: false, minimize: false }
);

export const ReconciliationRunModel = model<IReconciliationRun>(
    'ReconciliationRun', reconciliationRunSchema, 'reconciliation_runs'
);
