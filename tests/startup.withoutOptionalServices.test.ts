/**
 * La API y el worker arrancan y funcionan SIN Stripe, Firebase, correo ni
 * llaves de S3 (el .env.lab mínimo). Cada servicio que falta deshabilita
 * solo su función, con una respuesta clara en vez de tumbar el proceso.
 *
 * Sin mocks de stripe ni de firebase: se cargan las librerías reales.
 */
import { OPTIONAL_ENV } from './helpers/noOptionalServices';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';

// La app llama dotenv.config() al importarse: sin esto, un .env local con
// Stripe/correo/S3 reales volvería a llenar las variables que borró el helper
// y el test pegaría contra esos servicios.
jest.mock('dotenv', () => {
    const config = () => ({ parsed: {} });
    return { __esModule: true, default: { config }, config };
});

let mongod: MongoMemoryServer;
let app: any;
let BusinessModel: any;
let UserModel: any;
let UserPointsModel: any;

beforeAll(async () => {
    for (const k of OPTIONAL_ENV) expect(process.env[k]).toBeUndefined();
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'startup-optional-test' });
    // Cargar la app aquí: si algún módulo lanzara al importarse, este test falla
    app = require('../src/app').default;
    BusinessModel = require('../src/models/business.model').BusinessModel;
    UserModel = require('../src/models/user.model').UserModel;
    UserPointsModel = require('../src/models/userPoints.model').UserPointsModel;
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const seedBusiness = async () => {
    const biz = await BusinessModel.create({
        username: 'Cafe Lab', email: `cafe-${Date.now()}@lab.test`, passHash: await bcrypt.hash('lab12345', 4),
        isVerified: true, status: 'active', adminPinHash: await bcrypt.hash('123456', 4),
        locations: [{ name: 'Matriz', address: 'a', latitude: 20.66, longitude: -103.35, isMain: true }],
    });
    return biz;
};

describe('arranque', () => {
    it('los módulos del worker cargan sin servicios opcionales', () => {
        jest.isolateModules(() => {
            for (const m of ['../src/services/notification.service', '../src/queue/sqs', '../src/jobs/dailyStats.job',
                '../src/jobs/reconcile.job', '../src/jobs/replicateDynamo.job', '../src/cache/redis',
                '../src/observability/metrics', '../src/queue/jobLock', '../src/queue/processor', '../src/queue/jobs']) {
                expect(() => require(m)).not.toThrow();
            }
        });
    });

    it('la API responde /health', async () => {
        expect((await request(app).get('/health')).body).toEqual({ status: 'ok' });
    });
});

describe('lo que SÍ funciona sin Firebase/correo/Stripe/S3', () => {
    it('login de cajero con contraseña de sucursal → token → rutas de negocio', async () => {
        const biz = await seedBusiness();
        const login = await request(app).post('/auth/cashier-login').send({ email: biz.email, password: 'lab12345' });
        expect(login.status).toBe(200);
        expect(login.body.role).toBe('business');

        const me = await request(app).get('/business/me').set('Authorization', `Bearer ${login.body.token}`);
        expect(me.status).toBe(200);

        const user = await UserModel.create({ username: 'cliente', email: `c-${Date.now()}@lab.test`, passHash: 'x' });
        const System = require('../src/models/system.model').SystemModel;
        await System.create({ businessId: biz._id, type: 'points', name: 'Puntos', pointsConversion: { amount: 10, points: 1, currency: 'MXN' } });
        const add = await request(app).post('/user-points/add').set('Authorization', `Bearer ${login.body.token}`)
            .send({ userId: user.id, purchaseAmount: 100 });
        expect(add.status).toBe(200);
        expect(add.body.userPoints.businessPoints[0].points).toBe(10);
    });

    it('el mapa y la lista de negocios', async () => {
        await seedBusiness();
        expect((await request(app).get('/business/nearby').query({ latitude: 20.66, longitude: -103.35 })).body.count).toBeGreaterThan(0);
        expect((await request(app).get('/business/all')).status).toBe(200);
    });

    it('el batch de avisos del worker termina sin enviar (sin correo ni push) y sin lanzar', async () => {
        const user = await UserModel.create({ username: 'u', email: `n-${Date.now()}@lab.test`, passHash: 'x', isVerified: true });
        await UserPointsModel.create({ userId: user._id, businessPoints: [] });
        const { runNotificationBatch } = require('../src/services/notification.service');
        await expect(runNotificationBatch()).resolves.toMatchObject({ sent: 0 });
    });
});

describe('lo que se deshabilita, con una respuesta clara', () => {
    it('Firebase: login/registro con idToken → 401; check-email → no existe', async () => {
        expect((await request(app).post('/auth/login').send({ idToken: 'x' })).status).toBe(401);
        expect((await request(app).post('/auth/register').send({ idToken: 'x', role: 'user' })).status).toBe(401);
        expect((await request(app).post('/auth/check-email').send({ email: 'a@b.c' })).body).toEqual({ exists: false });
    });

    it('Stripe: checkout responde error JSON (no se cae); el webhook responde 400', async () => {
        const biz = await seedBusiness();
        const token = require('../src/services/auth.service').issueAccessToken(biz.id, 'business');
        const checkout = await request(app).post('/subscription/checkout').set('Authorization', `Bearer ${token}`).send({ planType: 'monthly' });
        expect(checkout.status).toBeGreaterThanOrEqual(400);
        expect(checkout.headers['content-type']).toMatch(/json/);

        const hook = await request(app).post('/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', 't=1,v1=x').send('{}');
        expect(hook.status).toBe(400);
        expect(hook.text).toMatch(/Webhook Error/);
        expect((await request(app).get('/health')).status).toBe(200); // sigue vivo
    });

    it('Correo: reset del PIN → 503 y el PIN anterior sigue valiendo', async () => {
        const biz = await seedBusiness();
        const before = (await BusinessModel.findById(biz._id).lean()).adminPinHash;
        const token = require('../src/services/auth.service').issueAccessToken(biz.id, 'business');

        const res = await request(app).post('/business/admin-pin/reset').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(503);
        expect((await BusinessModel.findById(biz._id).lean()).adminPinHash).toBe(before);

        const verify = await request(app).post('/business/admin-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '123456' });
        expect(verify.status).toBe(200);
    });

    it('Correo: generar PIN (soporte, con ADMIN_SECRET) → 503 sin tocar el PIN', async () => {
        process.env.ADMIN_SECRET = 'soporte';
        try {
            const biz = await seedBusiness();
            const before = (await BusinessModel.findById(biz._id).lean()).adminPinHash;
            const res = await request(app).post('/business/admin-pin/generate').set('x-admin-secret', 'soporte').send({ businessId: biz.id });
            expect(res.status).toBe(503);
            expect((await BusinessModel.findById(biz._id).lean()).adminPinHash).toBe(before);
        } finally {
            delete process.env.ADMIN_SECRET;
        }
    });

    it('Correo: recuperar contraseña de una cuenta que existe → 500 "Failed to send email" (como cuando falla el SMTP)', async () => {
        const biz = await seedBusiness();
        const res = await request(app).post('/business/forgot-password').send({ email: biz.email });
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ message: 'Failed to send email' });
    });

    it('S3: subir logo → 500 "failed to upload logo"; el resto del negocio sigue igual', async () => {
        const biz = await seedBusiness();
        const token = require('../src/services/auth.service').issueAccessToken(biz.id, 'business');
        const adminToken = jwt.sign({ sub: biz.id, type: 'admin_pin' }, process.env.JWT_SECRET || 'secret', { expiresIn: '5m' });
        const res = await request(app).post('/business/logo').set('Authorization', `Bearer ${token}`).set('x-admin-token', adminToken)
            .attach('logo', Buffer.from('png'), 'logo.png');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ message: 'failed to upload logo' });
    });
});
