/**
 * Mongoose System model
 *
 * This module defines the schema for reward system configurations.
 * Each business can have one or more systems (points or stamps).
 */
import { Schema, model, Document, Types } from 'mongoose';

/**
 * Points conversion configuration
 */
export interface IPointsConversion {
    amount: number; // Money amount (e.g., 10)
    currency: string; // Currency code (e.g., "MXN")
    points: number; // Points earned (e.g., 1)
}

/**
 * System document interface
 */
export interface ISystem extends Document {
    _id: any;
    businessId: Types.ObjectId; // Reference to the business
    type: 'points' | 'stamps';
    name: string;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    
    // Points-based system fields
    pointsConversion?: IPointsConversion; // Money to points conversion
    
    // Stamps-based system fields
    targetStamps?: number; // Target number of stamps to collect
    productType?: 'specific' | 'general' | 'any'; // Type of product counting towards stamps
    productIdentifier?: string; // If specific, the product identifier
}

const pointsConversionSchema = new Schema<IPointsConversion>(
    {
        amount: { type: Number, required: true, min: 0.01 },
        currency: { type: String, required: true, default: 'MXN' },
        points: { type: Number, required: true, min: 1 },
    },
    { _id: false }
);

const systemSchema = new Schema<ISystem>(
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
        
        // Stamps-based fields
        targetStamps: { type: Number, min: 1 },
        productType: {
            type: String,
            enum: ['specific', 'general', 'any'],
        },
        productIdentifier: { type: String },
    },
    { timestamps: true }
);

/**
 * Virtual `id` for convenience
 */
systemSchema.virtual('id').get(function (this: ISystem) {
    return this._id.toString();
});

/**
 * Validate that systems have required fields based on type
 */
systemSchema.pre('validate', function (next) {
    if (this.type === 'points') {
        if (!this.pointsConversion) {
            return next(new Error('pointsConversion is required for points-based systems'));
        }
    } else if (this.type === 'stamps') {
        if (!this.targetStamps || this.targetStamps < 1) {
            return next(new Error('targetStamps is required and must be at least 1 for stamps-based systems'));
        }
        if (!this.productType) {
            return next(new Error('productType is required for stamps-based systems'));
        }
        if (this.productType === 'specific' && !this.productIdentifier) {
            return next(new Error('productIdentifier is required when productType is "specific"'));
        }
    }
    next();
});

/**
 * toJSON transform
 */
systemSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
    },
});

/**
 * Index for efficient queries
 */
systemSchema.index({ businessId: 1, isActive: 1 });

/**
 * Collection name from environment variable
 */
const rawCollection = process.env.SYSTEMS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const SystemModel = model<ISystem>('System', systemSchema, collectionName);
