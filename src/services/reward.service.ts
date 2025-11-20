/**
 * Reward service (persistence layer).
 *
 * This module is responsible for creating, fetching, updating, and deleting
 * individual rewards from the database. It returns plain objects to avoid
 * leaking Mongoose internals.
 */
import { RewardModel, IReward } from '../models/reward.model';
import { Types } from 'mongoose';

/**
 * Public reward object interface (without Mongoose internals)
 */
export interface PublicReward {
    id: string;
    businessId: string;
    systemId: string;
    name: string;
    description?: string;
    rewardType: 'discount' | 'free_product' | 'coupon' | 'cashback';
    rewardValue: string | number;
    pointsRequired?: number;
    stampsRequired?: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * Convert a Mongoose document into a plain public object.
 */
const toPublic = (doc: IReward): PublicReward => ({
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    systemId: doc.systemId.toString(),
    name: doc.name,
    description: doc.description,
    rewardType: doc.rewardType,
    rewardValue: doc.rewardValue,
    pointsRequired: doc.pointsRequired,
    stampsRequired: doc.stampsRequired,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
});

/**
 * Create a new reward.
 * @param businessId - The business that owns this reward
 * @param systemId - The system this reward belongs to
 * @param name - Name of the reward
 * @param description - Optional description
 * @param rewardType - Type of reward
 * @param rewardValue - Value or description of the reward (string or number)
 * @param pointsRequired - Points required to redeem (for points-based systems)
 * @param stampsRequired - Stamps required to redeem (for stamps-based systems)
 * @returns Public reward object
 */
export const createReward = async (
    businessId: string,
    systemId: string,
    name: string,
    description: string | undefined,
    rewardType: 'discount' | 'free_product' | 'coupon' | 'cashback',
    rewardValue: string | number,
    pointsRequired: number | undefined,
    stampsRequired: number | undefined
): Promise<PublicReward> => {
    const doc = await RewardModel.create({
        businessId: new Types.ObjectId(businessId),
        systemId: new Types.ObjectId(systemId),
        name,
        description,
        rewardType,
        rewardValue,
        pointsRequired,
        stampsRequired,
        isActive: true,
    });
    return toPublic(doc as IReward);
};

/**
 * Find all reward systems for a specific business.
 * @param businessId - The business ID
 * @param includeInactive - Whether to include inactive rewards (default: false)
 * @returns Array of public reward objects
 */
export const findRewardsByBusinessId = async (
    businessId: string,
    includeInactive: boolean = false
): Promise<PublicReward[]> => {
    const query: any = { businessId: new Types.ObjectId(businessId) };
    if (!includeInactive) {
        query.isActive = true;
    }
    const docs = await RewardModel.find(query).sort({ createdAt: -1 }).exec();
    return docs.map((doc) => toPublic(doc as IReward));
};

/**
 * Find a reward system by ID.
 * @param rewardId - The reward system ID
 * @returns Public reward object or undefined
 */
export const findRewardById = async (rewardId: string): Promise<PublicReward | undefined> => {
    const doc = await RewardModel.findById(rewardId).exec();
    return doc ? toPublic(doc as IReward) : undefined;
};

/**
 * Find a reward by ID and business ID (for authorization checks).
 * @param rewardId - The reward ID
 * @param businessId - The business ID (to verify ownership)
 * @returns Public reward object or undefined
 */
export const findRewardByIdAndBusinessId = async (
    rewardId: string,
    businessId: string
): Promise<PublicReward | undefined> => {
    const doc = await RewardModel.findOne({
        _id: new Types.ObjectId(rewardId),
        businessId: new Types.ObjectId(businessId),
    }).exec();
    return doc ? toPublic(doc as IReward) : undefined;
};

/**
 * Find all rewards for a specific system.
 * @param systemId - The system ID
 * @param includeInactive - Whether to include inactive rewards (default: false)
 * @returns Array of public reward objects
 */
export const findRewardsBySystemId = async (
    systemId: string,
    includeInactive: boolean = false
): Promise<PublicReward[]> => {
    const query: any = { systemId: new Types.ObjectId(systemId) };
    if (!includeInactive) {
        query.isActive = true;
    }
    const docs = await RewardModel.find(query).sort({ createdAt: -1 }).exec();
    return docs.map((doc) => toPublic(doc as IReward));
};

/**
 * Update a reward.
 * @param rewardId - The reward ID
 * @param businessId - The business ID (for authorization)
 * @param updates - Partial update object
 * @returns Updated public reward object or undefined
 */
export const updateReward = async (
    rewardId: string,
    businessId: string,
    updates: {
        name?: string;
        description?: string;
        rewardType?: 'discount' | 'free_product' | 'coupon' | 'cashback';
        rewardValue?: string | number;
        pointsRequired?: number;
        stampsRequired?: number;
        isActive?: boolean;
    }
): Promise<PublicReward | undefined> => {
    const doc = await RewardModel.findOneAndUpdate(
        { _id: new Types.ObjectId(rewardId), businessId: new Types.ObjectId(businessId) },
        { $set: updates },
        { new: true, runValidators: true }
    ).exec();
    return doc ? toPublic(doc as IReward) : undefined;
};

/**
 * Delete a reward (soft delete by setting isActive to false, or hard delete).
 * @param rewardId - The reward ID
 * @param businessId - The business ID (for authorization)
 * @param hardDelete - Whether to permanently delete (default: false, soft delete)
 * @returns True if deleted, false otherwise
 */
export const deleteReward = async (
    rewardId: string,
    businessId: string,
    hardDelete: boolean = false
): Promise<boolean> => {
    if (hardDelete) {
        const result = await RewardModel.deleteOne({
            _id: new Types.ObjectId(rewardId),
            businessId: new Types.ObjectId(businessId),
        }).exec();
        return result.deletedCount > 0;
    } else {
        const result = await RewardModel.updateOne(
            { _id: new Types.ObjectId(rewardId), businessId: new Types.ObjectId(businessId) },
            { $set: { isActive: false } }
        ).exec();
        return result.modifiedCount > 0;
    }
};

