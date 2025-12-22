/**
 * Shift Calculator Helper
 * 
 * Utility functions to determine which work shift a transaction belongs to
 * based on the transaction timestamp.
 */

import { IWorkShift } from '../models/workShift.model';

/**
 * Convert time string "HH:mm" to minutes since midnight
 * @param timeStr - Time in "HH:mm" format (e.g., "08:30")
 * @returns Minutes since midnight (e.g., 510 for "08:30")
 */
function timeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * Check if a time falls within a shift's time range
 * Handles shifts that cross midnight (e.g., 22:00 - 06:00)
 * 
 * @param transactionTime - Time to check in minutes since midnight
 * @param shiftStart - Shift start time in minutes since midnight
 * @param shiftEnd - Shift end time in minutes since midnight
 * @returns True if the time falls within the shift
 */
function isTimeInShift(transactionTime: number, shiftStart: number, shiftEnd: number): boolean {
    if (shiftStart < shiftEnd) {
        // Normal shift (doesn't cross midnight)
        // Example: 08:00 - 16:00
        return transactionTime >= shiftStart && transactionTime < shiftEnd;
    } else {
        // Shift crosses midnight
        // Example: 22:00 - 06:00
        // This means: 22:00-23:59 OR 00:00-06:00
        return transactionTime >= shiftStart || transactionTime < shiftEnd;
    }
}

/**
 * Find which work shift a transaction belongs to based on its timestamp
 * 
 * @param transactionDate - The date/time of the transaction
 * @param shifts - Array of active work shifts for the business
 * @returns The matching shift or null if no shift matches
 * 
 * @example
 * const shifts = [
 *   { name: "Matutino", startTime: "08:00", endTime: "16:00" },
 *   { name: "Vespertino", startTime: "16:00", endTime: "00:00" }
 * ];
 * const transaction = new Date("2025-12-21T10:30:00");
 * const shift = findShiftForTransaction(transaction, shifts);
 * // Returns: { name: "Matutino", ... }
 */
export function findShiftForTransaction(
    transactionDate: Date,
    shifts: IWorkShift[]
): IWorkShift | null {
    if (!shifts || shifts.length === 0) {
        return null;
    }

    // Get transaction time in minutes since midnight
    const transactionHours = transactionDate.getHours();
    const transactionMinutes = transactionDate.getMinutes();
    const transactionTimeInMinutes = transactionHours * 60 + transactionMinutes;

    // Find the first shift that matches
    for (const shift of shifts) {
        const shiftStart = timeToMinutes(shift.startTime);
        const shiftEnd = timeToMinutes(shift.endTime);

        if (isTimeInShift(transactionTimeInMinutes, shiftStart, shiftEnd)) {
            return shift;
        }
    }

    // No matching shift found
    return null;
}

/**
 * Get a human-readable time range for a shift
 * 
 * @param shift - The work shift
 * @returns Formatted time range (e.g., "08:00 - 16:00")
 */
export function getShiftTimeRange(shift: IWorkShift): string {
    return `${shift.startTime} - ${shift.endTime}`;
}

/**
 * Check if a shift crosses midnight
 * 
 * @param shift - The work shift
 * @returns True if the shift crosses midnight
 */
export function shiftCrossesMidnight(shift: IWorkShift): boolean {
    const startMinutes = timeToMinutes(shift.startTime);
    const endMinutes = timeToMinutes(shift.endTime);
    return startMinutes >= endMinutes;
}

/**
 * Validate that shift times don't conflict with existing shifts
 * 
 * @param newShift - The shift to validate
 * @param existingShifts - Array of existing shifts for the business
 * @returns Object with isValid flag and optional error message
 */
export function validateShiftTimes(
    newShift: { startTime: string; endTime: string },
    existingShifts: IWorkShift[]
): { isValid: boolean; error?: string } {
    const newStart = timeToMinutes(newShift.startTime);
    const newEnd = timeToMinutes(newShift.endTime);

    // Check if start and end are the same (invalid)
    if (newStart === newEnd) {
        return {
            isValid: false,
            error: 'Start time and end time cannot be the same'
        };
    }

    // Note: We allow overlapping shifts as some businesses may have
    // multiple employees working different shifts at the same time
    // If you want to prevent overlaps, uncomment the code below:

    /*
    for (const existingShift of existingShifts) {
        if (!existingShift.isActive) continue;

        const existingStart = timeToMinutes(existingShift.startTime);
        const existingEnd = timeToMinutes(existingShift.endTime);

        // Check for overlap
        // This is complex because shifts can cross midnight
        // For simplicity, we'll check if any of the 4 time points overlap
        
        const newStartInExisting = isTimeInShift(newStart, existingStart, existingEnd);
        const newEndInExisting = isTimeInShift(newEnd, existingStart, existingEnd);
        const existingStartInNew = isTimeInShift(existingStart, newStart, newEnd);
        const existingEndInNew = isTimeInShift(existingEnd, newStart, newEnd);

        if (newStartInExisting || newEndInExisting || existingStartInNew || existingEndInNew) {
            return {
                isValid: false,
                error: `Shift times overlap with existing shift "${existingShift.name}"`
            };
        }
    }
    */

    return { isValid: true };
}

/**
 * Format a Date object to "HH:mm" string in local timezone
 * 
 * @param date - The date to format
 * @returns Time string in "HH:mm" format
 */
export function formatTimeFromDate(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}
