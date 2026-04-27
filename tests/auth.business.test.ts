import request from 'supertest';
import app from '../src/app';
import { BusinessModel } from '../src/models/business.model';
import { UserModel } from '../src/models/user.model';
import { connectTestDb, disconnectTestDb } from './helpers/db';

jest.mock('../src/services/email.service');

const BIZ_EMAIL = `test-biz-${Date.now()}@test.com`;
const BIZ_USERNAME = 'testbusiness';
const PASSWORD = 'Test1234!';

// User account used for cross-role isolation tests
const USER_EMAIL = `test-user-iso-${Date.now()}@test.com`;

let bizAccessToken: string;
let bizRefreshToken: string;
let userAccessToken: string;

beforeAll(async () => {
    await connectTestDb();

    // Pre-crear un usuario para los tests de aislamiento
    const res = await request(app)
        .post('/auth/register')
        .send({ username: 'isouser', email: USER_EMAIL, password: PASSWORD });
    userAccessToken = res.body.token;
});

afterAll(async () => {
    await BusinessModel.deleteOne({ email: BIZ_EMAIL });
    await UserModel.deleteOne({ email: USER_EMAIL });
    await disconnectTestDb();
});

describe('Business — register', () => {
    it('crea cuenta y devuelve tokens', async () => {
        const res = await request(app)
            .post('/business/register')
            .send({ username: BIZ_USERNAME, email: BIZ_EMAIL, password: PASSWORD });

        expect(res.status).toBe(201);
        expect(res.body.business.email).toBe(BIZ_EMAIL);
        expect(res.body.business.username).toBe(BIZ_USERNAME);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        bizAccessToken = res.body.token;
        bizRefreshToken = res.body.refreshToken;
    });

    it('rechaza email duplicado', async () => {
        const res = await request(app)
            .post('/business/register')
            .send({ username: BIZ_USERNAME, email: BIZ_EMAIL, password: PASSWORD });

        expect(res.status).toBe(409);
    });

    it('rechaza campos faltantes', async () => {
        const res = await request(app)
            .post('/business/register')
            .send({ email: BIZ_EMAIL });

        expect(res.status).toBe(400);
    });
});

describe('Business — login', () => {
    it('devuelve tokens con role: business en el JWT', async () => {
        const res = await request(app)
            .post('/business/login')
            .send({ email: BIZ_EMAIL, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.user.email).toBe(BIZ_EMAIL);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
        expect(payload.role).toBe('business');

        bizAccessToken = res.body.token;
        bizRefreshToken = res.body.refreshToken;
    });

    it('rechaza contraseña incorrecta', async () => {
        const res = await request(app)
            .post('/business/login')
            .send({ email: BIZ_EMAIL, password: 'wrongpassword' });

        expect(res.status).toBe(401);
    });
});

describe('Business — /business/me', () => {
    it('devuelve datos del negocio autenticado', async () => {
        const res = await request(app)
            .get('/business/me')
            .set('Authorization', `Bearer ${bizAccessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(BIZ_EMAIL);
        expect(res.body.username).toBe(BIZ_USERNAME);
    });

    it('rechaza sin token', async () => {
        const res = await request(app).get('/business/me');
        expect(res.status).toBe(401);
    });
});

describe('Business — refresh', () => {
    it('devuelve nuevo par de tokens', async () => {
        const res = await request(app)
            .post('/business/refresh')
            .send({ refreshToken: bizRefreshToken });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        bizAccessToken = res.body.token;
        bizRefreshToken = res.body.refreshToken;
    });

    it('rechaza refresh token inválido', async () => {
        const res = await request(app)
            .post('/business/refresh')
            .send({ refreshToken: 'garbage.token.here' });

        expect(res.status).toBe(401);
    });
});

describe('Business — logout', () => {
    it('revoca el refresh token', async () => {
        const res = await request(app)
            .post('/business/logout')
            .send({ refreshToken: bizRefreshToken });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('no puede refrescar después de logout', async () => {
        const res = await request(app)
            .post('/business/refresh')
            .send({ refreshToken: bizRefreshToken });

        expect(res.status).toBe(401);
    });
});

describe('Login unificado (/auth/login)', () => {
    it('encuentra un negocio desde el endpoint de usuario', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ email: BIZ_EMAIL, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.role).toBe('business');
        expect(res.body.user.email).toBe(BIZ_EMAIL);

        const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
        expect(payload.role).toBe('business');
    });

    it('email de negocio no se puede registrar como usuario', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ username: 'cualquiera', email: BIZ_EMAIL, password: PASSWORD });

        expect(res.status).toBe(409);
    });

    it('email de usuario no se puede registrar como negocio', async () => {
        const res = await request(app)
            .post('/business/register')
            .send({ username: 'cualquiera', email: USER_EMAIL, password: PASSWORD });

        expect(res.status).toBe(409);
    });
});

describe('Aislamiento de roles', () => {
    // Necesitamos un token de negocio válido — hacer login de nuevo
    beforeAll(async () => {
        const res = await request(app)
            .post('/business/login')
            .send({ email: BIZ_EMAIL, password: PASSWORD });
        bizAccessToken = res.body.token;
        bizRefreshToken = res.body.refreshToken;
    });

    it('token de usuario no accede a /business/me', async () => {
        const res = await request(app)
            .get('/business/me')
            .set('Authorization', `Bearer ${userAccessToken}`);

        expect(res.status).toBe(401);
    });

    it('refresh token de negocio es rechazado en /auth/refresh', async () => {
        const res = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: bizRefreshToken });

        expect(res.status).toBe(401);
    });

    it('refresh token de usuario es rechazado en /business/refresh', async () => {
        // Primero obtener un refresh token de usuario fresco
        const loginRes = await request(app)
            .post('/auth/login')
            .send({ email: USER_EMAIL, password: PASSWORD });
        const userRefreshToken = loginRes.body.refreshToken;

        const res = await request(app)
            .post('/business/refresh')
            .send({ refreshToken: userRefreshToken });

        expect(res.status).toBe(401);
    });
});
