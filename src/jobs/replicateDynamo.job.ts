/**
 * Job 'replicate-dynamo' (P5.2): copia incremental de Mongo a DynamoDB.
 * EventBridge lo encola cada 10 min (replicate_schedule).
 *
 * Por cada fuente (daily_stats por computedAt, transactions por updatedAt):
 * 1. Lee desde el checkpoint (menos 2 min de traslape, ver abajo) en orden
 *    (campo, _id), en páginas de 500.
 * 2. Escribe con BatchWriteItem de 25 en 25, reintentando UnprocessedItems con
 *    espera exponencial. Si después de varios intentos sigue sin poder, falla
 *    el job (el mensaje reaparece y SQS lo reintenta; tras 5, a la DLQ).
 * 3. Avanza el checkpoint DESPUÉS de cada página escrita. Nunca hacia atrás:
 *    si otra corrida va más adelante, esta no lo pisa.
 * Escribir el mismo item dos veces no cambia nada (misma pk/sk), así que un
 * reintento o el traslape son seguros.
 *
 * Traslape de 2 min: el reloj de dos instancias puede diferir un poco; un
 * documento con updatedAt "en el pasado" respecto al checkpoint se volvería a
 * leer en la siguiente pasada en vez de perderse.
 *
 * Sin DDB_* configuradas el job no hace nada.
 */
import { Types } from 'mongoose';
import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionModel } from '../models/transaction.model';
import { DailyStatModel } from '../models/dailyStat.model';
import { ReplicationCheckpointModel, CheckpointId } from '../models/replicationCheckpoint.model';
import { dynamoTables, getDynamo, isDynamoEnabled, dailyStatItem, transactionItem, META_PK } from '../replica/dynamo';

export const PAGE_SIZE = 500;
export const BATCH_SIZE = 25;
export const OVERLAP_MS = 2 * 60 * 1000;
const MAX_BATCH_ATTEMPTS = 8;

export interface ReplicateDeps {
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
    /** Tope de tiempo por corrida; lo que falte sigue en la próxima. */
    maxMs?: number;
    pageSize?: number;
    log?: (msg: string) => void;
    metric?: (name: string, value: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** BatchWriteItem de 25 en 25 con reintento de UnprocessedItems. */
export const batchPut = async (table: string, items: Record<string, unknown>[], sleep = defaultSleep): Promise<void> => {
    const ddb = getDynamo();
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        let request: Record<string, any[]> = { [table]: items.slice(i, i + BATCH_SIZE).map((Item) => ({ PutRequest: { Item } })) };
        for (let attempt = 1; ; attempt++) {
            const out: any = await ddb.send(new BatchWriteCommand({ RequestItems: request }));
            const unprocessed = out?.UnprocessedItems?.[table];
            if (!unprocessed || unprocessed.length === 0) break;
            if (attempt >= MAX_BATCH_ATTEMPTS) {
                throw new Error(`DynamoDB no aceptó ${unprocessed.length} items de ${table} tras ${attempt} intentos`);
            }
            request = { [table]: unprocessed };
            await sleep(Math.min(50 * 2 ** attempt, 2000) + Math.floor(Math.random() * 50));
        }
    }
};

/** Avanza el checkpoint solo si (at, id) va después del guardado. */
export const advanceCheckpoint = async (id: CheckpointId, at: Date, lastId: string, copied: number) => {
    try {
        await ReplicationCheckpointModel.updateOne(
            {
                _id: id,
                $or: [
                    { lastSeenAt: { $exists: false } },
                    { lastSeenAt: { $lt: at } },
                    { lastSeenAt: at, lastSeenId: { $lt: lastId } },
                ],
            },
            { $set: { lastSeenAt: at, lastSeenId: lastId }, $inc: { replicated: copied } },
            { upsert: true }
        );
    } catch (err: any) {
        // Duplicate key = otra corrida ya va más adelante: no se retrocede
        if (err?.code !== 11000) throw err;
    }
};

const SOURCES = {
    daily_stats: { model: DailyStatModel, field: 'computedAt', table: () => dynamoTables().dailyStats, toItem: dailyStatItem },
    transactions: { model: TransactionModel, field: 'updatedAt', table: () => dynamoTables().transactions, toItem: transactionItem },
} as const;

export interface SourceResult { copied: number; pages: number; caughtUp: boolean; syncedAt?: string }

const replicateSource = async (id: CheckpointId, deps: Required<Pick<ReplicateDeps, 'sleep' | 'now' | 'pageSize'>> & { deadline: number }): Promise<SourceResult> => {
    const { model, field, table, toItem } = SOURCES[id];
    const cp = await ReplicationCheckpointModel.findById(id).lean();

    // Primera página: desde el checkpoint menos el traslape (o desde el principio)
    let cursor: { at: Date; id: Types.ObjectId } | null = null;
    const from = cp?.lastSeenAt ? new Date(cp.lastSeenAt.getTime() - OVERLAP_MS) : null;

    let copied = 0;
    let pages = 0;
    for (;;) {
        if (Date.now() > deps.deadline) return { copied, pages, caughtUp: false };
        const startedPage = deps.now();
        const filter: Record<string, unknown> = cursor
            ? { $or: [{ [field]: { $gt: cursor.at } }, { [field]: cursor.at, _id: { $gt: cursor.id } }] }
            : from ? { [field]: { $gte: from } } : {};
        const docs: any[] = await (model as any).find(filter).sort({ [field]: 1, _id: 1 }).limit(deps.pageSize).lean();

        if (docs.length > 0) {
            await batchPut(table(), docs.map(toItem), deps.sleep);
            const last = docs[docs.length - 1];
            cursor = { at: last[field], id: last._id };
            await advanceCheckpoint(id, last[field], String(last._id), docs.length);
            copied += docs.length;
            pages++;
        }

        if (docs.length < deps.pageSize) {
            // Sin pendientes: los datos están al día hasta el inicio de esta última lectura
            const syncedAt = startedPage;
            await ReplicationCheckpointModel.updateOne({ _id: id }, { $max: { syncedAt } }, { upsert: true }).catch((err: any) => {
                if (err?.code !== 11000) throw err;
            });
            // Para `./lab.sh status` (lee DynamoDB, no Mongo)
            await getDynamo().send(new PutCommand({
                TableName: dynamoTables().dailyStats,
                Item: { pk: META_PK, sk: id, syncedAt: syncedAt.toISOString(), copied },
            }));
            return { copied, pages, caughtUp: true, syncedAt: syncedAt.toISOString() };
        }
    }
};

export const runReplicateDynamoJob = async (deps: ReplicateDeps = {}) => {
    const log = deps.log ?? console.log;
    if (!isDynamoEnabled()) {
        log('🗄️  [replicate-dynamo] DynamoDB no configurado (DDB_*): no hay nada que hacer');
        return { skipped: 'dynamo-disabled' };
    }

    const started = Date.now();
    const run = {
        sleep: deps.sleep ?? defaultSleep,
        now: deps.now ?? (() => new Date()),
        pageSize: deps.pageSize ?? PAGE_SIZE,
        deadline: started + (deps.maxMs ?? 8 * 60 * 1000),
    };

    const daily_stats = await replicateSource('daily_stats', run);
    const transactions = await replicateSource('transactions', run);

    const cps = await ReplicationCheckpointModel.find({}, { syncedAt: 1 }).lean();
    const oldest = cps.map((c) => c.syncedAt?.getTime()).filter((t): t is number => Boolean(t));
    const lagSeconds = oldest.length === 2 ? Math.round((run.now().getTime() - Math.min(...oldest)) / 1000) : null;
    if (lagSeconds !== null) deps.metric?.('ReplicationLagSeconds', lagSeconds);

    const result = { daily_stats, transactions, lagSeconds, ms: Date.now() - started };
    log(`🗄️  [replicate-dynamo] ${JSON.stringify(result)}`);
    return result;
};
