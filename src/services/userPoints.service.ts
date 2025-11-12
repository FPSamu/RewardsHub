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
 * Add points to a user for a specific business and reward system.
 * @param userId - The user ID
 * @param businessId - The business ID
 * @param rewardSystem - The reward system (must belong to the business)
 * @param purchaseAmount - The purchase amount (for points calculation)
 * @param stampsCount - The number of stamps to add (for stamps systems)
 * @returns Updated public user points object
 */
export const addPointsOrStamps = async (
    userId: string,
    businessId: string,
    rewardSystem: PublicReward,
    purchaseAmount?: number,
    stampsCount?: number
): Promise<PublicUserPoints> => {
    // Verify reward system belongs to business
    if (rewardSystem.businessId !== businessId) {
        throw new Error('Reward system does not belong to the specified business');
    }

    if (!rewardSystem.isActive) {
        throw new Error('Reward system is not active');
    }

    // Calculate points if it's a points system and purchaseAmount is provided
    let pointsToAdd = 0;
    if (rewardSystem.type === 'points' && purchaseAmount !== undefined) {
        if (!rewardSystem.pointsConversion) {
            throw new Error('Points conversion not configured for this reward system');
        }
        pointsToAdd = calculatePoints(purchaseAmount, rewardSystem.pointsConversion);
    }

    // Use stampsCount if it's a stamps system
    let stampsToAdd = 0;
    if (rewardSystem.type === 'stamps' && stampsCount !== undefined) {
        stampsToAdd = stampsCount;
    }

    if (pointsToAdd === 0 && stampsToAdd === 0) {
        throw new Error('No points or stamps to add');
    }

    const userIdObj = new Types.ObjectId(userId);
    const businessIdObj = new Types.ObjectId(businessId);
    const rewardSystemIdObj = new Types.ObjectId(rewardSystem.id);

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
        userPoints.businessPoints.push({
            businessId: businessIdObj,
            points: pointsToAdd,
            stamps: stampsToAdd,
            lastVisit: new Date(),
            rewardSystems: [
                {
                    rewardSystemId: rewardSystemIdObj,
                    points: pointsToAdd,
                    stamps: stampsToAdd,
                    lastUpdated: new Date(),
                },
            ],
        });
    } else {
        // Update existing business entry
        const businessPoints = userPoints.businessPoints[businessIndex];
        businessPoints.points += pointsToAdd;
        businessPoints.stamps += stampsToAdd;
        businessPoints.lastVisit = new Date();

        // Find or create reward system entry
        const rewardSystemIndex = businessPoints.rewardSystems.findIndex(
            (rs) => rs.rewardSystemId.toString() === rewardSystemIdObj.toString()
        );

        if (rewardSystemIndex === -1) {
            // Create new reward system entry
            businessPoints.rewardSystems.push({
                rewardSystemId: rewardSystemIdObj,
                points: pointsToAdd,
                stamps: stampsToAdd,
                lastUpdated: new Date(),
            });
        } else {
            // Update existing reward system entry
            const rewardSystemPoints = businessPoints.rewardSystems[rewardSystemIndex];
            rewardSystemPoints.points += pointsToAdd;
            rewardSystemPoints.stamps += stampsToAdd;
            rewardSystemPoints.lastUpdated = new Date();
        }
    }

    // Mark the array as modified so Mongoose saves it
    userPoints.markModified('businessPoints');

    // Save the document
    await userPoints.save();

    return toPublic(userPoints as IUserPoints);
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

