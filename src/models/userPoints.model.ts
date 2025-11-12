/**
 * Mongoose UserPoints model
 *
 * This module defines the schema and the typed interface for user points/stamps documents.
 * Tracks points and stamps accumulated by users at different businesses.
 */
import { Schema, model, Document, Types } from 'mongoose';

/**
 * Points/stamps information for a specific reward system
 */
export interface IRewardSystemPoints {
    rewardSystemId: Types.ObjectId; // Reference to the reward system
    points: number; // Accumulated points for this reward system
    stamps: number; // Accumulated stamps for this reward system
    lastUpdated: Date; // Last time points/stamps were updated for this system
}

/**
 * Points/stamps information for a specific business
 */
export interface IBusinessPoints {
    businessId: Types.ObjectId; // Reference to the business
    points: number; // Total points accumulated at this business
    stamps: number; // Total stamps accumulated at this business
    lastVisit: Date; // Last time the user visited this business
    rewardSystems: IRewardSystemPoints[]; // Points/stamps per reward system
}

/**
 * User points document interface
 */
export interface IUserPoints extends Document {
    _id: any;
    userId: Types.ObjectId; // Reference to the user
    businessPoints: IBusinessPoints[]; // List of businesses the user has visited
    createdAt: Date;
    updatedAt: Date;
}

const rewardSystemPointsSchema = new Schema<IRewardSystemPoints>(
    {
        rewardSystemId: { type: Schema.Types.ObjectId, required: true, ref: 'Reward' },
        points: { type: Number, default: 0, min: 0 },
        stamps: { type: Number, default: 0, min: 0 },
        lastUpdated: { type: Date, default: Date.now },
    },
    { _id: false }
);

const businessPointsSchema = new Schema<IBusinessPoints>(
    {
        businessId: { type: Schema.Types.ObjectId, required: true, ref: 'Business' },
        points: { type: Number, default: 0, min: 0 },
        stamps: { type: Number, default: 0, min: 0 },
        lastVisit: { type: Date, default: Date.now },
        rewardSystems: { type: [rewardSystemPointsSchema], default: [] },
    },
    { _id: false }
);

const userPointsSchema = new Schema<IUserPoints>(
    {
        userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', unique: true, index: true },
        businessPoints: { type: [businessPointsSchema], default: [] },
    },
    { timestamps: true }
);

/**
 * Virtual `id` for convenience that returns the string form of _id.
 */
userPointsSchema.virtual('id').get(function (this: IUserPoints) {
    return this._id.toString();
});

/**
 * Index for efficient queries by userId and businessId
 */
userPointsSchema.index({ userId: 1, 'businessPoints.businessId': 1 });

/**
 * toJSON transform hides internal fields when documents are serialized to JSON.
 */
userPointsSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
    },
});

/**
 * Collection name resolution from environment variable.
 */
const rawCollection = process.env.USERS_POINTS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const UserPointsModel = model<IUserPoints>('UserPoints', userPointsSchema, collectionName);

