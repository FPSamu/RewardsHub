/**
 * Cliente Redis compartido (P4): caché del mapa y rate limits.
 *
 * Se activa con REDIS_URL (en el lab lo pone user_data según redis_mode).
 * Sin REDIS_URL todo funciona como antes: sin caché y límites en memoria.
 *
 * Falla ABIERTA: si Redis no responde, ninguna petición falla por eso.
 * - commandTimeout 200 ms y sin cola offline: con Redis caído los comandos
 *   fallan al instante en vez de esperar.
 * - Los helpers (cacheGet/cacheSet/cacheIncr) atrapan el error y devuelven null.
 * - ioredis reconecta solo en segundo plano.
 */
import Redis from 'ioredis';

let client: Redis | null = null;
let lastErrorLog = 0;

export const isCacheEnabled = (): boolean => Boolean(process.env.REDIS_URL);

/** Evita llenar el log: un aviso cada 30 s mientras Redis esté caído. */
export const logRedisError = (context: string, err: unknown) => {
    const now = Date.now();
    if (now - lastErrorLog < 30_000) return;
    lastErrorLog = now;
    console.warn(`⚠️  [Redis] ${context}: ${(err as any)?.message ?? err} (la API sigue sin Redis)`);
};

/** El cliente, o null si no hay REDIS_URL. Se crea la primera vez que se pide. */
export const getRedis = (): Redis | null => {
    if (client) return client;
    const url = process.env.REDIS_URL;
    if (!url) return null;
    client = new Redis(url, {
        connectTimeout: 2000,
        commandTimeout: 200,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: (times) => Math.min(times * 500, 5000), // reconectar siempre, con espera creciente
    });
    client.on('error', (err) => logRedisError('conexión', err));
    return client;
};

/**
 * Abre la conexión al arrancar y espera a que esté lista (máx. `timeoutMs`).
 * Sin esto, el cliente se creaba con la primera petición y esa petición
 * encontraba la conexión aún abriéndose: con enableOfflineQueue = false el
 * comando falla al instante ("Stream isn't writeable") → X-Cache: BYPASS y
 * rate limit en memoria en la primera petición de cada instancia tras cada
 * arranque (visto en el lab). Si Redis no responde, sigue sin él: nunca lanza.
 */
export const warmUpRedis = async (timeoutMs = 2000): Promise<boolean> => {
    const r = getRedis();
    if (!r) return false;
    if (r.status === 'ready') return true;
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            r.off('ready', onReady);
            console.warn(`⚠️  [Redis] No respondió en ${timeoutMs} ms al arrancar: la API sigue y reconecta en segundo plano`);
            resolve(false);
        }, timeoutMs);
        const onReady = () => {
            clearTimeout(timer);
            resolve(true);
        };
        r.once('ready', onReady);
    });
};

/** Para tests: inyectar un cliente (ioredis-mock) o quitarlo. */
export const setRedisClient = (c: Redis | null) => {
    client = c;
};

export const closeRedis = async (): Promise<void> => {
    const c = client;
    client = null;
    if (!c) return;
    try {
        await c.quit();
    } catch {
        c.disconnect();
    }
};

export const cacheGet = async (key: string): Promise<string | null> => {
    const r = getRedis();
    if (!r) return null;
    try {
        return await r.get(key);
    } catch (err) {
        logRedisError(`GET ${key}`, err);
        return null;
    }
};

/** true si se guardó. */
export const cacheSet = async (key: string, value: string, ttlSeconds: number): Promise<boolean> => {
    const r = getRedis();
    if (!r) return false;
    try {
        await r.set(key, value, 'EX', ttlSeconds);
        return true;
    } catch (err) {
        logRedisError(`SET ${key}`, err);
        return false;
    }
};

export const cacheIncr = async (key: string): Promise<number | null> => {
    const r = getRedis();
    if (!r) return null;
    try {
        return await r.incr(key);
    } catch (err) {
        logRedisError(`INCR ${key}`, err);
        return null;
    }
};
