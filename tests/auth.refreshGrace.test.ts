/**
 * Periodo de gracia en la rotación de refresh tokens.
 *
 * Regresión: dos pestañas del mismo negocio que descubren el access token
 * expirado a la vez hacían refresh en paralelo. La primera rotaba el token y la
 * segunda llegaba con uno ya inexistente → 401 → logout forzado.
 *
 * Arranca su propio MongoDB en memoria: no depende de TEST_MONGO_URI ni toca
 * Firebase (el endpoint /auth/refresh no lo usa).
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { UserModel } from '../src/models/user.model';
import * as authService from '../src/services/auth.service';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
// Llega aquí de rebote vía app.ts → subscription.routes; este test no lo usa.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'refresh-grace-test' });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

afterEach(async () => {
    await UserModel.deleteMany({});
});

/** Crea un usuario con una sesión activa y devuelve su id + refresh token. */
const seedSession = async () => {
    const user = await UserModel.create({
        username: 'race',
        email: `race-${Date.now()}-${Math.random()}@test.com`,
        passHash: 'x',
    });
    const id = user._id.toString();
    const { refreshToken } = authService.issueTokenPair(id, 'user');
    await authService.addRefreshToken(UserModel, id, refreshToken);
    return { id, refreshToken };
};

const postRefresh = (refreshToken: string) =>
    request(app).post('/auth/refresh').send({ refreshToken });

describe('POST /auth/refresh — rotación', () => {
    it('rota el refresh token y deja solo el nuevo activo', async () => {
        const { id, refreshToken } = await seedSession();

        const res = await postRefresh(refreshToken);

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.refreshToken).toBeDefined();
        expect(res.body.refreshToken).not.toBe(refreshToken);

        const doc = await UserModel.findById(id).lean();
        expect(doc!.refreshTokens).toEqual([res.body.refreshToken]);
        expect(doc!.rotatedRefreshTokens).toHaveLength(1);
        expect(doc!.rotatedRefreshTokens![0].token).toBe(refreshToken);
        expect(doc!.rotatedRefreshTokens![0].replacedBy).toBe(res.body.refreshToken);
    });

    it('rechaza un refresh token con firma inválida', async () => {
        const res = await postRefresh('garbage.token.here');
        expect(res.status).toBe(401);
    });
});

describe('POST /auth/refresh — periodo de gracia', () => {
    it('acepta un token ya rotado y devuelve el mismo reemplazo', async () => {
        const { refreshToken } = await seedSession();

        // Pestaña A rota el token
        const first = await postRefresh(refreshToken);
        expect(first.status).toBe(200);

        // Pestaña B llega con el token viejo, un instante después
        const second = await postRefresh(refreshToken);

        expect(second.status).toBe(200);
        // Ambas pestañas convergen al mismo refresh token — no divergen
        expect(second.body.refreshToken).toBe(first.body.refreshToken);
        expect(second.body.token).toBeDefined();
    });

    it('deja a las dos pestañas con un token que sigue sirviendo', async () => {
        const { refreshToken } = await seedSession();

        const a = await postRefresh(refreshToken);
        const b = await postRefresh(refreshToken);

        // El token que recibió la pestaña B se puede canjear de nuevo
        const next = await postRefresh(b.body.refreshToken);
        expect(next.status).toBe(200);
        expect(a.body.refreshToken).toBe(b.body.refreshToken);
    });

    it('sigue la cadena cuando hubo dos rotaciones seguidas', async () => {
        const { refreshToken } = await seedSession();

        const t2 = await postRefresh(refreshToken);       // T1 → T2
        const t3 = await postRefresh(t2.body.refreshToken); // T2 → T3

        // Una pestaña rezagada llega con T1: debe recibir T3, el activo
        const late = await postRefresh(refreshToken);
        expect(late.status).toBe(200);
        expect(late.body.refreshToken).toBe(t3.body.refreshToken);
    });

    it('sobrevive a dos refrescos disparados en paralelo', async () => {
        const { refreshToken } = await seedSession();

        // El caso real: dos pestañas descubren el access token expirado a la vez
        // y salen las dos con el mismo refresh token, sin orden garantizado.
        const [a, b] = await Promise.all([
            postRefresh(refreshToken),
            postRefresh(refreshToken),
        ]);

        expect(a.status).toBe(200);
        expect(b.status).toBe(200);

        // Y lo que reciben sigue sirviendo — ninguna se queda con un token muerto
        const [nextA, nextB] = await Promise.all([
            postRefresh(a.body.refreshToken),
            postRefresh(b.body.refreshToken),
        ]);
        expect(nextA.status).toBe(200);
        expect(nextB.status).toBe(200);
    });

    it('rechaza el token viejo una vez pasada la ventana', async () => {
        const { id, refreshToken } = await seedSession();

        await postRefresh(refreshToken);

        // Envejecer la anotación de rotación más allá de la ventana (30 s)
        await UserModel.updateOne(
            { _id: id },
            { $set: { 'rotatedRefreshTokens.0.rotatedAt': new Date(Date.now() - 60_000) } }
        );

        const res = await postRefresh(refreshToken);
        expect(res.status).toBe(401);
    });

    it('no resucita una sesión cerrada con logout', async () => {
        const { refreshToken } = await seedSession();

        const rotated = await postRefresh(refreshToken);
        await request(app).post('/auth/logout').send({ refreshToken: rotated.body.refreshToken });

        // El token viejo sigue dentro de la ventana, pero su reemplazo ya no está activo
        const res = await postRefresh(refreshToken);
        expect(res.status).toBe(401);
    });
});
