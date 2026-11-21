/**
 * Job 'reconcile-balances' (P3.3): concilia saldos contra el historial.
 *
 * 1. Σ items.pointsChange / stampsChange de `transactions` por
 *    (usuario, negocio, sistema) = saldo esperado.
 * 2. Recorre `userpoints` y compara cada sistema con lo esperado; además que
 *    businessPoints.points/stamps == Σ de sus sistemas y que nada sea negativo.
 *    Un saldo esperado distinto de 0 sin entrada en userpoints también cuenta.
 * 3. Canjes/restas cuya recompensa (rewardId) ya no existe.
 *
 * SOLO REPORTA: guarda un ReconciliationRun y lo deja en el JobRun.result.
 * El arreglo es scripts/reconcile-fix.ts --run <runKey>, que corre una persona.
 *
 * En datos de producción viejos se esperan diferencias (saldos de antes de
 * que existiera el historial). En los del seed del lab debe dar 0.
 */
import { Types } from 'mongoose';
import { TransactionModel } from '../models/transaction.model';
import { UserPointsModel } from '../models/userPoints.model';
import { RewardModel } from '../models/reward.model';
import {
    ReconciliationRunModel, ReconcileIssue, ReconcileProblem, OrphanRewardIssue,
} from '../models/reconciliationRun.model';
import { ReconcileParams } from '../queue/jobs';

export const SAMPLE_SIZE = 100;

type Pair = { points: number; stamps: number };
const key = (userId: unknown, businessId: unknown, systemId: unknown) => `${userId}|${businessId}|${systemId}`;

/** Saldo esperado por (usuario, negocio, sistema) según el historial. */
export const expectedBalances = async (businessId?: string): Promise<Map<string, Pair>> => {
    const match = businessId ? { businessId: new Types.ObjectId(businessId) } : {};
    const expected = new Map<string, Pair>();
    const cursor = TransactionModel.aggregate([
        { $match: match },
        { $unwind: '$items' },
        {
            $group: {
                _id: { u: '$userId', b: '$businessId', s: '$items.rewardSystemId' },
                points: { $sum: '$items.pointsChange' },
                stamps: { $sum: '$items.stampsChange' },
            },
        },
    ]).allowDiskUse(true).cursor();
    for await (const row of cursor) {
        expected.set(key(row._id.u, row._id.b, row._id.s), { points: row.points, stamps: row.stamps });
    }
    return expected;
};

export interface ReconcileReport {
    checked: number;
    mismatchCount: number;
    countsByProblem: Partial<Record<ReconcileProblem, number>>;
    issues: ReconcileIssue[];
    orphanRewardCount: number;
    orphanRewardSample: OrphanRewardIssue[];
}

/**
 * Calcula el reporte completo (todas las diferencias). Lo usan el job (que
 * guarda una muestra) y el script de arreglo (que vuelve a revisar antes de escribir).
 */
export const reconcile = async (params: ReconcileParams = {}): Promise<ReconcileReport> => {
    const expected = await expectedBalances(params.businessId);
    const seen = new Set<string>();
    const issues: ReconcileIssue[] = [];
    const countsByProblem: Partial<Record<ReconcileProblem, number>> = {};
    let checked = 0;

    const report = (issue: ReconcileIssue) => {
        issues.push(issue);
        for (const p of issue.problems) countsByProblem[p] = (countsByProblem[p] ?? 0) + 1;
    };

    const bizOid = params.businessId ? new Types.ObjectId(params.businessId) : undefined;
    const filter = bizOid ? { 'businessPoints.businessId': bizOid } : {};

    for await (const doc of UserPointsModel.collection.find(filter, { projection: { userId: 1, businessPoints: 1 } })) {
        for (const bp of (doc.businessPoints ?? []) as any[]) {
            if (bizOid && String(bp.businessId) !== String(bizOid)) continue;
            const sum = { points: 0, stamps: 0 };

            for (const rs of (bp.rewardSystems ?? []) as any[]) {
                checked++;
                const k = key(doc.userId, bp.businessId, rs.rewardSystemId);
                seen.add(k);
                const stored = { points: rs.points ?? 0, stamps: rs.stamps ?? 0 };
                const exp = expected.get(k) ?? { points: 0, stamps: 0 };
                sum.points += stored.points;
                sum.stamps += stored.stamps;

                const problems: ReconcileProblem[] = [];
                if (stored.points !== exp.points || stored.stamps !== exp.stamps) problems.push('ledger_mismatch');
                if (stored.points < 0 || stored.stamps < 0) problems.push('negative');
                if (problems.length) {
                    report({
                        kind: 'system', userId: String(doc.userId), businessId: String(bp.businessId),
                        rewardSystemId: String(rs.rewardSystemId), stored, expected: exp, problems,
                    });
                }
            }

            checked++;
            const total = { points: bp.points ?? 0, stamps: bp.stamps ?? 0 };
            const problems: ReconcileProblem[] = [];
            if (total.points !== sum.points || total.stamps !== sum.stamps) problems.push('total_mismatch');
            if (total.points < 0 || total.stamps < 0) problems.push('negative');
            if (problems.length) {
                report({ kind: 'business_total', userId: String(doc.userId), businessId: String(bp.businessId), stored: total, expected: sum, problems });
            }
        }
    }

    // El historial dice que hay saldo pero no existe la entrada en userpoints
    for (const [k, exp] of expected) {
        if (seen.has(k) || (exp.points === 0 && exp.stamps === 0)) continue;
        const [userId, businessId, rewardSystemId] = k.split('|');
        report({ kind: 'system', userId, businessId, rewardSystemId, stored: null, expected: exp, problems: ['missing_entry'] });
    }

    // Canjes y restas que apuntan a una recompensa que ya no existe
    const txMatch: Record<string, unknown> = { type: { $in: ['subtract', 'redeem'] }, rewardId: { $ne: null } };
    if (bizOid) txMatch.businessId = bizOid;
    const rewardIds = await TransactionModel.distinct('rewardId', txMatch);
    const existing = new Set((await RewardModel.find({ _id: { $in: rewardIds } }, { _id: 1 }).lean()).map((r) => String(r._id)));
    const missing = rewardIds.filter((id) => !existing.has(String(id)));
    let orphanRewardCount = 0;
    let orphanRewardSample: OrphanRewardIssue[] = [];
    if (missing.length) {
        const orphanMatch = { ...txMatch, rewardId: { $in: missing } };
        orphanRewardCount = await TransactionModel.countDocuments(orphanMatch);
        orphanRewardSample = (await TransactionModel.find(orphanMatch, { type: 1, rewardId: 1, businessId: 1 }).limit(SAMPLE_SIZE).lean())
            .map((t) => ({ transactionId: String(t._id), type: t.type, rewardId: String(t.rewardId), businessId: String(t.businessId) }));
    }

    return { checked, mismatchCount: issues.length, countsByProblem, issues, orphanRewardCount, orphanRewardSample };
};

/** Publica las métricas RewardsHub/ReconciliationMismatches y ReconciliationOrphanRewards (el worker la conecta a observability/metrics). */
export type MetricSink = (name: string, value: number) => void;

export const runReconcileJob = async (
    params: ReconcileParams | undefined,
    ctx: { key: string },
    { log = console.log, metric }: { log?: (msg: string) => void; metric?: MetricSink } = {}
) => {
    const startedAt = new Date();
    const report = await reconcile(params ?? {});
    const finishedAt = new Date();

    await ReconciliationRunModel.updateOne(
        { runKey: ctx.key },
        {
            $set: {
                params: params ?? {},
                checked: report.checked,
                mismatchCount: report.mismatchCount,
                countsByProblem: report.countsByProblem,
                sample: report.issues.slice(0, SAMPLE_SIZE),
                orphanRewardCount: report.orphanRewardCount,
                orphanRewardSample: report.orphanRewardSample,
                startedAt,
                finishedAt,
            },
        },
        { upsert: true }
    );

    metric?.('ReconciliationMismatches', report.mismatchCount);
    metric?.('ReconciliationOrphanRewards', report.orphanRewardCount);
    const summary = {
        runKey: ctx.key,
        checked: report.checked,
        mismatchCount: report.mismatchCount,
        countsByProblem: report.countsByProblem,
        orphanRewardCount: report.orphanRewardCount,
        ms: finishedAt.getTime() - startedAt.getTime(),
    };
    log(`🧮 [reconcile] ${JSON.stringify(summary)}`);
    return summary;
};
