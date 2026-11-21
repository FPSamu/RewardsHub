/**
 * P1.4 / P1.6 — Idempotency-Key en las escrituras que mueven saldo (replica set en memoria).
 */
import request from 'supertest';
import { Types } from 'mongoose';
import app from '../src/app';
import { useReplSet, ensureCollections } from './helpers/replset';
import { MODELS, seedWorld, World } from './helpers/world';
import { TransactionModel } from '../src/models/transaction.model';
import { RedemptionCodeModel } from '../src/models/redemptionCode.model';
import { IdempotencyKeyModel } from '../src/models/idempotencyKey.model';
import { idempotencyCounters, hashRequestBody } from '../src/middleware/idempotency.middleware';
import * as transactionService from '../src/services/transaction.service';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

useReplSet('idempotency-test');

beforeAll(async () => {
    await ensureCollections(...MODELS);
});

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
    jest.restoreAllMocks();
    delete process.env.IDEMPOTENCY_REQUIRED;
    await Promise.all(MODELS.map((m) => m.deleteMany({})));
});

const add = (w: World, body: Record<string, unknown>, key?: string, auth = w.bizAuth) => {
    const r = request(app).post('/user-points/add').set('Authorization', auth);
    if (key !== undefined) r.set('Idempotency-Key', key);
    return r.send({ userId: w.user.id, ...body });
};

const subtract = (w: World, body: Record<string, unknown>, key?: string) => {
    const r = request(app).post('/user-points/subtract').set('Authorization', w.bizAuth);
    if (key !== undefined) r.set('Idempotency-Key', key);
    return r.send({ userId: w.user.id, ...body });
};

const key = () => new Types.ObjectId().toString();

describe('sin header', () => {
    it('funciona como siempre y cuenta la petición sin llave', async () => {
        const w = await seedWorld();
        const before = idempotencyCounters.missing;
        const res = await add(w, { purchaseAmount: 100 });
        expect(res.status).toBe(200);
        expect(res.headers['idempotent-replayed']).toBeUndefined();
        expect(idempotencyCounters.missing).toBe(before + 1);
        expect(await IdempotencyKeyModel.countDocuments()).toBe(0);
    });

    it('IDEMPOTENCY_REQUIRED=true → 400 sin escribir nada', async () => {
        process.env.IDEMPOTENCY_REQUIRED = 'true';
        const w = await seedWorld();
        const res = await add(w, { purchaseAmount: 100 });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ message: 'Idempotency-Key header is required' });
        expect(await TransactionModel.countDocuments()).toBe(0);
    });

    it('llave vacía o demasiado larga → 400', async () => {
        const w = await seedWorld();
        expect((await add(w, { purchaseAmount: 100 }, ' ')).status).toBe(400);
        expect((await add(w, { purchaseAmount: 100 }, 'x'.repeat(256))).body).toEqual({ message: 'invalid Idempotency-Key' });
    });
});

describe('con Idempotency-Key', () => {
    it('el reintento con la misma llave repite la respuesta sin volver a sumar', async () => {
        const w = await seedWorld();
        const k = key();

        const first = await add(w, { purchaseAmount: 100 }, k);
        const retry = await add(w, { purchaseAmount: 100 }, k);

        expect(first.status).toBe(200);
        expect(first.headers['idempotent-replayed']).toBeUndefined();
        expect(retry.status).toBe(200);
        expect(retry.headers['idempotent-replayed']).toBe('true');
        expect(retry.body).toEqual(first.body);
        expect(await TransactionModel.countDocuments()).toBe(1);
        expect(retry.body.userPoints.businessPoints[0].points).toBe(10);
    });

    it('5 peticiones en paralelo con la misma llave → 1 transacción; las demás 409 o replay', async () => {
        const w = await seedWorld();
        const k = key();

        const responses = await Promise.all(Array.from({ length: 5 }, () => add(w, { purchaseAmount: 100 }, k)));

        const original = responses.filter((r) => r.status === 200 && !r.headers['idempotent-replayed']);
        expect(original).toHaveLength(1);
        for (const r of responses) {
            if (r === original[0]) continue;
            if (r.status === 409) {
                expect(r.headers['retry-after']).toBe('1');
                expect(r.body).toEqual({ message: 'request with this Idempotency-Key is still in progress' });
            } else {
                expect(r.status).toBe(200);
                expect(r.headers['idempotent-replayed']).toBe('true');
                expect(r.body).toEqual(original[0].body);
            }
        }
        expect(await TransactionModel.countDocuments()).toBe(1);
    });

    it('misma llave con otro body → 422', async () => {
        const w = await seedWorld();
        const k = key();
        await add(w, { purchaseAmount: 100 }, k);

        const res = await add(w, { purchaseAmount: 200 }, k);
        expect(res.status).toBe(422);
        expect(res.body).toEqual({ message: 'Idempotency-Key already used with a different request' });
        expect(await TransactionModel.countDocuments()).toBe(1);
    });

    it('el mismo body con las llaves en otro orden cuenta como la misma petición', () => {
        expect(hashRequestBody({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } }))
            .toBe(hashRequestBody({ b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 }));
        expect(hashRequestBody({ a: [1, 2] })).not.toBe(hashRequestBody({ a: [2, 1] }));
    });

    it('un 4xx también se guarda y se repite (es la respuesta correcta a esa petición)', async () => {
        const w = await seedWorld();
        const k = key();
        const body = { pointsToSubtract: 5, rewardSystemId: w.points.id };

        const first = await subtract(w, body, k);
        expect(first.status).toBe(400);
        expect(first.body).toEqual({ message: 'User has no points/stamps to subtract' });

        // aunque ahora sí tenga saldo, el reintento de ESA petición recibe lo mismo
        await add(w, { purchaseAmount: 1000 });
        const retry = await subtract(w, body, k);
        expect(retry.status).toBe(400);
        expect(retry.headers['idempotent-replayed']).toBe('true');
        expect(retry.body).toEqual(first.body);
        expect(await TransactionModel.countDocuments({ type: 'subtract' })).toBe(0);
    });

    it('un 5xx borra la llave: el reintento se ejecuta de verdad', async () => {
        const w = await seedWorld();
        await RedemptionCodeModel.create({
            code: 'ABC123', businessId: w.business._id, branchId: w.business.locations![0]._id,
            amount: 200, expiresAt: new Date(Date.now() + 3600_000),
        });
        const k = key();
        const claim = () => request(app).post('/delivery/claim')
            .set('Authorization', w.userAuth).set('Idempotency-Key', k).send({ code: 'ABC123' });

        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const failing = jest.spyOn(transactionService, 'createTransaction').mockRejectedValueOnce(new Error('disco lleno'));

        const first = await claim();
        expect(first.status).toBe(500);
        expect(await IdempotencyKeyModel.countDocuments()).toBe(0);

        failing.mockRestore();
        const retry = await claim();
        expect(retry.status).toBe(200);
        expect(retry.headers['idempotent-replayed']).toBeUndefined();
        expect(retry.body.pointsAdded).toBe(20);
        expect(await TransactionModel.countDocuments()).toBe(1);
    });

    it('la misma llave en dos negocios distintos son peticiones independientes', async () => {
        const [a, b] = [await seedWorld(), await seedWorld()];
        const k = key();

        const ra = await add(a, { purchaseAmount: 100 }, k);
        const rb = await request(app).post('/user-points/add').set('Authorization', b.bizAuth)
            .set('Idempotency-Key', k).send({ userId: a.user.id, purchaseAmount: 100 });

        expect(ra.status).toBe(200);
        expect(rb.status).toBe(200);
        expect(rb.headers['idempotent-replayed']).toBeUndefined();
        expect(await TransactionModel.countDocuments()).toBe(2);
    });

    it('una llave "en curso" abandonada (proceso caído) se retoma pasado el lock', async () => {
        const w = await seedWorld();
        const k = key();
        const body = { userId: w.user.id, purchaseAmount: 100 };
        await IdempotencyKeyModel.create({
            scope: `${w.business.id}:POST:/user-points/add`, key: k, requestHash: hashRequestBody(body),
            status: 'in_progress', lockedAt: new Date(Date.now() - 120_000),
        });

        const res = await add(w, { purchaseAmount: 100 }, k);
        expect(res.status).toBe(200);
        expect(await TransactionModel.countDocuments()).toBe(1);
        const doc = await IdempotencyKeyModel.findOne({ key: k }).lean();
        expect(doc!.status).toBe('completed');
    });

    it('una llave "en curso" reciente → 409 + Retry-After', async () => {
        const w = await seedWorld();
        const k = key();
        const body = { userId: w.user.id, purchaseAmount: 100 };
        await IdempotencyKeyModel.create({
            scope: `${w.business.id}:POST:/user-points/add`, key: k, requestHash: hashRequestBody(body),
            status: 'in_progress', lockedAt: new Date(),
        });

        const res = await add(w, { purchaseAmount: 100 }, k);
        expect(res.status).toBe(409);
        expect(res.headers['retry-after']).toBe('1');
        expect(await TransactionModel.countDocuments()).toBe(0);
    });

    it('cubre los cinco endpoints (también memberships)', async () => {
        const w = await seedWorld();
        const { MembershipPlanModel } = await import('../src/models/membershipPlan.model');
        const plan = await MembershipPlanModel.create({
            businessId: w.business._id, name: 'Plan', description: 'd', benefit: 'Café', durationDays: 30, price: 1,
        });
        const k = key();
        const activate = () => request(app).post('/memberships/activate').set('Authorization', w.bizAuth)
            .set('Idempotency-Key', k).send({ userId: w.user.id, planId: plan.id });

        const first = await activate();
        const retry = await activate();
        expect(first.status).toBe(201);
        // sin llave sería 409 "ya tiene una membresía activa"; con la misma llave es el 201 original
        expect(retry.status).toBe(201);
        expect(retry.headers['idempotent-replayed']).toBe('true');
        expect(retry.body).toEqual(first.body);

        const scopes = (await IdempotencyKeyModel.find().lean()).map((d) => d.scope);
        expect(scopes).toEqual([`${w.business.id}:POST:/memberships/activate`]);
    });
});

describe('infraestructura', () => {
    it('CORS permite el header y expone Idempotent-Replayed / Retry-After', async () => {
        const res = await request(app)
            .options('/user-points/add')
            .set('Origin', 'http://localhost:5173')
            .set('Access-Control-Request-Method', 'POST')
            .set('Access-Control-Request-Headers', 'idempotency-key,authorization,content-type');
        expect(res.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/);

        const w = await seedWorld();
        const real = await request(app).post('/user-points/add').set('Origin', 'http://localhost:5173')
            .set('Authorization', w.bizAuth).send({ userId: w.user.id, purchaseAmount: 100 });
        expect(real.headers['access-control-expose-headers']).toMatch(/Idempotent-Replayed/);
        expect(real.headers['access-control-expose-headers']).toMatch(/Retry-After/);
    });

    it('índice único (scope, key) y TTL de 24 h', async () => {
        const indexes = await IdempotencyKeyModel.collection.indexes();
        expect(indexes.find((i) => i.key.scope === 1 && i.key.key === 1)?.unique).toBe(true);
        expect(indexes.find((i) => i.key.createdAt === 1)?.expireAfterSeconds).toBe(24 * 3600);
    });
});
