/**
 * P0.4 — Las respuestas a clientes no filtran secretos.
 *
 * - Respuestas con datos de negocio (/business/all, /business/locations…) sin
 *   hashes ni tokens.
 * - POST /business/admin-pin/generate solo con ADMIN_SECRET.
 * - GET /auth/:id solo para el propio usuario o un negocio del que es cliente.
 */
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { BusinessModel } from '../src/models/business.model';
import { UserModel } from '../src/models/user.model';
import { UserPointsModel } from '../src/models/userPoints.model';
import { TransactionModel } from '../src/models/transaction.model';
import * as authService from '../src/services/auth.service';
import { getBusinessesByCategory } from '../src/controllers/business.controller';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/services/email.service');

const SECRET_KEYS = [
    'passHash', 'branchPassHash', 'adminPinHash', 'refreshTokens', 'rotatedRefreshTokens',
    'verificationToken', 'resetPasswordToken', 'resetPasswordExpires',
];

/** Busca llaves secretas en cualquier nivel del JSON. */
const findSecretKeys = (value: unknown, path = '$'): string[] => {
    if (Array.isArray(value)) return value.flatMap((v, i) => findSecretKeys(v, `${path}[${i}]`));
    if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
            ...(SECRET_KEYS.includes(k) ? [`${path}.${k}`] : []),
            ...findSecretKeys(v, `${path}.${k}`),
        ]);
    }
    return [];
};

let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'public-dto-test' });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

afterEach(async () => {
    await Promise.all([
        BusinessModel.deleteMany({}),
        UserModel.deleteMany({}),
        UserPointsModel.deleteMany({}),
        TransactionModel.deleteMany({}),
    ]);
    delete process.env.ADMIN_SECRET;
});

/** Negocio visible en el mapa y con todos los campos secretos poblados. */
const seedBusiness = async (username = 'secretos') =>
    BusinessModel.create({
        username,
        email: `${username}-${Date.now()}-${Math.random()}@test.com`,
        passHash: 'hash-del-dueno',
        branchPassHash: 'hash-de-sucursal',
        adminPinHash: 'hash-del-pin',
        refreshTokens: ['rt-1'],
        verificationToken: 'vt',
        resetPasswordToken: 'rpt',
        resetPasswordExpires: new Date(Date.now() + 60_000),
        isVerified: true,
        status: 'active',
        locations: [{ name: 'Centro', address: 'Calle 1', latitude: 20.66, longitude: -103.35, isMain: true }],
    });

const seedUser = async (username = 'cliente') =>
    UserModel.create({ username, email: `${username}-${Date.now()}-${Math.random()}@test.com`, passHash: 'x' });

const bearer = (id: string, role: 'user' | 'business') => `Bearer ${authService.issueAccessToken(id, role)}`;

describe('respuestas de negocio sin secretos', () => {
    it('GET /business/all (sin coordenadas)', async () => {
        await seedBusiness();
        const res = await request(app).get('/business/all');
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
        expect(res.body.businesses[0].username).toBe('secretos');
        expect(findSecretKeys(res.body)).toEqual([]);
    });

    it('POST /business/locations', async () => {
        const biz = await seedBusiness();
        const res = await request(app)
            .post('/business/locations')
            .set('Authorization', bearer(biz.id, 'business'))
            .send({ address: 'Calle 2', name: 'Norte', latitude: 20.7, longitude: -103.4 });
        expect(res.status).toBe(200);
        expect(res.body.locations).toHaveLength(2);
        expect(findSecretKeys(res.body)).toEqual([]);
    });

    it('PUT /business/locations/:locationId', async () => {
        const biz = await seedBusiness();
        const locationId = biz.locations![0]._id!.toString();
        const res = await request(app)
            .put(`/business/locations/${locationId}`)
            .set('Authorization', bearer(biz.id, 'business'))
            .send({ name: 'Centro 2', latitude: 20.67, longitude: -103.36 });
        expect(res.status).toBe(200);
        expect(res.body.locations[0].name).toBe('Centro 2');
        expect(findSecretKeys(res.body)).toEqual([]);
    });

    it('DELETE /business/locations/:locationId', async () => {
        const biz = await seedBusiness();
        const locationId = biz.locations![0]._id!.toString();
        const res = await request(app)
            .delete(`/business/locations/${locationId}`)
            .set('Authorization', bearer(biz.id, 'business'));
        expect(res.status).toBe(200);
        expect(res.body.locations).toEqual([]);
        expect(findSecretKeys(res.body)).toEqual([]);
    });

    it('getBusinessesByCategory (handler sin ruta montada)', async () => {
        await seedBusiness();
        const json = jest.fn();
        const res: any = { json, status: jest.fn().mockReturnThis() };
        await getBusinessesByCategory({ params: { category: 'food' } } as any, res);
        expect(json).toHaveBeenCalledTimes(1);
        // Serializar igual que res.json (las sucursales son subdocumentos de Mongoose)
        const body = JSON.parse(JSON.stringify(json.mock.calls[0][0]));
        expect(body.count).toBe(1);
        expect(findSecretKeys(body)).toEqual([]);
    });

    it('PUT /business/me conserva su forma (llave `name`)', async () => {
        // requireAdminPin exige x-admin-token: se firma igual que /admin-pin/verify.
        const biz = await seedBusiness();
        const adminToken = jwt.sign({ sub: biz.id, type: 'admin_pin' }, process.env.JWT_SECRET || 'secret', { expiresIn: '5m' });
        const res = await request(app)
            .put('/business/me')
            .set('Authorization', bearer(biz.id, 'business'))
            .set('x-admin-token', adminToken)
            .send({ name: 'Nuevo nombre' });
        expect(res.status).toBe(200);
        // logoUrl viene solo si existe (JSON omite undefined)
        expect(Object.keys(res.body).filter(k => k !== 'logoUrl').sort()).toEqual(
            ['createdAt', 'email', 'id', 'isVerified', 'locations', 'name', 'status', 'timezone'],
        );
        expect(res.body.name).toBe('Nuevo nombre');
        expect(findSecretKeys(res.body)).toEqual([]);
    });
});

describe('POST /business/admin-pin/generate — solo con ADMIN_SECRET', () => {
    it('403 cuando ADMIN_SECRET no está configurado', async () => {
        const biz = await seedBusiness();
        const res = await request(app).post('/business/admin-pin/generate').send({ businessId: biz.id });
        expect(res.status).toBe(403);
        const doc = await BusinessModel.findById(biz.id).lean();
        expect(doc!.adminPinHash).toBe('hash-del-pin');
    });

    it('403 con un secreto incorrecto', async () => {
        process.env.ADMIN_SECRET = 'correcto';
        const biz = await seedBusiness();
        const res = await request(app)
            .post('/business/admin-pin/generate')
            .set('x-admin-secret', 'incorrecto')
            .send({ businessId: biz.id });
        expect(res.status).toBe(403);
    });

    it('200 con el secreto correcto', async () => {
        process.env.ADMIN_SECRET = 'correcto';
        const biz = await seedBusiness();
        const res = await request(app)
            .post('/business/admin-pin/generate')
            .set('x-admin-secret', 'correcto')
            .send({ businessId: biz.id });
        expect(res.status).toBe(200);
        const doc = await BusinessModel.findById(biz.id).lean();
        expect(doc!.adminPinHash).not.toBe('hash-del-pin');
        expect(doc!.isAdminPinTemporary).toBe(true);
    });
});

describe('GET /auth/:id — acceso', () => {
    const SHAPE = ['createdAt', 'email', 'id', 'username'];

    it('401 sin token', async () => {
        const user = await seedUser();
        const res = await request(app).get(`/auth/${user.id}`);
        expect(res.status).toBe(401);
    });

    it('el propio usuario lo ve, con la misma forma de siempre', async () => {
        const user = await seedUser();
        const res = await request(app).get(`/auth/${user.id}`).set('Authorization', bearer(user.id, 'user'));
        expect(res.status).toBe(200);
        // profilePicture viene solo si existe (JSON omite undefined)
        expect(Object.keys(res.body).filter(k => k !== 'profilePicture').sort()).toEqual(SHAPE);
        expect(res.body.id).toBe(user.id);
        expect(findSecretKeys(res.body)).toEqual([]);
    });

    it('otro usuario recibe 404', async () => {
        const [a, b] = [await seedUser('a'), await seedUser('b')];
        const res = await request(app).get(`/auth/${a.id}`).set('Authorization', bearer(b.id, 'user'));
        expect(res.status).toBe(404);
    });

    it('un negocio con saldo del usuario lo ve', async () => {
        const [user, biz] = [await seedUser(), await seedBusiness()];
        await UserPointsModel.collection.insertOne({
            userId: user._id,
            businessPoints: [{ businessId: biz._id, points: 5, stamps: 0, lastVisit: new Date(), rewardSystems: [] }],
        });
        const res = await request(app).get(`/auth/${user.id}`).set('Authorization', bearer(biz.id, 'business'));
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('cliente');
    });

    it('un negocio con una transacción del usuario lo ve', async () => {
        const [user, biz] = [await seedUser(), await seedBusiness()];
        await TransactionModel.collection.insertOne({
            userId: user._id, businessId: biz._id, type: 'add', items: [], createdAt: new Date(),
        });
        const res = await request(app).get(`/auth/${user.id}`).set('Authorization', bearer(biz.id, 'business'));
        expect(res.status).toBe(200);
    });

    it('un negocio sin relación recibe 404', async () => {
        const [user, biz, other] = [await seedUser(), await seedBusiness('a'), await seedBusiness('b')];
        await UserPointsModel.collection.insertOne({
            userId: user._id,
            businessPoints: [{ businessId: other._id, points: 5, stamps: 0, lastVisit: new Date(), rewardSystems: [] }],
        });
        const res = await request(app).get(`/auth/${user.id}`).set('Authorization', bearer(biz.id, 'business'));
        expect(res.status).toBe(404);
    });

    it('id inválido o inexistente → 404', async () => {
        const user = await seedUser();
        const auth = bearer(user.id, 'user');
        expect((await request(app).get('/auth/no-es-un-id').set('Authorization', auth)).status).toBe(404);
        expect((await request(app).get(`/auth/${new Types.ObjectId()}`).set('Authorization', auth)).status).toBe(404);
    });
});
