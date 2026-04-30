import request from 'supertest';
import app from '../src/app';
import { UserModel } from '../src/models/user.model';
import { connectTestDb, disconnectTestDb } from './helpers/db';

jest.mock('../src/services/email.service');

const EMAIL = `test-user-${Date.now()}@test.com`;
const PASSWORD = 'Test1234!';
const USERNAME = 'testuser';

let accessToken: string;
let refreshToken: string;

beforeAll(async () => {
    await connectTestDb();
});

afterAll(async () => {
    await UserModel.deleteOne({ email: EMAIL });
    await disconnectTestDb();
});

describe('User — register', () => {
    it('crea cuenta y devuelve tokens', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ username: USERNAME, email: EMAIL, password: PASSWORD });

        expect(res.status).toBe(201);
        expect(res.body.user.email).toBe(EMAIL);
        expect(res.body.user.username).toBe(USERNAME);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        accessToken = res.body.token;
        refreshToken = res.body.refreshToken;
    });

    it('rechaza email duplicado', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ username: USERNAME, email: EMAIL, password: PASSWORD });

        expect(res.status).toBe(409);
    });

    it('rechaza campos faltantes', async () => {
        const res = await request(app)
            .post('/auth/register')
            .send({ email: EMAIL });

        expect(res.status).toBe(400);
    });
});

describe('User — login', () => {
    it('devuelve role: user y tokens desde el login unificado', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ email: EMAIL, password: PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.role).toBe('user');
        expect(res.body.user.email).toBe(EMAIL);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
        expect(payload.role).toBe('user');

        accessToken = res.body.token;
        refreshToken = res.body.refreshToken;
    });

    it('rechaza contraseña incorrecta', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ email: EMAIL, password: 'wrongpassword' });

        expect(res.status).toBe(401);
    });

    it('rechaza email inexistente', async () => {
        const res = await request(app)
            .post('/auth/login')
            .send({ email: 'noexiste@test.com', password: PASSWORD });

        expect(res.status).toBe(401);
    });
});

describe('User — /auth/me', () => {
    it('devuelve datos del usuario autenticado', async () => {
        const res = await request(app)
            .get('/auth/me')
            .set('Authorization', `Bearer ${accessToken}`);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(EMAIL);
        expect(res.body.username).toBe(USERNAME);
    });

    it('rechaza sin token', async () => {
        const res = await request(app).get('/auth/me');
        expect(res.status).toBe(401);
    });

    it('rechaza token malformado', async () => {
        const res = await request(app)
            .get('/auth/me')
            .set('Authorization', 'Bearer token.invalido.aqui');

        expect(res.status).toBe(401);
    });
});

describe('User — refresh', () => {
    it('devuelve nuevo par de tokens', async () => {
        const res = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();

        // Actualizar tokens rotados
        accessToken = res.body.token;
        refreshToken = res.body.refreshToken;
    });

    it('rechaza refresh token inválido', async () => {
        const res = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken: 'garbage.token.here' });

        expect(res.status).toBe(401);
    });
});

describe('User — logout', () => {
    it('revoca el refresh token', async () => {
        const res = await request(app)
            .post('/auth/logout')
            .send({ refreshToken });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    it('no puede refrescar después de logout', async () => {
        const res = await request(app)
            .post('/auth/refresh')
            .send({ refreshToken });

        expect(res.status).toBe(401);
    });
});
