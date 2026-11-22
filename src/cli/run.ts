/**
 * Punto de entrada compilado (dist/cli/run.js) de los scripts de mantenimiento.
 *
 * En el lab MongoDB vive dentro de la VPC (infra/aws/mongo.tf) y no se alcanza
 * desde tu máquina, así que estos scripts corren en una instancia de la API:
 *
 *   ./lab.sh seed [--reset]                      → rh-cli seed …
 *   ./lab.sh run <script> [args]                 → rh-cli <script> …
 *
 * rh-cli (user_data.sh.tftpl) usa el mismo usuario y entorno que el servicio
 * (/etc/rewardshub.env: MONGO_URI del lab, DB_NAME=rewardshub_lab, TZ, DDB_*).
 * Cada script conserva sus candados (assertNonProductionDb). --prod se rechaza
 * siempre en dist/cli/run.js: el lab nunca escribe en producción. Solo el
 * wrapper local scripts/migrate-locations-geo.ts lo permite (lo corre una persona).
 *
 * Local, los scripts siguen corriendo como siempre con `npx ts-node scripts/…`.
 */
import dotenv from 'dotenv';
dotenv.config();

import { ProductionDbError } from '../db/safety';
import { SeedAlreadyPresentError } from '../db/seed/writeLabDataset';

type CliMain = (argv: string[]) => Promise<number>;

/** Carga perezosa: cada script importa sus modelos solo si se va a usar. */
export const SCRIPTS: Record<string, () => Promise<CliMain>> = {
    'seed': async () => (await import('./seed')).main,
    'compare-stats-sources': async () => (await import('./compareStatsSources')).main,
    'migrate-locations-geo': async () => (await import('./migrateLocationsGeo')).main,
    'find-duplicate-memberships': async () => (await import('./findDuplicateMemberships')).main,
    'reconcile-fix': async () => (await import('./reconcileFix')).main,
};

export const USAGE = `Uso: rh-cli <script> [args]\nScripts: ${Object.keys(SCRIPTS).join(', ')}`;

export class CliUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CliUsageError';
    }
}

/** Valida y separa `<script> [args]`. */
export const parseCommand = (argv: string[], { allowProd = false }: { allowProd?: boolean } = {}): { script: string; args: string[] } => {
    const [script, ...args] = argv;
    if (!script || script === '--help' || script === '-h') throw new CliUsageError(USAGE);
    if (!Object.prototype.hasOwnProperty.call(SCRIPTS, script)) {
        throw new CliUsageError(`Script desconocido: ${script}\n${USAGE}`);
    }
    if (args.includes('--prod') && !allowProd) {
        throw new CliUsageError('--prod no se permite desde el lab: estos scripts solo tocan la base del lab.');
    }
    return { script, args };
};

/** Corre el script y devuelve el código de salida (nunca lanza). */
export const runCli = async (
    argv: string[],
    { log = console.log, error = console.error, allowProd = false }:
        { log?: (m: string) => void; error?: (m: string) => void; allowProd?: boolean } = {}
): Promise<number> => {
    let script = 'rh-cli';
    try {
        const parsed = parseCommand(argv, { allowProd });
        script = parsed.script;
        log(`▶️  ${script} ${parsed.args.join(' ')}`.trimEnd());
        const main = await SCRIPTS[script]();
        return await main(parsed.args);
    } catch (err: any) {
        if (err instanceof CliUsageError) {
            error(err.message);
            return 2;
        }
        if (err instanceof ProductionDbError || err instanceof SeedAlreadyPresentError) {
            error(`⛔ ${err.message}`);
        } else {
            error(`❌ ${script} falló: ${err?.message ?? err}`);
        }
        return 1;
    }
};

if (require.main === module) {
    runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
