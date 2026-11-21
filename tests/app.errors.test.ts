/**
 * P0.6 — 404 y errores siempre en JSON, conservando err.status.
 *
 * Antes, una ruta inexistente, un body JSON inválido o un next(err) caían en
 * el handler por defecto de Express y devolvían HTML.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { UserModel } from '../src/models/user.model';
import { RedemptionCodeModel } from '../src/models/redemptionCode.model';
import * as authService from '../src/services/auth.service';
import { errorHandler } from '../src/middleware/error.middleware';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'app-errors-test' });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('404', () => {
    it('una ruta inexistente responde JSON', async () => {
        const res = await request(app).get('/no-existe');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body).toEqual({ message: 'not found' });
    });

    it('/health sigue respondiendo', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });
});

describe('errores', () => {
    it('body JSON inválido → 400 JSON (conserva err.status de express.json)', async () => {
        const res = await request(app)
            .post('/auth/login')
            .set('Content-Type', 'application/json')
            .send('{"idToken": ');
        expect(res.status).toBe(400);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(typeof res.body.message).toBe('string');
    });

    it('next(err) de un controller → 500 JSON sin detalles internos', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const user = await UserModel.create({ username: 'u', email: `u-${Date.now()}@test.com`, passHash: 'x' });
        jest.spyOn(RedemptionCodeModel, 'findOne').mockImplementation(() => {
            throw new Error('detalle interno de mongo');
        });

        const res = await request(app)
            .post('/delivery/claim')
            .set('Authorization', `Bearer ${authService.issueAccessToken(user.id, 'user')}`)
            .send({ code: 'ABC123' });

        expect(res.status).toBe(500);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body).toEqual({ message: 'internal server error' });
    });

    it('CORS rechazado en producción → JSON (el status sigue siendo 500)', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const res = await request(app).get('/health').set('Origin', 'https://malicioso.example');
            expect(res.status).toBe(500);
            expect(res.headers['content-type']).toMatch(/application\/json/);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });
});

describe('errorHandler', () => {
    const run = (err: any, headersSent = false) => {
        const res: any = { headersSent, status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();
        errorHandler(err, {} as any, res, next);
        return { res, next };
    };

    it('conserva statusCode 4xx con su mensaje', () => {
        const { res } = run(Object.assign(new Error('demasiado grande'), { statusCode: 413 }));
        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json).toHaveBeenCalledWith({ message: 'demasiado grande' });
    });

    it('un status fuera de 400–599 se trata como 500', () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const { res } = run(Object.assign(new Error('x'), { status: 302 }));
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it('si ya se enviaron headers delega en Express', () => {
        const err = new Error('tarde');
        const { res, next } = run(err, true);
        expect(next).toHaveBeenCalledWith(err);
        expect(res.status).not.toHaveBeenCalled();
    });
});
