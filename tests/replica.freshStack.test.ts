/**
 * replicate-dynamo en un stack recién creado. En el lab la base es la MongoDB
 * de EC2 (se pierde con ./lab.sh down) y las tablas de DynamoDB se recrean: la
 * réplica tiene que arrancar sola desde cero, antes y después del seed.
 *
 * Caso delicado: las transacciones del seed traen updatedAt del PASADO. Si el
 * checkpoint ya avanzó (p. ej. por transacciones de una demo), una corrida
 * normal no las copiaría; por eso `seed` borra los checkpoints (src/cli/seed.ts).
 */
import { useReplSet, ensureCollections } from './helpers/replset';
import { FakeDynamo } from './helpers/fakeDynamo';
import { generateLabDataset } from '../src/db/seed/labDataset';
import { TransactionModel } from '../src/models/transaction.model';
import { DailyStatModel } from '../src/models/dailyStat.model';
import { ReplicationCheckpointModel } from '../src/models/replicationCheckpoint.model';
import { setDynamoClient, META_PK } from '../src/replica/dynamo';
import { runReplicateDynamoJob } from '../src/jobs/replicateDynamo.job';

useReplSet('replica_fresh_stack_test');

const TABLES = { daily: 'rh-daily-stats', tx: 'rh-transactions' };
const replicate = () => runReplicateDynamoJob({ sleep: async () => undefined, log: () => undefined });
let ddb: FakeDynamo;

beforeAll(async () => {
    await ensureCollections(TransactionModel, DailyStatModel, ReplicationCheckpointModel);
    process.env.DDB_DAILY_STATS_TABLE = TABLES.daily;
    process.env.DDB_TRANSACTIONS_TABLE = TABLES.tx;
    ddb = new FakeDynamo();
    setDynamoClient(ddb as any);
});

afterAll(() => {
    delete process.env.DDB_DAILY_STATS_TABLE;
    delete process.env.DDB_TRANSACTIONS_TABLE;
    setDynamoClient(null);
});

const seeded = () => generateLabDataset({ seed: 5, businesses: 2, users: 20, transactions: 300, days: 30 }).transactions;

describe('replicate-dynamo en un stack nuevo', () => {
    it('con la base vacía (antes del seed) termina bien, no fija checkpoint y deja la marca para lab.sh status', async () => {
        const out: any = await replicate();
        expect(out.transactions).toMatchObject({ copied: 0, caughtUp: true });
        expect(out.daily_stats).toMatchObject({ copied: 0, caughtUp: true });
        expect(out.lagSeconds).toBeGreaterThanOrEqual(0);

        const cps = await ReplicationCheckpointModel.find().lean();
        for (const c of cps) {
            expect(c.lastSeenAt).toBeUndefined(); // sin datos no hay "hasta dónde": la próxima lee todo
            expect(c.syncedAt).toBeInstanceOf(Date);
        }
        expect(ddb.items(TABLES.daily).filter((i) => i.pk === META_PK).map((i) => i.sk).sort()).toEqual(['daily_stats', 'transactions']);
    });

    it('el seed (updatedAt del pasado) se copia completo en la siguiente corrida', async () => {
        const txs = seeded();
        await TransactionModel.collection.insertMany(txs);
        const out: any = await replicate();
        expect(out.transactions).toMatchObject({ copied: txs.length, caughtUp: true });
        expect(ddb.items(TABLES.tx)).toHaveLength(txs.length);
    });

    it('con el checkpoint ya avanzado, un seed nuevo solo se copia si se borran los checkpoints (lo que hace `seed`)', async () => {
        // Una transacción "de demo" de ahora mismo adelanta el checkpoint
        const demo = { ...seeded()[0], _id: undefined, createdAt: new Date(), updatedAt: new Date() } as any;
        delete demo._id;
        await TransactionModel.collection.insertOne(demo);
        await replicate();

        // Seed --reset: transacciones nuevas con fechas del pasado
        await TransactionModel.deleteMany({});
        const again = generateLabDataset({ seed: 9, businesses: 2, users: 20, transactions: 200, days: 30 }).transactions;
        await TransactionModel.collection.insertMany(again);

        const without: any = await replicate();
        expect(without.transactions.copied).toBe(0); // el problema: quedarían fuera de la réplica

        await ReplicationCheckpointModel.deleteMany({}); // src/cli/seed.ts
        const after: any = await replicate();
        expect(after.transactions).toMatchObject({ copied: 200, caughtUp: true });
        const ids = new Set(ddb.items(TABLES.tx).map((i) => i.txId));
        for (const t of again) expect(ids.has(String(t._id))).toBe(true);
    });
});
