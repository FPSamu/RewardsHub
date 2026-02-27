/**
 * Report service
 * 
 * This module handles the business logic for generating reports.
 * It queries transactions, groups them by day and shift, and calculates totals.
 */

import { TransactionModel, TransactionType } from '../models/transaction.model';
import { WorkShiftModel } from '../models/workShift.model';
import { BusinessModel } from '../models/business.model';
import { Types } from 'mongoose';

/**
 * Report filters interface
 */
export interface ReportFilters {
    businessId: string;
    startDate: Date;
    endDate: Date;
    shiftIds?: string[];  // Optional: filter by specific shifts
    types?: TransactionType[]; // Optional: filter by transaction types
}

/**
 * Transaction summary for a shift
 */
export interface ShiftSummary {
    shiftId: string | null;
    shiftName: string;
    shiftTime: string;  // e.g., "08:00 - 16:00"
    shiftColor: string;
    totalTransactions: number;
    totalPoints: number;
    totalStamps: number;
    transactions: TransactionDetail[];
    systemBreakdown: SystemBreakdown[];
}

/**
 * Transaction detail for reports
 */
export interface TransactionDetail {
    id: string;
    time: string;  // HH:mm format
    clientName: string;
    clientId: string;
    systemName: string;
    systemType: 'points' | 'stamps';
    points: number;
    stamps: number;
    type?: TransactionType;
}

/**
 * System breakdown (points/stamps per reward system)
 */
export interface SystemBreakdown {
    systemName: string;
    systemType: 'points' | 'stamps';
    transactions: number;
    points: number;
    stamps: number;
}

/**
 * Daily report data
 */
export interface DailyReport {
    date: Date;
    dayOfWeek: string;
    shifts: ShiftSummary[];
    dailyTotal: {
        transactions: number;
        points: number;
        stamps: number;
    };
}

/**
 * Complete report data
 */
export interface ReportData {
    metadata: {
        businessId: string;
        businessName: string;
        logoUrl?: string;
        generatedAt: Date;
        reportPeriod: {
            startDate: Date;
            endDate: Date;
        };
    };
    summary: {
        totalTransactions: number;
        totalPoints: number;
        totalStamps: number;
        totalDays: number;
    };
    dailyData: DailyReport[];
    branchSummary: Array<{
        branchId: string | null;
        branchName: string;
        totals: {
            transactions: number;
            points: number;
            stamps: number;
        };
        shifts: Array<{
            shiftId: string | null;
            shiftName: string;
            transactions: number;
            points: number;
            stamps: number;
        }>;
    }>;
    periodSummary: {
        totalsByShift: Array<{
            shiftName: string;
            transactions: number;
            points: number;
            stamps: number;
        }>;
        totalsBySystem: Array<{
            systemName: string;
            systemType: 'points' | 'stamps';
            transactions: number;
            points: number;
            stamps: number;
        }>;
    };
}

/**
 * Generate report data for a business
 * 
 * @param filters - Report filters (businessId, date range, optional shift filter)
 * @returns Complete report data structure
 */
export async function generateReportData(filters: ReportFilters): Promise<ReportData> {
    const { businessId, startDate, endDate, shiftIds } = filters;

    // Build query
    const query: any = {
        businessId: new Types.ObjectId(businessId),
        createdAt: {
            $gte: startDate,
            $lte: endDate,
        },
    };

    // Filter by specific shifts if provided
    if (shiftIds && shiftIds.length > 0) {
        query.workShiftId = { $in: shiftIds.map(id => new Types.ObjectId(id)) };
    }

    // Filter by transaction types if provided
    if (filters.types && filters.types.length > 0) {
        query.type = { $in: filters.types };
    }

    // Fetch transactions
    const transactions = await TransactionModel.find(query)
        .sort({ createdAt: 1 })
        .populate('userId', 'username email')
        .exec();

    // Fetch all shifts for this business (for display purposes)
    const allShifts = await WorkShiftModel.find({ businessId: new Types.ObjectId(businessId) }).exec();
    const shiftsMap = new Map(allShifts.map(s => [s._id.toString(), s]));

    // Group transactions by day
    const transactionsByDay = groupTransactionsByDay(transactions);

    // Build daily reports
    const dailyData: DailyReport[] = [];
    let totalTransactions = 0;
    let totalPoints = 0;
    let totalStamps = 0;

    for (const [dateStr, dayTransactions] of transactionsByDay) {
        const date = new Date(dateStr);
        const dayOfWeek = date.toLocaleDateString('es-ES', { weekday: 'long' });

        // Group by shift
        const shiftGroups = groupTransactionsByShift(dayTransactions, shiftsMap);

        // Calculate daily totals
        let dayTotalTransactions = 0;
        let dayTotalPoints = 0;
        let dayTotalStamps = 0;

        const shifts: ShiftSummary[] = [];

        for (const [shiftKey, shiftTransactions] of shiftGroups) {
            const shiftSummary = buildShiftSummary(shiftKey, shiftTransactions, shiftsMap);
            shifts.push(shiftSummary);

            dayTotalTransactions += shiftSummary.totalTransactions;
            dayTotalPoints += shiftSummary.totalPoints;
            dayTotalStamps += shiftSummary.totalStamps;
        }

        dailyData.push({
            date,
            dayOfWeek,
            shifts,
            dailyTotal: {
                transactions: dayTotalTransactions,
                points: dayTotalPoints,
                stamps: dayTotalStamps,
            },
        });

        totalTransactions += dayTotalTransactions;
        totalPoints += dayTotalPoints;
        totalStamps += dayTotalStamps;
    }

    // Fetch business data to get name, logo, and branch names
    const business = await BusinessModel.findById(businessId).exec();
    const businessName = business?.name || 'Business';
    const logoUrl = business?.logoUrl;
    const branchNameById = new Map<string, string>();
    if (business?.locations) {
        for (const loc of business.locations) {
            branchNameById.set(loc._id.toString(), loc.name || loc.formattedAddress || 'Sucursal');
        }
    }

    // Calculate period summaries
    const totalsByShift = calculateTotalsByShift(dailyData);
    const totalsBySystem = calculateTotalsBySystem(transactions);
    const branchSummary = buildBranchSummary(transactions, shiftsMap, branchNameById);

    return {
        metadata: {
            businessId,
            businessName,
            logoUrl,
            generatedAt: new Date(),
            reportPeriod: {
                startDate,
                endDate,
            },
        },
        summary: {
            totalTransactions,
            totalPoints,
            totalStamps,
            totalDays: dailyData.length,
        },
        dailyData,
        branchSummary,
        periodSummary: {
            totalsByShift,
            totalsBySystem,
        },
    };
}

/**
 * Group transactions by day (YYYY-MM-DD)
 */
function groupTransactionsByDay(transactions: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const transaction of transactions) {
        const dateStr = transaction.createdAt.toISOString().split('T')[0];
        if (!groups.has(dateStr)) {
            groups.set(dateStr, []);
        }
        groups.get(dateStr)!.push(transaction);
    }

    return groups;
}

/**
 * Group transactions by shift
 */
function groupTransactionsByShift(transactions: any[], shiftsMap: Map<string, any>): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const transaction of transactions) {
        const shiftKey = transaction.workShiftId?.toString() || 'no-shift';
        if (!groups.has(shiftKey)) {
            groups.set(shiftKey, []);
        }
        groups.get(shiftKey)!.push(transaction);
    }

    return groups;
}

/**
 * Build shift summary from transactions
 */
function buildShiftSummary(
    shiftKey: string,
    transactions: any[],
    shiftsMap: Map<string, any>
): ShiftSummary {
    const shift = shiftKey !== 'no-shift' ? shiftsMap.get(shiftKey) : null;

    const shiftName = shift ? shift.name : 'Sin turno asignado';
    const shiftTime = shift ? `${shift.startTime} - ${shift.endTime}` : '-';
    const shiftColor = shift ? shift.color : '#9CA3AF';

    let totalPoints = 0;
    let totalStamps = 0;
    const transactionDetails: TransactionDetail[] = [];
    const systemsMap = new Map<string, { type: 'points' | 'stamps'; points: number; stamps: number; count: number }>();

    for (const transaction of transactions) {
        totalPoints += transaction.totalPointsChange;
        totalStamps += transaction.totalStampsChange;

        // Build transaction detail
        const time = transaction.createdAt.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });

        const clientName = transaction.userId?.username || transaction.userId?.email || 'Cliente';

        for (const item of transaction.items) {
            transactionDetails.push({
                id: transaction._id.toString(),
                time,
                clientName,
                clientId: transaction.userId?._id?.toString() || '',
                systemName: item.rewardSystemName,
                systemType: item.pointsChange !== 0 ? 'points' : 'stamps',
                points: item.pointsChange,
                stamps: item.stampsChange,
                type: transaction.type,
            });

            // Aggregate by system
            const systemKey = item.rewardSystemName;
            if (!systemsMap.has(systemKey)) {
                systemsMap.set(systemKey, {
                    type: item.pointsChange !== 0 ? 'points' : 'stamps',
                    points: 0,
                    stamps: 0,
                    count: 0,
                });
            }
            const systemData = systemsMap.get(systemKey)!;
            systemData.points += item.pointsChange;
            systemData.stamps += item.stampsChange;
            systemData.count++;
        }
    }

    // Build system breakdown
    const systemBreakdown: SystemBreakdown[] = Array.from(systemsMap.entries()).map(
        ([systemName, data]) => ({
            systemName,
            systemType: data.type,
            transactions: data.count,
            points: data.points,
            stamps: data.stamps,
        })
    );

    return {
        shiftId: shift?._id?.toString() || null,
        shiftName,
        shiftTime,
        shiftColor,
        totalTransactions: transactions.length,
        totalPoints,
        totalStamps,
        transactions: transactionDetails,
        systemBreakdown,
    };
}

/**
 * Calculate totals by shift across all days
 */
function calculateTotalsByShift(dailyData: DailyReport[]): Array<{
    shiftName: string;
    transactions: number;
    points: number;
    stamps: number;
}> {
    const totalsMap = new Map<string, { transactions: number; points: number; stamps: number }>();

    for (const day of dailyData) {
        for (const shift of day.shifts) {
            if (!totalsMap.has(shift.shiftName)) {
                totalsMap.set(shift.shiftName, { transactions: 0, points: 0, stamps: 0 });
            }
            const totals = totalsMap.get(shift.shiftName)!;
            totals.transactions += shift.totalTransactions;
            totals.points += shift.totalPoints;
            totals.stamps += shift.totalStamps;
        }
    }

    return Array.from(totalsMap.entries()).map(([shiftName, totals]) => ({
        shiftName,
        ...totals,
    }));
}

/**
 * Calculate totals by system across all transactions
 */
function calculateTotalsBySystem(transactions: any[]): Array<{
    systemName: string;
    systemType: 'points' | 'stamps';
    transactions: number;
    points: number;
    stamps: number;
}> {
    const systemsMap = new Map<string, {
        type: 'points' | 'stamps';
        count: number;
        points: number;
        stamps: number;
    }>();

    for (const transaction of transactions) {
        for (const item of transaction.items) {
            const systemKey = item.rewardSystemName;
            if (!systemsMap.has(systemKey)) {
                systemsMap.set(systemKey, {
                    type: item.pointsChange !== 0 ? 'points' : 'stamps',
                    count: 0,
                    points: 0,
                    stamps: 0,
                });
            }
            const systemData = systemsMap.get(systemKey)!;
            systemData.count++;
            systemData.points += item.pointsChange;
            systemData.stamps += item.stampsChange;
        }
    }

    return Array.from(systemsMap.entries()).map(([systemName, data]) => ({
        systemName,
        systemType: data.type,
        transactions: data.count,
        points: data.points,
        stamps: data.stamps,
    }));
}

/**
 * Build branch summary with per-branch totals and per-branch shift totals.
 */
type BranchShiftTotals = {
    shiftId: string | null;
    shiftName: string;
    transactions: number;
    points: number;
    stamps: number;
};

type BranchTotals = {
    transactions: number;
    points: number;
    stamps: number;
};

type BranchBucket = {
    branchId: string | null;
    totals: BranchTotals;
    shifts: Map<string, BranchShiftTotals>;
};

function buildBranchSummary(
    transactions: any[],
    shiftsMap: Map<string, any>,
    branchNameById: Map<string, string>
): Array<{
    branchId: string | null;
    branchName: string;
    totals: BranchTotals;
    shifts: BranchShiftTotals[];
}> {
    const branchMap = new Map<string, BranchBucket>();

    for (const t of transactions) {
        const branchKey = t.branchId ? t.branchId.toString() : 'no-branch';
        if (!branchMap.has(branchKey)) {
            branchMap.set(branchKey, {
                branchId: branchKey === 'no-branch' ? null : branchKey,
                totals: { transactions: 0, points: 0, stamps: 0 },
                shifts: new Map<string, BranchShiftTotals>(),
            });
        }

        const bucket = branchMap.get(branchKey)!;
        bucket.totals.transactions += 1;
        bucket.totals.points += t.totalPointsChange || 0;
        bucket.totals.stamps += t.totalStampsChange || 0;

        const shiftKey = t.workShiftId ? t.workShiftId.toString() : 'no-shift';
        if (!bucket.shifts.has(shiftKey)) {
            const shift = shiftKey !== 'no-shift' ? shiftsMap.get(shiftKey) : null;
            bucket.shifts.set(shiftKey, {
                shiftId: shift?._id?.toString() || null,
                shiftName: shift ? shift.name : 'Sin turno asignado',
                transactions: 0,
                points: 0,
                stamps: 0,
            });
        }
        const shiftBucket = bucket.shifts.get(shiftKey)!;
        shiftBucket.transactions += 1;
        shiftBucket.points += t.totalPointsChange || 0;
        shiftBucket.stamps += t.totalStampsChange || 0;
    }

    return Array.from(branchMap.entries()).map(([branchKey, data]) => {
        const shifts = Array.from(data.shifts.values());
        const branchName =
            branchKey === 'no-branch'
                ? 'Sin sucursal asignada'
                : branchNameById.get(branchKey) || 'Sucursal';
        return {
            branchId: data.branchId,
            branchName,
            totals: data.totals,
            shifts,
        };
    });
}
