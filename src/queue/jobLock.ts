import { JobRunModel } from '../models/jobRun.model';

export type AcquireResult = 'acquired' | 'done' | 'busy';

const isDuplicateKey = (err: any) => err?.code === 11000;

/**
 * Intenta tomar el trabajo `key`.
 * - 'acquired': este worker debe ejecutarlo.
 * - 'done':     ya se ejecutó; el mensaje es un duplicado y se puede borrar.
 * - 'busy':     otro worker lo está ejecutando ahora; dejar que el mensaje reaparezca.
 */
export const acquireJob = async (key: string, type: string, workerId: string, leaseMs: number): Promise<AcquireResult> => {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + leaseMs);

    try {
        await JobRunModel.create({ key, type, status: 'running', lockedUntil, workerId });
        return 'acquired';
    } catch (err) {
        if (!isDuplicateKey(err)) throw err;
    }

    // Ya existe: lo retomamos solo si el lease anterior expiró (worker caído).
    const taken = await JobRunModel.findOneAndUpdate(
        { key, status: 'running', lockedUntil: { $lt: now } },
        { $set: { lockedUntil, workerId }, $inc: { attempts: 1 } },
        { new: true }
    );
    if (taken) return 'acquired';

    const existing = await JobRunModel.findOne({ key }, { status: 1 }).lean();
    return existing?.status === 'done' ? 'done' : 'busy';
};

export const renewJob = async (key: string, workerId: string, leaseMs: number): Promise<void> => {
    await JobRunModel.updateOne(
        { key, workerId, status: 'running' },
        { $set: { lockedUntil: new Date(Date.now() + leaseMs) } }
    );
};

export const completeJob = async (key: string, workerId: string, result: unknown): Promise<void> => {
    await JobRunModel.updateOne(
        { key, workerId },
        { $set: { status: 'done', result, finishedAt: new Date() } }
    );
};

/** Libera el candado tras un fallo para que el reintento de SQS pueda tomarlo de inmediato. */
export const releaseJob = async (key: string, workerId: string): Promise<void> => {
    await JobRunModel.updateOne(
        { key, workerId, status: 'running' },
        { $set: { lockedUntil: new Date(0) } }
    );
};
