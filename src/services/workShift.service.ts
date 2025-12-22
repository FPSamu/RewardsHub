/**
 * WorkShift service (persistence layer)
 * 
 * This module handles CRUD operations for work shifts.
 */

import { WorkShiftModel, IWorkShift } from '../models/workShift.model';
import { validateShiftTimes } from '../helpers/shiftCalculator';

/**
 * Public work shift object (without Mongoose internals)
 */
export interface PublicWorkShift {
    id: string;
    businessId: string;
    name: string;
    startTime: string;
    endTime: string;
    color: string;
    description?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * Convert a Mongoose document into a plain public object
 */
function toPublic(doc: IWorkShift): PublicWorkShift {
    return {
        id: doc._id.toString(),
        businessId: doc.businessId.toString(),
        name: doc.name,
        startTime: doc.startTime,
        endTime: doc.endTime,
        color: doc.color,
        description: doc.description,
        isActive: doc.isActive,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

/**
 * Create a new work shift
 * 
 * @param businessId - The business ID
 * @param name - Shift name
 * @param startTime - Start time in "HH:mm" format
 * @param endTime - End time in "HH:mm" format
 * @param color - Hex color for UI (optional)
 * @param description - Optional description
 * @returns The created work shift
 */
export async function createWorkShift(
    businessId: string,
    name: string,
    startTime: string,
    endTime: string,
    color?: string,
    description?: string
): Promise<PublicWorkShift> {
    // Get existing shifts for validation
    const existingShifts = await WorkShiftModel.find({ businessId, isActive: true });

    // Validate shift times
    const validation = validateShiftTimes({ startTime, endTime }, existingShifts);
    if (!validation.isValid) {
        throw new Error(validation.error);
    }

    const shift = new WorkShiftModel({
        businessId,
        name,
        startTime,
        endTime,
        color: color || '#3B82F6',
        description,
        isActive: true,
    });

    await shift.save();
    return toPublic(shift);
}

/**
 * Get all work shifts for a business
 * 
 * @param businessId - The business ID
 * @param includeInactive - Whether to include inactive shifts (default: false)
 * @returns Array of work shifts
 */
export async function getWorkShiftsByBusiness(
    businessId: string,
    includeInactive: boolean = false
): Promise<PublicWorkShift[]> {
    const query: any = { businessId };
    if (!includeInactive) {
        query.isActive = true;
    }

    const shifts = await WorkShiftModel.find(query).sort({ startTime: 1 });
    return shifts.map(toPublic);
}

/**
 * Get active work shifts for a business (for shift calculation)
 * 
 * @param businessId - The business ID
 * @returns Array of active work shifts (Mongoose documents)
 */
export async function getActiveWorkShifts(businessId: string): Promise<IWorkShift[]> {
    return await WorkShiftModel.find({ businessId, isActive: true }).sort({ startTime: 1 });
}

/**
 * Get a work shift by ID
 * 
 * @param shiftId - The shift ID
 * @returns The work shift or undefined
 */
export async function getWorkShiftById(shiftId: string): Promise<PublicWorkShift | undefined> {
    const shift = await WorkShiftModel.findById(shiftId);
    return shift ? toPublic(shift) : undefined;
}

/**
 * Update a work shift
 * 
 * @param shiftId - The shift ID
 * @param updates - Fields to update
 * @returns The updated work shift
 */
export async function updateWorkShift(
    shiftId: string,
    updates: {
        name?: string;
        startTime?: string;
        endTime?: string;
        color?: string;
        description?: string;
        isActive?: boolean;
    }
): Promise<PublicWorkShift | undefined> {
    const shift = await WorkShiftModel.findById(shiftId);
    if (!shift) {
        return undefined;
    }

    // If updating times, validate them
    if (updates.startTime || updates.endTime) {
        const newStartTime = updates.startTime || shift.startTime;
        const newEndTime = updates.endTime || shift.endTime;

        // Get other shifts for this business (excluding current shift)
        const otherShifts = await WorkShiftModel.find({
            businessId: shift.businessId,
            _id: { $ne: shiftId },
            isActive: true,
        });

        const validation = validateShiftTimes(
            { startTime: newStartTime, endTime: newEndTime },
            otherShifts
        );

        if (!validation.isValid) {
            throw new Error(validation.error);
        }
    }

    // Apply updates
    if (updates.name !== undefined) shift.name = updates.name;
    if (updates.startTime !== undefined) shift.startTime = updates.startTime;
    if (updates.endTime !== undefined) shift.endTime = updates.endTime;
    if (updates.color !== undefined) shift.color = updates.color;
    if (updates.description !== undefined) shift.description = updates.description;
    if (updates.isActive !== undefined) shift.isActive = updates.isActive;

    await shift.save();
    return toPublic(shift);
}

/**
 * Delete a work shift
 * 
 * @param shiftId - The shift ID
 * @returns True if deleted, false if not found
 */
export async function deleteWorkShift(shiftId: string): Promise<boolean> {
    const result = await WorkShiftModel.findByIdAndDelete(shiftId);
    return result !== null;
}

/**
 * Toggle shift active status
 * 
 * @param shiftId - The shift ID
 * @returns The updated work shift
 */
export async function toggleWorkShiftStatus(shiftId: string): Promise<PublicWorkShift | undefined> {
    const shift = await WorkShiftModel.findById(shiftId);
    if (!shift) {
        return undefined;
    }

    shift.isActive = !shift.isActive;
    await shift.save();
    return toPublic(shift);
}
