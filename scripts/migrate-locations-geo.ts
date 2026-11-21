/**
 * Backfill de `locations[].geo` (GeoJSON para el índice 2dsphere, P2.1).
 *
 * Las sucursales nuevas o editadas ya traen geo (hook del modelo); este script
 * rellena las que se guardaron antes. Idempotente: una segunda corrida no
 * encuentra nada que cambiar.
 *
 *   DB_NAME=rewardshub_lab npx ts-node scripts/migrate-locations-geo.ts            # dry run (default)
 *   DB_NAME=rewardshub_lab npx ts-node scripts/migrate-locations-geo.ts --apply
 *
 * Producción (lo corre una persona, DESPUÉS de desplegar el código en Render):
 *   npx ts-node scripts/migrate-locations-geo.ts --prod            # dry run
 *   npx ts-node scripts/migrate-locations-geo.ts --prod --apply
 * Sin --prod se niega a escribir en una base que no sea de lab/test.
 * Recién cuando termine, poner GEO_QUERY_MODE=geo en Render.
 *
 * Cada sucursal se actualiza con un arrayFilter por su _id, así que una
 * edición concurrente de otra sucursal del mismo negocio no se pisa.
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { buildConnectOptions } from '../src/db/mongoose';
import { assertNonProductionDb } from '../src/db/safety';
import { BusinessModel } from '../src/models/business.model';

export interface MigrateResult {
    businessesScanned: number;
    businessesToFix: number;
    locationsToFix: number;
    applied: boolean;
    sample: Array<{ businessId: string; locationId: string; coordinates: [number, number] }>;
}

const needsFix = (loc: any) =>
    typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number' && (
        loc.geo?.type !== 'Point' ||
        !Array.isArray(loc.geo?.coordinates) ||
        loc.geo.coordinates[0] !== loc.longitude ||
        loc.geo.coordinates[1] !== loc.latitude
    );

export const migrateLocationsGeo = async (
    { apply = false, prod = false, log = console.log }: { apply?: boolean; prod?: boolean; log?: (msg: string) => void } = {}
): Promise<MigrateResult> => {
    // Escribir exige base de lab/test, salvo --prod explícito (lo decide una persona)
    if (apply && !prod) assertNonProductionDb();
    const result: MigrateResult = { businessesScanned: 0, businessesToFix: 0, locationsToFix: 0, applied: apply, sample: [] };

    // Lectura directa de la colección: sin hooks ni casting, se ve lo que hay guardado
    const cursor = BusinessModel.collection.find(
        { 'locations.0': { $exists: true } },
        { projection: { locations: 1 } }
    );

    for await (const doc of cursor) {
        result.businessesScanned++;
        const pending = (doc.locations as any[]).filter(needsFix);
        if (pending.length === 0) continue;

        result.businessesToFix++;
        result.locationsToFix += pending.length;
        for (const loc of pending) {
            if (result.sample.length < 10) {
                result.sample.push({ businessId: String(doc._id), locationId: String(loc._id), coordinates: [loc.longitude, loc.latitude] });
            }
        }

        if (!apply) continue;

        const $set: Record<string, unknown> = {};
        const arrayFilters: Record<string, unknown>[] = [];
        pending.forEach((loc, i) => {
            $set[`locations.$[l${i}].geo`] = { type: 'Point', coordinates: [loc.longitude, loc.latitude] };
            // Además del _id, la lat/lng leída: si alguien movió la sucursal mientras tanto, no se pisa
            arrayFilters.push({ [`l${i}._id`]: loc._id, [`l${i}.latitude`]: loc.latitude, [`l${i}.longitude`]: loc.longitude });
        });
        await BusinessModel.collection.updateOne({ _id: doc._id }, { $set }, { arrayFilters });
    }

    log(`${apply ? '✅ Aplicado' : '🔎 Dry run'}: ${result.businessesScanned} negocios revisados, ` +
        `${result.businessesToFix} con ${result.locationsToFix} sucursales sin geo`);
    return result;
};

const main = async () => {
    const apply = process.argv.includes('--apply');
    const prod = process.argv.includes('--prod');
    const unknown = process.argv.slice(2).filter((a) => !['--apply', '--prod', '--dry-run'].includes(a));
    if (unknown.length) throw new Error(`Opción desconocida: ${unknown.join(' ')}`);

    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI no está configurada');

    // autoIndex: false → el script no construye índices; solo hace lo que dice
    await mongoose.connect(uri, { ...buildConnectOptions(), autoIndex: false });
    try {
        const dbName = mongoose.connection.db?.databaseName;
        if (apply && prod) console.warn(`⚠️  --prod: se escribirá en "${dbName}"`);
        console.log(`Base "${dbName}" · ${apply ? 'APLICAR' : 'dry run (usa --apply para escribir)'}`);

        const result = await migrateLocationsGeo({ apply, prod });
        if (result.sample.length) console.table(result.sample);
    } finally {
        await mongoose.disconnect();
    }
};

if (require.main === module) {
    main().catch((err) => {
        console.error('❌ migrate-locations-geo falló:', err?.message ?? err);
        process.exit(1);
    });
}
