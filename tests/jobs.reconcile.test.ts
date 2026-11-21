/**
 * P3.3 / P3.4 — job 'reconcile-balances' y scripts/reconcile-fix.ts (replica set en memoria).
 *
 * - Datos del seed: 0 diferencias.
 * - Cada saldo corrompido a mano aparece exactamente una vez.
 * - El script de arreglo: dry run no escribe; --apply deja todo cuadrado;
 *   no toca lo que cambió desde la corrida; no corre en bases que no son de lab.
 */
import mongoose from 'mongoose';
import { useReplSet, ensureCollections } from './helpers/replset';
import { generateLabDataset, LabDataset } from '../src/db/seed/labDataset';
import { TransactionModel } from '../src/models/transaction.model';
import { UserPointsModel } from '../src/models/userPoints.model';
import { RewardModel } from '../src/models/reward.model';
import { ReconciliationRunModel } from '../src/models/reconciliationRun.model';
import { reconcile, runReconcileJob, SAMPLE_SIZE } from '../src/jobs/reconcile.job';
import * as safety from '../src/db/safety';
import { ProductionDbError } from '../src/db/safety';
import { reconcileFix } from '../scripts/reconcile-fix';

useReplSet('jobs_reconcile_test');

const quiet = () => undefined;
let data: LabDataset;

const reload = async () => {
    await Promise.all([TransactionModel.deleteMany({}), UserPointsModel.deleteMany({}), RewardModel.deleteMany({}),
        ReconciliationRunModel.deleteMany({})]);
    await TransactionModel.collection.insertMany(data.transactions.map((t) => ({ ...t })));
    // Copia profunda que conserva los ObjectId (structuredClone los vuelve objetos planos)
    await UserPointsModel.collection.insertMany(data.userPoints.map((up) => ({
        ...up,
        businessPoints: up.businessPoints.map((bp: any) => ({ ...bp, rewardSystems: bp.rewardSystems.map((rs: any) => ({ ...rs })) })),
    })));
    await RewardModel.collection.insertMany(data.rewards.map((r) => ({ ...r })));
};

beforeAll(async () => {
    await ensureCollections(TransactionModel, UserPointsModel, RewardModel, ReconciliationRunModel);
    data = generateLabDataset({ seed: 5, businesses: 3, users: 80, transactions: 2000, days: 20 });
});

beforeEach(reload);

/** Un usuario con saldo de puntos > 10 en algún sistema. */
const someBalance = () => {
    for (const up of data.userPoints) for (const [bi, bp] of up.businessPoints.entries()) {
        const ri = bp.rewardSystems.findIndex((r: any) => r.points > 10);
        if (ri >= 0) return { userId: up.userId, bi, ri, bp, rs: bp.rewardSystems[ri] };
    }
    throw new Error('sin saldos en el seed');
};

describe('reconcile-balances', () => {
    it('en datos del seed reporta 0 diferencias y guarda la corrida', async () => {
        const out = await runReconcileJob(undefined, { key: 'reconcile-balances:2026-11-19T07:30' }, { log: quiet });
        expect(out.mismatchCount).toBe(0);
        expect(out.orphanRewardCount).toBe(0);
        expect(out.checked).toBeGreaterThan(100);

        const run = await ReconciliationRunModel.findOne({ runKey: 'reconcile-balances:2026-11-19T07:30' }).lean();
        expect(run).toMatchObject({ mismatchCount: 0, sample: [], orphanRewardCount: 0 });
        expect(run!.finishedAt).toBeInstanceOf(Date);
    });

    it('un saldo corrompido (sistema y total juntos, como una suma perdida) → exactamente 1', async () => {
        const { userId, bi, ri, rs } = someBalance();
        await UserPointsModel.collection.updateOne({ userId }, {
            $inc: { [`businessPoints.${bi}.rewardSystems.${ri}.points`]: 7, [`businessPoints.${bi}.points`]: 7 },
        });

        const report = await reconcile();
        expect(report.mismatchCount).toBe(1);
        expect(report.issues[0]).toMatchObject({
            kind: 'system', userId: String(userId), rewardSystemId: String(rs.rewardSystemId),
            stored: { points: rs.points + 7 }, expected: { points: rs.points }, problems: ['ledger_mismatch'],
        });
    });

    it('solo el total del negocio descuadrado → 1 total_mismatch', async () => {
        const { userId, bi } = someBalance();
        await UserPointsModel.collection.updateOne({ userId }, { $inc: { [`businessPoints.${bi}.points`]: -3 } });
        const report = await reconcile();
        expect(report.mismatchCount).toBe(1);
        expect(report.issues[0]).toMatchObject({ kind: 'business_total', problems: ['total_mismatch'] });
    });

    it('saldo negativo → una sola diferencia con los dos problemas', async () => {
        const { userId, bi, ri, rs } = someBalance();
        const delta = -(rs.points + 5);
        await UserPointsModel.collection.updateOne({ userId }, {
            $inc: { [`businessPoints.${bi}.rewardSystems.${ri}.points`]: delta, [`businessPoints.${bi}.points`]: delta },
        });
        const report = await reconcile();
        const systemIssues = report.issues.filter((i) => i.kind === 'system');
        expect(systemIssues).toHaveLength(1);
        expect(systemIssues[0].problems).toEqual(['ledger_mismatch', 'negative']);
    });

    it('el historial tiene saldo pero falta la entrada en userpoints → missing_entry', async () => {
        const { userId, bi, rs, bp } = someBalance();
        await UserPointsModel.collection.updateOne({ userId }, {
            $pull: { [`businessPoints.${bi}.rewardSystems`]: { rewardSystemId: rs.rewardSystemId } },
            $set: { [`businessPoints.${bi}.points`]: bp.points - rs.points, [`businessPoints.${bi}.stamps`]: bp.stamps - rs.stamps },
        } as any);
        const report = await reconcile();
        expect(report.mismatchCount).toBe(1);
        expect(report.issues[0]).toMatchObject({ kind: 'system', stored: null, problems: ['missing_entry'], expected: { points: rs.points } });
    });

    it('canjes cuya recompensa ya no existe se reportan aparte', async () => {
        const redeem = data.transactions.find((t) => t.type === 'redeem')!;
        const sameReward = data.transactions.filter((t) => String(t.rewardId) === String(redeem.rewardId)).length;
        await RewardModel.deleteOne({ _id: redeem.rewardId });

        const report = await reconcile();
        expect(report.mismatchCount).toBe(0);
        expect(report.orphanRewardCount).toBe(sameReward);
        expect(report.orphanRewardSample[0]).toMatchObject({ rewardId: String(redeem.rewardId), type: 'redeem' });
    });

    it('businessId limita la revisión a ese negocio', async () => {
        const { userId, bi, ri, bp } = someBalance();
        await UserPointsModel.collection.updateOne({ userId }, {
            $inc: { [`businessPoints.${bi}.rewardSystems.${ri}.points`]: 1, [`businessPoints.${bi}.points`]: 1 },
        });
        const other = data.businesses.map((b) => String(b._id)).find((id) => id !== String(bp.businessId))!;
        expect((await reconcile({ businessId: String(bp.businessId) })).mismatchCount).toBe(1);
        expect((await reconcile({ businessId: other })).mismatchCount).toBe(0);
    });

    it(`la muestra guardada se limita a ${SAMPLE_SIZE}; repetir la corrida con la misma llave la sobrescribe`, async () => {
        // todos los totales por negocio descuadrados (más de 100 entradas)
        await UserPointsModel.collection.updateMany({}, { $inc: { 'businessPoints.$[].points': 1 } });
        const out = await runReconcileJob(undefined, { key: 'k1' }, { log: quiet });
        expect(out.mismatchCount).toBeGreaterThan(SAMPLE_SIZE);
        const run = await ReconciliationRunModel.findOne({ runKey: 'k1' }).lean();
        expect(run!.sample).toHaveLength(SAMPLE_SIZE);

        await reload();
        await runReconcileJob(undefined, { key: 'k1' }, { log: quiet });
        expect(await ReconciliationRunModel.countDocuments({ runKey: 'k1' })).toBe(1);
        expect((await ReconciliationRunModel.findOne({ runKey: 'k1' }).lean())!.mismatchCount).toBe(0);
    });

    it('publica la métrica de diferencias (P6.3 la conecta a CloudWatch)', async () => {
        const metric = jest.fn();
        await runReconcileJob(undefined, { key: 'k-metric' }, { log: quiet, metric });
        expect(metric).toHaveBeenCalledWith('ReconciliationMismatches', 0);
    });
});

describe('scripts/reconcile-fix', () => {
    const corruptTwo = async () => {
        const a = someBalance();
        await UserPointsModel.collection.updateOne({ userId: a.userId }, {
            $inc: { [`businessPoints.${a.bi}.rewardSystems.${a.ri}.points`]: 9, [`businessPoints.${a.bi}.points`]: 9 },
        });
        // otro usuario: solo el total
        const b = data.userPoints.find((u) => String(u.userId) !== String(a.userId))!;
        await UserPointsModel.collection.updateOne({ userId: b.userId }, { $inc: { 'businessPoints.0.stamps': 2 } });
        await runReconcileJob(undefined, { key: 'run-fix' }, { log: quiet });
        return { a, b };
    };

    it('dry run no escribe; --apply deja la conciliación en 0', async () => {
        await corruptTwo();
        const before = await UserPointsModel.collection.find().toArray();

        const dry = await reconcileFix('run-fix', { log: quiet });
        expect(dry.outcomes.would_fix).toBe(2);
        expect(await UserPointsModel.collection.find().toArray()).toEqual(before);

        const applied = await reconcileFix('run-fix', { apply: true, log: quiet });
        expect(applied.outcomes.fixed).toBe(2);
        expect((await reconcile()).mismatchCount).toBe(0);

        // correrlo otra vez no hace nada (ya está resuelto)
        const again = await reconcileFix('run-fix', { apply: true, log: quiet });
        expect(again.outcomes).toMatchObject({ fixed: 0, skipped_resolved: 2 });
    });

    it('no toca un saldo que cambió desde la corrida', async () => {
        const { a } = await corruptTwo();
        await UserPointsModel.collection.updateOne({ userId: a.userId }, {
            $inc: { [`businessPoints.${a.bi}.rewardSystems.${a.ri}.points`]: 1, [`businessPoints.${a.bi}.points`]: 1 },
        });
        const out = await reconcileFix('run-fix', { apply: true, log: quiet });
        expect(out.outcomes.skipped_changed).toBe(1);
        expect(out.outcomes.fixed).toBe(1);
    });

    it('recrea una entrada faltante con el saldo del historial', async () => {
        const { userId, bi, rs, bp } = someBalance();
        await UserPointsModel.collection.updateOne({ userId }, {
            $pull: { [`businessPoints.${bi}.rewardSystems`]: { rewardSystemId: rs.rewardSystemId } },
            $set: { [`businessPoints.${bi}.points`]: bp.points - rs.points, [`businessPoints.${bi}.stamps`]: bp.stamps - rs.stamps },
        } as any);
        await runReconcileJob(undefined, { key: 'run-missing' }, { log: quiet });

        const out = await reconcileFix('run-missing', { apply: true, log: quiet });
        expect(out.outcomes.fixed).toBe(1);
        expect((await reconcile()).mismatchCount).toBe(0);
    });

    it('--apply pasa por assertNonProductionDb antes de escribir; si se niega, no toca nada', async () => {
        await corruptTwo();
        // Las reglas del candado (qué nombres de base pasan) están en tests/db.safety.test.ts;
        // aquí se prueba que el script lo llama y respeta el rechazo.
        const guard = jest.spyOn(safety, 'assertNonProductionDb').mockImplementation(() => {
            throw new ProductionDbError('La base "rewardshub" no parece de lab/test');
        });
        try {
            await expect(reconcileFix('run-fix', { apply: true, log: quiet })).rejects.toThrow(ProductionDbError);
            expect(guard).toHaveBeenCalled();
        } finally {
            guard.mockRestore();
        }
        expect((await reconcile()).mismatchCount).toBe(2); // nada se tocó
        expect(mongoose.connection.db!.databaseName).toMatch(/_test$/);
    });

    it('una corrida inexistente es un error claro', async () => {
        await expect(reconcileFix('no-existe', { log: quiet })).rejects.toThrow('No existe la corrida "no-existe"');
    });
});
