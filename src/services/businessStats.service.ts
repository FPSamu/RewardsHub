import { Types } from 'mongoose';
import { TransactionModel } from '../models/transaction.model';
import { RewardModel } from '../models/reward.model';
import { UserPointsModel } from '../models/userPoints.model';
import { UserModel } from '../models/user.model';

export interface BusinessStats {
    totalClients: number;
    totalPointsDistributed: number;
    totalRewardsRedeemed: number;
    totalActiveRewards: number;
    totalRevenue: number;
}

export const getBusinessStats = async (businessId: string): Promise<BusinessStats> => {
    const oid = new Types.ObjectId(businessId);

    const [
        uniqueClients,
        pointsResult,
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
