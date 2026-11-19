/**
 * JobRun: candado + bitácora de trabajos de la cola.
 *
 * Con N workers y entrega "al menos una vez", el mismo trabajo puede llegar
 * dos veces. La llave única `key` asegura que solo un worker lo ejecute.
 * `lockedUntil` es un lease: si el worker muere a mitad, otro puede retomarlo
 * cuando el mensaje reaparezca en la cola.
 */
import { Schema, model, Document } from 'mongoose';

export type JobRunStatus = 'running' | 'done';

export interface IJobRun extends Document {
    key: string;
    type: string;
    status: JobRunStatus;
    lockedUntil: Date;
    attempts: number;
    workerId: string;
    result?: unknown;
    startedAt: Date;
    finishedAt?: Date;
}

const jobRunSchema = new Schema<IJobRun>({
    key: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    status: { type: String, enum: ['running', 'done'], required: true },
    lockedUntil: { type: Date, required: true },
    attempts: { type: Number, default: 1 },
    workerId: { type: String, required: true },
    result: { type: Schema.Types.Mixed },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
});

// La bitácora se limpia sola a los 30 días.
jobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const JobRunModel = model<IJobRun>('JobRun', jobRunSchema);
