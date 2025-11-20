/**
 * System controller
 *
 * This module handles HTTP requests related to reward systems.
 */
import { Request, Response, NextFunction } from 'express';
import * as systemService from '../services/system.service';
import { IPointsConversion } from '../models/system.model';

/**
 * Create a new points-based system
 * POST /api/systems/points
 */
export const createPointsSystem = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const businessId = req.business!.id;
        const { name, description, pointsConversion } = req.body;

        // Validate required fields
        if (!name || !pointsConversion) {
            res.status(400).json({ message: 'Missing required fields: name, pointsConversion' });
            return;
        }

        // Validate pointsConversion structure
        if (
            !pointsConversion.amount ||
            !pointsConversion.currency ||
            !pointsConversion.points
        ) {
            res.status(400).json({
                message: 'pointsConversion must include amount, currency, and points',
            });
            return;
        }

        const system = await systemService.createPointsSystem(
            businessId,
            name,
            description,
            pointsConversion as IPointsConversion
        );

        res.status(201).json(system);
    } catch (error) {
        next(error);
    }
};

/**
 * Create a new stamps-based system
 * POST /api/systems/stamps
 */
export const createStampsSystem = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const businessId = req.business!.id;
        const { name, description, targetStamps, productType, productIdentifier } = req.body;

        // Validate required fields
        if (!name || !targetStamps || !productType) {
            res.status(400).json({
                message: 'Missing required fields: name, targetStamps, productType',
            });
            return;
        }

        // Validate targetStamps
        if (targetStamps < 1) {
            res.status(400).json({ message: 'targetStamps must be at least 1' });
            return;
        }

        // Validate productType
        if (!['specific', 'general', 'any'].includes(productType)) {
            res.status(400).json({
                message: 'productType must be one of: specific, general, any',
            });
            return;
        }

        const system = await systemService.createStampsSystem(
            businessId,
            name,
            description,
            targetStamps,
            productType,
            productIdentifier
        );

        res.status(201).json(system);
    } catch (error) {
        next(error);
    }
};

/**
 * Get all systems for the authenticated business
 * GET /api/systems
 */
export const getSystemsForBusiness = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const businessId = req.business!.id;
        const includeInactive = req.query.includeInactive === 'true';

        const systems = await systemService.findSystemsByBusinessId(businessId, includeInactive);
        res.status(200).json(systems);
    } catch (error) {
        next(error);
    }
};

/**
 * Get a specific system by ID
 * GET /api/systems/:systemId
 */
export const getSystemById = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const businessId = req.business!.id;
        const { systemId } = req.params;

        const system = await systemService.findSystemByIdAndBusinessId(systemId, businessId);

        if (!system) {
            res.status(404).json({ message: 'System not found' });
            return;
        }

        res.status(200).json(system);
    } catch (error) {
        next(error);
    }
};

/**
 * Update a points-based system
 * PUT /api/systems/points/:systemId
 */
export const updatePointsSystem = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const businessId = req.business!.id;
        const { systemId } = req.params;
        const { name, description, isActive, pointsConversion } = req.body;

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (isActive !== undefined) updates.isActive = isActive;
        if (pointsConversion !== undefined) updates.pointsConversion = pointsConversion;

        const system = await systemService.updatePointsSystem(systemId, businessId, updates);

        if (!system) {
            res.status(404).json({ message: 'Points system not found' });
            return;
        }

        res.status(200).json(system);
    } catch (error) {
        next(error);
    }
};

/**
 * Update a stamps-based system
 * PUT /api/systems/stamps/:systemId
 */
export const updateStampsSystem = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const businessId = req.business!.id;
        const { systemId } = req.params;
        const {
            name,
            description,
            isActive,
            targetStamps,
            productType,
            productIdentifier,
        } = req.body;

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (isActive !== undefined) updates.isActive = isActive;
        if (targetStamps !== undefined) updates.targetStamps = targetStamps;
        if (productType !== undefined) updates.productType = productType;
        if (productIdentifier !== undefined) updates.productIdentifier = productIdentifier;

        const system = await systemService.updateStampsSystem(systemId, businessId, updates);

        if (!system) {
            res.status(404).json({ message: 'Stamps system not found' });
            return;
        }

        res.status(200).json(system);
    } catch (error) {
        next(error);
    }
};

/**
 * Delete a system (soft or hard delete)
 * DELETE /api/systems/:systemId
 */
export const deleteSystem = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const businessId = req.business!.id;
        const { systemId } = req.params;
        const hardDelete = req.query.hardDelete === 'true';

        const deleted = await systemService.deleteSystem(systemId, businessId, hardDelete);

        if (!deleted) {
            res.status(404).json({ message: 'System not found' });
            return;
        }

        res.status(200).json({
            message: hardDelete ? 'System permanently deleted' : 'System deactivated',
        });
    } catch (error) {
        next(error);
    }
};
