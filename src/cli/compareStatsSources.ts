/**
 * SOLO LECTURA. Compara las estadísticas del dashboard calculadas con las tres
 * fuentes: live (agregación completa), daily (daily_stats en Mongo) y dynamo
 * (réplica en DynamoDB). Deben coincidir.
 *
 *   ./lab.sh run compare-stats-sources --businesses 10 --days 30   # en el lab (dentro de la VPC)
 *
 *   DB_NAME=rewardshub_lab TZ=UTC \
 *   DDB_DAILY_STATS_TABLE=rewardshub-daily-stats DDB_TRANSACTIONS_TABLE=rewardshub-transactions \
 *   DDB_AWS_PROFILE=academy npx ts-node scripts/compare-stats-sources.ts --businesses 10 --days 30
 *
 * Sin las variables DDB_* solo compara live vs daily.
 * TZ=UTC es obligatorio (los días guardados son UTC; en otra zona todo sale "live").
 * Sale con código 1 si alguna fuente no coincide con live.
 *
 * Nota: la serie y los KPIs incluyen HOY, que las tres fuentes calculan en
 * vivo; si entran transacciones mientras corre, puede haber una diferencia de
 * hoy entre una lectura y otra. Vuelve a correrlo para confirmar.
 */
import mongoose from 'mongoose';
import { buildConnectOptions } from '../db/mongoose';
import { BusinessModel } from '../models/business.model';
import { getTimeSeriesStats, getKpiSummary, getBranchComparison } from '../services/businessStats.service';
import { isDynamoEnabled } from '../replica/dynamo';
import { resolveStatsSource, StatsMeta, StatsSource } from '../services/dailyStats.service';

export const parseArgs = (argv: string[]) => {
    const opts = { businesses: 10, days: 30 };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key !== '--businesses' && key !== '--days') throw new Error(`Opción desconocida: ${key}`);
        const v = Number(argv[++i]);
        if (!Number.isInteger(v) || v < 1) throw new Error(`${key} necesita un entero positivo`);
        opts[key === '--businesses' ? 'businesses' : 'days'] = v;
    }
    if (opts.days < 7 || opts.days > 90) throw new Error('--days va de 7 a 90 (como el dashboard)');
    return opts;
};

const sortBranches = (rows: Array<{ branchId: string | null }>) =>
    [...rows].sort((a, b) => String(a.branchId).localeCompare(String(b.branchId)));

/** Lo que muestra el dashboard de un negocio, con la fuente indicada. */
export const snapshot = async (businessId: string, days: number, source: StatsSource) => {
    const previous = process.env.STATS_SOURCE;
    if (source === 'live') delete process.env.STATS_SOURCE; else process.env.STATS_SOURCE = source;
    try {
        const meta: StatsMeta = {};
        const series = await getTimeSeriesStats(businessId, days, meta);
        const kpi = await getKpiSummary(businessId, days);
        const branches = sortBranches(await getBranchComparison(businessId, days));
        return { usedSource: meta.source ?? 'live', freshness: meta.freshness?.toISOString(), data: { series, kpi, branches } };
    } finally {
        if (previous === undefined) delete process.env.STATS_SOURCE; else process.env.STATS_SOURCE = previous;
    }
};

/** Primera diferencia entre dos valores, como ruta legible (o null si son iguales). */
export const firstDifference = (a: unknown, b: unknown, path = ''): string | null => {
    if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return `${path || '·'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
    if (a && b && typeof a === 'object') {
        const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
        for (const k of keys) {
            const d = firstDifference((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k);
            if (d) return d;
        }
        return null;
    }
    return a === b ? null : `${path || '·'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
};

export const main = async (argv: string[]): Promise<number> => {
    const { businesses, days } = parseArgs(argv);
    if (new Date().getTimezoneOffset() !== 0) throw new Error('Corre con TZ=UTC (los días de daily_stats son UTC)');
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI no está configurada');

    await mongoose.connect(uri, { ...buildConnectOptions(), autoIndex: false });
    try {
        const sources: StatsSource[] = isDynamoEnabled() ? ['daily', 'dynamo'] : ['daily'];
        console.log(`Base "${mongoose.connection.db?.databaseName}" · ${days} días · fuentes: live vs ${sources.join(', ')}`);
        if (!isDynamoEnabled()) console.log('(sin DDB_DAILY_STATS_TABLE / DDB_TRANSACTIONS_TABLE: no se compara DynamoDB)');

        const ids = (await BusinessModel.find({}, { _id: 1 }).sort({ _id: 1 }).limit(businesses).lean()).map((b) => String(b._id));
        const rows: Array<Record<string, string>> = [];
        let mismatches = 0;

        for (const id of ids) {
            const live = await snapshot(id, days, 'live');
            const row: Record<string, string> = { negocio: id };
            for (const source of sources) {
                const other = await snapshot(id, days, source);
                const diff = firstDifference(live.data, other.data);
                if (other.usedSource !== source) {
                    row[source] = `⚠️ usó ${other.usedSource}`;
                } else {
                    row[source] = diff ? `❌ ${diff}` : `✅${other.freshness ? ` (réplica al ${other.freshness})` : ''}`;
                }
                if (diff || other.usedSource !== source) mismatches++;
            }
            rows.push(row);
        }
        console.table(rows);
        console.log(mismatches === 0 ? '✅ Todas las fuentes coinciden.' : `❌ ${mismatches} comparaciones no coinciden.`);
        console.log(`Fuente efectiva con STATS_SOURCE actual: ${resolveStatsSource()}`);
        return mismatches === 0 ? 0 : 1;
    } finally {
        await mongoose.disconnect();
    }
};
