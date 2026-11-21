/**
 * P2.3 — STATS_SOURCE=daily da EXACTAMENTE los mismos números que el cálculo en vivo.
 *
 * Datos del seed del lab (90 días hasta hoy, varias sucursales, transacciones
 * sin sucursal, compras chicas sin puntos y montos con decimales), daily_stats
 * calculado para cada día, y comparación campo por campo de:
 * getTimeSeriesStats, getKpiSummary y getBranchComparison.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generateLabDataset } from '../src/db/seed/labDataset';
import { TransactionModel } from '../src/models/transaction.model';
import { RewardModel } from '../src/models/reward.model';
import { UserPointsModel } from '../src/models/userPoints.model';
import { DailyStatModel } from '../src/models/dailyStat.model';
import {
    getTimeSeriesStats, getKpiSummary, getBranchComparison, getBusinessStats,
} from '../src/services/businessStats.service';
import { computeDailyStats, daysBetween, utcDay, useDailyStats } from '../src/services/dailyStats.service';

let mongod: MongoMemoryServer;
let businessIds: string[] = [];

const DAYS_OF_DATA = 90;

beforeAll(async () => {
    // TZ=UTC lo pone tests/setup/timezone.cjs (globalSetup), como en Render y el lab
    expect(new Date().getTimezoneOffset()).toBe(0);
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'stats-daily-test' });

    const data = generateLabDataset({ seed: 3, businesses: 5, users: 1500, transactions: 6000, days: DAYS_OF_DATA, now: new Date() });

    // Montos con decimales exactos en binario (.25/.5/.75) y transacciones sin sucursal
    data.transactions.forEach((t, i) => {
        if (t.type === 'add' && t.purchaseAmount !== undefined && i % 7 === 0) t.purchaseAmount += [0.25, 0.5, 0.75][i % 3];
        if (i % 23 === 0) delete t.branchId;
    });

    await Promise.all([
        TransactionModel.collection.insertMany(data.transactions),
        RewardModel.collection.insertMany(data.rewards),
        UserPointsModel.collection.insertMany(data.userPoints),
    ]);
    await DailyStatModel.init();
    businessIds = data.businesses.map((b) => b._id.toString());

    // Calcular daily_stats para todos los días con datos (incluye hoy, que igual se lee en vivo)
    const today = utcDay(new Date());
    const from = utcDay(new Date(Date.now() - (DAYS_OF_DATA + 1) * 86_400_000));
    const days = [...daysBetween(from, today), today];
    for (const b of businessIds) for (const d of days) await computeDailyStats(b, d);
}, 300_000);

afterAll(async () => {
    delete process.env.STATS_SOURCE;
    await mongoose.disconnect();
    await mongod.stop();
});

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.STATS_SOURCE;
});

const withSource = async <T>(source: 'live' | 'daily', fn: () => Promise<T>): Promise<T> => {
    if (source === 'daily') process.env.STATS_SOURCE = 'daily'; else delete process.env.STATS_SOURCE;
    try { return await fn(); } finally { delete process.env.STATS_SOURCE; }
};

/** El orden de getBranchComparison sale del $group (no determinista): se compara ordenado. */
const sortBranches = <T extends { branchId: string | null }>(rows: T[]) =>
    [...rows].sort((a, b) => String(a.branchId).localeCompare(String(b.branchId)));

const compareAll = async () => {
    for (const b of businessIds) {
        for (const days of [7, 30, 90]) {
            const live = await withSource('live', () => getTimeSeriesStats(b, days));
            const daily = await withSource('daily', () => getTimeSeriesStats(b, days));
            expect({ b, days, series: daily }).toEqual({ b, days, series: live });
        }
        for (const days of [7, 30]) {
            const liveKpi = await withSource('live', () => getKpiSummary(b, days));
            const dailyKpi = await withSource('daily', () => getKpiSummary(b, days));
            expect({ b, days, kpi: dailyKpi }).toEqual({ b, days, kpi: liveKpi });

            const liveBr = sortBranches(await withSource('live', () => getBranchComparison(b, days)));
            const dailyBr = sortBranches(await withSource('daily', () => getBranchComparison(b, days)));
            expect({ b, days, branches: dailyBr }).toEqual({ b, days, branches: liveBr });
        }
    }
};

describe('STATS_SOURCE=daily vs live', () => {
    it('los datos de prueba no son triviales', async () => {
        const series = await getTimeSeriesStats(businessIds[0], 30);
        expect(series.reduce((s, d) => s + d.transactionCount, 0)).toBeGreaterThan(50);
        expect(series.some((d) => d.revenue % 1 !== 0)).toBe(true);           // hay decimales
        expect(series.some((d) => d.newClients > 0)).toBe(true);
        expect(series.some((d) => d.redemptions > 0)).toBe(true);
        const branches = await getBranchComparison(businessIds[0], 30);
        expect(branches.some((r) => r.branchId === null)).toBe(true);           // bucket "sin sucursal"
    });

    it('serie diaria (7/30/90), KPIs (7/30) y comparación por sucursal (7/30): idénticos, en cada negocio', async () => {
        const find = jest.spyOn(DailyStatModel, 'find');
        await compareAll();
        expect(find).toHaveBeenCalled(); // daily sí leyó de daily_stats
    });

    it('con días sin calcular (el job no corrió), los calcula en vivo y sigue idéntico', async () => {
        const rows = await DailyStatModel.find({ kind: 'business', businessId: new Types.ObjectId(businessIds[0]) })
            .sort({ day: -1 }).limit(40).lean();
        const removed = rows.filter((_, i) => i % 3 === 0).map((r) => r.day);
        await DailyStatModel.deleteMany({ businessId: new Types.ObjectId(businessIds[0]), day: { $in: removed } });

        await compareAll();

        for (const d of removed) await computeDailyStats(businessIds[0], d);
    });

    it('revenueWithPoints sumado = totalRevenue de getBusinessStats (la otra regla de ingresos)', async () => {
        for (const b of businessIds) {
            const [agg] = await DailyStatModel.aggregate([
                { $match: { businessId: new Types.ObjectId(b), kind: 'business' } },
                { $group: { _id: null, total: { $sum: '$revenueWithPoints' } } },
            ]);
            expect(agg.total).toBe((await getBusinessStats(b)).totalRevenue);
        }
    });
});

describe('daily lee de verdad daily_stats (no recalcula todo en vivo)', () => {
    it('con todo calculado, la serie de 90 días solo agrega transacciones de HOY', async () => {
        const aggregate = jest.spyOn(TransactionModel, 'aggregate');
        const distinct = jest.spyOn(TransactionModel, 'distinct');
        await withSource('daily', () => getTimeSeriesStats(businessIds[0], 90));
        // hoy: actividad + clientes nuevos (aggregate) y usuarios del día (distinct)
        expect(aggregate.mock.calls.length).toBeLessThanOrEqual(2);
        expect(distinct).toHaveBeenCalledTimes(1);
    });

    it('si se altera una fila guardada, daily refleja la fila (y live no)', async () => {
        const b = new Types.ObjectId(businessIds[0]);
        const day = utcDay(new Date(Date.now() - 3 * 86_400_000));
        await DailyStatModel.updateOne({ businessId: b, kind: 'business', day }, { $inc: { revenueAllAdds: 1_000_000 } });
        try {
            const live = await withSource('live', () => getTimeSeriesStats(businessIds[0], 7));
            const daily = await withSource('daily', () => getTimeSeriesStats(businessIds[0], 7));
            const at = (s: typeof live) => s.find((d) => d.date === day)!.revenue;
            expect(at(daily) - at(live)).toBe(1_000_000);
        } finally {
            await computeDailyStats(businessIds[0], day);
        }
    });
});

describe('daily_stats', () => {
    it('computeDailyStats es idempotente: correrlo de nuevo deja las mismas filas', async () => {
        const b = businessIds[1];
        const day = utcDay(new Date(Date.now() - 5 * 86_400_000));
        const snapshot = async () => (await DailyStatModel.find({ businessId: new Types.ObjectId(b), day })
            .sort({ kind: 1, branchId: 1 }).lean()).map(({ _id, computedAt, ...rest }) => rest);

        const before = await snapshot();
        await computeDailyStats(b, day);
        await computeDailyStats(b, day);
        expect(await snapshot()).toEqual(before);
        expect(before.filter((r) => r.kind === 'business')).toHaveLength(1);
    });

    it('un día sin movimiento igual guarda su fila "business" en ceros (marca de día calculado)', async () => {
        const b = businessIds[2];
        const day = '2001-01-01';
        await computeDailyStats(b, day);
        const rows = await DailyStatModel.find({ businessId: new Types.ObjectId(b), day }).lean();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'business', branchId: null, txCount: 0, revenueAllAdds: 0, uniqueClients: 0 });
    });

    it('si el proceso no corre en UTC, daily usa el cálculo en vivo (si no, no daría lo mismo)', async () => {
        // Ciudad de México = UTC-6
        jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(360);
        process.env.STATS_SOURCE = 'daily';
        expect(useDailyStats()).toBe(false);
        const find = jest.spyOn(DailyStatModel, 'find');
        await getTimeSeriesStats(businessIds[0], 7);
        expect(find).not.toHaveBeenCalled();
    });

    it('sin STATS_SOURCE, ni se toca daily_stats', async () => {
        const find = jest.spyOn(DailyStatModel, 'find');
        await getTimeSeriesStats(businessIds[0], 30);
        await getKpiSummary(businessIds[0], 30);
        await getBranchComparison(businessIds[0], 30);
        expect(find).not.toHaveBeenCalled();
    });
});
