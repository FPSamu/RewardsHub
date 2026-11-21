/**
 * Auth de negocios: el registro y el login son los mismos endpoints que los
 * de usuario (/auth/register con role 'business', /auth/login unificado);
 * refresh y logout también viven en /auth. Ya no existen /business/register,
 * /business/login ni /business/refresh.
 *
 * Arranca su propio MongoDB en memoria y usa un Firebase falso.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { BusinessModel } from '../src/models/business.model';
import { fakeIdToken } from './helpers/fakeFirebase';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/services/firebase.service', () => require('./helpers/fakeFirebase').firebaseMock);
jest.mock('../src/services/email.service');

const BIZ_EMAIL = 'test-biz@test.com';
const BIZ_USERNAME = 'testbusiness';
const BIZ_ID_TOKEN = fakeIdToken('uid-biz-1', BIZ_EMAIL);

// Usuario para los tests de aislamiento entre roles
const USER_EMAIL = 'test-user-iso@test.com';
const USER_ID_TOKEN = fakeIdToken('uid-user-iso', USER_EMAIL);

let mongod: MongoMemoryServer;
let bizAccessToken: string;
let bizRefreshToken: string;
let userAccessToken: string;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'auth-business-test' });

    const res = await request(app)
        .post('/auth/register')
        .send({ idToken: USER_ID_TOKEN, role: 'user', username: 'isouser' });
    userAccessToken = res.body.token;
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

const decodeRole = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;

// Los describe comparten estado en orden: registro → login → me → refresh → logout.

describe('Business — register', () => {
    it('crea cuenta y devuelve tokens con role: business', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: BIZ_ID_TOKEN, role: 'business', username: BIZ_USERNAME });

        expect(res.status).toBe(201);
        expect(res.body.role).toBe('business');
        expect(res.body.user.email).toBe(BIZ_EMAIL);
        expect(res.body.user.username).toBe(BIZ_USERNAME);
        expect(decodeRole(res.body.token)).toBe('business');
        expect(res.body.refreshToken).toBeDefined();

        const doc = await BusinessModel.findOne({ email: BIZ_EMAIL }).lean();
        expect(doc!.googleUid).toBe('uid-biz-1');
    });

    it('rechaza email duplicado', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: BIZ_ID_TOKEN, role: 'business', username: BIZ_USERNAME });
        expect(res.status).toBe(409);
    });
});

describe('Business — login', () => {
    it('el login unificado encuentra al negocio', async () => {
        const res = await request(app).post('/auth/login').send({ idToken: BIZ_ID_TOKEN });

        expect(res.status).toBe(200);
        expect(res.body.role).toBe('business');
        expect(res.body.user.email).toBe(BIZ_EMAIL);
        expect(decodeRole(res.body.token)).toBe('business');

        bizAccessToken = res.body.token;
        bizRefreshToken = res.body.refreshToken;
    });
});

describe('Business — /business/me', () => {
    it('devuelve datos del negocio autenticado', async () => {
        const res = await request(app).get('/business/me').set('Authorization', `Bearer ${bizAccessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(BIZ_EMAIL);
        expect(res.body.username).toBe(BIZ_USERNAME);
        expect(res.body.registeredWithGoogle).toBe(true);
        expect(res.body.passHash).toBeUndefined();
    });

    it('rechaza sin token', async () => {
        const res = await request(app).get('/business/me');
        expect(res.status).toBe(401);
    });
});

describe('Business — refresh y logout', () => {
    it('refresh conserva role: business', async () => {
        const res = await request(app).post('/auth/refresh').send({ refreshToken: bizRefreshToken });

        expect(res.status).toBe(200);
        expect(decodeRole(res.body.token)).toBe('business');
        bizRefreshToken = res.body.refreshToken;
    });

    it('logout revoca el refresh token', async () => {
        const res = await request(app).post('/auth/logout').send({ refreshToken: bizRefreshToken });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        const again = await request(app).post('/auth/refresh').send({ refreshToken: bizRefreshToken });
        expect(again.status).toBe(401);
    });
});

describe('Aislamiento de roles', () => {
    it('email de negocio no se puede registrar como usuario', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: fakeIdToken('uid-otro', BIZ_EMAIL), role: 'user', username: 'cualquiera' });
        expect(res.status).toBe(409);
    });

    it('email de usuario no se puede registrar como negocio', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: fakeIdToken('uid-otro-2', USER_EMAIL), role: 'business', username: 'cualquiera' });
        expect(res.status).toBe(409);
    });

    it('token de usuario no accede a /business/me', async () => {
        const res = await request(app).get('/business/me').set('Authorization', `Bearer ${userAccessToken}`);
        expect(res.status).toBe(401);
    });

    it('token de usuario no accede a rutas de negocio', async () => {
        const res = await request(app)
            .post('/user-points/add')
            .set('Authorization', `Bearer ${userAccessToken}`)
            .send({ userId: new mongoose.Types.ObjectId().toString(), purchaseAmount: 10 });
        expect(res.status).toBe(401);
    });
});
