/**
 * Reward controllers
 *
 * Exposes endpoints for creating, listing, updating, and deleting individual rewards.
 * All endpoints require business authentication and are scoped to the authenticated business.
 */
import { Request, Response, NextFunction } from 'express';
import * as rewardService from '../services/reward.service';

/**
 * Create a new reward.
 * POST /api/rewards
 * Expects:
 * - systemId: string (ID of the system this reward belongs to)
 * - name: string
 * - description?: string
 * - rewardType: 'discount' | 'free_product' | 'coupon' | 'cashback'
 * - rewardValue: string
 * - pointsRequired?: number (for points-based systems)
 * - stampsRequired?: number (for stamps-based systems)
 */
export const createReward = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const business = req.business;
        if (!business) {
            res.status(401).json({ message: 'not authenticated' });
            return;
        }

        const {
            systemId,
            name,
            description,
            rewardType,
            rewardValue,
            pointsRequired,
            stampsRequired,
        } = req.body;

        // Validate required fields
        if (!systemId || !name || !rewardType || !rewardValue) {
            res.status(400).json({
                message: 'Missing required fields: systemId, name, rewardType, rewardValue',
            });
            return;
        }

        // Validate rewardType
        if (!['discount', 'free_product', 'coupon', 'cashback'].includes(rewardType)) {
            res.status(400).json({
                message: 'rewardType must be one of: discount, free_product, coupon, cashback',
            });
            return;
        }

        // Validate that either pointsRequired or stampsRequired is provided (but not both)
        if (
            (pointsRequired !== undefined && stampsRequired !== undefined) ||
            (pointsRequired === undefined && stampsRequired === undefined)
        ) {
            res.status(400).json({
                message: 'Must provide either pointsRequired or stampsRequired, but not both',
            });
            return;
        }

        const reward = await rewardService.createReward(
            business.id,
            systemId,
            name,
            description,
            rewardType,
            rewardValue,
            pointsRequired,
            stampsRequired
        );

        res.status(201).json(reward);
    } catch (error: any) {
        next(error);
    }
};

/**
 * Get all rewards for the authenticated business.
 * GET /api/rewards
 * Query params:
 * - includeInactive: boolean (default: false)
 */
export const getRewards = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const business = req.business;
        if (!business) {
            res.status(401).json({ message: 'not authenticated' });
            return;
        }

        const includeInactive = req.query.includeInactive === 'true';
        const rewards = await rewardService.findRewardsByBusinessId(business.id, includeInactive);
        res.json(rewards);
    } catch (error) {
        next(error);
    }
};

/**
 * Get all rewards for a specific system.
 * GET /api/rewards/system/:systemId
 * Query params:
 * - includeInactive: boolean (default: false)
 */
export const getRewardsBySystemId = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { systemId } = req.params;
        const includeInactive = req.query.includeInactive === 'true';

        const rewards = await rewardService.findRewardsBySystemId(systemId, includeInactive);
        res.json(rewards);
    } catch (error) {
        next(error);
    }
};

/**
 * Get a specific reward by ID.
 * GET /api/rewards/:id
 * The reward must belong to the authenticated business.
 */
export const getRewardById = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const business = req.business;
        if (!business) {
            res.status(401).json({ message: 'not authenticated' });
            return;
        }

        const { id } = req.params;

        const reward = await rewardService.findRewardByIdAndBusinessId(id, business.id);
        if (!reward) {
            res.status(404).json({ message: 'reward not found' });
            return;
        }
        res.json(reward);
    } catch (error) {
        next(error);
    }
};

/**
 * Update a reward.
 * PUT /api/rewards/:id
 * All fields are optional.
 */
export const updateReward = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const business = req.business;
        if (!business) {
            res.status(401).json({ message: 'not authenticated' });
            return;
        }

        const { id } = req.params;
        const {
            name,
            description,
            rewardType,
            rewardValue,
            pointsRequired,
            stampsRequired,
            isActive,
        } = req.body;

        const reward = await rewardService.updateReward(id, business.id, {
            name,
            description,
            rewardType,
            rewardValue,
            pointsRequired,
            stampsRequired,
            isActive,
        });

        if (!reward) {
            res.status(404).json({ message: 'reward not found' });
            return;
        }

        res.json(reward);
    } catch (error: any) {
        next(error);
    }
};

/**
 * Delete a reward.
 * DELETE /api/rewards/:id
 * Query params:
 * - hardDelete: boolean (default: false for soft delete)
 */
export const deleteReward = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const business = req.business;
        if (!business) {
            res.status(401).json({ message: 'not authenticated' });
            return;
        }

        const { id } = req.params;
        const hardDelete = req.query.hardDelete === 'true';

        const deleted = await rewardService.deleteReward(id, business.id, hardDelete);
        if (!deleted) {
            res.status(404).json({ message: 'reward not found' });
            return;
        }
        res.json({ message: hardDelete ? 'reward permanently deleted' : 'reward deactivated' });
    } catch (error) {
        next(error);
    }
};

/**
 * Get all rewards for a specific business by businessId.
 * GET /api/rewards/business/:businessId
 * Public endpoint - no authentication required.
 * This allows clients to see available rewards at businesses.
 * Query params:
 * - includeInactive: boolean (default: false)
 */
export const getRewardsByBusinessId = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const { businessId } = req.params;

        if (!businessId) {
            res.status(400).json({ message: 'businessId is required' });
            return;
        }

        const includeInactive = req.query.includeInactive === 'true';
        const rewards = await rewardService.findRewardsByBusinessId(businessId, includeInactive);
        res.json(rewards);
    } catch (error) {
        next(error);
    }
};

