/**
 * P1.1 — en un mongod standalone (sin transacciones) withTransaction corre fn
 * una sola vez con session = undefined, para que local y los tests viejos sigan funcionando.
 */
import mongoose, { Schema } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { withTransaction, supportsTransactions } from '../src/db/withTransaction';

const Thing = mongoose.model('TxThingStandalone', new Schema({ name: String }));
let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'with-transaction-standalone-test' });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

it('sin replica set: fn corre una vez con session undefined', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await supportsTransactions()).toBe(false);
    const sessions: unknown[] = [];
    const out = await withTransaction(async (session) => {
        sessions.push(session);
        await Thing.create([{ name: 'x' }], { session });
        return 7;
    });
    expect(out).toBe(7);
    expect(sessions).toEqual([undefined]);
    expect(await Thing.countDocuments()).toBe(1);
});
