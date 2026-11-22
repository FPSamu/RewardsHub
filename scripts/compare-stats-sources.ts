/**
 * SOLO LECTURA. Compara live vs daily vs dynamo. La lógica está en
 * src/cli/compareStatsSources.ts; en el lab: ./lab.sh run compare-stats-sources.
 *
 *   DB_NAME=rewardshub_lab TZ=UTC \
 *   DDB_DAILY_STATS_TABLE=rewardshub-daily-stats DDB_TRANSACTIONS_TABLE=rewardshub-transactions \
 *   DDB_AWS_PROFILE=academy npx ts-node scripts/compare-stats-sources.ts --businesses 10 --days 30
 */
import dotenv from 'dotenv';
dotenv.config();

import { runCli } from '../src/cli/run';

export { parseArgs, snapshot, firstDifference } from '../src/cli/compareStatsSources';

if (require.main === module) {
    runCli(['compare-stats-sources', ...process.argv.slice(2)]).then((code) => process.exit(code));
}
