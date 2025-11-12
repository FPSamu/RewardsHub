/**
 * UserPoints controllers
 *
 * Exposes endpoints for adding points/stamps to users when they make purchases at businesses.
 */
import { Request, Response } from 'express';
import * as userPointsService from '../services/userPoints.service';
import * as rewardService from '../services/reward.service';
import * as userService from '../services/user.service';

/**
 * Add points or stamps to a user after a purchase.
 * Expects:
 * - userId: string (from scanned QR code)
 * - rewardSystemId: string (the reward system to use)
 * - purchaseAmount?: number (for points systems)
 * - stampsCount?: number (for stamps systems)
 * - productIdentifier?: string (optional, for validating specific product stamps)
 */
export const addPointsOrStamps = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { userId, rewardSystemId, purchaseAmount, stampsCount, productIdentifier } = req.body as {
        userId?: string;
        rewardSystemId?: string;
        purchaseAmount?: number;
        stampsCount?: number;
        productIdentifier?: string;
    };

    // Validate required fields
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }

    if (!rewardSystemId) {
        return res.status(400).json({ message: 'rewardSystemId is required' });
    }

    // Validate user exists
    const user = await userService.findUserById(userId);
    if (!user) {
        return res.status(404).json({ message: 'user not found' });
    }

    // Get reward system and verify it belongs to the business
    const rewardSystem = await rewardService.findRewardByIdAndBusinessId(rewardSystemId, business.id);
    if (!rewardSystem) {
        return res.status(404).json({ message: 'reward system not found or does not belong to this business' });
    }

    if (!rewardSystem.isActive) {
        return res.status(400).json({ message: 'reward system is not active' });
    }

    // Validate system type and required fields
    if (rewardSystem.type === 'points') {
        if (purchaseAmount === undefined || purchaseAmount <= 0) {
            return res.status(400).json({ message: 'purchaseAmount is required and must be greater than 0 for points systems' });
        }
    } else if (rewardSystem.type === 'stamps') {
        if (stampsCount === undefined || stampsCount <= 0) {
            return res.status(400).json({ message: 'stampsCount is required and must be greater than 0 for stamps systems' });
        }

        // Validate product identifier for specific product types
        if (rewardSystem.productType === 'specific') {
            if (!productIdentifier) {
                return res.status(400).json({ message: 'productIdentifier is required for specific product stamp systems' });
            }
            if (productIdentifier !== rewardSystem.productIdentifier) {
                return res.status(400).json({ message: 'productIdentifier does not match the reward system configuration' });
            }
        }
    }

    try {
        const updatedUserPoints = await userPointsService.addPointsOrStamps(
            userId,
            business.id,
            rewardSystem,
            purchaseAmount,
            stampsCount
        );

        return res.status(200).json({
            message: 'Points/stamps added successfully',
            userPoints: updatedUserPoints,
        });
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to add points/stamps' });
    }
};

/**
 * Get user points for the authenticated user.
 * This endpoint is for users to check their own points.
 */
export const getUserPoints = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    try {
        const userPoints = await userPointsService.getUserPoints(user.id);
        if (!userPoints) {
            return res.status(200).json({
                userId: user.id,
                businessPoints: [],
                message: 'No points/stamps found for this user',
            });
        }

        return res.status(200).json(userPoints);
    } catch (error) {
        return res.status(500).json({ message: 'failed to get user points' });
    }
};

/**
 * Get user points for a specific business.
 * This endpoint can be used by businesses to check a user's points at their business.
 */
export const getUserPointsForBusiness = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { userId } = req.params;

    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }

    try {
        const businessPoints = await userPointsService.getUserPointsForBusiness(userId, business.id);
        if (!businessPoints) {
            return res.status(200).json({
                userId,
                businessId: business.id,
                points: 0,
                stamps: 0,
                rewardSystems: [],
                message: 'User has not visited this business yet',
            });
        }

        return res.status(200).json(businessPoints);
    } catch (error) {
        return res.status(500).json({ message: 'failed to get user points for business' });
    }
};

/**
 * Get authenticated user's points for a specific business.
 * This endpoint allows users to check their own points at a specific business.
 */
export const getUserPointsForBusinessByUser = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { businessId } = req.params;

    if (!businessId) {
        return res.status(400).json({ message: 'businessId is required' });
    }

    try {
        const businessPoints = await userPointsService.getUserPointsForBusiness(user.id, businessId);
        if (!businessPoints) {
            return res.status(200).json({
                userId: user.id,
                businessId,
                points: 0,
                stamps: 0,
                rewardSystems: [],
                lastVisit: null,
                message: 'You have not visited this business yet',
            });
        }

        return res.status(200).json(businessPoints);
    } catch (error) {
        return res.status(500).json({ message: 'failed to get user points for business' });
    }
};

