/**
 * Mongoose Reward model
 *
 * This module defines the schema for individual rewards that can be redeemed.
 * Rewards are linked to a System (points or stamps).
 */
import { Schema, model, Document, Types } from 'mongoose';

/**
 * Reward document interface
 */
export interface IReward extends Document {
    _id: any;
    businessId: Types.ObjectId; // Reference to the business
    systemId: Types.ObjectId; // Reference to the system (points or stamps)
    name: string;
    description: string;
    rewardType: 'discount' | 'free_product' | 'coupon' | 'cashback';
    rewardValue: number | string; // Can be percentage, amount, or product identifier
    
    // Cost of the reward
    pointsRequired?: number; // For points-based rewards
    stampsRequired?: number; // For stamps-based rewards (usually equals system's targetStamps)
    
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const rewardSchema = new Schema<IReward>(
    {
        businessId: { type: Schema.Types.ObjectId, required: true, ref: 'Business', index: true },
        systemId: { type: Schema.Types.ObjectId, required: true, ref: 'System', index: true },
        name: { type: String, required: true },
        description: { type: String, required: true },
        rewardType: {
            type: String,
            required: true,
            enum: ['discount', 'free_product', 'coupon', 'cashback'],
        },
        rewardValue: { type: Schema.Types.Mixed, required: true },
        pointsRequired: { type: Number, min: 1 },
        stampsRequired: { type: Number, min: 1 },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

/**
 * Virtual `id` for convenience
 */
rewardSchema.virtual('id').get(function (this: IReward) {
    return this._id.toString();
});

/**
 * Validate that reward has either points or stamps required
 */
rewardSchema.pre('validate', function (next) {
    if (!this.pointsRequired && !this.stampsRequired) {
        return next(new Error('Either pointsRequired or stampsRequired must be specified'));
    }
    if (this.pointsRequired && this.stampsRequired) {
        return next(new Error('Reward cannot have both pointsRequired and stampsRequired'));
    }
    next();
});

/**
 * Index for efficient queries
 */
rewardSchema.index({ businessId: 1, systemId: 1, isActive: 1 });

/**
 * toJSON transform
 */
rewardSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
    },
});

/**
 * Collection name from environment variable
 */
const rawCollection = process.env.REWARDS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const RewardModel = model<IReward>('Reward', rewardSchema, collectionName);

