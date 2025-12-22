/**
 * Mongoose Transaction model
 *
 * This module defines the schema for transaction history.
 * Tracks all points/stamps additions and subtractions.
 */
import { Schema, model, Document, Types } from 'mongoose';

/**
 * Transaction type enum
 */
export type TransactionType = 'add' | 'subtract' | 'redeem';

/**
 * Transaction item interface - tracks individual points/stamps per reward system
 */
export interface ITransactionItem {
    rewardSystemId: Types.ObjectId; // Reference to the reward system
    rewardSystemName: string; // Store name for historical purposes
    pointsChange: number; // Points added (positive) or subtracted (negative)
    stampsChange: number; // Stamps added (positive) or subtracted (negative)
}

/**
 * Transaction document interface
 */
export interface ITransaction extends Document {
    _id: any;
    userId: Types.ObjectId; // Reference to the user
    businessId: Types.ObjectId; // Reference to the business
    businessName: string; // Store business name for historical purposes
    type: TransactionType; // Type of transaction

    // Transaction details
    purchaseAmount?: number; // Original purchase amount (for 'add' type)
    items: ITransactionItem[]; // Points/stamps changes per reward system

    // Totals for this transaction
    totalPointsChange: number; // Total points in this transaction (can be negative)
    totalStampsChange: number; // Total stamps in this transaction (can be negative)

    // Optional metadata
    rewardId?: Types.ObjectId; // Reference to reward if this was a redemption
    rewardName?: string; // Reward name for historical purposes
    notes?: string; // Optional notes about the transaction

    // Work shift tracking (for reports)
    workShiftId?: Types.ObjectId; // Reference to the work shift
    workShiftName?: string; // Shift name for historical purposes

    createdAt: Date;
    updatedAt: Date;
}

const transactionItemSchema = new Schema<ITransactionItem>(
    {
        rewardSystemId: { type: Schema.Types.ObjectId, required: true, ref: 'System' },
        rewardSystemName: { type: String, required: true },
        pointsChange: { type: Number, default: 0 },
        stampsChange: { type: Number, default: 0 },
    },
    { _id: false }
);

const transactionSchema = new Schema<ITransaction>(
    {
        userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
        businessId: { type: Schema.Types.ObjectId, required: true, ref: 'Business', index: true },
        businessName: { type: String, required: true },
        type: {
            type: String,
            required: true,
            enum: ['add', 'subtract', 'redeem'],
            index: true
        },
        purchaseAmount: { type: Number, min: 0 },
        items: { type: [transactionItemSchema], required: true, default: [] },
        totalPointsChange: { type: Number, default: 0 },
        totalStampsChange: { type: Number, default: 0 },
        rewardId: { type: Schema.Types.ObjectId, ref: 'Reward' },
        rewardName: { type: String },
        notes: { type: String },
        workShiftId: { type: Schema.Types.ObjectId, ref: 'WorkShift' },
        workShiftName: { type: String },
    },
    { timestamps: true }
);

/**
 * Virtual `id` for convenience
 */
transactionSchema.virtual('id').get(function (this: ITransaction) {
    return this._id.toString();
});

/**
 * Compound indexes for efficient queries
 */
transactionSchema.index({ userId: 1, businessId: 1 });
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ businessId: 1, createdAt: -1 });
transactionSchema.index({ businessId: 1, workShiftId: 1, createdAt: -1 }); // For shift reports


/**
 * toJSON transform
 */
transactionSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
    },
});

/**
 * Collection name from environment variable
 */
const rawCollection = process.env.TRANSACTIONS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const TransactionModel = model<ITransaction>('Transaction', transactionSchema, collectionName);
