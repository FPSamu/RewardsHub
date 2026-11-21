/**
 * Worker de la cola SQS.  Arranque: `npm run worker` (dist/worker.js).
 *
 * Consume trabajos (avisos, engagement, daily-stats, reconcile-balances, replicate-dynamo)
 * publicados por EventBridge, por la API o por `./lab.sh enqueue`.
 * Se puede escalar horizontalmente: el candado JobRun evita ejecuciones dobles.
 */
import dotenv from 'dotenv';
dotenv.config();

import os from 'os';
import connectDb from './db/mongoose';
import { runNotificationBatch, runEngagementBatch } from './services/notification.service';
import { isQueueEnabled, receiveMessages, deleteMessage, extendVisibility, enqueueJob } from './queue/sqs';
import { runDailyStatsJob } from './jobs/dailyStats.job';
import { runReconcileJob } from './jobs/reconcile.job';
import { runReplicateDynamoJob } from './jobs/replicateDynamo.job';
import { closeRedis } from './cache/redis';
import { setGauge, startMetrics, stopMetrics } from './observability/metrics';
import { acquireJob, completeJob, releaseJob, renewJob } from './queue/jobLock';
import { processMessage, JobHandlers } from './queue/processor';
import { jobRunKey, parseJobMessage } from './queue/jobs';

const VISIBILITY_SECONDS = parseInt(process.env.SQS_VISIBILITY_SECONDS || '900', 10);
const HEARTBEAT_MS = Math.max(30, Math.floor(VISIBILITY_SECONDS / 3)) * 1000;
const LEASE_MS = VISIBILITY_SECONDS * 1000;
const workerId = `${os.hostname()}:${process.pid}`;

const handlers: JobHandlers = {
    'notification-batch': () => runNotificationBatch(),
    'engagement-batch': () => runEngagementBatch(),
    'daily-stats': (params, ctx) => runDailyStatsJob(params, ctx, { enqueue: enqueueJob }),
    // La conciliación publica sus diferencias como métrica (P6.3; no-op sin METRICS_ENABLED)
    'reconcile-balances': (params, ctx) => runReconcileJob(params, ctx, { metric: (name, value) => setGauge(name, value) }),
    // Réplica a DynamoDB (P5.2); no-op sin DDB_*. Publica el retraso como métrica.
    'replicate-dynamo': () => runReplicateDynamoJob({ metric: (name, value) => setGauge(name, value) }),
};

let stopping = false;

const handleOne = async (receiptHandle: string, body: string | undefined) => {
    // Mientras el batch corre, se renueva la visibilidad del mensaje y el lease
    // en Mongo, para que ni SQS ni otro worker lo consideren abandonado.
    const job = parseJobMessage(body);
    const heartbeat = setInterval(() => {
        extendVisibility(receiptHandle, VISIBILITY_SECONDS).catch(err =>
            console.warn('⚠️  [Worker] No se pudo extender visibilidad:', err?.message));
        if (job) renewJob(jobRunKey(job), workerId, LEASE_MS).catch(() => undefined);
    }, HEARTBEAT_MS);

    try {
        const outcome = await processMessage(body, {
            handlers,
            workerId,
            leaseMs: LEASE_MS,
            acquire: acquireJob,
            complete: completeJob,
            release: releaseJob,
        });
        if (outcome.action === 'delete') await deleteMessage(receiptHandle);
    } finally {
        clearInterval(heartbeat);
    }
};

const loop = async () => {
    console.log(`👷 [Worker] ${workerId} escuchando ${process.env.SQS_QUEUE_URL}`);
    while (!stopping) {
        try {
            const messages = await receiveMessages(VISIBILITY_SECONDS);
            for (const m of messages) {
                if (m.ReceiptHandle) await handleOne(m.ReceiptHandle, m.Body);
            }
        } catch (err: any) {
            console.error('❌ [Worker] Error leyendo la cola:', err?.message ?? err);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    console.log('👋 [Worker] Detenido');
    await stopMetrics();
    await closeRedis();
    process.exit(0);
};

const shutdown = (signal: string) => {
    if (stopping) return;
    console.log(`🛑 [Worker] ${signal}: termino el trabajo actual y salgo`);
    stopping = true;
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const start = async () => {
    if (!isQueueEnabled()) {
        console.error('SQS_QUEUE_URL no está configurada; el worker no tiene nada que consumir.');
        process.exit(1);
    }
    await connectDb();
    startMetrics('worker');
    await loop();
};

start().catch(err => {
    console.error('Failed to start worker', err);
    process.exit(1);
});
