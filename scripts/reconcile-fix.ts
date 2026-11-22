/**
 * Corrige saldos según una corrida de conciliación. La lógica está en
 * src/cli/reconcileFix.ts; en el lab: ./lab.sh run reconcile-fix --run <runKey> [--apply].
 *
 *   DB_NAME=rewardshub_lab npx ts-node scripts/reconcile-fix.ts --run <runKey>           # dry run (default)
 *   DB_NAME=rewardshub_lab npx ts-node scripts/reconcile-fix.ts --run <runKey> --apply
 */
import dotenv from 'dotenv';
dotenv.config();

import { runCli } from '../src/cli/run';

export { reconcileFix, FixOutcome, FixResult } from '../src/cli/reconcileFix';

if (require.main === module) {
    runCli(['reconcile-fix', ...process.argv.slice(2)]).then((code) => process.exit(code));
}
