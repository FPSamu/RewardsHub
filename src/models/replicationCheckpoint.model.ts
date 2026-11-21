import { Schema, model } from 'mongoose';

/**
 * Hasta dónde llegó la réplica a DynamoDB (job 'replicate-dynamo', P5.2).
 *
 * - _id: 'transactions' | 'daily_stats'
 * - lastSeenAt / lastSeenId: último documento copiado, en orden
 *   (updatedAt|computedAt, _id). Todo lo que va antes ya está en DynamoDB.
 * - syncedAt: cuándo terminó la última pasada COMPLETA (sin pendientes). Es
 *   lo que muestra el header X-Data-Freshness ("datos al …").
 */
export type CheckpointId = 'transactions' | 'daily_stats';

export interface IReplicationCheckpoint {
    _id: CheckpointId;
    lastSeenAt?: Date;
    lastSeenId?: string;
    syncedAt?: Date;
    replicated: number;
}

const replicationCheckpointSchema = new Schema<IReplicationCheckpoint>(
    {
        _id: { type: String, enum: ['transactions', 'daily_stats'], required: true },
        lastSeenAt: { type: Date },
        lastSeenId: { type: String },
        syncedAt: { type: Date },
        replicated: { type: Number, default: 0 },
    },
    { timestamps: false, _id: false }
);

export const ReplicationCheckpointModel = model<IReplicationCheckpoint>(
    'ReplicationCheckpoint', replicationCheckpointSchema, 'replication_checkpoints'
);
