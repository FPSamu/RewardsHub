/**
 * P4.2 / P4.3 — caché del mapa en Redis (ioredis-mock).
 *
 * - X-Cache: BYPASS sin Redis, MISS → HIT con Redis.
 * - La respuesta con caché es IDÉNTICA a la de sin caché, también para
 *   coordenadas distintas que caen en la misma llave redondeada.
 * - Cualquier escritura relevante de un negocio invalida (sube la versión);
 *   rotar tokens de sesión no.
 * - Redis caído: 200 y X-Cache: BYPASS (falla abierta).
 * - En Redis no se guardan secretos.
 */
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { BusinessModel } from '../src/models/business.model';
import { setRedisClient } from '../src/cache/redis';
import { BIZMAP_VERSION_KEY } from '../src/cache/bizmapCache';
import * as businessService from '../src/services/business.service';
import * as authService from '../src/services/auth.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RedisMock = require('ioredis-mock');

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

let mongod: MongoMemoryServer;
let redis: any;
const CENTER = { lat: 20.6597, lng: -103.3496 };

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'cache-bizmap-test' });
    await BusinessModel.init();
}, 120_000);

afterAll(async () => {
    setRedisClient(null);
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    redis = new RedisMock();
    await redis.flushall();
    await BusinessModel.deleteMany({});
    await seed();
    enableCache();
});

afterEach(() => {
    jest.restoreAllMocks();
    disableCache();
});

const enableCache = () => {
    process.env.REDIS_URL = 'redis://mock:6379';
    setRedisClient(redis);
};
const disableCache = () => {
    delete process.env.REDIS_URL;
    setRedisClient(null);
};

let biz: any;
const seed = async () => {
    biz = await BusinessModel.create({
        username: 'cafe', email: `c-${new Types.ObjectId()}@test.com`, passHash: 'hash-secreto-dueno',
        branchPassHash: 'hash-secreto-sucursal', adminPinHash: 'hash-pin', refreshTokens: ['rt'],
        isVerified: true, status: 'active',
        locations: [
            { name: 'Centro', address: 'a', latitude: 20.66, longitude: -103.35, isMain: true },
            { name: 'Norte', address: 'b', latitude: 20.70, longitude: -103.35 },
        ],
    });
    await BusinessModel.create({
        username: 'lejano', email: `l-${new Types.ObjectId()}@test.com`, passHash: 'x', isVerified: true, status: 'active',
        locations: [{ name: 'CDMX', address: 'c', latitude: 19.43, longitude: -99.13, isMain: true }],
    });
};

const nearby = (q: Record<string, unknown>) => request(app).get('/business/nearby').query(q);
const inBounds = (q: Record<string, unknown>) => request(app).get('/business/in-bounds').query(q);
const all = (q: Record<string, unknown> = {}) => request(app).get('/business/all').query(q);

/** La misma petición sin caché, como referencia. */
const uncached = async (fn: () => Promise<request.Response>) => {
    disableCache();
    try { return await fn(); } finally { enableCache(); }
};

const version = async () => Number((await redis.get(BIZMAP_VERSION_KEY)) ?? 0);

describe('X-Cache', () => {
    it('sin REDIS_URL: BYPASS y la respuesta de siempre', async () => {
        disableCache();
        const res = await nearby({ latitude: CENTER.lat, longitude: CENTER.lng });
        expect(res.status).toBe(200);
        expect(res.headers['x-cache']).toBe('BYPASS');
        expect(res.body.count).toBe(2);
    });

    it.each([
        ['/nearby', () => nearby({ latitude: CENTER.lat, longitude: CENTER.lng, maxDistanceKm: 10 })],
        ['/in-bounds', () => inBounds({ minLat: 20.6, maxLat: 20.8, minLng: -103.4, maxLng: -103.3 })],
        ['/all con coordenadas', () => all({ latitude: CENTER.lat, longitude: CENTER.lng })],
        ['/all sin coordenadas', () => all({ limit: 10 })],
    ])('%s: MISS y luego HIT, con el mismo cuerpo que sin caché', async (_name, call) => {
        const reference = await uncached(call);
        const first = await call();
        const second = await call();
        expect(first.headers['x-cache']).toBe('MISS');
        expect(second.headers['x-cache']).toBe('HIT');
        expect(first.body).toEqual(reference.body);
        expect(second.body).toEqual(reference.body);
    });

    it('coordenadas a unos metros (misma llave redondeada): HIT, pero con SUS distancias exactas', async () => {
        await nearby({ latitude: 20.6597, longitude: -103.3496, maxDistanceKm: 10 });
        const jitter = () => nearby({ latitude: 20.65992, longitude: -103.34978, maxDistanceKm: 9.8 });
        const res = await jitter();
        expect(res.headers['x-cache']).toBe('HIT');
        expect(res.body).toEqual((await uncached(jitter)).body);
        expect(res.body.center).toEqual({ latitude: 20.65992, longitude: -103.34978 });
    });

    it('un recuadro casi igual reutiliza la entrada y respeta sus propios bordes', async () => {
        // los dos se redondean hacia afuera al mismo recuadro (20.6–20.7, -103.4–-103.3)
        await inBounds({ minLat: 20.6, maxLat: 20.6995, minLng: -103.4, maxLng: -103.3 });
        const narrower = () => inBounds({ minLat: 20.6001, maxLat: 20.6999, minLng: -103.3999, maxLng: -103.3001 });
        const res = await narrower();
        expect(res.headers['x-cache']).toBe('HIT');
        expect(res.body).toEqual((await uncached(narrower)).body);
        expect(res.body.businesses.map((b: any) => b.branchName)).toEqual(['Centro']); // Norte (20.70) queda fuera
    });
});

describe('invalidación por versión', () => {
    const call = () => nearby({ latitude: CENTER.lat, longitude: CENTER.lng, maxDistanceKm: 10 });

    it('editar una sucursal: la siguiente consulta es MISS y trae el cambio', async () => {
        await call();
        expect((await call()).headers['x-cache']).toBe('HIT');
        const auth = `Bearer ${authService.issueAccessToken(biz.id, 'business')}`;
        const norte = biz.locations[1]._id.toString();
        await request(app).put(`/business/locations/${norte}`).set('Authorization', auth).send({ name: 'Norte 2', latitude: 20.7, longitude: -103.35 });

        const after = await call();
        expect(after.headers['x-cache']).toBe('MISS');
        expect(after.body.businesses.map((b: any) => b.branchName)).toContain('Norte 2');
    });

    it.each([
        ['addBranch', () => businessService.addBranch(biz.id, 'd', 'Sur', 20.6, -103.35)],
        ['removeBranch', () => businessService.removeBranch(biz.id, biz.locations[1]._id.toString())],
        ['updateBusiness (status, como el webhook)', () => businessService.updateBusiness(biz.id, { status: 'inactive' })],
        ['updateBusiness (nombre)', () => businessService.updateBusiness(biz.id, { username: 'cafe 2' })],
        ['updateBusinessLogo', () => businessService.updateBusinessLogo(biz.id, 'https://x/logo.png')],
        ['deleteBusiness', () => businessService.deleteBusiness(biz.id)],
        ['verificar correo (save)', async () => {
            // negocio sin verificar (no sale en el mapa) que verifica su correo → aparece
            await BusinessModel.collection.updateOne({ _id: biz._id }, { $set: { verificationToken: 'tok', isVerified: false } });
            return businessService.verifyBusinessEmail('tok');
        }],
        ['crear negocio', () => BusinessModel.create({ username: 'nuevo', email: 'n@test.com', passHash: 'x' })],
    ])('%s sube la versión', async (_name, write) => {
        const before = await version();
        await write();
        expect(await version()).toBeGreaterThan(before);
    });

    it('rotar refresh tokens (cada login) NO invalida la caché', async () => {
        const before = await version();
        await authService.addRefreshToken(BusinessModel, biz.id, 'otro-token');
        await BusinessModel.updateOne({ _id: biz._id }, { $set: { adminPinHash: 'nuevo' } });
        expect(await version()).toBe(before);
    });
});

describe('falla abierta y sin secretos', () => {
    it('Redis que no responde: 200 con los mismos datos y X-Cache: BYPASS', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const broken = { get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), set: jest.fn().mockRejectedValue(new Error('x')),
            incr: jest.fn().mockRejectedValue(new Error('x')) };
        setRedisClient(broken as any);
        const reference = await uncached(() => nearby({ latitude: CENTER.lat, longitude: CENTER.lng }));
        setRedisClient(broken as any);

        const res = await nearby({ latitude: CENTER.lat, longitude: CENTER.lng });
        expect(res.status).toBe(200);
        expect(res.headers['x-cache']).toBe('BYPASS');
        expect(res.body).toEqual(reference.body);

        // las escrituras tampoco fallan por Redis
        await expect(businessService.updateBusiness(biz.id, { username: 'otro' })).resolves.toBeDefined();
    });

    it('lo guardado en Redis no contiene hashes ni tokens', async () => {
        await all({ limit: 10 });
        const keys = await redis.keys('bizmap:*');
        const payload = (await Promise.all(keys.filter((k: string) => k !== BIZMAP_VERSION_KEY).map((k: string) => redis.get(k)))).join('');
        expect(payload).toContain('cafe');
        for (const secret of ['hash-secreto-dueno', 'hash-secreto-sucursal', 'hash-pin', '"rt"']) {
            expect(payload).not.toContain(secret);
        }
        // y la respuesta sigue diciendo que tiene contraseña de sucursal
        const res = await all({ limit: 10 });
        expect(res.headers['x-cache']).toBe('HIT');
        expect(res.body.businesses.find((b: any) => b.username === 'cafe').hasBranchPassword).toBe(true);
    });

    it('las entradas expiran con CACHE_BIZMAP_TTL (120 s por defecto)', async () => {
        await nearby({ latitude: CENTER.lat, longitude: CENTER.lng });
        const [key] = (await redis.keys('bizmap:v*'));
        const ttl = await redis.ttl(key);
        expect(ttl).toBeGreaterThan(100);
        expect(ttl).toBeLessThanOrEqual(120);
    });
});
