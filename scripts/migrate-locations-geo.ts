/**
 * Backfill de locations[].geo. La lógica está en src/cli/migrateLocationsGeo.ts;
 * en el lab: ./lab.sh run migrate-locations-geo [--apply].
 *
 *   DB_NAME=rewardshub_lab npx ts-node scripts/migrate-locations-geo.ts            # dry run (default)
 *   DB_NAME=rewardshub_lab npx ts-node scripts/migrate-locations-geo.ts --apply
 *   npx ts-node scripts/migrate-locations-geo.ts --prod [--apply]                  # producción, lo corre una persona
 */
import dotenv from 'dotenv';
dotenv.config();

import { runCli } from '../src/cli/run';

export { migrateLocationsGeo, MigrateResult } from '../src/cli/migrateLocationsGeo';

if (require.main === module) {
    runCli(['migrate-locations-geo', ...process.argv.slice(2)], { allowProd: true }).then((code) => process.exit(code));
}
