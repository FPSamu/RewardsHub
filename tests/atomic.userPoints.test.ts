/**
 * P1.2 — userPoints.service con $inc condicional (replica set en memoria).
 *
 * - Mismos resultados y mismos mensajes de error que la versión read-modify-save.
 * - En paralelo no se pierden sumas y el saldo nunca queda negativo.
 */
import { Types } from 'mongoose';
import { useReplSet, ensureCollections } from './helpers/replset';
import { UserPointsModel } from '../src/models/userPoints.model';
import { addPointsAndStamps, subtractPointsAndStamps } from '../src/services/userPoints.service';
import { PublicSystem } from '../src/services/system.service';

useReplSet('atomic-userpoints-test');

beforeAll(async () => {
    await ensureCollections(UserPointsModel);
});

afterEach(async () => {
    await UserPointsModel.deleteMany({});
});

const oid = () => new Types.ObjectId().toString();

const pointsSystem = (businessId: string, over: Partial<PublicSystem> = {}): PublicSystem => ({
    id: oid(), businessId, type: 'points', name: 'Puntos', isActive: true,
    createdAt: '', updatedAt: '', pointsConversion: { amount: 10, points: 1, currency: 'MXN' },
    ...over,
});

const stampSystem = (businessId: string, name = 'Café', over: Partial<PublicSystem> = {}): PublicSystem => ({
    id: oid(), businessId, type: 'stamps', name, isActive: true,
    createdAt: '', updatedAt: '', targetStamps: 8, productType: 'any',
    ...over,
});

/** Saldo de un sistema y totales del negocio, leídos de Mongo. */
const balances = async (userId: string, businessId: string) => {
    const doc = await UserPointsModel.findOne({ userId: new Types.ObjectId(userId) }).lean();
    const bp = doc?.businessPoints.find((b) => b.businessId.toString() === businessId);
    return {
        total: bp ? { points: bp.points, stamps: bp.stamps } : undefined,
        system: (id: string) => {
            const rs = bp?.rewardSystems.find((r) => r.rewardSystemId.toString() === id);
            return rs ? { points: rs.points, stamps: rs.stamps } : undefined;
        },
        entries: bp?.rewardSystems.length ?? 0,
        businesses: doc?.businessPoints.length ?? 0,
    };
};

describe('addPointsAndStamps', () => {
    it('crea documento, entrada del negocio y de cada sistema en la primera visita', async () => {
        const [user, biz] = [oid(), oid()];
        const pts = pointsSystem(biz);
        const cafe = stampSystem(biz);

        const out = await addPointsAndStamps(user, biz, pts, 125, [{ system: cafe, count: 2 }]);

        expect(out.userId).toBe(user);
        expect(out.businessPoints).toHaveLength(1);
        expect(out.businessPoints[0]).toMatchObject({ businessId: biz, points: 12, stamps: 2 });
        const b = await balances(user, biz);
        expect(b.system(pts.id)).toEqual({ points: 12, stamps: 0 });
        expect(b.system(cafe.id)).toEqual({ points: 0, stamps: 2 });
    });

    it('suma sobre lo existente, sin duplicar entradas', async () => {
        const [user, biz] = [oid(), oid()];
        const pts = pointsSystem(biz);
        await addPointsAndStamps(user, biz, pts, 100);
        await addPointsAndStamps(user, biz, pts, 50);

        const b = await balances(user, biz);
        expect(b.total).toEqual({ points: 15, stamps: 0 });
        expect(b.entries).toBe(1);
        expect(b.businesses).toBe(1);
    });

    it('un sistema de sellos repetido en la misma petición suma ambas cantidades', async () => {
        const [user, biz] = [oid(), oid()];
        const cafe = stampSystem(biz);
        await addPointsAndStamps(user, biz, null, undefined, [{ system: cafe, count: 1 }, { system: cafe, count: 2 }]);

        const b = await balances(user, biz);
        expect(b.system(cafe.id)).toEqual({ points: 0, stamps: 3 });
        expect(b.total).toEqual({ points: 0, stamps: 3 });
    });

    it.each([
        ['sistema de otro negocio', (biz: string) => [pointsSystem(oid()), 100, undefined], 'Points system does not belong to the specified business'],
        ['sistema inactivo', (biz: string) => [pointsSystem(biz, { isActive: false }), 100, undefined], 'Points system is not active'],
        ['sin conversión', (biz: string) => [pointsSystem(biz, { pointsConversion: undefined }), 100, undefined], 'Points conversion not configured for this system'],
        ['sellos de otro negocio', (biz: string) => [null, undefined, [{ system: stampSystem(oid()), count: 1 }]], 'Stamp system Café does not belong to the specified business'],
        ['sellos inactivos', (biz: string) => [null, undefined, [{ system: stampSystem(biz, 'Café', { isActive: false }), count: 1 }]], 'Stamp system Café is not active'],
        ['conteo inválido', (biz: string) => [null, undefined, [{ system: stampSystem(biz), count: 0 }]], 'Invalid stamp count for system Café'],
        ['nada que sumar', (biz: string) => [pointsSystem(biz), 5, undefined], 'No points or stamps to add'],
    ])('mismo error que antes: %s', async (_label, args, message) => {
        const [user, biz] = [oid(), oid()];
        const [system, amount, stamps] = (args as any)(biz);
        await expect(addPointsAndStamps(user, biz, system, amount, stamps)).rejects.toThrow(message);
        expect(await UserPointsModel.countDocuments()).toBe(0);
    });

    it('50 sumas en paralelo para un usuario nuevo: ninguna se pierde', async () => {
        const [user, biz] = [oid(), oid()];
        const pts = pointsSystem(biz);
        const cafe = stampSystem(biz);

        await Promise.all(Array.from({ length: 50 }, (_, i) =>
            addPointsAndStamps(user, biz, pts, 10 * (i + 1), [{ system: cafe, count: 1 }])));

        const expectedPoints = Array.from({ length: 50 }, (_, i) => i + 1).reduce((a, b) => a + b, 0);
        const b = await balances(user, biz);
        expect(b.system(pts.id)).toEqual({ points: expectedPoints, stamps: 0 });
        expect(b.system(cafe.id)).toEqual({ points: 0, stamps: 50 });
        expect(b.total).toEqual({ points: expectedPoints, stamps: 50 });
        expect(b.entries).toBe(2);
        expect(await UserPointsModel.countDocuments()).toBe(1);
    });
});

describe('subtractPointsAndStamps', () => {
    const seed = async (points = 100, stamps = 5) => {
        const [user, biz] = [oid(), oid()];
        const pts = pointsSystem(biz);
        const cafe = stampSystem(biz);
        await addPointsAndStamps(user, biz, pts, points * 10, stamps > 0 ? [{ system: cafe, count: stamps }] : undefined);
        return { user, biz, pts, cafe };
    };

    it('resta puntos y sellos y devuelve el documento actualizado', async () => {
        const { user, biz, pts, cafe } = await seed();
        const out = await subtractPointsAndStamps(user, biz, pts, 30, [{ system: cafe, count: 2 }]);

        expect(out.businessPoints[0]).toMatchObject({ points: 70, stamps: 3 });
        const b = await balances(user, biz);
        expect(b.system(pts.id)).toEqual({ points: 70, stamps: 0 });
        expect(b.system(cafe.id)).toEqual({ points: 0, stamps: 3 });
    });

    it('mensajes de error iguales a los de antes', async () => {
        const { user, biz, pts, cafe } = await seed(100, 5);
        const otherBizSystem = pointsSystem(oid());
        const unknownStamps = stampSystem(biz, 'Postre');

        await expect(subtractPointsAndStamps(oid(), biz, pts, 10)).rejects.toThrow('User has no points/stamps to subtract');
        await expect(subtractPointsAndStamps(user, oid(), pts, 10)).rejects.toThrow('User has no points/stamps at this business');
        await expect(subtractPointsAndStamps(user, biz, otherBizSystem, 10)).rejects.toThrow('Points system does not belong to the specified business');
        await expect(subtractPointsAndStamps(user, biz, { ...pts, isActive: false }, 10)).rejects.toThrow('Points system is not active');
        await expect(subtractPointsAndStamps(user, biz, pointsSystem(biz), 10)).rejects.toThrow('User has no points in this reward system');
        await expect(subtractPointsAndStamps(user, biz, pts, 101))
            .rejects.toThrow('Insufficient points. User has 100 points, trying to subtract 101');
        await expect(subtractPointsAndStamps(user, biz, null, undefined, [{ system: unknownStamps, count: 1 }]))
            .rejects.toThrow('User has no stamps in reward system Postre');
        await expect(subtractPointsAndStamps(user, biz, null, undefined, [{ system: cafe, count: 6 }]))
            .rejects.toThrow('Insufficient stamps in Café. User has 5 stamps, trying to subtract 6');
        // un sistema repetido se valida contra lo que queda tras el primero
        await expect(subtractPointsAndStamps(user, biz, null, undefined, [{ system: cafe, count: 3 }, { system: cafe, count: 3 }]))
            .rejects.toThrow('Insufficient stamps in Café. User has 2 stamps, trying to subtract 3');
        // los puntos se validan antes que los sellos, como antes
        await expect(subtractPointsAndStamps(user, biz, pts, 500, [{ system: { ...cafe, isActive: false }, count: 1 }]))
            .rejects.toThrow('Insufficient points.');

        const b = await balances(user, biz);
        expect(b.total).toEqual({ points: 100, stamps: 5 });
    });

    it('rechaza si el total del negocio quedaría negativo (datos viejos inconsistentes)', async () => {
        const { user, biz, pts } = await seed(100, 0);
        await UserPointsModel.collection.updateOne(
            { userId: new Types.ObjectId(user) },
            { $set: { 'businessPoints.0.points': 20 } },
        );
        await expect(subtractPointsAndStamps(user, biz, pts, 50)).rejects.toThrow('UserPoints validation failed');
        expect((await balances(user, biz)).system(pts.id)).toEqual({ points: 100, stamps: 0 });
    });

    it('20 restas de 10 en paralelo sobre 100: exactamente 10 pasan, saldo final 0', async () => {
        const { user, biz, pts } = await seed(100, 0);

        const results = await Promise.allSettled(Array.from({ length: 20 }, () =>
            subtractPointsAndStamps(user, biz, pts, 10)));

        const ok = results.filter((r) => r.status === 'fulfilled');
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(10);
        expect(failed).toHaveLength(10);
        for (const f of failed) expect(f.reason.message).toMatch(/^Insufficient points\. User has \d+ points, trying to subtract 10$/);

        const b = await balances(user, biz);
        expect(b.system(pts.id)).toEqual({ points: 0, stamps: 0 });
        expect(b.total).toEqual({ points: 0, stamps: 0 });
    });

    it('sumas y restas mezcladas en paralelo: el saldo cuadra y nunca es negativo', async () => {
        const { user, biz, pts, cafe } = await seed(50, 10);

        const ops = Array.from({ length: 40 }, (_, i) => (i % 2 === 0
            ? addPointsAndStamps(user, biz, pts, 50, [{ system: cafe, count: 1 }]).then(() => ({ dp: 5, ds: 1 }))
            : subtractPointsAndStamps(user, biz, pts, 8, [{ system: cafe, count: 1 }]).then(() => ({ dp: -8, ds: -1 }))));
        const results = await Promise.allSettled(ops);

        const applied = results
            .filter((r): r is PromiseFulfilledResult<{ dp: number; ds: number }> => r.status === 'fulfilled')
            .map((r) => r.value);
        const expected = applied.reduce((acc, d) => ({ points: acc.points + d.dp, stamps: acc.stamps + d.ds }), { points: 50, stamps: 10 });

        const b = await balances(user, biz);
        expect(b.system(pts.id)).toEqual({ points: expected.points, stamps: 0 });
        expect(b.system(cafe.id)).toEqual({ points: 0, stamps: expected.stamps });
        expect(b.total).toEqual(expected);
        expect(expected.points).toBeGreaterThanOrEqual(0);
        expect(expected.stamps).toBeGreaterThanOrEqual(0);
    });
});
