/**
 * P4.4 — rate limits compartidos (ioredis-mock).
 *
 * - Sin RATE_LIMITS=on no hacen nada (Render y local como siempre).
 * - Dos instancias de la API (como detrás del ALB):
 *     sin Redis → cada una cuenta por su lado (el límite real es ×2);
 *     con un Redis compartido → el límite es global.
 * - Login: solo cuentan los intentos fallidos.
 * - PIN de administrador: por negocio. Reportes: por negocio.
 * - Redis caído: sigue limitando por instancia y la API responde.
 */
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Express } from 'express';
import { fakeIdToken } from './helpers/fakeFirebase';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RedisMock = require('ioredis-mock');

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/services/firebase.service', () => require('./helpers/fakeFirebase').firebaseMock);
jest.mock('../src/services/email.service');

/** Una "instancia" de la API: su propio app y sus propios módulos (stores en memoria incluidos). */
interface Instance { app: Express; setRedisClient: (c: any) => void }
const newInstance = (): Instance => {
    let inst!: Instance;
    jest.isolateModules(() => {
        inst = { app: require('../src/app').default, setRedisClient: require('../src/cache/redis').setRedisClient };
    });
    return inst;
};

const badLogin = (app: Express) => request(app).post('/auth/login').send({ idToken: 'garbage' });

afterEach(() => {
    delete process.env.RATE_LIMITS;
    delete process.env.REDIS_URL;
    jest.restoreAllMocks();
});

describe('dos instancias, login (sin base de datos)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('sin RATE_LIMITS=on no hay límite', async () => {
        const a = newInstance();
        for (let i = 0; i < 15; i++) expect((await badLogin(a.app)).status).toBe(401);
    });

    it('sin Redis (antes): 20 intentos repartidos entre 2 instancias pasan todos (10 + 10)', async () => {
        process.env.RATE_LIMITS = 'on';
        const [a, b] = [newInstance(), newInstance()];
        const statuses: number[] = [];
        for (let i = 0; i < 20; i++) statuses.push((await badLogin(i % 2 ? b.app : a.app)).status);
        expect(statuses.every((s) => s === 401)).toBe(true);
        expect((await badLogin(a.app)).status).toBe(429); // cada una ya llegó a 10
    });

    it('con un Redis compartido: el intento 11 recibe 429, sin importar la instancia', async () => {
        process.env.RATE_LIMITS = 'on';
        process.env.REDIS_URL = 'redis://mock:6379';
        const redis = new RedisMock();
        await redis.flushall();
        const [a, b] = [newInstance(), newInstance()];
        a.setRedisClient(redis);
        b.setRedisClient(redis);

        const statuses: number[] = [];
        for (let i = 0; i < 20; i++) statuses.push((await badLogin(i % 2 ? b.app : a.app)).status);
        expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
        expect(statuses.slice(10).every((s) => s === 429)).toBe(true);

        const limited = await badLogin(a.app);
        expect(limited.body).toEqual({ message: 'too many requests, please try again later' });
        expect(limited.headers['ratelimit']).toBeDefined();
        expect(limited.headers['ratelimit-policy']).toMatch(/10;w=900/);
        expect(await redis.pttl((await redis.keys('rl:login:*'))[0])).toBeGreaterThan(14 * 60_000);
    });

    it('Redis caído: cuenta por instancia y la API sigue respondiendo', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        process.env.RATE_LIMITS = 'on';
        process.env.REDIS_URL = 'redis://mock:6379';
        const a = newInstance();
        const broken = { multi: () => { throw new Error('ECONNREFUSED'); }, decr: jest.fn().mockRejectedValue(new Error('x')) };
        a.setRedisClient(broken);

        for (let i = 0; i < 10; i++) expect((await badLogin(a.app)).status).toBe(401);
        expect((await badLogin(a.app)).status).toBe(429);
    });
});

describe('con base de datos', () => {
    let mongod: MongoMemoryServer;
    let app: Express;
    let setRedisClient: (c: any) => void;
    let redis: any;
    let BusinessModel: any;
    let authService: any;

    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        await mongoose.connect(mongod.getUri(), { dbName: 'rate-limit-test' });
        app = require('../src/app').default;
        setRedisClient = require('../src/cache/redis').setRedisClient;
        BusinessModel = require('../src/models/business.model').BusinessModel;
        authService = require('../src/services/auth.service');
    }, 120_000);

    afterAll(async () => {
        await mongoose.disconnect();
        await mongod.stop();
    });

    beforeEach(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        process.env.RATE_LIMITS = 'on';
        process.env.REDIS_URL = 'redis://mock:6379';
        redis = new RedisMock();
        await redis.flushall();
        setRedisClient(redis);
    });

    afterEach(() => setRedisClient(null));

    const business = async () => {
        const biz = await BusinessModel.create({
            username: 'b', email: `b-${new Types.ObjectId()}@test.com`, passHash: 'x', isVerified: true, status: 'active',
            adminPinHash: await require('bcryptjs').hash('123456', 4),
        });
        return { biz, auth: `Bearer ${authService.issueAccessToken(biz.id, 'business')}` };
    };

    it('un login correcto no gasta cupo (solo cuentan los fallidos)', async () => {
        await require('../src/models/user.model').UserModel.create({ username: 'u', email: 'ok@test.com', passHash: 'x' });
        for (let i = 0; i < 15; i++) {
            expect((await request(app).post('/auth/login').send({ idToken: fakeIdToken('uid', 'ok@test.com') })).status).toBe(200);
        }
        expect((await badLogin(app)).status).toBe(401);
    });

    it('PIN de administrador: 5 intentos fallidos por negocio; otro negocio no se ve afectado', async () => {
        const [a, b] = [await business(), await business()];
        const verify = (who: { auth: string }, pin: string) =>
            request(app).post('/business/admin-pin/verify').set('Authorization', who.auth).send({ pin });

        for (let i = 0; i < 5; i++) expect((await verify(a, '000000')).status).toBe(401);
        expect((await verify(a, '000000')).status).toBe(429);
        expect((await verify(a, '123456')).status).toBe(429); // ni el PIN correcto mientras dure la ventana
        expect((await verify(b, '123456')).status).toBe(200);
    });

    it('reportes: 10 por minuto por negocio', async () => {
        const { auth } = await business();
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) {
            statuses.push((await request(app).post('/report/preview').set('Authorization', auth).send({})).status);
        }
        expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
        expect(statuses[10]).toBe(429);
        // el mismo cupo aplica en la ruta montada bajo /business/reports
        expect((await request(app).post('/business/reports/preview').set('Authorization', auth).send({})).status).toBe(429);
    });

    it('recuperar contraseña: 10 / 15 min por IP (usuarios y negocios comparten el cupo)', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) statuses.push((await request(app).post('/auth/forgot-password').send({ email: 'x@test.com' })).status);
        for (let i = 0; i < 5; i++) statuses.push((await request(app).post('/business/forgot-password').send({ email: 'x@test.com' })).status);
        expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
        expect(statuses[10]).toBe(429);
    });
});
