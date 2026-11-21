/**
 * Auth de usuarios: registro y login con idToken de Firebase, /auth/me,
 * refresh y logout.
 *
 * Arranca su propio MongoDB en memoria (ya no depende de TEST_MONGO_URI) y
 * usa un Firebase falso: el idToken lleva el uid y el email.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { UserModel } from '../src/models/user.model';
import { fakeIdToken } from './helpers/fakeFirebase';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/services/firebase.service', () => require('./helpers/fakeFirebase').firebaseMock);
jest.mock('../src/services/email.service');

const EMAIL = 'test-user@test.com';
const USERNAME = 'testuser';
const ID_TOKEN = fakeIdToken('uid-user-1', EMAIL);

let mongod: MongoMemoryServer;
let accessToken: string;
let refreshToken: string;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'auth-user-test' });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

const decodeRole = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;

// Los describe comparten estado en orden: registro → login → me → refresh → logout.

describe('User — register', () => {
    it('crea cuenta y devuelve tokens', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: ID_TOKEN, role: 'user', username: USERNAME });

        expect(res.status).toBe(201);
        expect(res.body.role).toBe('user');
        expect(res.body.user.email).toBe(EMAIL);
        expect(res.body.user.username).toBe(USERNAME);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
        expect(await UserModel.countDocuments({ email: EMAIL })).toBe(1);
    });

    it('rechaza email duplicado', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: ID_TOKEN, role: 'user', username: USERNAME });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('EMAIL_TAKEN');
    });

    it('rechaza sin idToken', async () => {
        const res = await request(app).post('/auth/register').send({ role: 'user' });
        expect(res.status).toBe(400);
    });

    it('rechaza un rol desconocido', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: fakeIdToken('uid-x', 'x@test.com'), role: 'admin' });
        expect(res.status).toBe(400);
    });

    it('rechaza un idToken inválido', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ idToken: 'garbage', role: 'user' });
        expect(res.status).toBe(401);
    });
});

describe('User — login', () => {
    it('devuelve role: user y tokens desde el login unificado', async () => {
        const res = await request(app).post('/auth/login').send({ idToken: ID_TOKEN });

        expect(res.status).toBe(200);
        expect(res.body.role).toBe('user');
        expect(res.body.user.email).toBe(EMAIL);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
        expect(decodeRole(res.body.token)).toBe('user');

        accessToken = res.body.token;
        refreshToken = res.body.refreshToken;
    });

    it('rechaza un idToken inválido', async () => {
        const res = await request(app).post('/auth/login').send({ idToken: 'garbage' });
        expect(res.status).toBe(401);
    });

    it('409 si Firebase conoce el email pero Mongo no', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ idToken: fakeIdToken('uid-ghost', 'noexiste@test.com') });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('ACCOUNT_INCONSISTENCY');
    });
});

describe('User — /auth/me', () => {
    it('devuelve datos del usuario autenticado', async () => {
        const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(EMAIL);
        expect(res.body.username).toBe(USERNAME);
    });

    it('rechaza sin token', async () => {
        const res = await request(app).get('/auth/me');
        expect(res.status).toBe(401);
    });

    it('rechaza token malformado', async () => {
        const res = await request(app).get('/auth/me').set('Authorization', 'Bearer token.invalido.aqui');
        expect(res.status).toBe(401);
    });
});

describe('User — refresh', () => {
    it('devuelve nuevo par de tokens', async () => {
        const res = await request(app).post('/auth/refresh').send({ refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
        expect(decodeRole(res.body.token)).toBe('user');

        refreshToken = res.body.refreshToken;
    });

    it('rechaza refresh token inválido', async () => {
        const res = await request(app).post('/auth/refresh').send({ refreshToken: 'garbage.token.here' });
        expect(res.status).toBe(401);
    });
});

describe('User — logout', () => {
    it('revoca el refresh token', async () => {
        const res = await request(app).post('/auth/logout').send({ refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('no puede refrescar después de logout', async () => {
        const res = await request(app).post('/auth/refresh').send({ refreshToken });
        expect(res.status).toBe(401);
    });
});
