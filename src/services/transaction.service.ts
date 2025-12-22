/**
 * Transaction service (persistence layer).
 *
 * This module is responsible for creating and fetching transaction history.
 */
import { TransactionModel, ITransaction, TransactionType, ITransactionItem } from '../models/transaction.model';
import { Types } from 'mongoose';
import * as workShiftService from './workShift.service';
import { findShiftForTransaction } from '../helpers/shiftCalculator';

/**
 * Public transaction object interface
 */
export interface PublicTransaction {
    id: string;
    userId: string;
    businessId: string;
    businessName: string;
    type: TransactionType;
    purchaseAmount?: number;
    items: PublicTransactionItem[];
    totalPointsChange: number;
    totalStampsChange: number;
    rewardId?: string;
    rewardName?: string;
    notes?: string;
    workShiftId?: string;
    workShiftName?: string;
    createdAt: string;
    updatedAt: string;
}

export interface PublicTransactionItem {
    rewardSystemId: string;
    rewardSystemName: string;
    pointsChange: number;
    stampsChange: number;
}

/**
 * Convert a Mongoose document into a plain public object.
 */
const toPublic = (doc: ITransaction): PublicTransaction => ({
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    businessId: doc.businessId.toString(),
    businessName: doc.businessName,
    type: doc.type,
    purchaseAmount: doc.purchaseAmount,
    items: doc.items.map((item) => ({
        rewardSystemId: item.rewardSystemId.toString(),
        rewardSystemName: item.rewardSystemName,
        pointsChange: item.pointsChange,
        stampsChange: item.stampsChange,
    })),
    totalPointsChange: doc.totalPointsChange,
    totalStampsChange: doc.totalStampsChange,
    rewardId: doc.rewardId?.toString(),
    rewardName: doc.rewardName,
    notes: doc.notes,
    workShiftId: doc.workShiftId?.toString(),
    workShiftName: doc.workShiftName,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
});

/**
 * Create a new transaction record.
 */
export const createTransaction = async (
    userId: string,
    businessId: string,
    businessName: string,
    type: TransactionType,
    items: Array<{
        rewardSystemId: string;
        rewardSystemName: string;
        pointsChange: number;
        stampsChange: number;
    }>,
    purchaseAmount?: number,
    rewardId?: string,
    rewardName?: string,
    notes?: string
): Promise<PublicTransaction> => {
    // Calculate totals
    const totalPointsChange = items.reduce((sum, item) => sum + item.pointsChange, 0);
    const totalStampsChange = items.reduce((sum, item) => sum + item.stampsChange, 0);

    const transactionItems: ITransactionItem[] = items.map((item) => ({
        rewardSystemId: new Types.ObjectId(item.rewardSystemId),
        rewardSystemName: item.rewardSystemName,
        pointsChange: item.pointsChange,
        stampsChange: item.stampsChange,
    }));

    // Calculate work shift based on current time
    const now = new Date();
    let workShiftId: Types.ObjectId | undefined;
    let workShiftName: string | undefined;

    try {
        // Get active work shifts for this business
        const activeShifts = await workShiftService.getActiveWorkShifts(businessId);

        if (activeShifts.length > 0) {
            // Find which shift the current time belongs to
            const matchingShift = findShiftForTransaction(now, activeShifts);

            if (matchingShift) {
                workShiftId = matchingShift._id;
                workShiftName = matchingShift.name;
                console.log(`[createTransaction] Assigned to shift: ${workShiftName} (${matchingShift.startTime} - ${matchingShift.endTime})`);
            } else {
                console.log(`[createTransaction] No matching shift found for time: ${now.toISOString()}`);
            }
        } else {
            console.log(`[createTransaction] No active shifts configured for business: ${businessId}`);
        }
    } catch (err) {
        // If shift calculation fails, log error but continue creating transaction
        console.error('[createTransaction] Error calculating work shift:', err);
    }

    const doc = await TransactionModel.create({
        userId: new Types.ObjectId(userId),
        businessId: new Types.ObjectId(businessId),
        businessName,
        type,
        purchaseAmount,
        items: transactionItems,
        totalPointsChange,
        totalStampsChange,
        rewardId: rewardId ? new Types.ObjectId(rewardId) : undefined,
        rewardName,
        notes,
        workShiftId,
        workShiftName,
    });

    return toPublic(doc as ITransaction);
};

/**
 * Get all transactions for a specific user.
 * @param userId - The user ID
 * @param limit - Maximum number of transactions to return
 * @param offset - Number of transactions to skip
 * @returns Array of public transaction objects
 */
export const getTransactionsByUserId = async (
    userId: string,
    limit: number = 50,
    offset: number = 0
): Promise<PublicTransaction[]> => {
    const docs = await TransactionModel.find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

    return docs.map((doc) => toPublic(doc as ITransaction));
};

/**
 * Get all transactions for a specific business.
 * @param businessId - The business ID
 * @param limit - Maximum number of transactions to return
 * @param offset - Number of transactions to skip
 * @returns Array of public transaction objects
 */
export const getTransactionsByBusinessId = async (
    businessId: string,
    limit: number = 50,
    offset: number = 0
): Promise<PublicTransaction[]> => {
    const docs = await TransactionModel.find({ businessId: new Types.ObjectId(businessId) })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

    return docs.map((doc) => toPublic(doc as ITransaction));
};

/**
 * Get transactions for a specific user at a specific business.
 * @param userId - The user ID
 * @param businessId - The business ID
 * @param limit - Maximum number of transactions to return
 * @param offset - Number of transactions to skip
 * @returns Array of public transaction objects
 */
export const getTransactionsByUserAndBusiness = async (
    userId: string,
    businessId: string,
    limit: number = 50,
    offset: number = 0
): Promise<PublicTransaction[]> => {
    const docs = await TransactionModel.find({
        userId: new Types.ObjectId(userId),
        businessId: new Types.ObjectId(businessId),
    })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

    return docs.map((doc) => toPublic(doc as ITransaction));
};

/**
 * Get a specific transaction by ID.
 * @param transactionId - The transaction ID
 * @returns Public transaction object or undefined
 */
export const getTransactionById = async (transactionId: string): Promise<PublicTransaction | undefined> => {
    const doc = await TransactionModel.findById(transactionId).exec();
    return doc ? toPublic(doc as ITransaction) : undefined;
};

/**
 * Get transaction statistics for a user.
 * @param userId - The user ID
 * @returns Statistics object
 */
export const getUserTransactionStats = async (userId: string): Promise<{
    totalTransactions: number;
    totalPointsEarned: number;
    totalPointsSpent: number;
    totalStampsEarned: number;
    totalStampsSpent: number;
}> => {
    const userIdObj = new Types.ObjectId(userId);

    const stats = await TransactionModel.aggregate([
        { $match: { userId: userIdObj } },
        {
            $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                totalPointsEarned: {
                    $sum: {
                        $cond: [{ $gt: ['$totalPointsChange', 0] }, '$totalPointsChange', 0]
                    }
                },
                totalPointsSpent: {
                    $sum: {
                        $cond: [{ $lt: ['$totalPointsChange', 0] }, { $abs: '$totalPointsChange' }, 0]
                    }
                },
                totalStampsEarned: {
                    $sum: {
                        $cond: [{ $gt: ['$totalStampsChange', 0] }, '$totalStampsChange', 0]
                    }
                },
                totalStampsSpent: {
                    $sum: {
                        $cond: [{ $lt: ['$totalStampsChange', 0] }, { $abs: '$totalStampsChange' }, 0]
                    }
                },
            }
        }
    ]).exec();

    if (stats.length === 0) {
        return {
            totalTransactions: 0,
            totalPointsEarned: 0,
            totalPointsSpent: 0,
            totalStampsEarned: 0,
            totalStampsSpent: 0,
        };
    }

    return stats[0];
};
