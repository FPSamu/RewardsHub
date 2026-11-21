/**
 * P3.2 / P3.4 — job 'daily-stats' (replica set en memoria).
 *
 * Reusa computeDailyStats (P2.3). Idempotente; un backfill largo se parte por
 * semanas; y lo que deja en daily_stats es justo lo que leen los lectores con
 * STATS_SOURCE=daily.
 */
import { useReplSet, ensureCollections } from './helpers/replset';
import { generateLabDataset } from '../src/db/seed/labDataset';
import { BusinessModel } from '../src/models/business.model';
import { TransactionModel } from '../src/models/transaction.model';
import { DailyStatModel } from '../src/models/dailyStat.model';
import { JobRunModel } from '../src/models/jobRun.model';
import { runDailyStatsJob, resolveDays, splitRange } from '../src/jobs/dailyStats.job';
import { getTimeSeriesStats, getKpiSummary } from '../src/services/businessStats.service';
import { utcDay } from '../src/services/dailyStats.service';
import { processMessage } from '../src/queue/processor';
import { acquireJob, completeJob, releaseJob } from '../src/queue/jobLock';
import { jobRunKey, parseJobMessage } from '../src/queue/jobs';

useReplSet('jobs_daily_stats_test');

const quiet = () => undefined;
const NOW = new Date();
const today = utcDay(NOW);
const daysAgo = (n: number) => utcDay(new Date(NOW.getTime() - n * 86_400_000));
let businessIds: string[] = [];

beforeAll(async () => {
    await ensureCollections(BusinessModel, TransactionModel, DailyStatModel, JobRunModel);
    const data = generateLabDataset({ seed: 21, businesses: 3, users: 400, transactions: 2500, days: 30, now: NOW });
    await BusinessModel.collection.insertMany(data.businesses);
    await TransactionModel.collection.insertMany(data.transactions);
    businessIds = data.businesses.map((b) => String(b._id));
});

afterEach(async () => {
    jest.restoreAllMocks();
    delete process.env.STATS_SOURCE;
    await DailyStatModel.deleteMany({});
    await JobRunModel.deleteMany({});
});

const snapshot = async () => (await DailyStatModel.find().sort({ businessId: 1, day: 1, kind: 1, branchId: 1 }).lean())
    .map(({ _id, computedAt, ...rest }) => ({ ...rest, businessId: String(rest.businessId), branchId: rest.branchId && String(rest.branchId) }));

describe('días que cubre', () => {
    it('sin params: los últimos 2 días UTC cerrados (antier y ayer)', () => {
        expect(resolveDays(undefined, new Date('2026-11-19T06:15:00Z'))).toEqual(['2026-11-17', '2026-11-18']);
    });

    it('day y rango inclusive', () => {
        expect(resolveDays({ day: '2026-11-18' })).toEqual(['2026-11-18']);
        expect(resolveDays({ from: '2026-10-30', to: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    });

    it('splitRange parte en semanas sin huecos ni traslapes', () => {
        expect(splitRange('2026-08-01', '2026-08-17')).toEqual([
            { from: '2026-08-01', to: '2026-08-07' },
            { from: '2026-08-08', to: '2026-08-14' },
            { from: '2026-08-15', to: '2026-08-17' },
        ]);
        expect(splitRange('2026-08-01', '2026-08-07')).toEqual([{ from: '2026-08-01', to: '2026-08-07' }]);
    });
});

describe('runDailyStatsJob', () => {
    const ctx = { scheduledAt: '2026-11-19T06:15:00.000Z' };

    it('sin params: escribe los 2 días de cada negocio (fila "business" aunque no haya movimiento)', async () => {
        const out = await runDailyStatsJob(undefined, ctx, { enqueue: null, log: quiet });
        expect(out).toMatchObject({ businesses: 3, days: 2, from: daysAgo(2), to: daysAgo(1) });
        const businessRows = await DailyStatModel.find({ kind: 'business' }).lean();
        expect(businessRows).toHaveLength(3 * 2);
        expect(new Set(businessRows.map((r) => r.day))).toEqual(new Set([daysAgo(2), daysAgo(1)]));
    });

    it('es idempotente: correrlo dos veces deja exactamente las mismas filas', async () => {
        const params = { from: daysAgo(10), to: daysAgo(4) };
        await runDailyStatsJob(params, ctx, { enqueue: null, log: quiet });
        const first = await snapshot();
        await runDailyStatsJob(params, ctx, { enqueue: null, log: quiet });
        expect(await snapshot()).toEqual(first);
        expect(first.filter((r) => r.kind === 'business')).toHaveLength(3 * 7);
    });

    it('businessId: solo ese negocio', async () => {
        const out = await runDailyStatsJob({ day: daysAgo(3), businessId: businessIds[1] }, ctx, { enqueue: null, log: quiet });
        expect(out).toMatchObject({ businesses: 1, days: 1 });
        const rows = await DailyStatModel.find().lean();
        expect(new Set(rows.map((r) => String(r.businessId)))).toEqual(new Set([businessIds[1]]));
    });

    it('un rango de más de una semana con cola: encola un trabajo por semana y no calcula nada', async () => {
        const enqueue = jest.fn().mockResolvedValue('msg-id');
        const out = await runDailyStatsJob({ from: '2026-08-01', to: '2026-08-17', businessId: businessIds[0] }, ctx, { enqueue, log: quiet });

        expect(out).toMatchObject({ split: 3 });
        expect(enqueue.mock.calls).toEqual([
            ['daily-stats', new Date(ctx.scheduledAt), { from: '2026-08-01', to: '2026-08-07', businessId: businessIds[0] }],
            ['daily-stats', new Date(ctx.scheduledAt), { from: '2026-08-08', to: '2026-08-14', businessId: businessIds[0] }],
            ['daily-stats', new Date(ctx.scheduledAt), { from: '2026-08-15', to: '2026-08-17', businessId: businessIds[0] }],
        ]);
        expect(await DailyStatModel.countDocuments()).toBe(0);
    });

    it('sin cola (local) el mismo rango se procesa completo aquí', async () => {
        const out = await runDailyStatsJob({ from: daysAgo(16), to: daysAgo(1) }, ctx, { enqueue: null, log: quiet });
        expect(out).toMatchObject({ businesses: 3, days: 16 });
    });
});

describe('a través del worker (processMessage + candado JobRun real)', () => {
    const deps = (enqueued: string[]) => ({
        handlers: {
            'notification-batch': jest.fn(), 'engagement-batch': jest.fn(), 'reconcile-balances': jest.fn(), 'replicate-dynamo': jest.fn(),
            'daily-stats': (params: any, ctx: any) => runDailyStatsJob(params, ctx, {
                enqueue: async (type, scheduledAt, p) => { enqueued.push(JSON.stringify({ type, scheduledAt, params: p })); },
                log: quiet,
            }),
        },
        workerId: 'w-test', leaseMs: 60_000, acquire: acquireJob, complete: completeJob, release: releaseJob,
        log: { log: quiet, warn: quiet, error: quiet },
    });

    it('las semanas de un backfill tienen llaves distintas; reprocesar el padre o una semana no duplica', async () => {
        const enqueued: string[] = [];
        const parent = JSON.stringify({ type: 'daily-stats', scheduledAt: '2026-11-19T07:00:00Z', params: { from: daysAgo(20), to: daysAgo(1) } });

        expect((await processMessage(parent, deps(enqueued) as any)).action).toBe('delete');
        expect(enqueued).toHaveLength(3);
        const keys = enqueued.map((m) => jobRunKey(parseJobMessage(m)!));
        expect(new Set(keys).size).toBe(3);

        for (const m of enqueued) expect((await processMessage(m, deps([]) as any)).reason).toBe('done');
        expect(await DailyStatModel.countDocuments({ kind: 'business' })).toBe(3 * 20);

        // SQS entrega dos veces el padre y una semana: el candado los descarta
        expect((await processMessage(parent, deps([]) as any)).reason).toBe('duplicate');
        expect((await processMessage(enqueued[0], deps([]) as any)).reason).toBe('duplicate');
        const done = await JobRunModel.find({ status: 'done' }).lean();
        expect(done.find((r) => r.key === keys[0])!.result).toMatchObject({ businesses: 3, days: 7 });
    });
});

describe('con STATS_SOURCE=daily', () => {
    it('tras el backfill, los lectores usan lo que dejó el job y dan lo mismo que en vivo', async () => {
        await runDailyStatsJob({ from: daysAgo(35), to: daysAgo(1) }, { scheduledAt: NOW.toISOString() }, { enqueue: null, log: quiet });

        for (const b of businessIds) {
            const live = { series: await getTimeSeriesStats(b, 30), kpi: await getKpiSummary(b, 7) };
            process.env.STATS_SOURCE = 'daily';
            const aggregate = jest.spyOn(TransactionModel, 'aggregate');
            const daily = { series: await getTimeSeriesStats(b, 30) };
            // con todos los días cerrados calculados, solo "hoy" se agrega en vivo
            expect(aggregate.mock.calls.length).toBeLessThanOrEqual(2);
            aggregate.mockRestore();
            const dailyKpi = await getKpiSummary(b, 7);
            delete process.env.STATS_SOURCE;
            expect({ ...daily, kpi: dailyKpi }).toEqual(live);
        }
        expect(today).toBe(utcDay(new Date()));
    });
});
