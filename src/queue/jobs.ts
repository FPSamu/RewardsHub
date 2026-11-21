/**
 * Tipos de trabajos que viajan por la cola (SQS).
 *
 * El mensaje es JSON: { "type": "<JobType>", "scheduledAt": "<ISO>", "params"?: {...} }.
 * - EventBridge lo publica según infra/aws/scheduler.tf (sin params).
 * - Los endpoints /notifications/run-* lo publican cuando la cola está activa.
 * - `./lab.sh enqueue <type> [json]` lo publica a mano (con params opcionales).
 *
 * `params` es opcional y se valida por tipo; los mensajes viejos (sin params)
 * se leen exactamente igual que antes.
 */
import crypto from 'crypto';

export const JOB_TYPES = ['notification-batch', 'engagement-batch', 'daily-stats', 'reconcile-balances', 'replicate-dynamo'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** daily-stats: un día, un rango (inclusive) o, sin nada, los últimos 2 días UTC cerrados. */
export interface DailyStatsParams {
    day?: string;
    from?: string;
    to?: string;
    businessId?: string;
}

export interface ReconcileParams {
    businessId?: string;
}

export interface JobParamsMap {
    'notification-batch': undefined;
    'engagement-batch': undefined;
    'daily-stats': DailyStatsParams;
    'reconcile-balances': ReconcileParams;
    'replicate-dynamo': undefined;
}

export interface JobMessage<T extends JobType = JobType> {
    type: T;
    /** Momento para el que se programó el trabajo. Forma parte de la llave de idempotencia. */
    scheduledAt: string;
    params?: JobParamsMap[T];
}

export const isJobType = (value: unknown): value is JobType =>
    typeof value === 'string' && (JOB_TYPES as readonly string[]).includes(value);

/** Rango máximo de un backfill de daily-stats en un solo mensaje (el job lo parte por semanas). */
export const MAX_DAILY_STATS_RANGE_DAYS = 400;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string =>
    typeof v === 'string' && DAY_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isObjectIdHex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const onlyKeys = (obj: Record<string, unknown>, allowed: string[]) => Object.keys(obj).every((k) => allowed.includes(k));

/** Valida params por tipo. Devuelve los params normalizados, undefined si no hay, o null si son inválidos. */
const parseParams = (type: JobType, raw: unknown): JobParamsMap[JobType] | null | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).length === 0) return undefined;

    switch (type) {
        case 'daily-stats': {
            if (!onlyKeys(p, ['day', 'from', 'to', 'businessId'])) return null;
            if (p.businessId !== undefined && !isObjectIdHex(p.businessId)) return null;
            const hasDay = p.day !== undefined;
            const hasRange = p.from !== undefined || p.to !== undefined;
            if (hasDay && hasRange) return null;
            if (hasDay && !isDay(p.day)) return null;
            if (hasRange) {
                if (!isDay(p.from) || !isDay(p.to)) return null;
                const span = daysApart(p.from, p.to);
                if (span < 0 || span >= MAX_DAILY_STATS_RANGE_DAYS) return null;
            }
            return {
                ...(hasDay && { day: p.day as string }),
                ...(hasRange && { from: p.from as string, to: p.to as string }),
                ...(p.businessId !== undefined && { businessId: (p.businessId as string).toLowerCase() }),
            };
        }
        case 'reconcile-balances':
            if (!onlyKeys(p, ['businessId'])) return null;
            if (p.businessId !== undefined && !isObjectIdHex(p.businessId)) return null;
            return { ...(p.businessId !== undefined && { businessId: (p.businessId as string).toLowerCase() }) };
        default:
            // Los batches de avisos y replicate-dynamo no aceptan params
            return null;
    }
};

/**
 * Valida el cuerpo de un mensaje SQS. Devuelve null si no es un trabajo válido
 * (el worker lo descarta en vez de reintentarlo eternamente).
 */
export const parseJobMessage = (body: string | undefined): JobMessage | null => {
    if (!body) return null;
    let data: any;
    try {
        data = JSON.parse(body);
    } catch {
        return null;
    }
    if (!data || !isJobType(data.type)) return null;
    const scheduledAt = typeof data.scheduledAt === 'string' && !Number.isNaN(Date.parse(data.scheduledAt))
        ? new Date(data.scheduledAt).toISOString()
        : null;
    if (!scheduledAt) return null;

    const params = parseParams(data.type, data.params);
    if (params === null) return null;
    return { type: data.type, scheduledAt, ...(params !== undefined && { params }) };
};

/** JSON con llaves ordenadas: los mismos params dan el mismo hash sin importar el orden. */
const canonical = (value: unknown): string =>
    JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v).sort().reduce((acc, k) => ({ ...acc, [k]: v[k] }), {})
        : v));

export const paramsHash = (params: object): string =>
    crypto.createHash('sha256').update(canonical(params)).digest('hex').slice(0, 10);

/**
 * Llave de idempotencia: SQS entrega "al menos una vez", y EventBridge puede
 * reintentar. Dos mensajes del mismo tipo para el mismo minuto son el mismo trabajo.
 * Con params se agrega un hash corto: un backfill de otra semana es otro trabajo.
 * Sin params la llave es la de siempre.
 */
export const jobRunKey = (job: JobMessage): string =>
    `${job.type}:${job.scheduledAt.slice(0, 16)}${job.params ? `:${paramsHash(job.params)}` : ''}`;
