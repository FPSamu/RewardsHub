/**
 * P2.2 — legacy y geo devuelven exactamente lo mismo.
 *
 * Con los negocios del seed del lab (≈100 sucursales en Guadalajara y CDMX),
 * se comparan cientos de consultas aleatorias (semilla fija) en los dos modos.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { BusinessModel } from '../src/models/business.model';
import { findNearbyBusinesses, findBusinessesInBounds } from '../src/services/business.service';
import { generateLabDataset } from '../src/db/seed/labDataset';

let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'geo-equivalence-test' });
    await BusinessModel.init();
    const { businesses } = generateLabDataset({ seed: 11, businesses: 50, users: 1, transactions: 1 });
    await BusinessModel.collection.insertMany(businesses);
}, 120_000);

afterAll(async () => {
    delete process.env.GEO_QUERY_MODE;
    await mongoose.disconnect();
    await mongod.stop();
});

// PRNG determinista para que un fallo se pueda reproducir
let state = 12345;
const rand = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const between = (a: number, b: number) => a + rand() * (b - a);

const inMode = async <T>(mode: 'legacy' | 'geo', fn: () => Promise<T>) => {
    process.env.GEO_QUERY_MODE = mode;
    return fn();
};

/** Lo que importa del resultado, serializado como lo recibe el cliente. */
const view = (rows: any[]) => JSON.parse(JSON.stringify(rows));
const byBranch = (rows: any[]) => [...rows].sort((a, b) => String(a.branchId).localeCompare(String(b.branchId)));

const CITIES = [{ lat: 20.6597, lng: -103.3496 }, { lat: 19.4326, lng: -99.1332 }];

it('findNearbyBusinesses: 200 consultas aleatorias dan el mismo resultado (mismo orden)', async () => {
    for (let i = 0; i < 200; i++) {
        const c = CITIES[i % 2];
        const lat = c.lat + between(-0.15, 0.15);
        const lng = c.lng + between(-0.15, 0.15);
        const km = [0.5, 1, 2, 3, 5, 8, 10, 15, 25, 50, 300, 600][i % 12];

        const legacy = view(await inMode('legacy', () => findNearbyBusinesses(lat, lng, km)));
        const geo = view(await inMode('geo', () => findNearbyBusinesses(lat, lng, km)));
        expect({ i, lat, lng, km, rows: geo }).toEqual({ i, lat, lng, km, rows: legacy });
    }
});

it('findBusinessesInBounds: 200 recuadros aleatorios dan las mismas sucursales', async () => {
    for (let i = 0; i < 200; i++) {
        const c = CITIES[i % 2];
        const h = between(0.005, 0.4);
        const w = between(0.005, 0.6);
        const minLat = c.lat + between(-0.2, 0.2);
        const minLng = c.lng + between(-0.3, 0.3);
        const box = [minLat, minLat + h, minLng, minLng + w] as const;

        const legacy = byBranch(view(await inMode('legacy', () => findBusinessesInBounds(...box))));
        const geo = byBranch(view(await inMode('geo', () => findBusinessesInBounds(...box))));
        expect({ i, box, rows: geo }).toEqual({ i, box, rows: legacy });
    }
});

it('incluye casos con resultados (la comparación no es trivialmente vacía)', async () => {
    process.env.GEO_QUERY_MODE = 'geo';
    expect((await findNearbyBusinesses(CITIES[0].lat, CITIES[0].lng, 10)).length).toBeGreaterThan(5);
    expect((await findBusinessesInBounds(20.6, 20.75, -103.42, -103.28)).length).toBeGreaterThan(5);
});
