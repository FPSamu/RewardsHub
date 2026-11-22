/**
 * Llena la base del lab con datos sintéticos. La lógica está en src/cli/seed.ts
 * (se compila a dist/cli: en el lab corre con ./lab.sh seed, dentro de la VPC).
 *
 *   DB_NAME=rewardshub_lab npm run seed:lab            # falla si ya hay datos del seed
 *   DB_NAME=rewardshub_lab npm run seed:lab -- --reset # vacía las colecciones y regenera
 *
 * Opciones: --businesses N  --users N  --transactions N  --days N  --seed N
 */
import dotenv from 'dotenv';
dotenv.config();

import { runCli } from '../src/cli/run';

export { parseArgs } from '../src/cli/seed';

if (require.main === module) {
    runCli(['seed', ...process.argv.slice(2)]).then((code) => process.exit(code));
}
