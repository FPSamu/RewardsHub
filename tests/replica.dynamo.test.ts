/**
 * P5.2 / P5.3 — réplica en DynamoDB (DynamoDB falso en memoria, Mongo en replica set).
 *
 * replicate-dynamo:
 * - copia daily_stats y transactions con las llaves del plan; idempotente;
 * - BatchWriteItem de ≤ 25 y reintento de UnprocessedItems;
 * - checkpoint después de cada página; nunca retrocede; traslape de 2 min;
 * - si DynamoDB no acepta, falla y NO avanza el checkpoint;
 * - sin DDB_* no hace nada.
 * Lectores (STATS_SOURCE=dynamo):
 * - mismos números que live/daily; X-Data-Freshness;
 * - días que la réplica no tiene → Mongo → en vivo; DynamoDB caído → Mongo;
 * - reportes: DynamoDB hasta el corte + Mongo después = el reporte de siempre (también por turno).
 */
import request from 'supertest';
import { Types } from 'mongoose';
import { useReplSet, ensureCollections } from './helpers/replset';
import { FakeDynamo } from './helpers/fakeDynamo';
import { generateLabDataset } from '../src/db/seed/labDataset';
import { BusinessModel } from '../src/models/business.model';
import { TransactionModel } from '../src/models/transaction.model';
import { DailyStatModel } from '../src/models/dailyStat.model';
import { UserModel } from '../src/models/user.model';
import { WorkShiftModel } from '../src/models/workShift.model';
import { ReplicationCheckpointModel } from '../src/models/replicationCheckpoint.model';
import { setDynamoClient, bizPk, META_PK } from '../src/replica/dynamo';
import { runReplicateDynamoJob, OVERLAP_MS, advanceCheckpoint } from '../src/jobs/replicateDynamo.job';
import { runDailyStatsJob } from '../src/jobs/dailyStats.job';
import { getTimeSeriesStats, getKpiSummary, getBranchComparison } from '../src/services/businessStats.service';
import { StatsMeta, utcDay } from '../src/services/dailyStats.service';
import { generateReportData } from '../src/services/report.service';
import * as authService from '../src/services/auth.service';

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

useReplSet('replica_dynamo_test');

const quiet = () => undefined;
const noSleep = async () => undefined;
const TABLES = { daily: 'rh-daily-stats', tx: 'rh-transactions' };
const NOW = new Date();
const daysAgo = (n: number) => utcDay(new Date(NOW.getTime() - n * 86_400_000));
let ddb: FakeDynamo;
let businessIds: string[] = [];
let shiftId: Types.ObjectId;

beforeAll(async () => {
    await ensureCollections(BusinessModel, TransactionModel, DailyStatModel, UserModel, WorkShiftModel, ReplicationCheckpointModel);
    const data = generateLabDataset({ seed: 31, businesses: 3, users: 300, transactions: 1800, days: 20, now: NOW });
    shiftId = new Types.ObjectId();
    // Algunas transacciones con turno (para el GSI byShift) y sin sucursal
    data.transactions.forEach((t, i) => {
        if (i % 4 === 0) { t.workShiftId = shiftId; t.workShiftName = 'Mañana'; }
        if (i % 17 === 0) delete t.branchId;
    });
    await BusinessModel.collection.insertMany(data.businesses);
    await UserModel.collection.insertMany(data.users);
    await TransactionModel.collection.insertMany(data.transactions);
    await WorkShiftModel.collection.insertOne({
        _id: shiftId, businessId: data.businesses[0]._id, name: 'Mañana', startTime: '06:00', endTime: '14:00', isActive: true,
    } as any);
    businessIds = data.businesses.map((b) => String(b._id));
    await runDailyStatsJob({ from: daysAgo(22), to: daysAgo(1) }, { scheduledAt: NOW.toISOString() }, { enqueue: null, log: quiet });
}, 300_000);

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.DDB_DAILY_STATS_TABLE = TABLES.daily;
    process.env.DDB_TRANSACTIONS_TABLE = TABLES.tx;
    ddb = new FakeDynamo();
    setDynamoClient(ddb as any);
    await ReplicationCheckpointModel.deleteMany({});
});

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.DDB_DAILY_STATS_TABLE;
    delete process.env.DDB_TRANSACTIONS_TABLE;
    delete process.env.STATS_SOURCE;
    setDynamoClient(null);
});

const replicate = (extra = {}) => runReplicateDynamoJob({ sleep: noSleep, log: quiet, ...extra });

describe('replicate-dynamo', () => {
    it('sin DDB_* no hace nada', async () => {
        delete process.env.DDB_DAILY_STATS_TABLE;
        expect(await replicate()).toEqual({ skipped: 'dynamo-disabled' });
        expect(ddb.calls).toHaveLength(0);
    });

    it('copia todo con las llaves del plan y deja los checkpoints al día', async () => {
        const out: any = await replicate({ pageSize: 200 });
        const [txCount, rowCount] = [await TransactionModel.countDocuments(), await DailyStatModel.countDocuments()];

        expect(out.transactions).toMatchObject({ copied: txCount, caughtUp: true });
        expect(out.daily_stats).toMatchObject({ copied: rowCount, caughtUp: true });
        expect(out.transactions.pages).toBe(Math.ceil(txCount / 200));
        expect(ddb.items(TABLES.tx)).toHaveLength(txCount);
        expect(ddb.items(TABLES.daily).filter((i) => i.pk !== META_PK)).toHaveLength(rowCount);

        const tx = await TransactionModel.findOne({ workShiftId: shiftId }).lean();
        const item = ddb.items(TABLES.tx).find((i) => i.txId === String(tx!._id));
        expect(item).toMatchObject({
            pk: bizPk(String(tx!.businessId)),
            sk: `${tx!.createdAt.toISOString()}#${tx!._id}`,
            gsi1pk: `BIZ#${tx!.businessId}#SHIFT#${shiftId}`,
            type: tx!.type, totalPointsChange: tx!.totalPointsChange,
        });
        const row = await DailyStatModel.findOne({ kind: 'business' }).lean();
        expect(ddb.items(TABLES.daily).find((i) => i.sk === `DAY#${row!.day}#BR#ALL` && i.businessId === String(row!.businessId)))
            .toMatchObject({ revenueAllAdds: row!.revenueAllAdds, revenueWithPoints: row!.revenueWithPoints });

        const cps = await ReplicationCheckpointModel.find().lean();
        expect(cps.map((c) => c._id).sort()).toEqual(['daily_stats', 'transactions']);
        for (const c of cps) expect(c.syncedAt).toBeInstanceOf(Date);
        // marca para `./lab.sh status`
        expect(ddb.items(TABLES.daily).filter((i) => i.pk === META_PK).map((i) => i.sk).sort()).toEqual(['daily_stats', 'transactions']);
        expect(out.lagSeconds).toBeGreaterThanOrEqual(0);
    });

    it('nunca manda más de 25 items por BatchWriteItem, y reintenta UnprocessedItems', async () => {
        ddb.unprocessedRounds = 5;
        await replicate();
        const batches = ddb.calls.filter((c) => c.constructor.name === 'BatchWriteCommand');
        for (const b of batches) expect(Object.values(b.input.RequestItems as Record<string, any[]>)[0].length).toBeLessThanOrEqual(25);
        expect(ddb.items(TABLES.tx)).toHaveLength(await TransactionModel.countDocuments());
    });

    it('la segunda corrida solo copia lo nuevo (más el traslape de 2 min) y es idempotente', async () => {
        await replicate();
        const before = ddb.items(TABLES.tx).length;
        const second: any = await replicate();
        // Solo lo del traslape (transacciones con updatedAt en los últimos 2 min antes del checkpoint)
        const cp = await ReplicationCheckpointModel.findById('transactions').lean();
        const inOverlap = await TransactionModel.countDocuments({ updatedAt: { $gte: new Date(cp!.lastSeenAt!.getTime() - OVERLAP_MS) } });
        expect(second.transactions.copied).toBe(inOverlap);
        expect(ddb.items(TABLES.tx)).toHaveLength(before);

        // Una transacción nueva aparece en la siguiente corrida
        const fresh = await TransactionModel.create({
            userId: new Types.ObjectId(), businessId: new Types.ObjectId(businessIds[0]), businessName: 'x', type: 'add', items: [],
        });
        await replicate();
        expect(ddb.items(TABLES.tx).some((i) => i.txId === String(fresh._id))).toBe(true);
        await TransactionModel.deleteOne({ _id: fresh._id });
    });

    it('si DynamoDB no acepta un lote, el job falla y el checkpoint no avanza por esa página', async () => {
        ddb.unprocessedRounds = 1000; // nunca acepta todo
        await expect(replicate({ pageSize: 100 })).rejects.toThrow(/no aceptó/);
        const cp = await ReplicationCheckpointModel.findById('daily_stats').lean();
        expect(cp?.lastSeenAt).toBeUndefined();
    });

    it('el checkpoint nunca retrocede (dos corridas solapadas)', async () => {
        const t = new Date('2026-11-20T10:00:00Z');
        const id = (hex: string) => hex.padStart(24, '0');
        await advanceCheckpoint('transactions', t, id('b'), 10);
        // una corrida vieja que terminó tarde: mismo instante con _id menor, o un instante anterior
        await advanceCheckpoint('transactions', t, id('a'), 5);
        await advanceCheckpoint('transactions', new Date(t.getTime() - 1000), id('f'), 5);
        let cp = await ReplicationCheckpointModel.findById('transactions').lean();
        expect(cp).toMatchObject({ lastSeenAt: t, lastSeenId: id('b'), replicated: 10 });
        // una más adelante sí avanza
        await advanceCheckpoint('transactions', t, id('c'), 3);
        cp = await ReplicationCheckpointModel.findById('transactions').lean();
        expect(cp).toMatchObject({ lastSeenId: id('c'), replicated: 13 });
    });

    it('con tope de tiempo deja la réplica a medias y la siguiente corrida sigue donde quedó', async () => {
        const partial: any = await replicate({ maxMs: -1 });
        expect(partial.daily_stats.caughtUp).toBe(false);
        const full: any = await replicate();
        expect(full.transactions.caughtUp).toBe(true);
        expect(ddb.items(TABLES.tx)).toHaveLength(await TransactionModel.countDocuments());
    });
});

describe('STATS_SOURCE=dynamo', () => {
    const readAll = async (b: string) => ({
        series: await getTimeSeriesStats(b, 14),
        kpi: await getKpiSummary(b, 7),
        branches: [...await getBranchComparison(b, 14)].sort((x, y) => String(x.branchId).localeCompare(String(y.branchId))),
    });
    const withSource = async <T>(source: string | undefined, fn: () => Promise<T>) => {
        if (source) process.env.STATS_SOURCE = source; else delete process.env.STATS_SOURCE;
        try { return await fn(); } finally { delete process.env.STATS_SOURCE; }
    };

    it('mismos números que live y daily, leyendo de DynamoDB', async () => {
        await replicate();
        for (const b of businessIds) {
            const live = await withSource(undefined, () => readAll(b));
            const daily = await withSource('daily', () => readAll(b));
            const callsBefore = ddb.calls.length;
            const dynamo = await withSource('dynamo', () => readAll(b));
            expect(dynamo).toEqual(live);
            expect(daily).toEqual(live);
            expect(ddb.calls.slice(callsBefore).some((c) => c.constructor.name === 'QueryCommand')).toBe(true);
        }
    });

    it('días que la réplica no tiene se leen de Mongo (y lo que no esté, en vivo)', async () => {
        await replicate();
        // Borrar de la "réplica" 5 días de un negocio
        const t = ddb.tables.get(TABLES.daily)!;
        for (const [k, it] of t) if (it.businessId === businessIds[0] && it.day >= daysAgo(6) && it.day <= daysAgo(2)) t.delete(k);
        const live = await withSource(undefined, () => readAll(businessIds[0]));
        expect(await withSource('dynamo', () => readAll(businessIds[0]))).toEqual(live);
    });

    it('DynamoDB caído: responde igual desde Mongo', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        await replicate();
        const live = await withSource(undefined, () => readAll(businessIds[1]));
        ddb.failWith = new Error('ProvisionedThroughputExceededException');
        const meta: StatsMeta = {};
        const series = await withSource('dynamo', () => getTimeSeriesStats(businessIds[1], 14, meta));
        expect(series).toEqual(live.series);
        expect(meta.source).toBe('daily');
        expect(meta.freshness).toBeUndefined();
    });

    it('sin DDB_* configuradas, STATS_SOURCE=dynamo se comporta como daily', async () => {
        delete process.env.DDB_DAILY_STATS_TABLE;
        const meta: StatsMeta = {};
        await withSource('dynamo', () => getTimeSeriesStats(businessIds[0], 7, meta));
        expect(meta.source).toBe('daily');
        expect(ddb.calls).toHaveLength(0);
    });

    it('los endpoints mandan X-Data-Freshness (hasta cuándo está al día la réplica)', async () => {
        await replicate();
        const app = (await import('../src/app')).default;
        const auth = `Bearer ${authService.issueAccessToken(businessIds[0], 'business')}`;
        const cp = await ReplicationCheckpointModel.findById('daily_stats').lean();

        process.env.STATS_SOURCE = 'dynamo';
        for (const path of ['/business/stats/timeseries?days=7', '/business/stats/kpi-summary?days=7', '/business/stats/branch-comparison?days=7']) {
            const res = await request(app).get(path).set('Authorization', auth);
            expect(res.status).toBe(200);
            expect(res.headers['x-data-freshness']).toBe(cp!.syncedAt!.toISOString());
        }
        delete process.env.STATS_SOURCE;
        const live = await request(app).get('/business/stats/timeseries?days=7').set('Authorization', auth);
        expect(live.headers['x-data-freshness']).toBeUndefined();
    });
});

describe('reportes con STATS_SOURCE=dynamo', () => {
    const filters = (extra = {}) => ({
        businessId: businessIds[0], startDate: new Date(NOW.getTime() - 15 * 86_400_000), endDate: NOW, timezone: 'America/Mexico_City', ...extra,
    });
    const report = async (source: string | undefined, f: any) => {
        if (source) process.env.STATS_SOURCE = source; else delete process.env.STATS_SOURCE;
        try {
            const data = JSON.parse(JSON.stringify(await generateReportData(f)));
            delete data.metadata.generatedAt; // la hora en que se armó cada reporte
            return data;
        } finally { delete process.env.STATS_SOURCE; }
    };

    it('el reporte es idéntico (DynamoDB hasta el corte + Mongo después)', async () => {
        await replicate();
        // Una transacción nueva que la réplica todavía no tiene: tiene que salir de Mongo
        await TransactionModel.create({
            userId: (await UserModel.findOne().lean())!._id, businessId: new Types.ObjectId(businessIds[0]), businessName: 'x',
            type: 'add', purchaseAmount: 100, totalPointsChange: 10, items: [],
        });
        const mongo = await report(undefined, filters());
        const callsBefore = ddb.calls.length;
        const dynamo = await report('dynamo', filters());
        expect(dynamo).toEqual(mongo);
        expect(ddb.calls.slice(callsBefore).filter((c) => c.constructor.name === 'QueryCommand').length).toBeGreaterThan(0);
        expect(mongo.dailyData.length).toBeGreaterThan(5);
    });

    it('por turno usa el GSI byShift y da lo mismo; con filtro de tipos también', async () => {
        await replicate();
        const byShift = filters({ shiftIds: [String(shiftId)] });
        const callsBefore = ddb.calls.length;
        expect(await report('dynamo', byShift)).toEqual(await report(undefined, byShift));
        expect(ddb.calls.slice(callsBefore).some((c) => c.input?.IndexName === 'byShift')).toBe(true);

        const onlyRedeem = filters({ types: ['redeem'] });
        expect(await report('dynamo', onlyRedeem)).toEqual(await report(undefined, onlyRedeem));
    });

    it('sin réplica todavía (sin checkpoint) o con DynamoDB caído, el reporte sale de Mongo', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const mongo = await report(undefined, filters());
        expect(await report('dynamo', filters())).toEqual(mongo); // sin checkpoint: todo Mongo
        await replicate();
        ddb.failWith = new Error('down');
        expect(await report('dynamo', filters())).toEqual(mongo);
    });
});
