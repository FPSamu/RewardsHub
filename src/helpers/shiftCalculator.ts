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
 * Get the local hours and minutes of a date in a specific IANA timezone.
 * Uses the built-in Intl API (no external dependencies required).
 * Falls back to UTC if the timezone string is invalid.
 *
 * @param date - The UTC date to convert
 * @param timezone - IANA timezone name (e.g. "America/Mexico_City")
 * @returns Object with hours (0-23) and minutes (0-59) in the given timezone
 */
function getTimeInTimezone(date: Date, timezone: string): { hours: number; minutes: number } {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        const parts = formatter.formatToParts(date);
        const hourPart = parts.find(p => p.type === 'hour')?.value ?? '0';
        const minutePart = parts.find(p => p.type === 'minute')?.value ?? '0';
        // Intl can return "24" for midnight in some environments; normalise to 0
        const hours = parseInt(hourPart, 10) % 24;
        const minutes = parseInt(minutePart, 10);
        return { hours, minutes };
    } catch {
        // Invalid timezone — fall back to UTC so the transaction is still saved
        console.warn(`[shiftCalculator] Invalid timezone "${timezone}", falling back to UTC`);
        return { hours: date.getUTCHours(), minutes: date.getUTCMinutes() };
    }
}

/**
 * Find which work shift a transaction belongs to based on its timestamp
 *
 * @param transactionDate - The UTC date/time of the transaction
 * @param shifts - Array of active work shifts for the business
 * @param timezone - IANA timezone of the business (e.g. "America/Mexico_City")
 * @returns The matching shift or null if no shift matches
 *
 * @example
 * const shifts = [
 *   { name: "Matutino", startTime: "08:00", endTime: "16:00" },
 *   { name: "Vespertino", startTime: "16:00", endTime: "00:00" }
 * ];
 * const transaction = new Date("2025-12-21T16:30:00Z"); // 10:30 AM in Mexico City (UTC-6)
 * const shift = findShiftForTransaction(transaction, shifts, "America/Mexico_City");
 * // Returns: { name: "Matutino", ... }
 */
export function findShiftForTransaction(
    transactionDate: Date,
    shifts: IWorkShift[],
    timezone: string = 'UTC'
): IWorkShift | null {
    if (!shifts || shifts.length === 0) {
        return null;
    }

    // Convert transaction time to business local timezone before comparing
    const { hours, minutes } = getTimeInTimezone(transactionDate, timezone);
    const transactionTimeInMinutes = hours * 60 + minutes;

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
