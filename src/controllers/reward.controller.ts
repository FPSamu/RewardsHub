/**
 * Reward controllers
 *
 * Exposes endpoints for creating, listing, updating, and deleting reward systems.
 * All endpoints require business authentication and are scoped to the authenticated business.
 */
import { Request, Response } from 'express';
import * as rewardService from '../services/reward.service';
import {
    IPointsReward,
    IStampReward,
    IPointsConversion,
} from '../models/reward.model';

/**
 * Create a new points-based reward system.
 * Expects:
 * - type: "points"
 * - name: string
 * - description?: string
 * - pointsConversion: { amount: number, currency: string, points: number }
 * - pointsRewards?: array of { pointsRequired, rewardType, rewardValue, description }
 */
export const createPointsReward = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { name, description, pointsConversion, pointsRewards } = req.body as {
        name?: string;
        description?: string;
        pointsConversion?: IPointsConversion;
        pointsRewards?: IPointsReward[];
    };

    if (!name) {
        return res.status(400).json({ message: 'name is required' });
    }

    if (!pointsConversion) {
        return res.status(400).json({ message: 'pointsConversion is required for points-based reward systems' });
    }

    if (!pointsConversion.amount || pointsConversion.amount <= 0) {
        return res.status(400).json({ message: 'pointsConversion.amount must be greater than 0' });
    }

    if (!pointsConversion.currency) {
        return res.status(400).json({ message: 'pointsConversion.currency is required' });
    }

    if (!pointsConversion.points || pointsConversion.points < 1) {
        return res.status(400).json({ message: 'pointsConversion.points must be at least 1' });
    }

    try {
        const reward = await rewardService.createPointsReward(
            business.id,
            name,
            description,
            pointsConversion,
            pointsRewards || []
        );
        return res.status(201).json(reward);
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to create reward system' });
    }
};

/**
 * Create a new stamps-based reward system.
 * Expects:
 * - type: "stamps"
 * - name: string
 * - description?: string
 * - targetStamps: number
 * - productType: "specific" | "general" | "any"
 * - productIdentifier?: string (required if productType is "specific")
 * - stampReward: { rewardType, rewardValue, description }
 */
export const createStampsReward = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const {
        name,
        description,
        targetStamps,
        productType,
        productIdentifier,
        stampReward,
    } = req.body as {
        name?: string;
        description?: string;
        targetStamps?: number;
        productType?: 'specific' | 'general' | 'any';
        productIdentifier?: string;
        stampReward?: IStampReward;
    };

    if (!name) {
        return res.status(400).json({ message: 'name is required' });
    }

    if (!targetStamps || targetStamps < 1) {
        return res.status(400).json({ message: 'targetStamps is required and must be at least 1' });
    }

    if (!productType) {
        return res.status(400).json({ message: 'productType is required' });
    }

    if (productType === 'specific' && !productIdentifier) {
        return res.status(400).json({ message: 'productIdentifier is required when productType is "specific"' });
    }

    if (!stampReward) {
        return res.status(400).json({ message: 'stampReward is required' });
    }

    if (!stampReward.rewardType || !['free_product', 'coupon', 'discount'].includes(stampReward.rewardType)) {
        return res.status(400).json({ message: 'stampReward.rewardType must be one of: free_product, coupon, discount' });
    }

    if (!stampReward.description) {
        return res.status(400).json({ message: 'stampReward.description is required' });
    }

    try {
        const reward = await rewardService.createStampsReward(
            business.id,
            name,
            description,
            targetStamps,
            productType,
            productIdentifier,
            stampReward
        );
        return res.status(201).json(reward);
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to create reward system' });
    }
};

/**
 * Get all reward systems for the authenticated business.
 * Query params:
 * - includeInactive: boolean (default: false)
 */
export const getRewards = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const includeInactive = req.query.includeInactive === 'true';

    try {
        const rewards = await rewardService.findRewardsByBusinessId(business.id, includeInactive);
        return res.json(rewards);
    } catch (error) {
        return res.status(500).json({ message: 'failed to fetch reward systems' });
    }
};

/**
 * Get a specific reward system by ID.
 * The reward must belong to the authenticated business.
 */
export const getRewardById = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { id } = req.params;

    try {
        const reward = await rewardService.findRewardByIdAndBusinessId(id, business.id);
        if (!reward) {
            return res.status(404).json({ message: 'reward system not found' });
        }
        return res.json(reward);
    } catch (error) {
        return res.status(500).json({ message: 'failed to fetch reward system' });
    }
};

/**
 * Update a points-based reward system.
 * Expects the same fields as createPointsReward, but all are optional.
 */
export const updatePointsReward = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { id } = req.params;
    const { name, description, isActive, pointsConversion, pointsRewards } = req.body;

    try {
        const reward = await rewardService.updatePointsReward(id, business.id, {
            name,
            description,
            isActive,
            pointsConversion,
            pointsRewards,
        });

        if (!reward) {
            return res.status(404).json({ message: 'reward system not found or not a points-based system' });
        }

        return res.json(reward);
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to update reward system' });
    }
};

/**
 * Update a stamps-based reward system.
 * Expects the same fields as createStampsReward, but all are optional.
 */
export const updateStampsReward = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { id } = req.params;
    const {
        name,
        description,
        isActive,
        targetStamps,
        productType,
        productIdentifier,
        stampReward,
    } = req.body;

    try {
        const reward = await rewardService.updateStampsReward(id, business.id, {
            name,
            description,
            isActive,
            targetStamps,
            productType,
            productIdentifier,
            stampReward,
        });

        if (!reward) {
            return res.status(404).json({ message: 'reward system not found or not a stamps-based system' });
        }

        return res.json(reward);
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to update reward system' });
    }
};

/**
 * Delete a reward system (soft delete by default, hard delete if hardDelete=true in query).
 */
export const deleteReward = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { id } = req.params;
    const hardDelete = req.query.hardDelete === 'true';

    try {
        const deleted = await rewardService.deleteReward(id, business.id, hardDelete);
        if (!deleted) {
            return res.status(404).json({ message: 'reward system not found' });
        }
        return res.json({ message: 'reward system deleted successfully' });
    } catch (error) {
        return res.status(500).json({ message: 'failed to delete reward system' });
    }
};

/**
 * Get all reward systems for a specific business by businessId.
 * Public endpoint - no authentication required.
 * This allows clients to see available rewards at businesses.
 * Query params:
 * - includeInactive: boolean (default: false)
 */
export const getRewardsByBusinessId = async (req: Request, res: Response) => {
    const { businessId } = req.params;

    if (!businessId) {
        return res.status(400).json({ message: 'businessId is required' });
    }

    const includeInactive = req.query.includeInactive === 'true';

    try {
        const rewards = await rewardService.findRewardsByBusinessId(businessId, includeInactive);
        return res.json(rewards);
    } catch (error) {
        return res.status(500).json({ message: 'failed to fetch reward systems' });
    }
};

