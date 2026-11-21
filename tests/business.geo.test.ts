/**
 * P2.1 — GeoJSON en las sucursales.
 *
 * - El hook mantiene locations[].geo igual a [longitude, latitude] en todas las
 *   escrituras (todas pasan por doc.save()).
 * - geo nunca sale en las respuestas.
 * - El backfill (scripts/migrate-locations-geo.ts) rellena lo viejo, es
 *   idempotente y se niega a escribir en una base que no es de lab sin --prod.
 */
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { BusinessModel } from '../src/models/business.model';
import * as businessService from '../src/services/business.service';
import * as authService from '../src/services/auth.service';
import { ProductionDbError } from '../src/db/safety';
import { migrateLocationsGeo } from '../scripts/migrate-locations-geo';

// stripe.service instancia el SDK al importarse y aborta sin STRIPE_SECRET_KEY.
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/services/geocoding.service', () => ({
    geocodeAddress: jest.fn(async () => ({ latitude: 19.4326, longitude: -99.1332, displayName: 'Ciudad de México' })),
}));

let mongod: MongoMemoryServer;

const connectTo = async (dbName: string) => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
    await mongoose.connect(mongod.getUri(), { dbName });
    await BusinessModel.init();
};

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectTo('business_geo_test');
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
    jest.restoreAllMocks();
    await BusinessModel.deleteMany({});
});

const geoOf = async (id: string) =>
    ((await BusinessModel.collection.findOne({ _id: new Types.ObjectId(id) }))!.locations as any[])
        .map((l) => ({ name: l.name, lat: l.latitude, lng: l.longitude, geo: l.geo }));

const create = () => BusinessModel.create({
    username: 'geo', email: `geo-${new Types.ObjectId()}@test.com`, passHash: 'x', isVerified: true, status: 'active',
    locations: [{ name: 'Centro', address: 'Calle 1', latitude: 20.66, longitude: -103.35, isMain: true }],
});

describe('hook de geo', () => {
    it('create guarda geo = [lng, lat]', async () => {
        const biz = await create();
        expect(await geoOf(biz.id)).toEqual([
            { name: 'Centro', lat: 20.66, lng: -103.35, geo: { type: 'Point', coordinates: [-103.35, 20.66] } },
        ]);
    });

    it('addBranch, updateBranch (coordenadas y dirección geocodificada) y removeBranch mantienen geo', async () => {
        const biz = await create();

        await businessService.addBranch(biz.id, 'Calle 2', 'Norte', 20.7, -103.4);
        let rows = await geoOf(biz.id);
        expect(rows.map((r) => r.geo.coordinates)).toEqual([[-103.35, 20.66], [-103.4, 20.7]]);

        const norteId = (await BusinessModel.findById(biz.id))!.locations![1]._id.toString();
        await businessService.updateBranch(biz.id, norteId, { latitude: 21, longitude: -103 });
        rows = await geoOf(biz.id);
        expect(rows[1].geo.coordinates).toEqual([-103, 21]);

        await businessService.updateBranch(biz.id, norteId, { address: 'Reforma 1, CDMX' }); // geocoding mockeado
        rows = await geoOf(biz.id);
        expect(rows[1]).toMatchObject({ lat: 19.4326, lng: -99.1332, geo: { type: 'Point', coordinates: [-99.1332, 19.4326] } });

        const centroId = (await BusinessModel.findById(biz.id))!.locations![0]._id.toString();
        await businessService.removeBranch(biz.id, centroId);
        rows = await geoOf(biz.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].geo.coordinates).toEqual([-99.1332, 19.4326]);
    });

    it('cualquier save rellena sucursales viejas sin geo', async () => {
        const biz = await create();
        await BusinessModel.collection.updateOne({ _id: biz._id }, { $unset: { 'locations.0.geo': '' } });
        expect((await geoOf(biz.id))[0].geo).toBeUndefined();

        const doc = await BusinessModel.findById(biz.id);
        doc!.username = 'geo2';
        await doc!.save();
        expect((await geoOf(biz.id))[0].geo).toEqual({ type: 'Point', coordinates: [-103.35, 20.66] });
    });

    it('geo no sale en las respuestas (business/me, locations, nearby)', async () => {
        const biz = await create();
        const auth = `Bearer ${authService.issueAccessToken(biz.id, 'business')}`;

        const me = await request(app).get('/business/me').set('Authorization', auth);
        const added = await request(app).post('/business/locations').set('Authorization', auth)
            .send({ address: 'Calle 2', name: 'Norte', latitude: 20.7, longitude: -103.4 });
        const nearby = await request(app).get('/business/nearby').query({ latitude: 20.66, longitude: -103.35 });

        for (const body of [me.body, added.body, nearby.body]) {
            expect(JSON.stringify(body)).not.toMatch(/"geo":/);
        }
        expect(added.body.locations).toHaveLength(2);
    });

    it('existe el índice 2dsphere (y sigue el de lat/lng para el modo legacy)', async () => {
        const indexes = await BusinessModel.collection.indexes();
        expect(indexes.find((i) => i.key['locations.geo'] === '2dsphere')).toBeDefined();
        expect(indexes.find((i) => i.key['locations.latitude'] === 1)).toBeDefined();
    });
});

describe('scripts/migrate-locations-geo', () => {
    /** Documentos "de antes": insertados sin pasar por el modelo, sin geo. */
    const seedLegacy = async () => {
        const ids = [new Types.ObjectId(), new Types.ObjectId()];
        await BusinessModel.collection.insertMany([
            { _id: ids[0], username: 'viejo', email: 'v@test.com', passHash: 'x', status: 'active', isVerified: true,
                locations: [
                    { _id: new Types.ObjectId(), name: 'A', address: 'a', latitude: 20.66, longitude: -103.35 },
                    { _id: new Types.ObjectId(), name: 'B', address: 'b', latitude: 20.7, longitude: -103.4,
                        geo: { type: 'Point', coordinates: [0, 0] } }, // geo desfasado
                ] },
            { _id: ids[1], username: 'nuevo', email: 'n@test.com', passHash: 'x', status: 'active', isVerified: true,
                locations: [{ _id: new Types.ObjectId(), name: 'C', address: 'c', latitude: 19.4, longitude: -99.1,
                    geo: { type: 'Point', coordinates: [-99.1, 19.4] } }] }, // ya bien
        ]);
        return ids;
    };

    it('dry run reporta sin escribir; --apply corrige; la segunda corrida no encuentra nada', async () => {
        const [viejo, nuevo] = await seedLegacy();
        const quiet = () => undefined;

        const dry = await migrateLocationsGeo({ log: quiet });
        expect(dry).toMatchObject({ businessesScanned: 2, businessesToFix: 1, locationsToFix: 2, applied: false });
        expect((await geoOf(viejo.toString()))[0].geo).toBeUndefined();

        const applied = await migrateLocationsGeo({ apply: true, log: quiet });
        expect(applied).toMatchObject({ businessesToFix: 1, locationsToFix: 2, applied: true });
        expect((await geoOf(viejo.toString())).map((r) => r.geo)).toEqual([
            { type: 'Point', coordinates: [-103.35, 20.66] },
            { type: 'Point', coordinates: [-103.4, 20.7] },
        ]);
        expect((await geoOf(nuevo.toString()))[0].geo).toEqual({ type: 'Point', coordinates: [-99.1, 19.4] });

        const again = await migrateLocationsGeo({ apply: true, log: quiet });
        expect(again).toMatchObject({ businessesToFix: 0, locationsToFix: 0 });
    });

    it('sin --prod no escribe en una base que no es de lab/test; con --prod sí', async () => {
        await connectTo('rewardshub');
        try {
            await seedLegacy();
            await expect(migrateLocationsGeo({ apply: true, log: () => undefined })).rejects.toThrow(ProductionDbError);
            // el dry run (solo lectura) sí se permite
            await expect(migrateLocationsGeo({ log: () => undefined })).resolves.toMatchObject({ locationsToFix: 2 });

            const forced = await migrateLocationsGeo({ apply: true, prod: true, log: () => undefined });
            expect(forced.locationsToFix).toBe(2);
            await BusinessModel.deleteMany({});
        } finally {
            await connectTo('business_geo_test');
        }
    });
});
