/**
 * Reward service (persistence layer).
 *
 * This module is responsible for creating, fetching, updating, and deleting
 * reward systems from the database. It returns plain objects to avoid
 * leaking Mongoose internals.
 */
import { RewardModel, IReward, IPointsReward, IStampReward, IPointsConversion } from '../models/reward.model';
import { Types } from 'mongoose';

/**
 * Public reward object interface (without Mongoose internals)
 */
export interface PublicReward {
    id: string;
    businessId: string;
    type: 'points' | 'stamps';
    name: string;
    description?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    pointsConversion?: IPointsConversion;
    pointsRewards?: IPointsReward[];
    targetStamps?: number;
    productType?: 'specific' | 'general' | 'any';
    productIdentifier?: string;
    stampReward?: IStampReward;
}

/**
 * Convert a Mongoose document into a plain public object.
 */
const toPublic = (doc: IReward): PublicReward => ({
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    type: doc.type,
    name: doc.name,
    description: doc.description,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    pointsConversion: doc.pointsConversion,
    pointsRewards: doc.pointsRewards,
    targetStamps: doc.targetStamps,
    productType: doc.productType,
    productIdentifier: doc.productIdentifier,
    stampReward: doc.stampReward,
});

/**
 * Create a new points-based reward system.
 * @param businessId - The business that owns this reward system
 * @param name - Name of the reward system
 * @param description - Optional description
 * @param pointsConversion - Money to points conversion configuration
 * @param pointsRewards - Array of available rewards
 * @returns Public reward object
 */
export const createPointsReward = async (
    businessId: string,
    name: string,
    description: string | undefined,
    pointsConversion: IPointsConversion,
    pointsRewards: IPointsReward[] = []
): Promise<PublicReward> => {
    const doc = await RewardModel.create({
        businessId: new Types.ObjectId(businessId),
        type: 'points',
        name,
        description,
        pointsConversion,
        pointsRewards,
        isActive: true,
    });
    return toPublic(doc as IReward);
};

/**
 * Create a new stamps-based reward system.
 * @param businessId - The business that owns this reward system
 * @param name - Name of the reward system
 * @param description - Optional description
 * @param targetStamps - Target number of stamps to collect
 * @param productType - Type of product counting towards stamps
 * @param productIdentifier - Optional product identifier for specific products
 * @param stampReward - Reward when target is reached
 * @returns Public reward object
 */
export const createStampsReward = async (
    businessId: string,
    name: string,
    description: string | undefined,
    targetStamps: number,
    productType: 'specific' | 'general' | 'any',
    productIdentifier: string | undefined,
    stampReward: IStampReward
): Promise<PublicReward> => {
    const doc = await RewardModel.create({
        businessId: new Types.ObjectId(businessId),
        type: 'stamps',
        name,
        description,
        targetStamps,
        productType,
        productIdentifier,
        stampReward,
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
 * Find a reward system by ID and business ID (for authorization checks).
 * @param rewardId - The reward system ID
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
 * Update a points-based reward system.
 * @param rewardId - The reward system ID
 * @param businessId - The business ID (for authorization)
 * @param updates - Partial update object
 * @returns Updated public reward object or undefined
 */
export const updatePointsReward = async (
    rewardId: string,
    businessId: string,
    updates: {
        name?: string;
        description?: string;
        isActive?: boolean;
        pointsConversion?: IPointsConversion;
        pointsRewards?: IPointsReward[];
    }
): Promise<PublicReward | undefined> => {
    const updateData: any = { ...updates };
    if (updates.pointsConversion) {
        updateData.pointsConversion = updates.pointsConversion;
    }
    if (updates.pointsRewards !== undefined) {
        updateData.pointsRewards = updates.pointsRewards;
    }

    const doc = await RewardModel.findOneAndUpdate(
        { _id: new Types.ObjectId(rewardId), businessId: new Types.ObjectId(businessId), type: 'points' },
        { $set: updateData },
        { new: true, runValidators: true }
    ).exec();
    return doc ? toPublic(doc as IReward) : undefined;
};

/**
 * Update a stamps-based reward system.
 * @param rewardId - The reward system ID
 * @param businessId - The business ID (for authorization)
 * @param updates - Partial update object
 * @returns Updated public reward object or undefined
 */
export const updateStampsReward = async (
    rewardId: string,
    businessId: string,
    updates: {
        name?: string;
        description?: string;
        isActive?: boolean;
        targetStamps?: number;
        productType?: 'specific' | 'general' | 'any';
        productIdentifier?: string;
        stampReward?: IStampReward;
    }
): Promise<PublicReward | undefined> => {
    const updateData: any = { ...updates };
    if (updates.stampReward) {
        updateData.stampReward = updates.stampReward;
    }

    const doc = await RewardModel.findOneAndUpdate(
        { _id: new Types.ObjectId(rewardId), businessId: new Types.ObjectId(businessId), type: 'stamps' },
        { $set: updateData },
        { new: true, runValidators: true }
    ).exec();
    return doc ? toPublic(doc as IReward) : undefined;
};

/**
 * Delete a reward system (soft delete by setting isActive to false, or hard delete).
 * @param rewardId - The reward system ID
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

