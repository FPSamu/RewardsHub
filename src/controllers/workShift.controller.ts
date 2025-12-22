/**
 * WorkShift controllers
 * 
 * Handles HTTP requests for work shift management.
 */

import { Request, Response } from 'express';
import * as workShiftService from '../services/workShift.service';

/**
 * Create a new work shift
 * POST /work-shifts
 * 
 * Body: {
 *   businessId: string,
 *   name: string,
 *   startTime: string,  // "HH:mm" format
 *   endTime: string,    // "HH:mm" format
 *   color?: string,     // Hex color
 *   description?: string
 * }
 */
export async function createWorkShift(req: Request, res: Response) {
    try {
        const { businessId, name, startTime, endTime, color, description } = req.body;

        // Validate required fields
        if (!businessId || !name || !startTime || !endTime) {
            return res.status(400).json({
                message: 'Missing required fields: businessId, name, startTime, endTime',
            });
        }

        // Validate time format
        const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
            return res.status(400).json({
                message: 'Invalid time format. Use HH:mm format (e.g., "08:00")',
            });
        }

        const shift = await workShiftService.createWorkShift(
            businessId,
            name,
            startTime,
            endTime,
            color,
            description
        );

        return res.status(201).json(shift);
    } catch (err: any) {
        console.error('Error creating work shift:', err);
        return res.status(500).json({ message: err.message || 'Failed to create work shift' });
    }
}

/**
 * Get work shifts for the authenticated business
 * GET /work-shifts
 * 
 * Query params:
 *   includeInactive?: boolean (default: false)
 * 
 * Requires authentication - uses req.user.id as businessId
 */
export async function getMyWorkShifts(req: Request, res: Response) {
    console.log("BUSCANDO ID");
    try {
        const businessId = (req as any).user?.id;

        console.log('[getMyWorkShifts] Request received');
        console.log('[getMyWorkShifts] User object:', (req as any).user);
        console.log('[getMyWorkShifts] Business ID:', businessId);

        if (!businessId) {
            console.error('[getMyWorkShifts] No businessId found in request');
            return res.status(401).json({ message: 'Authentication required' });
        }

        const includeInactive = req.query.includeInactive === 'true';
        console.log('[getMyWorkShifts] Include inactive:', includeInactive);

        const shifts = await workShiftService.getWorkShiftsByBusiness(businessId, includeInactive);
        console.log('[getMyWorkShifts] Found shifts:', shifts.length);

        return res.json(shifts);
    } catch (err: any) {
        console.error('[getMyWorkShifts] Error:', err);
        console.error('[getMyWorkShifts] Error stack:', err.stack);
        return res.status(500).json({ message: 'Failed to get work shifts', error: err.message });
    }
}

/**
 * Get all work shifts for a business
 * GET /work-shifts/business/:businessId
 * 
 * Query params:
 *   includeInactive?: boolean (default: false)
 */
export async function getWorkShiftsByBusiness(req: Request, res: Response) {
    try {
        const { businessId } = req.params;
        const includeInactive = req.query.includeInactive === 'true';

        const shifts = await workShiftService.getWorkShiftsByBusiness(businessId, includeInactive);
        return res.json(shifts);
    } catch (err: any) {
        console.error('Error getting work shifts:', err);
        return res.status(500).json({ message: 'Failed to get work shifts' });
    }
}

/**
 * Get a work shift by ID
 * GET /work-shifts/:id
 */
export async function getWorkShiftById(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const shift = await workShiftService.getWorkShiftById(id);

        if (!shift) {
            return res.status(404).json({ message: 'Work shift not found' });
        }

        return res.json(shift);
    } catch (err: any) {
        console.error('Error getting work shift:', err);
        return res.status(500).json({ message: 'Failed to get work shift' });
    }
}

/**
 * Update a work shift
 * PUT /work-shifts/:id
 * 
 * Body: {
 *   name?: string,
 *   startTime?: string,
 *   endTime?: string,
 *   color?: string,
 *   description?: string,
 *   isActive?: boolean
 * }
 */
export async function updateWorkShift(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Validate time format if provided
        const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
        if (updates.startTime && !timeRegex.test(updates.startTime)) {
            return res.status(400).json({
                message: 'Invalid startTime format. Use HH:mm format (e.g., "08:00")',
            });
        }
        if (updates.endTime && !timeRegex.test(updates.endTime)) {
            return res.status(400).json({
                message: 'Invalid endTime format. Use HH:mm format (e.g., "16:00")',
            });
        }

        const shift = await workShiftService.updateWorkShift(id, updates);

        if (!shift) {
            return res.status(404).json({ message: 'Work shift not found' });
        }

        return res.json(shift);
    } catch (err: any) {
        console.error('Error updating work shift:', err);
        return res.status(500).json({ message: err.message || 'Failed to update work shift' });
    }
}

/**
 * Delete a work shift
 * DELETE /work-shifts/:id
 */
export async function deleteWorkShift(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const deleted = await workShiftService.deleteWorkShift(id);

        if (!deleted) {
            return res.status(404).json({ message: 'Work shift not found' });
        }

        return res.json({ message: 'Work shift deleted successfully' });
    } catch (err: any) {
        console.error('Error deleting work shift:', err);
        return res.status(500).json({ message: 'Failed to delete work shift' });
    }
}

/**
 * Toggle work shift active status
 * PATCH /work-shifts/:id/toggle
 */
export async function toggleWorkShiftStatus(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const shift = await workShiftService.toggleWorkShiftStatus(id);

        if (!shift) {
            return res.status(404).json({ message: 'Work shift not found' });
        }

        return res.json(shift);
    } catch (err: any) {
        console.error('Error toggling work shift status:', err);
        return res.status(500).json({ message: 'Failed to toggle work shift status' });
    }
}
