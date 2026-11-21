/**
 * MongoDB en memoria como replica set de un nodo: hace falta para cualquier
 * test que use transacciones (el MongoMemoryServer standalone no las soporta).
 *
 *   const rs = useReplSet('mi-test');   // dentro del archivo de test, a nivel superior
 *   // ... rs.uri si hace falta
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const startReplSet = async (dbName: string): Promise<MongoMemoryReplSet> => {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(replSet.getUri(), { dbName });
    return replSet;
};

/** Registra beforeAll/afterAll que levantan y apagan el replica set. */
export const useReplSet = (dbName: string) => {
    const state: { replSet?: MongoMemoryReplSet } = {};
    beforeAll(async () => {
        state.replSet = await startReplSet(dbName);
    }, 120_000);
    afterAll(async () => {
        await mongoose.disconnect();
        await state.replSet?.stop();
    });
    return state;
};

/** Crea las colecciones (y sus índices) antes de usarlas en transacciones. */
export const ensureCollections = async (...models: mongoose.Model<any>[]) => {
    await Promise.all(models.map((m) => m.createCollection().catch(() => undefined).then(() => m.createIndexes())));
};
