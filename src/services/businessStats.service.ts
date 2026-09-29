import { Types } from 'mongoose';
import { TransactionModel } from '../models/transaction.model';
import { RewardModel } from '../models/reward.model';
import { UserPointsModel } from '../models/userPoints.model';
import { UserModel } from '../models/user.model';

export interface BusinessStats {
    totalClients: number;
    totalPointsDistributed: number;
    totalStampsDistributed: number;
    totalRewardsRedeemed: number;
    totalActiveRewards: number;
    totalRevenue: number;
}

export const getBusinessStats = async (businessId: string): Promise<BusinessStats> => {
    const oid = new Types.ObjectId(businessId);

    const [
        uniqueClients,
        pointsResult,
        stampsResult,
        totalRewardsRedeemed,
        totalActiveRewards,
        revenueResult,
    ] = await Promise.all([
        // Clientes únicos con al menos una transacción
        TransactionModel.distinct('userId', { businessId: oid }),

        // Suma de puntos otorgados (solo transacciones de tipo 'add')
        TransactionModel.aggregate([
            { $match: { businessId: oid, type: 'add' } },
            { $group: { _id: null, total: { $sum: '$totalPointsChange' } } },
        ]),

        // Suma de estampas otorgadas (solo transacciones de tipo 'add')
        TransactionModel.aggregate([
            { $match: { businessId: oid, type: 'add' } },
            { $group: { _id: null, total: { $sum: '$totalStampsChange' } } },
        ]),

        // Total de canjes
        TransactionModel.countDocuments({ businessId: oid, type: 'redeem' }),

        // Recompensas activas
        RewardModel.countDocuments({ businessId: oid, isActive: true }),

        // Ingresos generados: suma de purchaseAmount en transacciones con puntos
        TransactionModel.aggregate([
            { $match: { businessId: oid, type: 'add', totalPointsChange: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$purchaseAmount' } } },
        ]),
    ]);

    return {
        totalClients: uniqueClients.length,
        totalPointsDistributed: pointsResult[0]?.total ?? 0,
        totalStampsDistributed: stampsResult[0]?.total ?? 0,
        totalRewardsRedeemed,
        totalActiveRewards,
        totalRevenue: revenueResult[0]?.total ?? 0,
    };
};

export interface BranchStat {
    branchId: string | null;
    transactionCount: number;
    totalPoints: number;
}

export interface ShiftStat {
    branchId: string | null;
    shiftId: string | null;
    shiftName: string;
    transactionCount: number;
}

export const getShiftStatsByBranch = async (businessId: string): Promise<ShiftStat[]> => {
    const oid = new Types.ObjectId(businessId);

    const results = await TransactionModel.aggregate([
        { $match: { businessId: oid, type: 'add' } },
        {
            $group: {
                _id: {
                    branchId: '$branchId',
                    shiftId: '$workShiftId',
                    shiftName: '$workShiftName',
                },
                transactionCount: { $sum: 1 },
            },
        },
    ]);

    return results.map((r) => ({
        branchId: r._id.branchId?.toString() ?? null,
        shiftId: r._id.shiftId?.toString() ?? null,
        shiftName: r._id.shiftName ?? 'Sin turno',
        transactionCount: r.transactionCount,
    }));
};

export const getStatsByBranch = async (businessId: string): Promise<BranchStat[]> => {
    const oid = new Types.ObjectId(businessId);

    const results = await TransactionModel.aggregate([
        { $match: { businessId: oid, type: 'add' } },
        {
            $group: {
                _id: '$branchId',
                transactionCount: { $sum: 1 },
                totalPoints: { $sum: '$totalPointsChange' },
            },
        },
    ]);

    return results.map((r) => ({
        branchId: r._id?.toString() ?? null,
        transactionCount: r.transactionCount,
        totalPoints: r.totalPoints,
    }));
};

export interface RecentClient {
    userId: string;
    username: string;
    email: string;
    points: number;
    lastVisit: string;
}

export const getRecentClients = async (
    businessId: string,
    limit: number = 5
): Promise<RecentClient[]> => {
    const oid = new Types.ObjectId(businessId);

    // Nombre real de la colección de usuarios (respeta la variable de entorno)
    const userCollection = UserModel.collection.name;

    const results = await UserPointsModel.aggregate([
        // Solo documentos que tengan puntos en este negocio
        { $match: { 'businessPoints.businessId': oid } },

        // Extraer el entry del negocio del array
        { $unwind: '$businessPoints' },
        { $match: { 'businessPoints.businessId': oid } },

        // Más recientes primero
        { $sort: { 'businessPoints.lastVisit': -1 } },
        { $limit: limit },

        // Join con colección de usuarios
        {
            $lookup: {
                from: userCollection,
                localField: 'userId',
                foreignField: '_id',
                as: 'user',
            },
        },
        { $unwind: '$user' },

        // Dar forma a la respuesta
        {
            $project: {
                _id: 0,
                userId: { $toString: '$userId' },
                username: '$user.username',
                email: '$user.email',
                points: '$businessPoints.points',
                lastVisit: '$businessPoints.lastVisit',
            },
        },
    ]);

    return results;
};

export interface DailyStat {
    date: string; // YYYY-MM-DD
    newClients: number;
    pointsDistributed: number;
    stampsDistributed: number;
    revenue: number;
    transactionCount: number;
}

/**
 * Serie diaria de actividad para los últimos `days` días.
 * "Clientes nuevos" se calcula por la fecha de la PRIMERA transacción de cada
 * usuario con este negocio (histórica), no solo dentro del rango solicitado.
 */
export const getTimeSeriesStats = async (businessId: string, days: number = 30): Promise<DailyStat[]> => {
    const oid = new Types.ObjectId(businessId);

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const [activity, newClientsRaw] = await Promise.all([
        TransactionModel.aggregate([
            { $match: { businessId: oid, type: 'add', createdAt: { $gte: since } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    pointsDistributed: { $sum: '$totalPointsChange' },
                    stampsDistributed: { $sum: '$totalStampsChange' },
                    revenue: { $sum: { $ifNull: ['$purchaseAmount', 0] } },
                    transactionCount: { $sum: 1 },
                },
            },
        ]),

        // Primera transacción histórica de cada usuario, filtrada al rango
        TransactionModel.aggregate([
            { $match: { businessId: oid } },
            { $group: { _id: '$userId', firstTxDate: { $min: '$createdAt' } } },
            { $match: { firstTxDate: { $gte: since } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$firstTxDate' } },
                    newClients: { $sum: 1 },
                },
            },
        ]),
    ]);

    const activityMap = new Map(activity.map((a) => [a._id, a]));
    const newClientsMap = new Map(newClientsRaw.map((c) => [c._id, c.newClients]));

    const result: DailyStat[] = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        const a = activityMap.get(key);
        result.push({
            date: key,
            newClients: newClientsMap.get(key) ?? 0,
            pointsDistributed: a?.pointsDistributed ?? 0,
            stampsDistributed: a?.stampsDistributed ?? 0,
            revenue: a?.revenue ?? 0,
            transactionCount: a?.transactionCount ?? 0,
        });
    }
    return result;
};

export interface AtRiskClient {
    userId: string;
    username: string;
    email: string;
    points: number;
    lastVisit: string;
    daysSinceVisit: number;
}

/**
 * Clientes que no han vuelto en al menos `minDays` días, más viejos primero.
 */
export const getAtRiskClients = async (
    businessId: string,
    minDays: number = 30,
    limit: number = 20
): Promise<AtRiskClient[]> => {
    const oid = new Types.ObjectId(businessId);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - minDays);

    const userCollection = UserModel.collection.name;

    const results = await UserPointsModel.aggregate([
        { $match: { 'businessPoints.businessId': oid } },
        { $unwind: '$businessPoints' },
        { $match: { 'businessPoints.businessId': oid, 'businessPoints.lastVisit': { $lte: cutoff } } },
        { $sort: { 'businessPoints.lastVisit': 1 } }, // más tiempo sin visitar primero
        { $limit: limit },
        {
            $lookup: {
                from: userCollection,
                localField: 'userId',
                foreignField: '_id',
                as: 'user',
            },
        },
        { $unwind: '$user' },
        {
            $project: {
                _id: 0,
                userId: { $toString: '$userId' },
                username: '$user.username',
                email: '$user.email',
                points: '$businessPoints.points',
                lastVisit: '$businessPoints.lastVisit',
            },
        },
    ]);

    return results.map((r) => ({
        ...r,
        daysSinceVisit: Math.floor((Date.now() - new Date(r.lastVisit).getTime()) / 86_400_000),
    }));
};

export interface TopReward {
    rewardId: string | null;
    rewardName: string;
    redemptions: number;
}

/**
 * Recompensas más canjeadas, de mayor a menor.
 */
export const getTopRewards = async (businessId: string, limit: number = 5): Promise<TopReward[]> => {
    const oid = new Types.ObjectId(businessId);

    const results = await TransactionModel.aggregate([
        { $match: { businessId: oid, type: 'redeem' } },
        {
            $group: {
                _id: { rewardId: '$rewardId', rewardName: '$rewardName' },
                redemptions: { $sum: 1 },
            },
        },
        { $sort: { redemptions: -1 } },
        { $limit: limit },
    ]);

    return results.map((r) => ({
        rewardId: r._id.rewardId ? r._id.rewardId.toString() : null,
        rewardName: r._id.rewardName ?? 'Recompensa eliminada',
        redemptions: r.redemptions,
    }));
};

export interface BranchComparisonStat {
    branchId: string | null;
    currentCount: number;
    previousCount: number;
    changePct: number | null; // null = sin datos del periodo anterior para comparar
}

/**
 * Compara transacciones por sucursal en los últimos `days` días contra los
 * `days` anteriores a ese periodo (ej. este mes vs el mes pasado).
 */
export const getBranchComparison = async (businessId: string, days: number = 30): Promise<BranchComparisonStat[]> => {
    const oid = new Types.ObjectId(businessId);

    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);
    periodStart.setDate(periodStart.getDate() - days);

    const previousStart = new Date(periodStart);
    previousStart.setDate(previousStart.getDate() - days);

    const [current, previous] = await Promise.all([
        TransactionModel.aggregate([
            { $match: { businessId: oid, type: 'add', createdAt: { $gte: periodStart } } },
            { $group: { _id: '$branchId', count: { $sum: 1 } } },
        ]),
        TransactionModel.aggregate([
            { $match: { businessId: oid, type: 'add', createdAt: { $gte: previousStart, $lt: periodStart } } },
            { $group: { _id: '$branchId', count: { $sum: 1 } } },
        ]),
    ]);

    const toKey = (id: any) => (id ? id.toString() : null);
    const currentMap = new Map(current.map((c) => [toKey(c._id), c.count]));
    const previousMap = new Map(previous.map((c) => [toKey(c._id), c.count]));

    const branchIds = new Set<string | null>([...currentMap.keys(), ...previousMap.keys()]);

    return Array.from(branchIds).map((branchId) => {
        const currentCount = currentMap.get(branchId) ?? 0;
        const previousCount = previousMap.get(branchId) ?? 0;
        const changePct = previousCount > 0
            ? ((currentCount - previousCount) / previousCount) * 100
            : (currentCount > 0 ? 100 : null);
        return { branchId, currentCount, previousCount, changePct };
    });
};
