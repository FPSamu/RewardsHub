import mongoose, { ConnectOptions } from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGO_URI;

/**
 * Opciones de conexión a partir del entorno.
 * - DB_NAME: base a usar (gana sobre la del MONGO_URI). En el lab, rewardshub_lab.
 * - MONGO_MAX_POOL_SIZE: conexiones por proceso. Sin definir se usa el default
 *   del driver (100); en el lab va en 20 porque hasta 7 procesos × 100 rebasan
 *   el límite de conexiones de los clusters compartidos de Atlas.
 */
export const buildConnectOptions = (env: NodeJS.ProcessEnv = process.env): ConnectOptions => {
    const options: ConnectOptions = { dbName: env.DB_NAME };
    const pool = parseInt(env.MONGO_MAX_POOL_SIZE ?? '', 10);
    if (Number.isInteger(pool) && pool > 0) options.maxPoolSize = pool;
    return options;
};

/**
 * Esperas entre reintentos de la conexión inicial (MONGO_CONNECT_RETRIES).
 * Sin la variable (local, Render): [] → un solo intento, como siempre.
 * En el lab la API y los workers pueden arrancar antes que la instancia de
 * Mongo: 1 s, 2 s, 4 s… hasta 30 s entre intentos.
 */
export const connectRetryDelaysMs = (env: NodeJS.ProcessEnv = process.env): number[] => {
    const retries = parseInt(env.MONGO_CONNECT_RETRIES ?? '', 10);
    if (!Number.isInteger(retries) || retries <= 0) return [];
    return Array.from({ length: retries }, (_, i) => Math.min(1000 * 2 ** i, 30_000));
};

/** Corre `connect`; si falla, espera delays[i] y reintenta. Tras el último, relanza el error. */
export const connectWithRetry = async <T>(
    connect: () => Promise<T>,
    delays: number[],
    { sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), log = console.warn }:
        { sleep?: (ms: number) => Promise<void>; log?: (msg: string) => void } = {}
): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
        try {
            return await connect();
        } catch (err: any) {
            if (attempt >= delays.length) throw err;
            log(`⏳ MongoDB no responde (intento ${attempt + 1}/${delays.length + 1}: ${err?.message ?? err}); reintento en ${Math.round(delays[attempt] / 1000)} s`);
            await sleep(delays[attempt]);
        }
    }
};

export const connectDb = async (): Promise<void> => {
    if (!uri) {
        console.warn('MONGO_URI not set, skipping MongoDB connection');
        return;
    }
    try {
        // connect with a default dbName to avoid relying on connection string
        await connectWithRetry(() => mongoose.connect(uri, buildConnectOptions()), connectRetryDelaysMs());
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
};

export default connectDb;
