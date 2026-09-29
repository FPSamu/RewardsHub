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
    redemptions: number;
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

    const [activity, redemptionsRaw, newClientsRaw] = await Promise.all([
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

        TransactionModel.aggregate([
            { $match: { businessId: oid, type: 'redeem', createdAt: { $gte: since } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    redemptions: { $sum: 1 },
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
    const redemptionsMap = new Map(redemptionsRaw.map((r) => [r._id, r.redemptions]));
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
            redemptions: redemptionsMap.get(key) ?? 0,
            transactionCount: a?.transactionCount ?? 0,
        });
    }
    return result;
};

export interface KpiComparison {
    current: number;
    previous: number;
}

export interface KpiSummary {
    totalClients: KpiComparison;
    revenue: KpiComparison;
    pointsDistributed: KpiComparison;
    redemptions: KpiComparison;
    totalActiveRewards: number;
    atRiskClients: number;
}

/**
 * Resumen para la franja de KPIs: cada métrica con tendencia trae su valor
 * de los últimos `days` días y el mismo rango justo anterior, para calcular
 * un % de cambio real. Las que son una foto del momento (recompensas activas,
 * clientes en riesgo) no tienen "anterior" — no aplica compararlas.
 */
export const getKpiSummary = async (businessId: string, days: number = 30): Promise<KpiSummary> => {
    const oid = new Types.ObjectId(businessId);

    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);
    periodStart.setDate(periodStart.getDate() - days);

    const previousStart = new Date(periodStart);
    previousStart.setDate(previousStart.getDate() - days);

    // "En riesgo" usa un umbral fijo de 30 días sin importar qué rango esté
    // viendo el negocio — no tendría sentido que alguien "esté en riesgo"
    // solo porque el dueño está mirando la vista de 7 días.
    const AT_RISK_DAYS = 30;
    const atRiskCutoff = new Date();
    atRiskCutoff.setHours(0, 0, 0, 0);
    atRiskCutoff.setDate(atRiskCutoff.getDate() - AT_RISK_DAYS);

    const sumInRange = async (match: Record<string, any>, field: string) => {
        const rows = await TransactionModel.aggregate([
            { $match: match },
            { $group: { _id: null, total: { $sum: field === '__count__' ? 1 : `$${field}` } } },
        ]);
        return rows[0]?.total ?? 0;
    };

    const [
        revenueCurrent, revenuePrevious,
        pointsCurrent, pointsPrevious,
        redemptionsCurrent, redemptionsPrevious,
        clientsBeforeNow, clientsBeforePeriod,
        totalActiveRewards,
        atRiskCount,
    ] = await Promise.all([
        sumInRange({ businessId: oid, type: 'add', createdAt: { $gte: periodStart } }, 'purchaseAmount'),
        sumInRange({ businessId: oid, type: 'add', createdAt: { $gte: previousStart, $lt: periodStart } }, 'purchaseAmount'),
        sumInRange({ businessId: oid, type: 'add', createdAt: { $gte: periodStart } }, 'totalPointsChange'),
        sumInRange({ businessId: oid, type: 'add', createdAt: { $gte: previousStart, $lt: periodStart } }, 'totalPointsChange'),
        sumInRange({ businessId: oid, type: 'redeem', createdAt: { $gte: periodStart } }, '__count__'),
        sumInRange({ businessId: oid, type: 'redeem', createdAt: { $gte: previousStart, $lt: periodStart } }, '__count__'),

        // Tamaño de la base de clientes: total histórico y tamaño de la base
        // hace `days` días (para medir el crecimiento del periodo).
        TransactionModel.distinct('userId', { businessId: oid }).then((ids) => ids.length),
        TransactionModel.aggregate([
            { $match: { businessId: oid } },
            { $group: { _id: '$userId', firstTxDate: { $min: '$createdAt' } } },
            { $match: { firstTxDate: { $lt: periodStart } } },
            { $count: 'total' },
        ]).then((r) => r[0]?.total ?? 0),

        RewardModel.countDocuments({ businessId: oid, isActive: true }),

        // Mismo criterio que getAtRiskClients: sin visitar desde hace AT_RISK_DAYS,
        // sin importar el `days` que se pidió para el resto del resumen.
        UserPointsModel.aggregate([
            { $match: { 'businessPoints.businessId': oid } },
            { $unwind: '$businessPoints' },
            { $match: { 'businessPoints.businessId': oid, 'businessPoints.lastVisit': { $lte: atRiskCutoff } } },
            { $count: 'total' },
        ]).then((r) => r[0]?.total ?? 0),
    ]);

    return {
        totalClients: { current: clientsBeforeNow, previous: clientsBeforePeriod },
        revenue: { current: revenueCurrent, previous: revenuePrevious },
        pointsDistributed: { current: pointsCurrent, previous: pointsPrevious },
        redemptions: { current: redemptionsCurrent, previous: redemptionsPrevious },
        totalActiveRewards,
        atRiskClients: atRiskCount,
    };
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
 * Recompensas más canjeadas, de mayor a menor. Si se pasa `days`, solo
 * cuenta canjes de ese rango — para que coincida con el resto del resumen
 * cuando el negocio cambia el periodo seleccionado.
 */
export const getTopRewards = async (businessId: string, limit: number = 5, days?: number): Promise<TopReward[]> => {
    const oid = new Types.ObjectId(businessId);

    const match: Record<string, any> = { businessId: oid, type: 'redeem' };
    if (days) {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - days);
        match.createdAt = { $gte: since };
    }

    const results = await TransactionModel.aggregate([
        { $match: match },
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
