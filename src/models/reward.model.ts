/**
 * Mongoose Reward model
 *
 * This module defines the schema and the typed interface for reward system documents.
 * Supports two types of reward systems: points-based and stamps-based.
 */
import { Schema, model, Document, Types } from 'mongoose';

/**
 * Reward type for points-based systems
 */
export interface IPointsReward {
    pointsRequired: number;
    rewardType: 'discount' | 'free_product' | 'coupon' | 'cashback';
    rewardValue: number | string; // Can be percentage, amount, or product identifier
    description: string;
}

/**
 * Points conversion configuration
 */
export interface IPointsConversion {
    amount: number; // Money amount (e.g., 10)
    currency: string; // Currency code (e.g., "MXN")
    points: number; // Points earned (e.g., 1)
}

/**
 * Stamp system reward configuration
 */
export interface IStampReward {
    rewardType: 'free_product' | 'coupon' | 'discount';
    rewardValue: number | string; // Can be product identifier, discount amount, or coupon code
    description: string;
}

/**
 * Reward system document interface
 */
export interface IReward extends Document {
    _id: any;
    businessId: Types.ObjectId; // Reference to the business that owns this reward system
    type: 'points' | 'stamps';
    name: string;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    
    // Points-based system fields
    pointsConversion?: IPointsConversion; // Money to points conversion (e.g., 10 MXN = 1 point)
    pointsRewards?: IPointsReward[]; // Available rewards that can be redeemed with points
    
    // Stamps-based system fields
    targetStamps?: number; // Target number of stamps to collect (e.g., 10 drinks)
    productType?: 'specific' | 'general' | 'any'; // Type of product counting towards stamps
    productIdentifier?: string; // If specific, the product identifier
    stampReward?: IStampReward; // Reward when target is reached
}

const pointsConversionSchema = new Schema<IPointsConversion>(
    {
        amount: { type: Number, required: true, min: 0.01 },
        currency: { type: String, required: true, default: 'MXN' },
        points: { type: Number, required: true, min: 1 },
    },
    { _id: false }
);

const pointsRewardSchema = new Schema<IPointsReward>(
    {
        pointsRequired: { type: Number, required: true, min: 1 },
        rewardType: {
            type: String,
            required: true,
            enum: ['discount', 'free_product', 'coupon', 'cashback'],
        },
        rewardValue: { type: Schema.Types.Mixed, required: true },
        description: { type: String, required: true },
    },
    { _id: false }
);

const stampRewardSchema = new Schema<IStampReward>(
    {
        rewardType: {
            type: String,
            required: true,
            enum: ['free_product', 'coupon', 'discount'],
        },
        rewardValue: { type: Schema.Types.Mixed, required: true },
        description: { type: String, required: true },
    },
    { _id: false }
);

const rewardSchema = new Schema<IReward>(
    {
        businessId: { type: Schema.Types.ObjectId, required: true, ref: 'Business', index: true },
        type: {
            type: String,
            required: true,
            enum: ['points', 'stamps'],
        },
        name: { type: String, required: true },
        description: { type: String },
        isActive: { type: Boolean, default: true },
        
        // Points-based fields
        pointsConversion: { type: pointsConversionSchema },
        pointsRewards: { type: [pointsRewardSchema], default: [] },
        
        // Stamps-based fields
        targetStamps: { type: Number, min: 1 },
        productType: {
            type: String,
            enum: ['specific', 'general', 'any'],
        },
        productIdentifier: { type: String },
        stampReward: { type: stampRewardSchema },
    },
    { timestamps: true }
);

/**
 * Virtual `id` for convenience that returns the string form of _id.
 */
rewardSchema.virtual('id').get(function (this: IReward) {
    return this._id.toString();
});

/**
 * Validate that points systems have required fields
 */
rewardSchema.pre('validate', function (next) {
    if (this.type === 'points') {
        if (!this.pointsConversion) {
            return next(new Error('pointsConversion is required for points-based reward systems'));
        }
    } else if (this.type === 'stamps') {
        if (!this.targetStamps || this.targetStamps < 1) {
            return next(new Error('targetStamps is required and must be at least 1 for stamps-based reward systems'));
        }
        if (!this.productType) {
            return next(new Error('productType is required for stamps-based reward systems'));
        }
        if (this.productType === 'specific' && !this.productIdentifier) {
            return next(new Error('productIdentifier is required when productType is "specific"'));
        }
        if (!this.stampReward) {
            return next(new Error('stampReward is required for stamps-based reward systems'));
        }
    }
    next();
});

/**
 * toJSON transform hides internal fields when documents are serialized to JSON.
 */
rewardSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
    },
});

/**
 * Collection name resolution from environment variable.
 */
const rawCollection = process.env.REWARDS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const RewardModel = model<IReward>('Reward', rewardSchema, collectionName);

