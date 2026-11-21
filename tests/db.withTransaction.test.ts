/**
 * P1.1 — withTransaction sobre un replica set en memoria.
 */
import mongoose, { Schema } from 'mongoose';
import { useReplSet, ensureCollections } from './helpers/replset';
import { withTransaction, supportsTransactions } from '../src/db/withTransaction';

const Thing = mongoose.model('TxThing', new Schema({ name: String, n: Number }));

useReplSet('with-transaction-test');

beforeAll(async () => {
    await ensureCollections(Thing);
});

afterEach(async () => {
    await Thing.deleteMany({});
});

describe('withTransaction', () => {
    it('detecta que el replica set soporta transacciones', async () => {
        expect(await supportsTransactions()).toBe(true);
    });

    it('confirma todas las escrituras y devuelve el resultado de fn', async () => {
        const out = await withTransaction(async (session) => {
            expect(session).toBeDefined();
            await Thing.create([{ name: 'a', n: 1 }], { session });
            await Thing.updateOne({ name: 'a' }, { $inc: { n: 1 } }, { session });
            return 'ok';
        });
        expect(out).toBe('ok');
        expect((await Thing.findOne({ name: 'a' }).lean())!.n).toBe(2);
    });

    it('si fn lanza, no queda ninguna escritura (rollback)', async () => {
        await expect(withTransaction(async (session) => {
            await Thing.create([{ name: 'b', n: 1 }], { session });
            throw new Error('falla a mitad');
        })).rejects.toThrow('falla a mitad');
        expect(await Thing.countDocuments()).toBe(0);
    });

    it('reintenta ante TransientTransactionError', async () => {
        let attempts = 0;
        await withTransaction(async (session) => {
            attempts++;
            await Thing.create([{ name: `try-${attempts}` }], { session });
            if (attempts === 1) {
                const err = new mongoose.mongo.MongoServerError({ message: 'conflicto simulado' });
                err.addErrorLabel('TransientTransactionError');
                throw err;
            }
        });
        expect(attempts).toBe(2);
        // solo la escritura del intento que confirmó
        expect((await Thing.find().lean()).map((t) => t.name)).toEqual(['try-2']);
    });

    it('no reintenta errores normales', async () => {
        let attempts = 0;
        await expect(withTransaction(async () => {
            attempts++;
            throw new Error('validación');
        })).rejects.toThrow('validación');
        expect(attempts).toBe(1);
    });
});
