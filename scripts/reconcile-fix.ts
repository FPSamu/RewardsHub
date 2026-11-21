/**
 * Corrige saldos según una corrida de conciliación (P3.3). LO CORRE UNA PERSONA.
 *
 *   DB_NAME=rewardshub_lab npx ts-node scripts/reconcile-fix.ts --run <runKey>           # dry run (default)
 *   DB_NAME=rewardshub_lab npx ts-node scripts/reconcile-fix.ts --run <runKey> --apply
 *
 * El historial (`transactions`) es la fuente de verdad: cada saldo de la
 * muestra de la corrida se deja igual a Σ de su historial, y el total del
 * negocio igual a Σ de sus sistemas.
 *
 * Cuidados:
 * - Solo toca lo que está en la muestra de esa corrida (lo que alguien revisó),
 *   y solo si el saldo guardado SIGUE siendo el que vio la corrida (si cambió
 *   desde entonces, se omite: vuelve a correr la conciliación).
 * - Antes de escribir recalcula la conciliación en este momento y solo
 *   corrige lo que todavía no cuadra.
 * - Un saldo esperado negativo (historial incoherente) no se corrige: se reporta.
 * - Llama a assertNonProductionDb(): en producción hay saldos de antes del
 *   historial, y "corregirlos" los borraría. No hay --prod a propósito.
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose, { Types } from 'mongoose';
import { buildConnectOptions } from '../src/db/mongoose';
import { assertNonProductionDb } from '../src/db/safety';
import { UserPointsModel } from '../src/models/userPoints.model';
import { ReconciliationRunModel, ReconcileIssue } from '../src/models/reconciliationRun.model';
import { reconcile } from '../src/jobs/reconcile.job';

export type FixOutcome = 'fixed' | 'would_fix' | 'skipped_changed' | 'skipped_resolved' | 'skipped_negative_expected';

export interface FixResult {
    runKey: string;
    applied: boolean;
    outcomes: Record<FixOutcome, number>;
    notInSample: number;
    details: Array<{ issue: ReconcileIssue; outcome: FixOutcome }>;
}

const issueKey = (i: Pick<ReconcileIssue, 'kind' | 'userId' | 'businessId' | 'rewardSystemId'>) =>
    `${i.kind}|${i.userId}|${i.businessId}|${i.rewardSystemId ?? ''}`;

const same = (a: { points: number; stamps: number } | null, b: { points: number; stamps: number } | null) =>
    a === b || (!!a && !!b && a.points === b.points && a.stamps === b.stamps);

/** Recalcula businessPoints[].points/stamps = Σ de sus sistemas. */
const syncBusinessTotal = async (userId: Types.ObjectId, businessId: Types.ObjectId) => {
    const doc = await UserPointsModel.collection.findOne({ userId }, { projection: { businessPoints: 1 } });
    const bp = (doc?.businessPoints as any[] | undefined)?.find((b) => String(b.businessId) === String(businessId));
    if (!bp) return;
    const points = (bp.rewardSystems ?? []).reduce((s: number, r: any) => s + (r.points ?? 0), 0);
    const stamps = (bp.rewardSystems ?? []).reduce((s: number, r: any) => s + (r.stamps ?? 0), 0);
    await UserPointsModel.collection.updateOne(
        { userId },
        { $set: { 'businessPoints.$[bp].points': points, 'businessPoints.$[bp].stamps': stamps } },
        { arrayFilters: [{ 'bp.businessId': businessId }] }
    );
};

/** Aplica un arreglo; el filtro exige el saldo que vio la corrida (si cambió, no toca nada). */
const applyFix = async (issue: ReconcileIssue): Promise<boolean> => {
    const userId = new Types.ObjectId(issue.userId);
    const businessId = new Types.ObjectId(issue.businessId);
    const now = new Date();

    if (issue.kind === 'business_total') {
        const res = await UserPointsModel.collection.updateOne(
            { userId, businessPoints: { $elemMatch: { businessId, points: issue.stored!.points, stamps: issue.stored!.stamps } } },
            { $set: { 'businessPoints.$[bp].points': issue.expected.points, 'businessPoints.$[bp].stamps': issue.expected.stamps } },
            { arrayFilters: [{ 'bp.businessId': businessId }] }
        );
        return res.matchedCount === 1;
    }

    const rewardSystemId = new Types.ObjectId(issue.rewardSystemId);
    if (issue.stored === null) {
        // missing_entry: crear la entrada (y el documento/negocio si faltan) con el saldo del historial
        await UserPointsModel.collection.updateOne(
            { userId }, { $setOnInsert: { userId, businessPoints: [], createdAt: now, updatedAt: now } }, { upsert: true }
        );
        await UserPointsModel.collection.updateOne(
            { userId, 'businessPoints.businessId': { $ne: businessId } },
            { $push: { businessPoints: { businessId, points: 0, stamps: 0, lastVisit: now, rewardSystems: [] } } } as any
        );
        const res = await UserPointsModel.collection.updateOne(
            { userId, businessPoints: { $elemMatch: { businessId, 'rewardSystems.rewardSystemId': { $ne: rewardSystemId } } } },
            { $push: { 'businessPoints.$[bp].rewardSystems': { rewardSystemId, ...issue.expected, lastUpdated: now } } } as any,
            { arrayFilters: [{ 'bp.businessId': businessId }] }
        );
        if (res.matchedCount !== 1) return false;
    } else {
        const res = await UserPointsModel.collection.updateOne(
            {
                userId,
                businessPoints: { $elemMatch: { businessId, rewardSystems: { $elemMatch: {
                    rewardSystemId, points: issue.stored.points, stamps: issue.stored.stamps,
                } } } },
            },
            { $set: {
                'businessPoints.$[bp].rewardSystems.$[rs].points': issue.expected.points,
                'businessPoints.$[bp].rewardSystems.$[rs].stamps': issue.expected.stamps,
            } },
            { arrayFilters: [{ 'bp.businessId': businessId }, { 'rs.rewardSystemId': rewardSystemId }] }
        );
        if (res.matchedCount !== 1) return false;
    }
    // El total del negocio debe seguir a sus sistemas
    await syncBusinessTotal(userId, businessId);
    return true;
};

export const reconcileFix = async (
    runKey: string,
    { apply = false, log = console.log }: { apply?: boolean; log?: (msg: string) => void } = {}
): Promise<FixResult> => {
    if (apply) assertNonProductionDb();

    const run = await ReconciliationRunModel.findOne({ runKey }).lean();
    if (!run) throw new Error(`No existe la corrida "${runKey}"`);

    // Lo que sigue sin cuadrar AHORA (otra cosa pudo haberlo corregido ya)
    const current = await reconcile((run.params ?? {}) as { businessId?: string });
    const stillOpen = new Map(current.issues.map((i) => [issueKey(i), i]));

    const outcomes: Record<FixOutcome, number> = {
        fixed: 0, would_fix: 0, skipped_changed: 0, skipped_resolved: 0, skipped_negative_expected: 0,
    };
    const details: FixResult['details'] = [];
    const record = (issue: ReconcileIssue, outcome: FixOutcome) => {
        outcomes[outcome]++;
        details.push({ issue, outcome });
    };

    // Primero los sistemas; los totales del negocio al final (el arreglo de un
    // sistema ya resincroniza su total, y el total suelto puede quedar resuelto)
    const ordered = [...(run.sample as ReconcileIssue[])].sort((a, b) =>
        (a.kind === 'business_total' ? 1 : 0) - (b.kind === 'business_total' ? 1 : 0));

    for (const issue of ordered) {
        const now = stillOpen.get(issueKey(issue));
        if (!now) { record(issue, 'skipped_resolved'); continue; }
        if (!same(now.stored, issue.stored)) { record(issue, 'skipped_changed'); continue; }
        if (issue.expected.points < 0 || issue.expected.stamps < 0) { record(issue, 'skipped_negative_expected'); continue; }
        if (!apply) { record(issue, 'would_fix'); continue; }

        if (issue.kind === 'business_total') {
            // Puede haberse resuelto al arreglar un sistema del mismo negocio
            const recheck = await reconcile({ businessId: issue.businessId });
            const open = recheck.issues.find((i) => issueKey(i) === issueKey(issue));
            if (!open) { record(issue, 'skipped_resolved'); continue; }
        }
        record(issue, (await applyFix(issue)) ? 'fixed' : 'skipped_changed');
    }

    const result = { runKey, applied: apply, outcomes, notInSample: Math.max(0, run.mismatchCount - run.sample.length), details };
    log(`${apply ? '✅ Aplicado' : '🔎 Dry run'} ${runKey}: ${JSON.stringify(outcomes)}` +
        (result.notInSample ? ` · ${result.notInSample} diferencias fuera de la muestra: vuelve a correr reconcile-balances` : ''));
    return result;
};

const main = async () => {
    const args = process.argv.slice(2);
    const runIdx = args.indexOf('--run');
    const runKey = runIdx >= 0 ? args[runIdx + 1] : undefined;
    const apply = args.includes('--apply');
    const unknown = args.filter((a, i) => !['--run', '--apply', '--dry-run'].includes(a) && i !== runIdx + 1);
    if (!runKey || unknown.length) {
        throw new Error('Uso: npx ts-node scripts/reconcile-fix.ts --run <runKey> [--apply]');
    }

    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI no está configurada');
    await mongoose.connect(uri, { ...buildConnectOptions(), autoIndex: false });
    try {
        // Incluso el dry run se niega fuera de lab/test: este script no es para producción
        assertNonProductionDb();
        const result = await reconcileFix(runKey, { apply });
        console.table(result.details.slice(0, 50).map(({ issue, outcome }) => ({
            outcome, kind: issue.kind, userId: issue.userId, rewardSystemId: issue.rewardSystemId ?? '-',
            stored: issue.stored ? `${issue.stored.points}/${issue.stored.stamps}` : '(no existe)',
            expected: `${issue.expected.points}/${issue.expected.stamps}`,
        })));
    } finally {
        await mongoose.disconnect();
    }
};

if (require.main === module) {
    main().catch((err) => {
        console.error('❌ reconcile-fix falló:', err?.message ?? err);
        process.exit(1);
    });
}
