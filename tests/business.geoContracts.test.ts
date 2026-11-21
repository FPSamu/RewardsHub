/**
 * Contratos del mapa de negocios: GET /business/nearby, /in-bounds y /all.
 *
 * Se escribieron ANTES de pasar las consultas a 2dsphere (P2.2) y fijan lo que
 * los clientes reciben hoy: qué filas, en qué orden, con qué llaves. Corren en
 * los dos modos (GEO_QUERY_MODE legacy | geo): ambos deben responder lo mismo.
 */
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { BusinessModel } from '../src/models/business.model';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

let mongod: MongoMemoryServer;

// Centro de Guadalajara, el mismo fallback que usan los clientes.
const CENTER = { lat: 20.6597, lng: -103.3496 };
const KM_PER_DEG_LAT = (6371 * Math.PI) / 180;
/** Punto a `km` al norte del centro (distancia haversine exacta sobre el meridiano). */
const north = (km: number) => ({ lat: CENTER.lat + km / KM_PER_DEG_LAT, lng: CENTER.lng });

type Branch = { name: string; lat: number; lng: number };
const seed = (username: string, branches: Branch[], extra: Record<string, unknown> = {}) =>
    BusinessModel.create({
        username,
        email: `${username}@test.com`,
        passHash: 'hash-secreto',
        isVerified: true,
        status: 'active',
        locations: branches.map((b, i) => ({
            name: b.name, address: `Calle ${username} ${i}`, latitude: b.lat, longitude: b.lng, isMain: i === 0,
        })),
        ...extra,
    });

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'geo-contracts-test' });
    await BusinessModel.init();

    await seed('alfa', [
        { name: 'Centro', lat: 20.6600, lng: -103.3500 },
        { name: 'Norte', ...north(4.5) },
        { name: 'Lejos', ...north(26) },
    ]);
    await seed('borde', [
        { name: 'Dentro', ...north(9.9) },
        { name: 'Fuera', ...north(10.1) },
    ]);
    await seed('esquina', [{ name: 'Esquina', lat: 20.8, lng: -103.3 }]); // justo en la esquina del recuadro
    await seed('cdmx', [{ name: 'Reforma', lat: 19.4326, lng: -99.1332 }]);
    await seed('madrid', [{ name: 'Sol', lat: 40.4168, lng: -3.7038 }]); // > 5000 km
    await seed('sinverificar', [{ name: 'X', lat: 20.66, lng: -103.35 }], { isVerified: false });
    await seed('inactivo', [{ name: 'Y', lat: 20.66, lng: -103.35 }], { status: 'inactive' });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

const label = (r: any) => `${r.username}/${r.branchName}`;
const sortedLabels = (rows: any[]) => rows.map(label).sort();

const ROW_KEYS = ['branchId', 'branchName', 'distance', 'id', 'location', 'username'];
const LOCATION_KEYS = ['_id', 'address', 'isMain', 'latitude', 'longitude', 'name'];

describe('GEO_QUERY_MODE=geo usa de verdad el índice 2dsphere', () => {
    beforeEach(() => { process.env.GEO_QUERY_MODE = 'geo'; });
    afterEach(() => { delete process.env.GEO_QUERY_MODE; jest.restoreAllMocks(); });

    it('/nearby y /all consultan con $geoNear; /in-bounds con $geoWithin', async () => {
        const aggregate = jest.spyOn(BusinessModel, 'aggregate');
        const find = jest.spyOn(BusinessModel, 'find');

        await request(app).get('/business/nearby').query({ latitude: CENTER.lat, longitude: CENTER.lng });
        await request(app).get('/business/all').query({ latitude: CENTER.lat, longitude: CENTER.lng });
        expect(aggregate).toHaveBeenCalledTimes(2);
        for (const [pipeline] of aggregate.mock.calls) expect((pipeline as any[])[0].$geoNear).toBeDefined();
        // /all acota a los 200 negocios más cercanos
        expect((aggregate.mock.calls[1][0] as any[])[1]).toEqual({ $limit: 200 });

        await request(app).get('/business/in-bounds').query({ minLat: 20.6, maxLat: 20.8, minLng: -103.4, maxLng: -103.3 });
        expect((find.mock.calls.at(-1) as any[])[0]).toHaveProperty(['locations.geo', '$geoWithin']);
    });

    it('limit toma solo los N negocios más cercanos', async () => {
        const { findNearbyBusinesses } = await import('../src/services/business.service');
        const rows = await findNearbyBusinesses(CENTER.lat, CENTER.lng, 5000, 2);
        expect([...new Set(rows.map((r) => r.username))].sort()).toEqual(['alfa', 'borde']);
    });

    it('recuadros que el polígono no representa bien van por la consulta legacy', async () => {
        const find = jest.spyOn(BusinessModel, 'find');
        for (const box of [
            { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 },   // mundo / ≥ 180° de ancho
            { minLat: -10, maxLat: 10, minLng: 170, maxLng: -170 },  // antimeridiano
            { minLat: 80, maxLat: 89, minLng: 0, maxLng: 10 },       // cerca del polo
        ]) {
            await request(app).get('/business/in-bounds').query(box);
            expect((find.mock.calls.at(-1) as any[])[0]).toHaveProperty('locations.$elemMatch');
        }
    });
});

describe.each(['legacy', 'geo'])('GEO_QUERY_MODE=%s', (mode) => {
    beforeEach(() => {
        process.env.GEO_QUERY_MODE = mode;
    });
    afterAll(() => {
        delete process.env.GEO_QUERY_MODE;
    });

    describe('GET /business/nearby', () => {
        it('una fila por sucursal dentro del radio, de cerca a lejos, con la forma de siempre', async () => {
            const res = await request(app).get('/business/nearby')
                .query({ latitude: CENTER.lat, longitude: CENTER.lng, maxDistanceKm: 10 });

            expect(res.status).toBe(200);
            expect(res.body.center).toEqual({ latitude: CENTER.lat, longitude: CENTER.lng });
            expect(res.body.maxDistanceKm).toBe(10);
            expect(res.body.businesses.map(label)).toEqual(['alfa/Centro', 'alfa/Norte', 'borde/Dentro']);
            expect(res.body.count).toBe(3);
            for (const row of res.body.businesses) {
                expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
                expect(Object.keys(row.location).sort()).toEqual(LOCATION_KEYS);
                expect(row.branchId).toBe(row.location._id);
            }
            const distances = res.body.businesses.map((r: any) => r.distance);
            expect(distances).toEqual([...distances].sort((a, b) => a - b));
        });

        it('el borde del radio se decide con la misma distancia haversine (9.9 km sí, 10.1 km no)', async () => {
            const res = await request(app).get('/business/nearby')
                .query({ latitude: CENTER.lat, longitude: CENTER.lng, maxDistanceKm: 10 });
            const borde = res.body.businesses.filter((r: any) => r.username === 'borde');
            expect(borde.map((r: any) => r.branchName)).toEqual(['Dentro']);
            expect(borde[0].distance).toBeCloseTo(9.9, 6);
        });

        it('radio por defecto 10 km y validación de siempre', async () => {
            const res = await request(app).get('/business/nearby').query({ latitude: CENTER.lat, longitude: CENTER.lng });
            expect(res.body.maxDistanceKm).toBe(10);
            expect((await request(app).get('/business/nearby')).body)
                .toEqual({ message: 'latitude and longitude are required' });
            expect((await request(app).get('/business/nearby').query({ latitude: 'x', longitude: 1 })).body)
                .toEqual({ message: 'invalid coordinates or distance' });
        });
    });

    describe('GET /business/in-bounds', () => {
        const BOX = { minLat: 20.6, maxLat: 20.8, minLng: -103.4, maxLng: -103.3 };

        it('las sucursales dentro del recuadro (bordes inclusivos), con la forma de siempre', async () => {
            const res = await request(app).get('/business/in-bounds').query(BOX);

            expect(res.status).toBe(200);
            expect(res.body.bounds).toEqual(BOX);
            expect(sortedLabels(res.body.businesses))
                .toEqual(['alfa/Centro', 'alfa/Norte', 'borde/Dentro', 'borde/Fuera', 'esquina/Esquina']);
            expect(res.body.count).toBe(5);
            for (const row of res.body.businesses) {
                expect(Object.keys(row).sort()).toEqual(['branchId', 'branchName', 'id', 'location', 'username']);
                expect(Object.keys(row.location).sort()).toEqual(['address', 'latitude', 'longitude']);
            }
        });

        it('un recuadro que cruza el antimeridiano (minLng > maxLng) no devuelve nada, como hoy', async () => {
            const res = await request(app).get('/business/in-bounds')
                .query({ minLat: -10, maxLat: 10, minLng: 170, maxLng: -170 });
            expect(res.status).toBe(200);
            expect(res.body.businesses).toEqual([]);
        });

        it('un recuadro del mundo entero trae todo lo visible', async () => {
            const res = await request(app).get('/business/in-bounds')
                .query({ minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 });
            expect(res.body.count).toBe(8);
        });

        it('validación de siempre', async () => {
            expect((await request(app).get('/business/in-bounds').query({ minLat: 1 })).body)
                .toEqual({ message: 'minLat, maxLat, minLng, and maxLng are required' });
            expect((await request(app).get('/business/in-bounds').query({ ...BOX, minLat: 'x' })).body)
                .toEqual({ message: 'invalid bounds coordinates' });
        });
    });

    describe('GET /business/all', () => {
        it('con coordenadas: cada sucursal a menos de 5000 km, de cerca a lejos', async () => {
            const res = await request(app).get('/business/all').query({ latitude: CENTER.lat, longitude: CENTER.lng });

            expect(res.status).toBe(200);
            expect(res.body.userLocation).toEqual({ latitude: CENTER.lat, longitude: CENTER.lng });
            expect(res.body.businesses.map(label)).toEqual([
                'alfa/Centro', 'alfa/Norte', 'borde/Dentro', 'borde/Fuera', 'esquina/Esquina', 'alfa/Lejos', 'cdmx/Reforma',
            ]);
            for (const row of res.body.businesses) {
                expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
                expect(Object.keys(row.location).sort()).toEqual(LOCATION_KEYS);
            }
        });

        it('sin coordenadas: negocios visibles con la forma pública, respetando limit', async () => {
            const res = await request(app).get('/business/all');
            expect(res.body.userLocation).toBeNull();
            expect(res.body.businesses.map((b: any) => b.username).sort())
                .toEqual(['alfa', 'borde', 'cdmx', 'esquina', 'madrid']);
            for (const b of res.body.businesses) {
                expect(Object.keys(b).sort()).toEqual([
                    'createdAt', 'email', 'hasBranchPassword', 'id', 'isVerified', 'locations', 'mainLocation',
                    'registeredWithGoogle', 'status', 'timezone', 'username',
                ]);
                for (const loc of b.locations) expect(Object.keys(loc).sort()).toEqual(LOCATION_KEYS);
            }

            const limited = await request(app).get('/business/all').query({ limit: 2 });
            expect(limited.body.count).toBe(2);
        });
    });
});
