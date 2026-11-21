/**
 * daily_stats (P2.3): agregados por día UTC para que las estadísticas del
 * dashboard no recorran toda la colección de transacciones en cada petición.
 *
 * - computeDailyStats(negocio, día) recalcula y guarda un día (idempotente,
 *   bulkWrite con upserts: funciona en cualquier tier de Atlas, sin $merge).
 *   Lo llama el job 'daily-stats' del worker (P3).
 * - Lectores (STATS_SOURCE=daily): días cerrados desde daily_stats + HOY en
 *   vivo. Un día que aún no está calculado se calcula en vivo (sin guardarlo),
 *   así que el resultado es igual al de siempre aunque el job no haya corrido.
 *
 * Exactitud: las estadísticas en vivo agrupan por día UTC pero arrancan sus
 * rangos en la medianoche LOCAL del servidor. Solo coinciden con días UTC si
 * el proceso corre en UTC (Render; el lab pone TZ=UTC). Si no, los lectores
 * usan el cálculo en vivo.
 */
import { Types } from 'mongoose';
import { TransactionModel } from '../models/transaction.model';
import { DailyStatModel } from '../models/dailyStat.model';
import type { DailyStat } from './businessStats.service';
import { isDynamoEnabled } from '../replica/dynamo';
import { dynamoDailyRows, replicaFreshness } from '../replica/dynamoReaders';

const DAY_MS = 24 * 3600 * 1000;

/** Lo pedido en STATS_SOURCE (la fuente efectiva la decide resolveStatsSource). */
export const statsSource = (): StatsSource =>
    (process.env.STATS_SOURCE === 'daily' || process.env.STATS_SOURCE === 'dynamo' ? process.env.STATS_SOURCE : 'live');

/** Fuente guardada (daily o dynamo) solo si está pedida Y el proceso corre en UTC (si no, no daría lo mismo que live). */
export const useDailyStats = (): boolean => resolveStatsSource() !== 'live';

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);
export const startOfUtcDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const addDays = (day: string, n: number): string => utcDay(new Date(startOfUtcDay(day).getTime() + n * DAY_MS));

/** Días [from, to) como 'YYYY-MM-DD'. */
export const daysBetween = (from: string, to: string): string[] => {
    const out: string[] = [];
    for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
    return out;
};

export interface DayCounters {
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
}

export interface DayAggregate {
    day: string;
    business: DayCounters & { uniqueClients: number };
    branches: Array<DayCounters & { branchId: string | null }>;
}

const COUNTER_KEYS: Array<keyof DayCounters> = [
    'txCount', 'addCount', 'subtractCount', 'redeemCount', 'pointsAdded', 'stampsAdded',
    'pointsRedeemed', 'stampsRedeemed', 'revenueWithPoints', 'revenueAllAdds', 'newClients',
];

const zero = (): DayCounters => COUNTER_KEYS.reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as DayCounters);

const branchKey = (id: unknown): string | null => (id ? String(id) : null);

/**
 * Agrega las transacciones de un negocio en [start, end) — end null = sin
 * límite (para "hoy", igual que las consultas en vivo, que no tienen tope).
 */
export const aggregateRange = async (businessId: string, day: string, start: Date, end: Date | null): Promise<DayAggregate> => {
    const oid = new Types.ObjectId(businessId);
    const createdAt = end ? { $gte: start, $lt: end } : { $gte: start };
    const is = (type: string) => ({ $eq: ['$type', type] });

    const [activity, users] = await Promise.all([
        TransactionModel.aggregate([
            { $match: { businessId: oid, createdAt } },
            {
                $group: {
                    _id: '$branchId',
                    txCount: { $sum: 1 },
                    addCount: { $sum: { $cond: [is('add'), 1, 0] } },
                    subtractCount: { $sum: { $cond: [is('subtract'), 1, 0] } },
                    redeemCount: { $sum: { $cond: [is('redeem'), 1, 0] } },
                    pointsAdded: { $sum: { $cond: [is('add'), '$totalPointsChange', 0] } },
                    stampsAdded: { $sum: { $cond: [is('add'), '$totalStampsChange', 0] } },
                    pointsRedeemed: { $sum: { $cond: [is('redeem'), { $multiply: [-1, { $ifNull: ['$totalPointsChange', 0] }] }, 0] } },
                    stampsRedeemed: { $sum: { $cond: [is('redeem'), { $multiply: [-1, { $ifNull: ['$totalStampsChange', 0] }] }, 0] } },
                    revenueAllAdds: { $sum: { $cond: [is('add'), { $ifNull: ['$purchaseAmount', 0] }, 0] } },
                    revenueWithPoints: {
                        $sum: { $cond: [{ $and: [is('add'), { $gt: ['$totalPointsChange', 0] }] }, { $ifNull: ['$purchaseAmount', 0] }, 0] },
                    },
                },
            },
        ]),
        TransactionModel.distinct('userId', { businessId: oid, createdAt }),
    ]);

    // Clientes nuevos: de los que tuvieron movimiento en el rango, aquellos cuya
    // primera transacción HISTÓRICA con el negocio cae en el rango.
    const firsts = users.length === 0 ? [] : await TransactionModel.aggregate([
        { $match: { businessId: oid, userId: { $in: users } } },
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$userId', first: { $first: '$createdAt' }, branchId: { $first: '$branchId' } } },
        { $match: { first: createdAt } },
        { $group: { _id: '$branchId', newClients: { $sum: 1 } } },
    ]);

    const branches = new Map<string | null, DayCounters & { branchId: string | null }>();
    const branch = (id: unknown) => {
        const key = branchKey(id);
        if (!branches.has(key)) branches.set(key, { branchId: key, ...zero() });
        return branches.get(key)!;
    };
    for (const a of activity) {
        const row = branch(a._id);
        for (const k of COUNTER_KEYS) if (k !== 'newClients') row[k] = a[k] ?? 0;
    }
    for (const f of firsts) branch(f._id).newClients = f.newClients;

    const business = { ...zero(), uniqueClients: users.length };
    for (const row of branches.values()) for (const k of COUNTER_KEYS) business[k] += row[k];

    return { day, business, branches: Array.from(branches.values()) };
};

/** Agregado de un día UTC completo, en vivo (no guarda nada). */
export const aggregateDay = (businessId: string, day: string): Promise<DayAggregate> =>
    aggregateRange(businessId, day, startOfUtcDay(day), startOfUtcDay(addDays(day, 1)));

/** Recalcula y guarda un día. Correrlo dos veces deja las mismas filas. */
export const computeDailyStats = async (businessId: string, day: string): Promise<{ day: string; rows: number }> => {
    const agg = await aggregateDay(businessId, day);
    const oid = new Types.ObjectId(businessId);
    const computedAt = new Date();
    const branchOid = (id: string | null) => (id ? new Types.ObjectId(id) : null);

    const pick = (c: DayCounters) => COUNTER_KEYS.reduce((acc, k) => ({ ...acc, [k]: c[k] }), {} as DayCounters);

    await DailyStatModel.bulkWrite([
        {
            updateOne: {
                filter: { businessId: oid, kind: 'business', branchId: null, day },
                update: { $set: { ...pick(agg.business), uniqueClients: agg.business.uniqueClients, computedAt } },
                upsert: true,
            },
        },
        ...agg.branches.map((b) => ({
            updateOne: {
                filter: { businessId: oid, kind: 'branch' as const, branchId: branchOid(b.branchId), day },
                update: { $set: { ...pick(b), computedAt } },
                upsert: true,
            },
        })),
        // Sucursales que ya no tienen movimiento ese día (recalcular no deja filas viejas)
        {
            deleteMany: {
                filter: { businessId: oid, kind: 'branch', day, branchId: { $nin: agg.branches.map((b) => branchOid(b.branchId)) } },
            },
        },
    ], { ordered: true });

    return { day, rows: 1 + agg.branches.length };
};

/** Filas guardadas entre from y to (inclusive). Sin branchId: las de todo el negocio. */
export const getDailyStats = async (businessId: string, from: string, to: string, branchId?: string | null) => {
    const filter: Record<string, unknown> = { businessId: new Types.ObjectId(businessId), day: { $gte: from, $lte: to } };
    if (branchId === undefined) {
        filter.kind = 'business';
    } else {
        filter.kind = 'branch';
        filter.branchId = branchId ? new Types.ObjectId(branchId) : null;
    }
    return DailyStatModel.find(filter).sort({ day: 1 }).lean();
};

/**
 * Agregados de los días pedidos: guardados para días cerrados; en vivo para
 * hoy (sin tope superior) y para los días que aún no estén calculados.
 */
/** Fila guardada de daily_stats (Mongo o la réplica de DynamoDB). */
export interface DailyRow {
    businessId: unknown;
    kind: 'business' | 'branch';
    branchId: unknown;
    day: string;
    uniqueClients?: number;
    [counter: string]: unknown;
}

/** De dónde se leen las filas de los días cerrados. */
export type RowLoader = (businessId: string, days: string[]) => Promise<DailyRow[]>;

export const mongoDailyRows: RowLoader = async (businessId, days) =>
    (await DailyStatModel.find({ businessId: new Types.ObjectId(businessId), day: { $in: days } }).lean()) as unknown as DailyRow[];

/**
 * Agregados de los días pedidos. Para los días cerrados se prueba cada fuente
 * en orden (p. ej. DynamoDB y luego Mongo); lo que ninguna tenga —y hoy,
 * siempre— se calcula en vivo (hoy sin tope superior, como las consultas en vivo).
 */
export const dayAggregates = async (
    businessId: string,
    days: string[],
    loaders: RowLoader[] = [mongoDailyRows]
): Promise<Map<string, DayAggregate>> => {
    const today = utcDay(new Date());
    const out = new Map<string, DayAggregate>();
    let pendingClosed = days.filter((d) => d < today);

    for (const load of loaders) {
        if (pendingClosed.length === 0) break;
        const rows = await load(businessId, pendingClosed);
        // Un día solo cuenta como calculado si tiene su fila 'business'
        const computed = new Set(rows.filter((r) => r.kind === 'business').map((r) => r.day));
        for (const r of rows) {
            if (!computed.has(r.day)) continue;
            if (!out.has(r.day)) out.set(r.day, { day: r.day, business: { ...zero(), uniqueClients: 0 }, branches: [] });
            const agg = out.get(r.day)!;
            const counters = COUNTER_KEYS.reduce((acc, k) => ({ ...acc, [k]: (r[k] as number) ?? 0 }), {} as DayCounters);
            if (r.kind === 'business') agg.business = { ...counters, uniqueClients: r.uniqueClients ?? 0 };
            else agg.branches.push({ branchId: branchKey(r.branchId), ...counters });
        }
        pendingClosed = pendingClosed.filter((d) => !computed.has(d));
    }

    const pending = [...pendingClosed, ...days.filter((d) => d >= today)];
    const live = await Promise.all(pending.map((d) =>
        d >= today ? aggregateRange(businessId, d, startOfUtcDay(d), null) : aggregateDay(businessId, d)));
    for (const agg of live) out.set(agg.day, agg);

    return out;
};

// ── Fuente de las estadísticas ────────────────────────────────────────────────

export type StatsSource = 'live' | 'daily' | 'dynamo';

/** Qué fuente usaron los lectores, y hasta cuándo está al día la réplica (header X-Data-Freshness). */
export interface StatsMeta {
    source?: StatsSource;
    freshness?: Date;
}

/**
 * - STATS_SOURCE=dynamo (con DDB_* configuradas) → réplica de DynamoDB, con Mongo de respaldo.
 * - STATS_SOURCE=daily (o dynamo sin DDB_*) → daily_stats en Mongo.
 * - Si el proceso no corre en UTC → siempre en vivo (los días guardados son UTC).
 */
export const resolveStatsSource = (): StatsSource => {
    if (new Date().getTimezoneOffset() !== 0) return 'live';
    if (process.env.STATS_SOURCE === 'dynamo') return isDynamoEnabled() ? 'dynamo' : 'daily';
    if (process.env.STATS_SOURCE === 'daily') return 'daily';
    return 'live';
};

let lastDynamoWarn = 0;

/**
 * Corre un lector con la fuente guardada que toque. Con DynamoDB, cualquier
 * error hace que se repita con Mongo: la réplica nunca tumba una petición.
 */
export const withStoredStats = async <T>(meta: StatsMeta | undefined, read: (loaders: RowLoader[]) => Promise<T>): Promise<T> => {
    if (resolveStatsSource() === 'dynamo') {
        try {
            const out = await read([dynamoDailyRows, mongoDailyRows]);
            if (meta) {
                meta.source = 'dynamo';
                meta.freshness = await replicaFreshness('daily_stats');
            }
            return out;
        } catch (err: any) {
            const now = Date.now();
            if (now - lastDynamoWarn > 60_000) {
                lastDynamoWarn = now;
                console.warn(`⚠️  [stats] DynamoDB falló, se usa daily_stats de Mongo: ${err?.message ?? err}`);
            }
        }
    }
    if (meta) meta.source = 'daily';
    return read([mongoDailyRows]);
};

// ── Lectores con la misma forma que businessStats.service ─────────────────────

/** = getTimeSeriesStats en vivo, desde daily_stats. */
export const dailyTimeSeries = async (businessId: string, days: number, loaders?: RowLoader[]): Promise<DailyStat[]> => {
    const today = utcDay(new Date());
    const since = addDays(today, -(days - 1));
    const keys = daysBetween(since, addDays(today, 1));
    const aggs = await dayAggregates(businessId, keys, loaders);

    return keys.map((date) => {
        const b = aggs.get(date)!.business;
        return {
            date,
            newClients: b.newClients,
            pointsDistributed: b.pointsAdded,
            stampsDistributed: b.stampsAdded,
            revenue: b.revenueAllAdds,
            redemptions: b.redeemCount,
            transactionCount: b.addCount,
        };
    });
};

/** Periodo actual = [periodStart, hoy] y anterior = [previousStart, periodStart), como getKpiSummary. */
const periodDays = (days: number) => {
    const today = utcDay(new Date());
    const periodStart = addDays(today, -days);
    const previousStart = addDays(periodStart, -days);
    return {
        current: daysBetween(periodStart, addDays(today, 1)),
        previous: daysBetween(previousStart, periodStart),
    };
};

/** Las tres sumas de getKpiSummary que son por día (ingresos, puntos, canjes). */
export const dailyKpiSums = async (businessId: string, days: number, loaders?: RowLoader[]) => {
    const { current, previous } = periodDays(days);
    const aggs = await dayAggregates(businessId, [...previous, ...current], loaders);
    const sum = (keys: string[], k: keyof DayCounters) => keys.reduce((acc, d) => acc + aggs.get(d)!.business[k], 0);
    return {
        revenueCurrent: sum(current, 'revenueAllAdds'),
        revenuePrevious: sum(previous, 'revenueAllAdds'),
        pointsCurrent: sum(current, 'pointsAdded'),
        pointsPrevious: sum(previous, 'pointsAdded'),
        redemptionsCurrent: sum(current, 'redeemCount'),
        redemptionsPrevious: sum(previous, 'redeemCount'),
    };
};

/** Conteo de transacciones 'add' por sucursal en el periodo actual y el anterior (getBranchComparison). */
export const dailyBranchCounts = async (businessId: string, days: number, loaders?: RowLoader[]) => {
    const { current, previous } = periodDays(days);
    const aggs = await dayAggregates(businessId, [...previous, ...current], loaders);
    const count = (keys: string[]) => {
        const m = new Map<string | null, number>();
        for (const d of keys) for (const b of aggs.get(d)!.branches) {
            if (b.addCount > 0) m.set(b.branchId, (m.get(b.branchId) ?? 0) + b.addCount);
        }
        return m;
    };
    return { currentMap: count(current), previousMap: count(previous) };
};
