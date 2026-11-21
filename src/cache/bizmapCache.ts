/**
 * Caché del mapa de negocios (P4.3): /business/nearby, /in-bounds y /all.
 *
 * Cache-aside de los NEGOCIOS CANDIDATOS, no de la respuesta final:
 * - La llave usa parámetros redondeados (lat/lng a 3 decimales ≈ 110 m, radio
 *   hacia arriba a 0.5 km, recuadro hacia afuera), así que pedidos cercanos
 *   comparten entrada.
 * - Se guardan los negocios de un área un poco MÁS grande que la pedida, y
 *   cada petición aplica el filtro exacto de siempre (distancia, bordes) con
 *   sus coordenadas reales: la respuesta es idéntica con o sin caché.
 *
 * Invalidación por versión: INCR bizmap:version (sin SCAN). Las llaves viejas
 * dejan de leerse y expiran solas (CACHE_BIZMAP_TTL, 120 s). La versión sube
 * con cada escritura relevante de un negocio (hooks en business.model.ts).
 *
 * Falla abierta: con Redis caído se consulta Mongo directo (X-Cache: BYPASS).
 */
import { BusinessModel } from '../models/business.model';
import { getRedis, logRedisError } from './redis';
import { BIZMAP_VERSION_KEY } from './bizmapVersion';
import { incrementMetric, Metric } from '../observability/metrics';

export { BIZMAP_VERSION_KEY, bumpBizmapVersion } from './bizmapVersion';

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS';
export interface CacheMeta { cache?: CacheStatus }

/** Más grande que esto no se guarda (un área enorme no vale la pena cachear). */
const MAX_PAYLOAD_BYTES = 1024 * 1024;

const ttlSeconds = () => {
    const ttl = parseInt(process.env.CACHE_BIZMAP_TTL || '', 10);
    return Number.isInteger(ttl) && ttl > 0 ? ttl : 120;
};

// ── Redondeo de parámetros ────────────────────────────────────────────────────

/** lat/lng a 3 decimales (≈ 110 m). */
export const roundCoord = (v: number) => Math.round(v * 1000) / 1000;
/** Radio hacia arriba al siguiente 0.5 km. */
export const roundRadiusUp = (km: number) => Math.ceil(km * 2) / 2;
/** Recuadro hacia afuera a 3 decimales (siempre contiene al original). */
export const roundBoundsOut = (minLat: number, maxLat: number, minLng: number, maxLng: number) => ({
    minLat: Math.floor(minLat * 1000) / 1000,
    maxLat: Math.ceil(maxLat * 1000) / 1000,
    minLng: Math.floor(minLng * 1000) / 1000,
    maxLng: Math.ceil(maxLng * 1000) / 1000,
});
/** Error máximo al redondear el centro (0.0005° en lat y lng ≈ 80 m): se pide este margen de más. */
export const CENTER_ROUNDING_PAD_KM = 0.1;

// ── Lo que se guarda ──────────────────────────────────────────────────────────

const SECRET_FIELDS = ['refreshTokens', 'rotatedRefreshTokens', 'verificationToken', 'resetPasswordToken',
    'resetPasswordExpires', 'adminPinHash'];

/**
 * Copia del negocio sin secretos. passHash / branchPassHash se reemplazan por
 * un marcador: el valor nunca sale (toPublicResponse los quita), pero
 * hasBranchPassword necesita saber si existen.
 */
const forCache = (doc: any) => {
    const obj = doc.toObject({ depopulate: true });
    for (const f of SECRET_FIELDS) delete obj[f];
    if (obj.passHash) obj.passHash = '[cached]';
    if (obj.branchPassHash) obj.branchPassHash = '[cached]';
    return obj;
};

const fromCache = (raw: string) => (JSON.parse(raw) as any[]).map((d) => BusinessModel.hydrate(d));

// ── Cache-aside ───────────────────────────────────────────────────────────────

/** Versión actual; null si Redis no responde. */
const currentVersion = async (): Promise<string | null> => {
    const r = getRedis();
    if (!r) return null;
    try {
        return (await r.get(BIZMAP_VERSION_KEY)) ?? '0';
    } catch (err) {
        logRedisError('versión del mapa', err);
        return null;
    }
};

/**
 * Devuelve los negocios candidatos de `keyParams`, de Redis o de `load()`.
 * Marca meta.cache con HIT / MISS / BYPASS (para el header X-Cache).
 */
export const cachedBusinessDocs = async (keyParams: string, load: () => Promise<any[]>, meta?: CacheMeta): Promise<any[]> => {
    const version = await currentVersion();
    if (version === null) {
        markCache(meta, 'BYPASS');
        return load();
    }

    const key = `bizmap:v${version}:${keyParams}`;
    const r = getRedis()!;
    try {
        const raw = await r.get(key);
        if (raw) {
            markCache(meta, 'HIT');
            return fromCache(raw);
        }
    } catch (err) {
        logRedisError(`GET ${key}`, err);
        markCache(meta, 'BYPASS');
        return load();
    }

    const docs = await load();
    markCache(meta, 'MISS');
    const payload = JSON.stringify(docs.map(forCache));
    if (Buffer.byteLength(payload) <= MAX_PAYLOAD_BYTES) {
        r.set(key, payload, 'EX', ttlSeconds()).catch((err) => logRedisError(`SET ${key}`, err));
    }
    return docs;
};

const CACHE_METRIC: Record<CacheStatus, string> = { HIT: Metric.CacheHits, MISS: Metric.CacheMisses, BYPASS: Metric.CacheBypass };

/** Marca el resultado (header X-Cache) y lo cuenta como métrica. */
const markCache = (meta: CacheMeta | undefined, status: CacheStatus) => {
    if (meta) meta.cache = status;
    incrementMetric(CACHE_METRIC[status]);
};

/** Sin caché (sin REDIS_URL): no se cuenta, no hay nada que medir. */
export const bypass = (meta?: CacheMeta) => {
    if (meta) meta.cache = 'BYPASS';
};
