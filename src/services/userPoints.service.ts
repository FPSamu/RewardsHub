/**
 * UserPoints service (persistence layer).
 *
 * This module is responsible for managing user points and stamps across different businesses.
 */
import { UserPointsModel, IUserPoints, IBusinessPoints, IRewardSystemPoints } from '../models/userPoints.model';
import { Types } from 'mongoose';
import { PublicReward } from './reward.service';

/**
 * Public user points object interface (without Mongoose internals)
 */
export interface PublicUserPoints {
    id: string;
    userId: string;
    businessPoints: PublicBusinessPoints[];
    createdAt: string;
    updatedAt: string;
}

export interface PublicBusinessPoints {
    businessId: string;
    points: number;
    stamps: number;
    lastVisit: string;
    rewardSystems: PublicRewardSystemPoints[];
}

export interface PublicRewardSystemPoints {
    rewardSystemId: string;
    points: number;
    stamps: number;
    lastUpdated: string;
}

/**
 * Convert a Mongoose document into a plain public object.
 */
const toPublic = (doc: IUserPoints): PublicUserPoints => ({
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    businessPoints: doc.businessPoints.map((bp) => ({
        businessId: bp.businessId.toString(),
        points: bp.points,
        stamps: bp.stamps,
        lastVisit: bp.lastVisit.toISOString(),
        rewardSystems: bp.rewardSystems.map((rs) => ({
            rewardSystemId: rs.rewardSystemId.toString(),
            points: rs.points,
            stamps: rs.stamps,
            lastUpdated: rs.lastUpdated.toISOString(),
        })),
    })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
});

/**
 * Calculate points based on purchase amount and reward system conversion.
 * @param purchaseAmount - The purchase amount in the currency
 * @param pointsConversion - The points conversion configuration
 * @returns The number of points earned
 */
export const calculatePoints = (purchaseAmount: number, pointsConversion: { amount: number; points: number }): number => {
    if (purchaseAmount <= 0 || pointsConversion.amount <= 0) {
        return 0;
    }
    return Math.floor((purchaseAmount / pointsConversion.amount) * pointsConversion.points);
};

/**
 * Add points and/or stamps to a user for a specific business.
 * @param userId - The user ID
 * @param businessId - The business ID
 * @param pointsSystem - The points reward system (null if not adding points)
 * @param purchaseAmount - The purchase amount (for points calculation)
 * @param stampSystems - Array of stamp systems with their counts
 * @returns Updated public user points object
 */
export const addPointsAndStamps = async (
    userId: string,
    businessId: string,
    pointsSystem: PublicReward | null,
    purchaseAmount?: number,
    stampSystems?: Array<{ system: PublicReward, count: number }>
): Promise<PublicUserPoints> => {
    // Calculate points if points system is provided
    let pointsToAdd = 0;
    let pointsSystemIdObj: Types.ObjectId | null = null;
    
    if (pointsSystem && purchaseAmount !== undefined && purchaseAmount > 0) {
        if (pointsSystem.businessId !== businessId) {
            throw new Error('Points system does not belong to the specified business');
        }
        if (!pointsSystem.isActive) {
            throw new Error('Points system is not active');
        }
        if (!pointsSystem.pointsConversion) {
            throw new Error('Points conversion not configured for this reward system');
        }
        pointsToAdd = calculatePoints(purchaseAmount, pointsSystem.pointsConversion);
        pointsSystemIdObj = new Types.ObjectId(pointsSystem.id);
    }

    // Validate stamp systems
    const validatedStampSystems: Array<{ id: Types.ObjectId, count: number }> = [];
    let totalStampsToAdd = 0;
    
    if (stampSystems && stampSystems.length > 0) {
        for (const { system, count } of stampSystems) {
            if (system.businessId !== businessId) {
                throw new Error(`Stamp system ${system.name} does not belong to the specified business`);
            }
            if (!system.isActive) {
                throw new Error(`Stamp system ${system.name} is not active`);
            }
            if (count <= 0) {
                throw new Error(`Invalid stamp count for system ${system.name}`);
            }
            validatedStampSystems.push({
                id: new Types.ObjectId(system.id),
                count
            });
            totalStampsToAdd += count;
        }
    }

    if (pointsToAdd === 0 && totalStampsToAdd === 0) {
        throw new Error('No points or stamps to add');
    }

    const userIdObj = new Types.ObjectId(userId);
    const businessIdObj = new Types.ObjectId(businessId);

    // Find or create user points document
    let userPoints = await UserPointsModel.findOne({ userId: userIdObj }).exec();

    if (!userPoints) {
        // Create new user points document
        userPoints = await UserPointsModel.create({
            userId: userIdObj,
            businessPoints: [],
        });
    }

    // Find business index in user's businessPoints array
    const businessIndex = userPoints.businessPoints.findIndex(
        (bp) => bp.businessId.toString() === businessIdObj.toString()
    );

    if (businessIndex === -1) {
        // Create new business entry
        const newRewardSystems: IRewardSystemPoints[] = [];
        
        // Add points system if applicable
        if (pointsSystemIdObj && pointsToAdd > 0) {
            newRewardSystems.push({
                rewardSystemId: pointsSystemIdObj,
                points: pointsToAdd,
                stamps: 0,
                lastUpdated: new Date(),
            });
        }
        
        // Add stamp systems
        for (const { id, count } of validatedStampSystems) {
            newRewardSystems.push({
                rewardSystemId: id,
                points: 0,
                stamps: count,
                lastUpdated: new Date(),
            });
        }
        
        userPoints.businessPoints.push({
            businessId: businessIdObj,
            points: pointsToAdd,
            stamps: totalStampsToAdd,
            lastVisit: new Date(),
            rewardSystems: newRewardSystems,
        });
    } else {
        // Update existing business entry
        const businessPoints = userPoints.businessPoints[businessIndex];
        businessPoints.points += pointsToAdd;
        businessPoints.stamps += totalStampsToAdd;
        businessPoints.lastVisit = new Date();

        // Update or create points system entry
        if (pointsSystemIdObj && pointsToAdd > 0) {
            const pointsSystemIndex = businessPoints.rewardSystems.findIndex(
                (rs) => rs.rewardSystemId.toString() === pointsSystemIdObj!.toString()
            );

            if (pointsSystemIndex === -1) {
                // Create new points system entry
                businessPoints.rewardSystems.push({
                    rewardSystemId: pointsSystemIdObj,
                    points: pointsToAdd,
                    stamps: 0,
                    lastUpdated: new Date(),
                });
            } else {
                // Update existing points system entry
                const pointsSystemPoints = businessPoints.rewardSystems[pointsSystemIndex];
                pointsSystemPoints.points += pointsToAdd;
                pointsSystemPoints.lastUpdated = new Date();
            }
        }

        // Update or create stamp system entries
        for (const { id, count } of validatedStampSystems) {
            const stampSystemIndex = businessPoints.rewardSystems.findIndex(
                (rs) => rs.rewardSystemId.toString() === id.toString()
            );

            if (stampSystemIndex === -1) {
                // Create new stamp system entry
                businessPoints.rewardSystems.push({
                    rewardSystemId: id,
                    points: 0,
                    stamps: count,
                    lastUpdated: new Date(),
                });
            } else {
                // Update existing stamp system entry
                const stampSystemPoints = businessPoints.rewardSystems[stampSystemIndex];
                stampSystemPoints.stamps += count;
                stampSystemPoints.lastUpdated = new Date();
            }
        }
    }

    // Mark the array as modified so Mongoose saves it
    userPoints.markModified('businessPoints');

    // Save the document
    await userPoints.save();

    return toPublic(userPoints as IUserPoints);
};

/**
 * Legacy function for backward compatibility - now calls addPointsAndStamps
 * @deprecated Use addPointsAndStamps instead
 */
export const addPointsOrStamps = async (
    userId: string,
    businessId: string,
    rewardSystem: PublicReward,
    purchaseAmount?: number,
    stampsCount?: number
): Promise<PublicUserPoints> => {
    const pointsSystem = rewardSystem.type === 'points' ? rewardSystem : null;
    const stampSystems = rewardSystem.type === 'stamps' ? [{ system: rewardSystem, count: stampsCount || 0 }] : undefined;
    
    return addPointsAndStamps(userId, businessId, pointsSystem, purchaseAmount, stampSystems);
};

/**
 * Get user points for a specific user.
 * @param userId - The user ID
 * @returns Public user points object or undefined
 */
export const getUserPoints = async (userId: string): Promise<PublicUserPoints | undefined> => {
    const doc = await UserPointsModel.findOne({ userId: new Types.ObjectId(userId) }).exec();
    return doc ? toPublic(doc as IUserPoints) : undefined;
};

/**
 * Get user points for a specific business.
 * @param userId - The user ID
 * @param businessId - The business ID
 * @returns Public business points object or undefined
 */
export const getUserPointsForBusiness = async (
    userId: string,
    businessId: string
): Promise<PublicBusinessPoints | undefined> => {
    const doc = await UserPointsModel.findOne({
        userId: new Types.ObjectId(userId),
        'businessPoints.businessId': new Types.ObjectId(businessId),
    }).exec();

    if (!doc) {
        return undefined;
    }

    const businessPoints = doc.businessPoints.find(
        (bp) => bp.businessId.toString() === businessId
    );

    if (!businessPoints) {
        return undefined;
    }

    return {
        businessId: businessPoints.businessId.toString(),
        points: businessPoints.points,
        stamps: businessPoints.stamps,
        lastVisit: businessPoints.lastVisit.toISOString(),
        rewardSystems: businessPoints.rewardSystems.map((rs) => ({
            rewardSystemId: rs.rewardSystemId.toString(),
            points: rs.points,
            stamps: rs.stamps,
            lastUpdated: rs.lastUpdated.toISOString(),
        })),
    };
};

/**
 * Get all users that have points/stamps at a specific business.
 * @param businessId - The business ID
 * @returns Array of user points with business points filtered
 */
export const getAllUsersForBusiness = async (businessId: string): Promise<Array<{
    userId: string;
    businessPoints: PublicBusinessPoints;
}>> => {
    const docs = await UserPointsModel.find({
        'businessPoints.businessId': new Types.ObjectId(businessId),
    }).exec();

    const results = docs.map((doc) => {
        const businessPoints = doc.businessPoints.find(
            (bp) => bp.businessId.toString() === businessId
        );

        if (!businessPoints) {
            return null;
        }

        return {
            userId: doc.userId.toString(),
            businessPoints: {
                businessId: businessPoints.businessId.toString(),
                points: businessPoints.points,
                stamps: businessPoints.stamps,
                lastVisit: businessPoints.lastVisit.toISOString(),
                rewardSystems: businessPoints.rewardSystems.map((rs) => ({
                    rewardSystemId: rs.rewardSystemId.toString(),
                    points: rs.points,
                    stamps: rs.stamps,
                    lastUpdated: rs.lastUpdated.toISOString(),
                })),
            },
        };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    return results;
};

