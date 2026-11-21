/**
 * Job 'daily-stats' (P3.2): llena daily_stats con computeDailyStats (P2.3).
 *
 * - Sin params (EventBridge, ~00:15 Ciudad de México = 06:15 UTC): recalcula
 *   los últimos 2 días UTC cerrados de cada negocio, para absorber
 *   transacciones que llegaron tarde (los upserts son idempotentes).
 * - params.day: un día. params.from/to (inclusive): backfill.
 *   Un rango de más de 7 días se parte en un mensaje por semana (con el mismo
 *   scheduledAt: si este mensaje se reintenta, las semanas tienen las mismas
 *   llaves y el candado JobRun no las duplica). Así cada trabajo es corto
 *   respecto al visibility timeout.
 * - params.businessId: solo ese negocio.
 *
 * Se recorren TODOS los negocios (también los inactivos: su dashboard sigue
 * existiendo), y se escribe la fila "business" aunque el día no tenga
 * movimiento: así los lectores con STATS_SOURCE=daily no tienen que
 * calcular ese día en vivo.
 */
import { Types } from 'mongoose';
import { BusinessModel } from '../models/business.model';
import { computeDailyStats, daysBetween, utcDay, startOfUtcDay } from '../services/dailyStats.service';
import { DailyStatsParams, JobParamsMap } from '../queue/jobs';
import { JobContext } from '../queue/processor';

export const CHUNK_DAYS = 7;
const DAY_MS = 86_400_000;

const addDays = (day: string, n: number) => utcDay(new Date(startOfUtcDay(day).getTime() + n * DAY_MS));

/** Días que cubre el trabajo (inclusive). */
export const resolveDays = (params: DailyStatsParams | undefined, now: Date = new Date()): string[] => {
    if (params?.day) return [params.day];
    if (params?.from && params?.to) return daysBetween(params.from, addDays(params.to, 1));
    const today = utcDay(now);
    return [addDays(today, -2), addDays(today, -1)];
};

/** Rango [from, to] partido en tramos de `size` días. */
export const splitRange = (from: string, to: string, size = CHUNK_DAYS): Array<{ from: string; to: string }> => {
    const chunks: Array<{ from: string; to: string }> = [];
    for (let start = from; start <= to; start = addDays(start, size)) {
        const end = addDays(start, size - 1);
        chunks.push({ from: start, to: end < to ? end : to });
    }
    return chunks;
};

export interface DailyStatsJobDeps {
    /** Encola un trabajo (sqs.enqueueJob); null = sin cola (local): todo se procesa aquí. */
    enqueue: ((type: 'daily-stats', scheduledAt: Date, params: JobParamsMap['daily-stats']) => Promise<unknown>) | null;
    now?: () => Date;
    log?: (msg: string) => void;
}

export const runDailyStatsJob = async (
    params: DailyStatsParams | undefined,
    ctx: Pick<JobContext, 'scheduledAt'>,
    deps: DailyStatsJobDeps
) => {
    const started = Date.now();
    const now = deps.now?.() ?? new Date();
    const log = deps.log ?? console.log;

    // Backfill largo → un mensaje por semana
    if (params?.from && params?.to && deps.enqueue) {
        const chunks = splitRange(params.from, params.to);
        if (chunks.length > 1) {
            for (const chunk of chunks) {
                await deps.enqueue('daily-stats', new Date(ctx.scheduledAt), {
                    ...chunk,
                    ...(params.businessId && { businessId: params.businessId }),
                });
            }
            log(`📅 [daily-stats] ${params.from}..${params.to} partido en ${chunks.length} trabajos semanales`);
            return { split: chunks.length, ms: Date.now() - started };
        }
    }

    const days = resolveDays(params, now);
    const filter = params?.businessId ? { _id: new Types.ObjectId(params.businessId) } : {};

    let businesses = 0;
    let rows = 0;
    for await (const biz of BusinessModel.find(filter, { _id: 1 }).lean().cursor()) {
        businesses++;
        for (const day of days) {
            const out = await computeDailyStats(String(biz._id), day);
            rows += out.rows;
        }
    }

    const result = { businesses, days: days.length, from: days[0], to: days[days.length - 1], rows, ms: Date.now() - started };
    log(`📅 [daily-stats] ${JSON.stringify(result)}`);
    return result;
};
