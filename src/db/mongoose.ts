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

export const connectDb = async (): Promise<void> => {
    if (!uri) {
        console.warn('MONGO_URI not set, skipping MongoDB connection');
        return;
    }
    try {
        // connect with a default dbName to avoid relying on connection string
        await mongoose.connect(uri, buildConnectOptions());
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
};

export default connectDb;
