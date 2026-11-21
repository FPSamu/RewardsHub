/**
 * P1.3 / P1.6 — operaciones de negocio en una transacción (replica set en memoria).
 *
 * - /user-points/add y /subtract: saldo + transacción juntos; en paralelo no se
 *   pierden sumas ni se gasta de más; si falla el registro de la transacción,
 *   el saldo no cambia (rollback); una sucursal inválida no escribe nada.
 * - /delivery/claim: un código se canjea una sola vez aunque lleguen dos a la vez.
 * - /memberships/activate y /redeem: sin dobles activaciones ni dobles canjes.
 * - Las respuestas (forma y mensajes) son las de siempre.
 */
import request from 'supertest';
import { Types } from 'mongoose';
import app from '../src/app';
import { useReplSet, ensureCollections } from './helpers/replset';
import { MODELS, seedWorld, World } from './helpers/world';
import { UserPointsModel } from '../src/models/userPoints.model';
import { TransactionModel } from '../src/models/transaction.model';
import { RedemptionCodeModel } from '../src/models/redemptionCode.model';
import { MembershipPlanModel } from '../src/models/membershipPlan.model';
import { ClientMembershipModel } from '../src/models/clientMembership.model';
import * as transactionService from '../src/services/transaction.service';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

useReplSet('atomic-endpoints-test');


beforeAll(async () => {
    await ensureCollections(...MODELS);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await Promise.all(MODELS.map((m) => m.deleteMany({})));
});


const add = (w: World, body: Record<string, unknown>) =>
    request(app).post('/user-points/add').set('Authorization', w.bizAuth).send({ userId: w.user.id, ...body });

const subtract = (w: World, body: Record<string, unknown>) =>
    request(app).post('/user-points/subtract').set('Authorization', w.bizAuth).send({ userId: w.user.id, ...body });

const pointsOf = async (w: World) => {
    const doc = await UserPointsModel.findOne({ userId: w.user._id }).lean();
    const bp = doc?.businessPoints.find((b) => b.businessId.toString() === w.business.id);
    const rs = bp?.rewardSystems.find((r) => r.rewardSystemId.toString() === w.points.id);
    return { total: bp?.points, system: rs?.points };
};

describe('POST /user-points/add y /subtract', () => {
    it('la respuesta conserva su forma', async () => {
        const w = await seedWorld();
        const res = await add(w, { purchaseAmount: 250, stampData: [{ rewardSystemId: w.stamps.id, stampsCount: 1 }] });

        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(['message', 'transaction', 'userPoints']);
        expect(res.body.message).toBe('Points and/or stamps added successfully');
        expect(res.body.userPoints.businessPoints[0]).toMatchObject({ businessId: w.business.id, points: 25, stamps: 1 });
        expect(res.body.transaction).toMatchObject({
            type: 'add', businessName: 'Cafetería Lab', purchaseAmount: 250,
            totalPointsChange: 25, totalStampsChange: 1, notes: 'Purchase transaction',
            branchId: w.business.locations![0]._id!.toString(), timezone: 'America/Mexico_City',
        });

        const sub = await subtract(w, { pointsToSubtract: 5, rewardSystemId: w.points.id });
        expect(sub.status).toBe(200);
        expect(Object.keys(sub.body).sort()).toEqual(['message', 'transaction', 'userPoints']);
        expect(sub.body.message).toBe('Points and/or stamps subtracted successfully');
        expect(sub.body.transaction).toMatchObject({ type: 'subtract', totalPointsChange: -5, notes: 'Points/stamps subtraction' });
    });

    it('mensajes de error de siempre', async () => {
        const w = await seedWorld();
        await add(w, { purchaseAmount: 100 });

        const insufficient = await subtract(w, { pointsToSubtract: 11, rewardSystemId: w.points.id });
        expect(insufficient.status).toBe(400);
        expect(insufficient.body).toEqual({ message: 'Insufficient points. User has 10 points, trying to subtract 11' });

        const noStamps = await subtract(w, { stampData: [{ rewardSystemId: w.stamps.id, stampsCount: 1 }] });
        expect(noStamps.status).toBe(400);
        expect(noStamps.body).toEqual({ message: 'User has no stamps in reward system Café' });
    });

    it('sucursal inválida: 400 con el mensaje de siempre y NO se escribe nada', async () => {
        const w = await seedWorld({ branches: 2 });

        const res = await add(w, { purchaseAmount: 100 });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ message: 'branchId is required for businesses with multiple branches' });

        const wrong = await add(w, { purchaseAmount: 100, branchId: new Types.ObjectId().toString() });
        expect(wrong.status).toBe(400);
        expect(wrong.body).toEqual({ message: 'branchId does not belong to this business' });

        // Antes el saldo se sumaba y solo fallaba el registro de la transacción
        expect(await UserPointsModel.countDocuments()).toBe(0);
        expect(await TransactionModel.countDocuments()).toBe(0);
    });

    it('si falla el registro de la transacción, el saldo no cambia (rollback)', async () => {
        const w = await seedWorld();
        await add(w, { purchaseAmount: 1000 });
        expect(await pointsOf(w)).toEqual({ total: 100, system: 100 });

        jest.spyOn(transactionService, 'createTransaction').mockRejectedValue(new Error('disco lleno'));

        const addRes = await add(w, { purchaseAmount: 500 });
        expect(addRes.status).toBe(400);
        expect(addRes.body).toEqual({ message: 'disco lleno' });

        const subRes = await subtract(w, { pointsToSubtract: 30, rewardSystemId: w.points.id });
        expect(subRes.status).toBe(400);

        expect(await pointsOf(w)).toEqual({ total: 100, system: 100 });
        expect(await TransactionModel.countDocuments()).toBe(1);
    });

    it('20 restas de 10 en paralelo sobre 100: 10 × 200, 10 × 400, saldo 0, 10 transacciones subtract', async () => {
        const w = await seedWorld();
        await add(w, { purchaseAmount: 1000 });

        const responses = await Promise.all(Array.from({ length: 20 }, () =>
            subtract(w, { pointsToSubtract: 10, rewardSystemId: w.points.id })));

        const ok = responses.filter((r) => r.status === 200);
        const rejected = responses.filter((r) => r.status === 400);
        expect(ok).toHaveLength(10);
        expect(rejected).toHaveLength(10);
        for (const r of rejected) expect(r.body.message).toMatch(/^Insufficient points\. User has \d+ points, trying to subtract 10$/);

        expect(await pointsOf(w)).toEqual({ total: 0, system: 0 });
        expect(await TransactionModel.countDocuments({ type: 'subtract' })).toBe(10);
    });

    it('50 sumas en paralelo: saldo == suma, 50 transacciones', async () => {
        const w = await seedWorld();

        const responses = await Promise.all(Array.from({ length: 50 }, (_, i) => add(w, { purchaseAmount: 10 * (i + 1) })));

        expect(responses.every((r) => r.status === 200)).toBe(true);
        const expected = (50 * 51) / 2;
        expect(await pointsOf(w)).toEqual({ total: expected, system: expected });
        expect(await TransactionModel.countDocuments({ type: 'add' })).toBe(50);
        expect(await UserPointsModel.countDocuments()).toBe(1);
    });
});

describe('POST /delivery/claim', () => {
    const seedCode = async (w: World, over: Record<string, unknown> = {}) =>
        RedemptionCodeModel.create({
            code: 'ABC123',
            businessId: w.business._id,
            branchId: w.business.locations![0]._id,
            amount: 200,
            stamps: [{ systemId: w.stamps._id, count: 2 }],
            expiresAt: new Date(Date.now() + 3600_000),
            ...over,
        });

    const claim = (w: World, code = 'abc123') =>
        request(app).post('/delivery/claim').set('Authorization', w.userAuth).send({ code });

    it('canjea con la respuesta de siempre y marca el código', async () => {
        const w = await seedWorld();
        await seedCode(w);

        const res = await claim(w);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: 'Rewards claimed successfully', pointsAdded: 20, stampsAdded: 1, businessId: w.business.id,
        });
        const code = await RedemptionCodeModel.findOne({ code: 'ABC123' }).lean();
        expect(code!.isRedeemed).toBe(true);
        expect(code!.redeemedBy!.toString()).toBe(w.user.id);
        expect(await pointsOf(w)).toEqual({ total: 20, system: 20 });
        const tx = await TransactionModel.findOne().lean();
        expect(tx!.notes).toBe('Pedido a domicilio (Código: ABC123)');
    });

    it('2 canjes simultáneos del mismo código: uno 200, otro 409; puntos una sola vez', async () => {
        const w = await seedWorld();
        await seedCode(w);

        const responses = await Promise.all([claim(w), claim(w)]);
        expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(responses.find((r) => r.status === 409)!.body).toEqual({ message: 'Code already redeemed' });

        expect(await pointsOf(w)).toEqual({ total: 20, system: 20 });
        expect(await TransactionModel.countDocuments()).toBe(1);
    });

    it('404 / 409 / 400 como antes', async () => {
        const w = await seedWorld();
        expect((await claim(w, 'NOPE00')).body).toEqual({ message: 'Invalid code' });

        await seedCode(w, { code: 'OLD001', expiresAt: new Date(Date.now() - 1000) });
        const expired = await claim(w, 'OLD001');
        expect(expired.status).toBe(400);
        expect(expired.body).toEqual({ message: 'Code expired' });

        await seedCode(w, { code: 'USED01', isRedeemed: true });
        const used = await claim(w, 'USED01');
        expect(used.status).toBe(409);
        expect(used.body).toEqual({ message: 'Code already redeemed' });

        expect(await UserPointsModel.countDocuments()).toBe(0);
    });

    it('si falla después de marcar el código, el código vuelve a quedar libre (rollback)', async () => {
        const w = await seedWorld();
        await seedCode(w);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(transactionService, 'createTransaction').mockRejectedValue(new Error('disco lleno'));

        const res = await claim(w);
        expect(res.status).toBe(500);

        const code = await RedemptionCodeModel.findOne({ code: 'ABC123' }).lean();
        expect(code!.isRedeemed).toBe(false);
        expect(await UserPointsModel.countDocuments()).toBe(0);
    });
});

describe('POST /memberships/activate y /redeem', () => {
    const seedPlan = async (w: World) =>
        MembershipPlanModel.create({
            businessId: w.business._id, name: 'Café diario', description: 'Un café al día',
            benefit: 'Café americano', durationDays: 30, price: 299,
        });

    const activate = (w: World, planId: string) =>
        request(app).post('/memberships/activate').set('Authorization', w.bizAuth).send({ userId: w.user.id, planId });

    const redeem = (w: World, membershipId: string) =>
        request(app).post('/memberships/redeem').set('Authorization', w.bizAuth).send({ userId: w.user.id, membershipId });

    it('activa con la respuesta de siempre; 5 activaciones simultáneas → una sola membresía', async () => {
        const w = await seedWorld();
        const plan = await seedPlan(w);

        const responses = await Promise.all(Array.from({ length: 5 }, () => activate(w, plan.id)));
        const created = responses.filter((r) => r.status === 201);
        const conflicts = responses.filter((r) => r.status === 409);
        expect(created).toHaveLength(1);
        expect(conflicts).toHaveLength(4);
        for (const r of conflicts) expect(r.body).toEqual({ message: 'El cliente ya tiene una membresía activa con este plan' });

        expect(Object.keys(created[0].body).sort()).toEqual(['membership', 'message', 'userName']);
        expect(created[0].body.message).toBe('Membresía "Café diario" activada para cliente');
        expect(await ClientMembershipModel.countDocuments({ status: 'active' })).toBe(1);
    });

    it('5 canjes simultáneos del día → uno 200, el resto 409 redeemedToday', async () => {
        const w = await seedWorld();
        const plan = await seedPlan(w);
        const { body } = await activate(w, plan.id);
        const membershipId = body.membership._id;

        const responses = await Promise.all(Array.from({ length: 5 }, () => redeem(w, membershipId)));
        const ok = responses.filter((r) => r.status === 200);
        expect(ok).toHaveLength(1);
        expect(ok[0].body).toEqual({ message: 'Beneficio canjeado: Café americano', benefit: 'Café americano' });
        for (const r of responses.filter((x) => x.status !== 200)) {
            expect(r.status).toBe(409);
            expect(r.body).toEqual({ message: 'El beneficio de hoy ya fue canjeado', redeemedToday: true });
        }

        const doc = await ClientMembershipModel.findById(membershipId).lean();
        expect(doc!.lastRedeemedBusinessName).toBe('Cafetería Lab');
    });

    it('un canje de ayer no impide el de hoy', async () => {
        const w = await seedWorld();
        const plan = await seedPlan(w);
        const { body } = await activate(w, plan.id);
        await ClientMembershipModel.updateOne({ _id: body.membership._id }, { $set: { lastRedeemedDate: new Date(Date.now() - 36 * 3600_000) } });

        expect((await redeem(w, body.membership._id)).status).toBe(200);
    });

    it('404 y 409 vencida como antes (y la marca como expired)', async () => {
        const w = await seedWorld();
        const plan = await seedPlan(w);

        const missing = await redeem(w, new Types.ObjectId().toString());
        expect(missing.status).toBe(404);
        expect(missing.body).toEqual({ message: 'Membresía no encontrada o inactiva' });

        const { body } = await activate(w, plan.id);
        await ClientMembershipModel.updateOne({ _id: body.membership._id }, { $set: { endDate: new Date(Date.now() - 1000) } });
        const expired = await redeem(w, body.membership._id);
        expect(expired.status).toBe(409);
        expect(expired.body).toEqual({ message: 'La membresía ha vencido' });
        expect((await ClientMembershipModel.findById(body.membership._id).lean())!.status).toBe('expired');
    });

    it('un error inesperado responde 500 JSON (antes quedaba sin respuesta)', async () => {
        const w = await seedWorld();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const res = await redeem(w, 'no-es-un-id');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ message: 'internal server error' });
    });
});
