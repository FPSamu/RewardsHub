/**
 * UserPoints controllers
 *
 * Exposes endpoints for adding points/stamps to users when they make purchases at businesses.
 */
import { Request, Response } from 'express';
import * as userPointsService from '../services/userPoints.service';
import * as systemService from '../services/system.service';
import * as userService from '../services/user.service';
import * as transactionService from '../services/transaction.service';
import * as businessService from '../services/business.service';

const resolveBranchId = (business: any, branchId?: string): { id?: string } => {
    const locations = business?.locations || [];

    if (branchId) {
        const match = locations.find((loc: any) => loc?._id?.toString() === branchId);
        if (!match) {
            throw new Error('branchId does not belong to this business');
        }
        return { id: match._id.toString() };
    }

    if (locations.length === 1) {
        return { id: locations[0]._id.toString() };
    }

    const main = locations.find((loc: any) => loc?.isMain);
    if (main) {
        return { id: main._id.toString() };
    }

    if (locations.length > 1) {
        throw new Error('branchId is required for businesses with multiple branches');
    }

    return {};
};

/**
 * Add points and/or stamps to a user after a purchase.
 * Expects:
 * - userId: string (from scanned QR code)
 * - purchaseAmount?: number (for points calculation, if business has points system)
 * - stampData?: { rewardSystemId: string, stampsCount: number, productIdentifier?: string }[] (for stamps, if business has stamp systems)
 */
export const addPointsOrStamps = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { userId, purchaseAmount, stampData, branchId, locationId } = req.body as {
        userId?: string;
        purchaseAmount?: number;
        stampData?: Array<{
            rewardSystemId: string;
            stampsCount: number;
            productIdentifier?: string;
        }>;
        branchId?: string;
        locationId?: string;
    };

    // Validate required fields
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }

    if (!purchaseAmount && (!stampData || stampData.length === 0)) {
        return res.status(400).json({ message: 'either purchaseAmount or stampData is required' });
    }

    // Validate user exists
    const user = await userService.findUserById(userId);
    if (!user) {
        return res.status(404).json({ message: 'user not found' });
    }

    try {
        // Process points if purchaseAmount is provided
        let pointsSystem = null;
        if (purchaseAmount && purchaseAmount > 0) {
            // Find active points system for this business
            const allSystems = await systemService.findSystemsByBusinessId(business.id);
            pointsSystem = allSystems.find(sys => sys.type === 'points' && sys.isActive);
            
            if (!pointsSystem) {
                return res.status(400).json({ message: 'no active points system found for this business' });
            }
        }

        // Process stamps if stampData is provided
        let stampSystems: Array<{ system: any, count: number }> = [];
        if (stampData && stampData.length > 0) {
            for (const stamp of stampData) {
                if (!stamp.rewardSystemId || stamp.stampsCount === undefined || stamp.stampsCount <= 0) {
                    return res.status(400).json({ message: 'invalid stamp data: systemId and stampsCount are required' });
                }

                // Get and validate stamp system
                const stampSystem = await systemService.findSystemByIdAndBusinessId(stamp.rewardSystemId, business.id);
                if (!stampSystem) {
                    return res.status(404).json({ message: `stamp system ${stamp.rewardSystemId} not found or does not belong to this business` });
                }

                if (!stampSystem.isActive) {
                    return res.status(400).json({ message: `stamp system ${stampSystem.name} is not active` });
                }

                if (stampSystem.type !== 'stamps') {
                    return res.status(400).json({ message: `system ${stampSystem.name} is not a stamps system` });
                }

                // Validate product identifier for specific product types
                if (stampSystem.productType === 'specific') {
                    if (!stamp.productIdentifier) {
                        return res.status(400).json({ message: `productIdentifier is required for stamp system ${stampSystem.name}` });
                    }
                    if (stamp.productIdentifier !== stampSystem.productIdentifier) {
                        return res.status(400).json({ message: `productIdentifier does not match stamp system ${stampSystem.name} configuration` });
                    }
                }

                stampSystems.push({ system: stampSystem, count: stamp.stampsCount });
            }
        }

        // Add points and stamps
        const updatedUserPoints = await userPointsService.addPointsAndStamps(
            userId,
            business.id,
            pointsSystem,
            purchaseAmount,
            stampSystems
        );

        // Create transaction record
        const transactionItems = [];
        
        if (pointsSystem && purchaseAmount) {
            const pointsEarned = userPointsService.calculatePoints(
                purchaseAmount,
                pointsSystem.pointsConversion!
            );
            transactionItems.push({
                rewardSystemId: pointsSystem.id,
                rewardSystemName: pointsSystem.name,
                pointsChange: pointsEarned,
                stampsChange: 0,
            });
        }
        
        for (const { system, count } of stampSystems) {
            transactionItems.push({
                rewardSystemId: system.id,
                rewardSystemName: system.name,
                pointsChange: 0,
                stampsChange: count,
            });
        }

        const resolvedBranch = resolveBranchId(business, locationId || branchId);

        const transaction = await transactionService.createTransaction(
            userId,
            business.id,
            resolvedBranch.id,
            business.name,
            'add',
            transactionItems,
            purchaseAmount,
            undefined,
            undefined,
            'Purchase transaction'
        );

        return res.status(200).json({
            message: 'Points and/or stamps added successfully',
            userPoints: updatedUserPoints,
            transaction,
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
 * Get all users that have points/stamps at the authenticated business.
 * This endpoint is for businesses to see all their customers with points/stamps.
 */
export const getAllUsersForBusiness = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    try {
        const users = await userPointsService.getAllUsersForBusiness(business.id);
        return res.status(200).json({
            businessId: business.id,
            totalUsers: users.length,
            users,
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get users for business' });
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

/**
 * Subtract points and/or stamps from a user.
 * This endpoint is typically used when a user redeems rewards.
 * Expects:
 * - userId: string (user to subtract points/stamps from)
 * - pointsToSubtract?: number (for points subtraction)
 * - rewardSystemId?: string (for points system identification)
 * - stampData?: { rewardSystemId: string, stampsCount: number }[] (for stamps subtraction)
 */
export const subtractPointsOrStamps = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { userId, pointsToSubtract, rewardSystemId, stampData, branchId, locationId } = req.body as {
        userId?: string;
        pointsToSubtract?: number;
        rewardSystemId?: string;
        stampData?: Array<{
            rewardSystemId: string;
            stampsCount: number;
        }>;
        branchId?: string;
        locationId?: string;
    };

    // Validate required fields
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }

    if (!pointsToSubtract && (!stampData || stampData.length === 0)) {
        return res.status(400).json({ message: 'either pointsToSubtract or stampData is required' });
    }

    if (pointsToSubtract && !rewardSystemId) {
        return res.status(400).json({ message: 'rewardSystemId is required when subtracting points' });
    }

    // Validate user exists
    const user = await userService.findUserById(userId);
    if (!user) {
        return res.status(404).json({ message: 'user not found' });
    }

    try {
        // Process points if pointsToSubtract is provided
        let pointsSystem = null;
        if (pointsToSubtract && pointsToSubtract > 0 && rewardSystemId) {
            // Get and validate points system
            pointsSystem = await systemService.findSystemByIdAndBusinessId(rewardSystemId, business.id);
            if (!pointsSystem) {
                return res.status(404).json({ message: 'points system not found or does not belong to this business' });
            }

            if (!pointsSystem.isActive) {
                return res.status(400).json({ message: 'points system is not active' });
            }

            if (pointsSystem.type !== 'points') {
                return res.status(400).json({ message: 'specified system is not a points system' });
            }
        }

        // Process stamps if stampData is provided
        let stampSystems: Array<{ system: any, count: number }> = [];
        if (stampData && stampData.length > 0) {
            for (const stamp of stampData) {
                if (!stamp.rewardSystemId || stamp.stampsCount === undefined || stamp.stampsCount <= 0) {
                    return res.status(400).json({ message: 'invalid stamp data: rewardSystemId and stampsCount are required' });
                }

                // Get and validate stamp system
                const stampSystem = await systemService.findSystemByIdAndBusinessId(stamp.rewardSystemId, business.id);
                if (!stampSystem) {
                    return res.status(404).json({ message: `stamp system ${stamp.rewardSystemId} not found or does not belong to this business` });
                }

                if (!stampSystem.isActive) {
                    return res.status(400).json({ message: `stamp system ${stampSystem.name} is not active` });
                }

                if (stampSystem.type !== 'stamps') {
                    return res.status(400).json({ message: `system ${stampSystem.name} is not a stamps system` });
                }

                stampSystems.push({ system: stampSystem, count: stamp.stampsCount });
            }
        }

        // Subtract points and stamps
        const updatedUserPoints = await userPointsService.subtractPointsAndStamps(
            userId,
            business.id,
            pointsSystem,
            pointsToSubtract,
            stampSystems
        );

        // Create transaction record
        const transactionItems = [];
        
        if (pointsSystem && pointsToSubtract) {
            transactionItems.push({
                rewardSystemId: pointsSystem.id,
                rewardSystemName: pointsSystem.name,
                pointsChange: -pointsToSubtract,
                stampsChange: 0,
            });
        }
        
        for (const { system, count } of stampSystems) {
            transactionItems.push({
                rewardSystemId: system.id,
                rewardSystemName: system.name,
                pointsChange: 0,
                stampsChange: -count,
            });
        }

        const resolvedBranch = resolveBranchId(business, locationId || branchId);

        const transaction = await transactionService.createTransaction(
            userId,
            business.id,
            resolvedBranch.id,
            business.name,
            'subtract',
            transactionItems,
            undefined,
            undefined,
            undefined,
            'Points/stamps subtraction'
        );

        return res.status(200).json({
            message: 'Points and/or stamps subtracted successfully',
            userPoints: updatedUserPoints,
            transaction,
        });
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to subtract points/stamps' });
    }
};
