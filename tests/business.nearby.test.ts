/**
 * GET /business/nearby — una entrada por sucursal.
 *
 * Contrato que los clientes consumen: un negocio con varias sucursales dentro
 * del radio devuelve una fila por cada una, todas con el mismo `id` de negocio
 * y distinto `branchId`.
 *
 * Web y movil deduplicaban por `id`, lo que colapsaba esas filas en la mas
 * cercana y escondia el resto de sucursales. El backend siempre fue correcto;
 * este test fija ese comportamiento para que no se "arregle" por el lado malo.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { BusinessModel } from '../src/models/business.model';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
// Llega aqui de rebote via app.ts → subscription.routes; este test no lo usa.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

let mongod: MongoMemoryServer;

// Centro de Guadalajara, el mismo fallback que usan los clientes.
const CENTER = { lat: 20.6597, lng: -103.3496 };

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'nearby-test' });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

afterEach(async () => {
    await BusinessModel.deleteMany({});
});

/** Un negocio visible en el mapa: verificado y activo. */
const seedBusiness = async (
    username: string,
    locations: Array<{ name: string; lat: number; lng: number }>
) =>
    BusinessModel.create({
        username,
        email: `${username}-${Date.now()}@test.com`,
        passHash: 'x',
        isVerified: true,
        status: 'active',
        locations: locations.map((l, i) => ({
            name: l.name,
            address: `Calle ${i}`,
            latitude: l.lat,
            longitude: l.lng,
            isMain: i === 0,
        })),
    });

const getNearby = (maxDistanceKm = 50) =>
    request(app)
        .get('/business/nearby')
        .query({ latitude: CENTER.lat, longitude: CENTER.lng, maxDistanceKm });

describe('GET /business/nearby', () => {
    it('devuelve una entrada por cada sucursal dentro del radio', async () => {
        await seedBusiness('Cafe Tres', [
            { name: 'Centro', lat: 20.6597, lng: -103.3496 },
            { name: 'Chapalita', lat: 20.6668, lng: -103.3918 },
            { name: 'Providencia', lat: 20.7000, lng: -103.3800 },
        ]);

        const res = await getNearby();

        expect(res.status).toBe(200);
        expect(res.body.businesses).toHaveLength(3);
        expect(res.body.count).toBe(3);

        // Mismo negocio en las tres, pero cada sucursal con identidad propia
        const ids = new Set(res.body.businesses.map((b: any) => b.id));
        const branchIds = new Set(res.body.businesses.map((b: any) => b.branchId));
        expect(ids.size).toBe(1);
        expect(branchIds.size).toBe(3);

        expect(res.body.businesses.map((b: any) => b.branchName).sort())
            .toEqual(['Centro', 'Chapalita', 'Providencia']);
    });

    it('cada sucursal trae su propia distancia, ordenadas de cerca a lejos', async () => {
        await seedBusiness('Cafe Tres', [
            { name: 'Lejos', lat: 20.7400, lng: -103.4200 },
            { name: 'Encima', lat: 20.6597, lng: -103.3496 },
            { name: 'Media', lat: 20.6800, lng: -103.3700 },
        ]);

        const res = await getNearby();

        const distances = res.body.businesses.map((b: any) => b.distance);
        expect(distances).toHaveLength(3);
        expect([...distances].sort((a: number, b: number) => a - b)).toEqual(distances);
        expect(new Set(distances).size).toBe(3);
        expect(res.body.businesses[0].branchName).toBe('Encima');
    });

    it('mezcla sucursales de varios negocios', async () => {
        await seedBusiness('Cafe Tres', [
            { name: 'Centro', lat: 20.6597, lng: -103.3496 },
            { name: 'Chapalita', lat: 20.6668, lng: -103.3918 },
        ]);
        await seedBusiness('Panaderia Uno', [
            { name: 'Unica', lat: 20.6700, lng: -103.3500 },
        ]);

        const res = await getNearby();

        expect(res.body.businesses).toHaveLength(3);
        expect(new Set(res.body.businesses.map((b: any) => b.id)).size).toBe(2);
    });

    it('deja fuera las sucursales que caen fuera del radio', async () => {
        await seedBusiness('Cafe Tres', [
            { name: 'Cerca', lat: 20.6597, lng: -103.3496 },
            // Ciudad de Mexico, ~460 km de Guadalajara
            { name: 'Otra ciudad', lat: 19.4326, lng: -99.1332 },
        ]);

        const res = await getNearby(50);

        expect(res.body.businesses).toHaveLength(1);
        expect(res.body.businesses[0].branchName).toBe('Cerca');
    });

    it('ignora negocios sin verificar o inactivos', async () => {
        const visible = await seedBusiness('Visible', [
            { name: 'Centro', lat: 20.6597, lng: -103.3496 },
        ]);
        const hidden = await seedBusiness('Oculto', [
            { name: 'Centro', lat: 20.6597, lng: -103.3496 },
        ]);
        await BusinessModel.updateOne({ _id: hidden._id }, { $set: { status: 'inactive' } });

        const res = await getNearby();

        expect(res.body.businesses).toHaveLength(1);
        expect(res.body.businesses[0].id).toBe(visible._id.toString());
    });
});
