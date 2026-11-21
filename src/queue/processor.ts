/**
 * Lógica de procesamiento de un mensaje, separada del loop de SQS para poder
 * probarla sin AWS ni Mongo (las dependencias se inyectan).
 */
import { JobMessage, JobParamsMap, JobType, jobRunKey, parseJobMessage } from './jobs';
import { AcquireResult } from './jobLock';

/** Lo que recibe cada handler además de sus params. */
export interface JobContext {
    /** Llave del trabajo (JobRun.key); sirve como id de corrida (p. ej. reconcile). */
    key: string;
    scheduledAt: string;
}

/** Cada tipo recibe sus propios params (undefined si el mensaje no trae). */
export type JobHandlers = {
    [T in JobType]: (params: JobParamsMap[T] | undefined, ctx: JobContext) => Promise<unknown>;
};

export interface ProcessorDeps {
    handlers: JobHandlers;
    workerId: string;
    leaseMs: number;
    acquire: (key: string, type: string, workerId: string, leaseMs: number) => Promise<AcquireResult>;
    complete: (key: string, workerId: string, result: unknown) => Promise<void>;
    release: (key: string, workerId: string) => Promise<void>;
    log?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Qué hacer con el mensaje de SQS después de procesarlo:
 * - 'delete': terminó (o es basura/duplicado). Se borra de la cola.
 * - 'retry':  no se borra; reaparece tras el visibility timeout. Tras N
 *             intentos SQS lo manda a la DLQ.
 */
export type ProcessOutcome = { action: 'delete' | 'retry'; reason: string; job?: JobMessage; result?: unknown };

export const processMessage = async (body: string | undefined, deps: ProcessorDeps): Promise<ProcessOutcome> => {
    const log = deps.log ?? console;
    const job = parseJobMessage(body);
    if (!job) {
        log.warn('⚠️  [Worker] Mensaje inválido, se descarta:', body);
        return { action: 'delete', reason: 'invalid' };
    }

    const key = jobRunKey(job);
    const lock = await deps.acquire(key, job.type, deps.workerId, deps.leaseMs);
    if (lock === 'done') {
        log.log(`↩️  [Worker] ${key} ya se ejecutó, duplicado descartado`);
        return { action: 'delete', reason: 'duplicate', job };
    }
    if (lock === 'busy') {
        log.log(`⏳ [Worker] ${key} lo está ejecutando otro worker`);
        return { action: 'retry', reason: 'busy', job };
    }

    try {
        log.log(`▶️  [Worker] Ejecutando ${key}`);
        const handler = deps.handlers[job.type] as (params: unknown, ctx: JobContext) => Promise<unknown>;
        const result = await handler(job.params, { key, scheduledAt: job.scheduledAt });
        await deps.complete(key, deps.workerId, result);
        log.log(`✅ [Worker] ${key} terminado`, result);
        return { action: 'delete', reason: 'done', job, result };
    } catch (err) {
        log.error(`❌ [Worker] ${key} falló:`, err);
        await deps.release(key, deps.workerId).catch(() => undefined);
        return { action: 'retry', reason: 'failed', job };
    }
};
