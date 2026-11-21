/**
 * UserPoints service (persistence layer).
 *
 * This module is responsible for managing user points and stamps across different businesses.
 */
import { UserPointsModel, IUserPoints } from '../models/userPoints.model';
import { ClientSession, Types } from 'mongoose';
import { PublicSystem } from './system.service';

/**
 * Public user points object interface (without Mongoose internals)
 */
export interface PublicUserPoints {
    id: string;
    userId: string;
    businessPoints: PublicBusinessPoints[];
    createdAt: string;
    updatedAt: string;
}

export interface PublicBusinessPoints {
    businessId: string;
    points: number;
    stamps: number;
    lastVisit: string;
    rewardSystems: PublicRewardSystemPoints[];
}

export interface PublicRewardSystemPoints {
    rewardSystemId: string;
    points: number;
    stamps: number;
    lastUpdated: string;
}

/**
 * Convert a Mongoose document into a plain public object.
 */
const toPublic = (doc: IUserPoints): PublicUserPoints => ({
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    businessPoints: doc.businessPoints.map((bp) => ({
        businessId: bp.businessId.toString(),
        points: bp.points,
        stamps: bp.stamps,
        lastVisit: bp.lastVisit.toISOString(),
        rewardSystems: bp.rewardSystems.map((rs) => ({
            rewardSystemId: rs.rewardSystemId.toString(),
            points: rs.points,
            stamps: rs.stamps,
            lastUpdated: rs.lastUpdated.toISOString(),
        })),
    })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
});

/**
 * Calculate points based on purchase amount and reward system conversion.
 * @param purchaseAmount - The purchase amount in the currency
 * @param pointsConversion - The points conversion configuration
 * @returns The number of points earned
 */
export const calculatePoints = (purchaseAmount: number, pointsConversion: { amount: number; points: number }): number => {
    if (purchaseAmount <= 0 || pointsConversion.amount <= 0) {
        return 0;
    }
    return Math.floor((purchaseAmount / pointsConversion.amount) * pointsConversion.points);
};

// ── Escrituras atómicas ──────────────────────────────────────────────────────
//
// Antes: leer el documento → modificarlo en JS → save(). Dos cajeros (o dos
// instancias detrás del ALB) sobre el mismo usuario perdían una de las dos
// actualizaciones, y dos restas a la vez podían pasar ambas el chequeo de saldo.
// Ahora cada cambio es un solo updateOne con $inc, y en las restas el filtro
// exige saldo suficiente (los validadores min: 0 del schema no corren con $inc).

/** Cambio de puntos/sellos de un sistema de recompensas. */
type SystemDelta = { id: Types.ObjectId; points: number; stamps: number };

const isDuplicateKey = (err: any) => err?.code === 11000;

/** Junta los cambios por sistema: un sistema repetido queda en una sola entrada. */
const mergeDeltas = (entries: SystemDelta[]): SystemDelta[] => {
    const merged = new Map<string, SystemDelta>();
    for (const e of entries) {
        const cur = merged.get(e.id.toString()) ?? { id: e.id, points: 0, stamps: 0 };
        cur.points += e.points;
        cur.stamps += e.stamps;
        merged.set(e.id.toString(), cur);
    }
    return Array.from(merged.values());
};

/**
 * Crea, si faltan, el documento del usuario, su entrada del negocio y la de
 * cada sistema. Idempotente y seguro en paralelo: cada $push lleva en el
 * filtro la condición de que la entrada aún no exista.
 */
const ensureEntries = async (
    userId: Types.ObjectId,
    businessId: Types.ObjectId,
    systemIds: Types.ObjectId[],
    now: Date,
    session?: ClientSession
): Promise<void> => {
    try {
        await UserPointsModel.updateOne(
            { userId },
            { $setOnInsert: { userId, businessPoints: [] } },
            { upsert: true, session }
        );
    } catch (err) {
        // Otra petición creó el documento al mismo tiempo: ya existe, que es lo que queríamos.
        if (!isDuplicateKey(err)) throw err;
    }

    await UserPointsModel.updateOne(
        { userId, 'businessPoints.businessId': { $ne: businessId } },
        { $push: { businessPoints: { businessId, points: 0, stamps: 0, lastVisit: now, rewardSystems: [] } } },
        { session }
    );

    for (const rewardSystemId of systemIds) {
        await UserPointsModel.updateOne(
            { userId, businessPoints: { $elemMatch: { businessId, 'rewardSystems.rewardSystemId': { $ne: rewardSystemId } } } },
            { $push: { 'businessPoints.$[bp].rewardSystems': { rewardSystemId, points: 0, stamps: 0, lastUpdated: now } } },
            { arrayFilters: [{ 'bp.businessId': businessId }], session }
        );
    }
};

/**
 * Un solo update con $inc: totales del negocio (bp) y cada sistema (rs0, rs1, …).
 * Los valores negativos restan.
 */
const buildIncUpdate = (
    businessId: Types.ObjectId,
    businessPoints: number,
    businessStamps: number,
    deltas: SystemDelta[],
    now: Date
) => {
    const $inc: Record<string, number> = {};
    const $set: Record<string, Date> = { 'businessPoints.$[bp].lastVisit': now };
    const arrayFilters: Record<string, unknown>[] = [{ 'bp.businessId': businessId }];

    if (businessPoints) $inc['businessPoints.$[bp].points'] = businessPoints;
    if (businessStamps) $inc['businessPoints.$[bp].stamps'] = businessStamps;

    deltas.forEach((d, i) => {
        const path = `businessPoints.$[bp].rewardSystems.$[rs${i}]`;
        if (d.points) $inc[`${path}.points`] = d.points;
        if (d.stamps) $inc[`${path}.stamps`] = d.stamps;
        $set[`${path}.lastUpdated`] = now;
        arrayFilters.push({ [`rs${i}.rewardSystemId`]: d.id });
    });

    const update: Record<string, unknown> = { $set };
    if (Object.keys($inc).length > 0) update.$inc = $inc;
    return { update, arrayFilters };
};

const readUserPoints = async (userId: Types.ObjectId, session?: ClientSession): Promise<PublicUserPoints> => {
    const doc = await UserPointsModel.findOne({ userId }, null, { session }).exec();
    if (!doc) throw new Error('User has no points/stamps to subtract');
    return toPublic(doc as IUserPoints);
};

/**
 * Las mismas validaciones, en el mismo orden y con los mismos mensajes que
 * antes, contra un documento leído. Devuelve qué hay que restar.
 */
const checkSubtract = (
    doc: IUserPoints | null,
    businessId: string,
    pointsSystem: PublicSystem | null,
    pointsToSubtract?: number,
    stampSystems?: Array<{ system: PublicSystem, count: number }>
): { points: number; stamps: number; deltas: SystemDelta[] } => {
    if (!doc) {
        throw new Error('User has no points/stamps to subtract');
    }

    const businessPoints = doc.businessPoints.find((bp) => bp.businessId.toString() === businessId);
    if (!businessPoints) {
        throw new Error('User has no points/stamps at this business');
    }

    // Saldo restante por sistema mientras se validan los pedidos (un sistema repetido se descuenta dos veces)
    const left = new Map(businessPoints.rewardSystems.map((rs) => [
        rs.rewardSystemId.toString(),
        { points: rs.points, stamps: rs.stamps },
    ]));
    const deltas: SystemDelta[] = [];
    let points = 0;
    let stamps = 0;

    if (pointsSystem && pointsToSubtract !== undefined && pointsToSubtract > 0) {
        if (pointsSystem.businessId !== businessId) {
            throw new Error('Points system does not belong to the specified business');
        }
        if (!pointsSystem.isActive) {
            throw new Error('Points system is not active');
        }

        const pointsSystemIdObj = new Types.ObjectId(pointsSystem.id);
        const balance = left.get(pointsSystemIdObj.toString());
        if (!balance) {
            throw new Error('User has no points in this reward system');
        }
        if (balance.points < pointsToSubtract) {
            throw new Error(`Insufficient points. User has ${balance.points} points, trying to subtract ${pointsToSubtract}`);
        }

        balance.points -= pointsToSubtract;
        points += pointsToSubtract;
        deltas.push({ id: pointsSystemIdObj, points: pointsToSubtract, stamps: 0 });
    }

    if (stampSystems && stampSystems.length > 0) {
        for (const { system, count } of stampSystems) {
            if (system.businessId !== businessId) {
                throw new Error(`Stamp system ${system.name} does not belong to the specified business`);
            }
            if (!system.isActive) {
                throw new Error(`Stamp system ${system.name} is not active`);
            }
            if (count <= 0) {
                throw new Error(`Invalid stamp count for system ${system.name}`);
            }

            const stampSystemIdObj = new Types.ObjectId(system.id);
            const balance = left.get(stampSystemIdObj.toString());
            if (!balance) {
                throw new Error(`User has no stamps in reward system ${system.name}`);
            }
            if (balance.stamps < count) {
                throw new Error(`Insufficient stamps in ${system.name}. User has ${balance.stamps} stamps, trying to subtract ${count}`);
            }

            balance.stamps -= count;
            stamps += count;
            deltas.push({ id: stampSystemIdObj, points: 0, stamps: count });
        }
    }

    // Antes, save() fallaba con el validador min: 0 si el total del negocio quedaba negativo
    // (datos viejos donde el total no cuadra con los sistemas). Se conserva ese rechazo.
    if (businessPoints.points < points || businessPoints.stamps < stamps) {
        throw new Error('UserPoints validation failed: business total would become negative');
    }

    return { points, stamps, deltas: mergeDeltas(deltas) };
};

/**
 * Add points and/or stamps to a user for a specific business.
 * @param userId - The user ID
 * @param businessId - The business ID
 * @param pointsSystem - The points system (null if not adding points)
 * @param purchaseAmount - The purchase amount (for points calculation)
 * @param stampSystems - Array of stamp systems with their counts
 * @param session - Sesión de la transacción en curso (opcional)
 * @returns Updated public user points object
 */
export const addPointsAndStamps = async (
    userId: string,
    businessId: string,
    pointsSystem: PublicSystem | null,
    purchaseAmount?: number,
    stampSystems?: Array<{ system: PublicSystem, count: number }>,
    session?: ClientSession
): Promise<PublicUserPoints> => {
    // Calculate points if points system is provided
    let pointsToAdd = 0;
    let pointsSystemIdObj: Types.ObjectId | null = null;
    
    if (pointsSystem && purchaseAmount !== undefined && purchaseAmount > 0) {
        if (pointsSystem.businessId !== businessId) {
            throw new Error('Points system does not belong to the specified business');
        }
        if (!pointsSystem.isActive) {
            throw new Error('Points system is not active');
        }
        if (!pointsSystem.pointsConversion) {
            throw new Error('Points conversion not configured for this system');
        }
        pointsToAdd = calculatePoints(purchaseAmount, pointsSystem.pointsConversion);
        pointsSystemIdObj = new Types.ObjectId(pointsSystem.id);
    }

    // Validate stamp systems
    const validatedStampSystems: Array<{ id: Types.ObjectId, count: number }> = [];
    let totalStampsToAdd = 0;
    
    if (stampSystems && stampSystems.length > 0) {
        for (const { system, count } of stampSystems) {
            if (system.businessId !== businessId) {
                throw new Error(`Stamp system ${system.name} does not belong to the specified business`);
            }
            if (!system.isActive) {
                throw new Error(`Stamp system ${system.name} is not active`);
            }
            if (count <= 0) {
                throw new Error(`Invalid stamp count for system ${system.name}`);
            }
            validatedStampSystems.push({
                id: new Types.ObjectId(system.id),
                count
            });
            totalStampsToAdd += count;
        }
    }

    if (pointsToAdd === 0 && totalStampsToAdd === 0) {
        throw new Error('No points or stamps to add');
    }

    const userIdObj = new Types.ObjectId(userId);
    const businessIdObj = new Types.ObjectId(businessId);
    const now = new Date();

    const deltas = mergeDeltas([
        ...(pointsSystemIdObj && pointsToAdd > 0 ? [{ id: pointsSystemIdObj, points: pointsToAdd, stamps: 0 }] : []),
        ...validatedStampSystems.map(({ id, count }) => ({ id, points: 0, stamps: count })),
    ]);

    await ensureEntries(userIdObj, businessIdObj, deltas.map((d) => d.id), now, session);

    const { update, arrayFilters } = buildIncUpdate(businessIdObj, pointsToAdd, totalStampsToAdd, deltas, now);
    await UserPointsModel.updateOne({ userId: userIdObj }, update, { arrayFilters, session });

    return readUserPoints(userIdObj, session);
};

/**
 * Legacy function for backward compatibility - now calls addPointsAndStamps
 * @deprecated Use addPointsAndStamps instead
 */
export const addPointsOrStamps = async (
    userId: string,
    businessId: string,
    system: PublicSystem,
    purchaseAmount?: number,
    stampsCount?: number
): Promise<PublicUserPoints> => {
    const pointsSystem = system.type === 'points' ? system : null;
    const stampSystems = system.type === 'stamps' ? [{ system: system, count: stampsCount || 0 }] : undefined;
    
    return addPointsAndStamps(userId, businessId, pointsSystem, purchaseAmount, stampSystems);
};

/**
 * Get user points for a specific user.
 * @param userId - The user ID
 * @returns Public user points object or undefined
 */
export const getUserPoints = async (userId: string): Promise<PublicUserPoints | undefined> => {
    const doc = await UserPointsModel.findOne({ userId: new Types.ObjectId(userId) }).exec();
    return doc ? toPublic(doc as IUserPoints) : undefined;
};

/**
 * Get user points for a specific business.
 * @param userId - The user ID
 * @param businessId - The business ID
 * @returns Public business points object or undefined
 */
export const getUserPointsForBusiness = async (
    userId: string,
    businessId: string
): Promise<PublicBusinessPoints | undefined> => {
    const doc = await UserPointsModel.findOne({
        userId: new Types.ObjectId(userId),
        'businessPoints.businessId': new Types.ObjectId(businessId),
    }).exec();

    if (!doc) {
        return undefined;
    }

    const businessPoints = doc.businessPoints.find(
        (bp) => bp.businessId.toString() === businessId
    );

    if (!businessPoints) {
        return undefined;
    }

    return {
        businessId: businessPoints.businessId.toString(),
        points: businessPoints.points,
        stamps: businessPoints.stamps,
        lastVisit: businessPoints.lastVisit.toISOString(),
        rewardSystems: businessPoints.rewardSystems.map((rs) => ({
            rewardSystemId: rs.rewardSystemId.toString(),
            points: rs.points,
            stamps: rs.stamps,
            lastUpdated: rs.lastUpdated.toISOString(),
        })),
    };
};

/**
 * Get all users that have points/stamps at a specific business.
 * @param businessId - The business ID
 * @returns Array of user points with business points filtered
 */
export const getAllUsersForBusiness = async (businessId: string): Promise<Array<{
    userId: string;
    businessPoints: PublicBusinessPoints;
}>> => {
    const docs = await UserPointsModel.find({
        'businessPoints.businessId': new Types.ObjectId(businessId),
    }).exec();

    const results = docs.map((doc) => {
        const businessPoints = doc.businessPoints.find(
            (bp) => bp.businessId.toString() === businessId
        );

        if (!businessPoints) {
            return null;
        }

        return {
            userId: doc.userId.toString(),
            businessPoints: {
                businessId: businessPoints.businessId.toString(),
                points: businessPoints.points,
                stamps: businessPoints.stamps,
                lastVisit: businessPoints.lastVisit.toISOString(),
                rewardSystems: businessPoints.rewardSystems.map((rs) => ({
                    rewardSystemId: rs.rewardSystemId.toString(),
                    points: rs.points,
                    stamps: rs.stamps,
                    lastUpdated: rs.lastUpdated.toISOString(),
                })),
            },
        };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    return results;
};

/**
 * Subtract points and/or stamps from a user for a specific business.
 * @param userId - The user ID
 * @param businessId - The business ID
 * @param pointsSystem - The points system (null if not subtracting points)
 * @param pointsToSubtract - The number of points to subtract
 * @param stampSystems - Array of stamp systems with their counts to subtract
 * @param session - Sesión de la transacción en curso (opcional)
 * @returns Updated public user points object
 */
export const subtractPointsAndStamps = async (
    userId: string,
    businessId: string,
    pointsSystem: PublicSystem | null,
    pointsToSubtract?: number,
    stampSystems?: Array<{ system: PublicSystem, count: number }>,
    session?: ClientSession
): Promise<PublicUserPoints> => {
    const userIdObj = new Types.ObjectId(userId);
    const businessIdObj = new Types.ObjectId(businessId);

    for (let attempt = 1; ; attempt++) {
        const doc = await UserPointsModel.findOne({ userId: userIdObj }, null, { session }).exec();
        const plan = checkSubtract(doc as IUserPoints | null, businessId, pointsSystem, pointsToSubtract, stampSystems);

        // El filtro exige el saldo que se validó: si otra petición lo gastó
        // mientras tanto, no hay match y no se resta nada.
        const guards: Record<string, unknown>[] = [];
        if (plan.points > 0 || plan.stamps > 0) {
            guards.push({ businessPoints: { $elemMatch: {
                businessId: businessIdObj,
                ...(plan.points > 0 && { points: { $gte: plan.points } }),
                ...(plan.stamps > 0 && { stamps: { $gte: plan.stamps } }),
            } } });
        }
        for (const d of plan.deltas) {
            guards.push({ businessPoints: { $elemMatch: {
                businessId: businessIdObj,
                rewardSystems: { $elemMatch: {
                    rewardSystemId: d.id,
                    ...(d.points > 0 && { points: { $gte: d.points } }),
                    ...(d.stamps > 0 && { stamps: { $gte: d.stamps } }),
                } },
            } } });
        }

        const now = new Date();
        const negative = plan.deltas.map((d) => ({ id: d.id, points: -d.points, stamps: -d.stamps }));
        const { update, arrayFilters } = buildIncUpdate(businessIdObj, -plan.points, -plan.stamps, negative, now);
        const result = await UserPointsModel.updateOne(
            { userId: userIdObj, 'businessPoints.businessId': businessIdObj, ...(guards.length > 0 && { $and: guards }) },
            update,
            { arrayFilters, session }
        );
        if (result.matchedCount === 1) return readUserPoints(userIdObj, session);

        // Sin match: el saldo cambió entre la lectura y la escritura. Al releer,
        // checkSubtract lanza el mismo error que antes ("Insufficient points…").
        if (attempt >= 3) throw new Error('Points were updated concurrently, please retry');
    }
};
