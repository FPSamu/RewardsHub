/**
 * SOLO LECTURA. Membresías activas duplicadas. La lógica está en
 * src/cli/findDuplicateMemberships.ts; en el lab: ./lab.sh run find-duplicate-memberships.
 *
 *   npx ts-node scripts/find-duplicate-memberships.ts [--json]
 */
import dotenv from 'dotenv';
dotenv.config();

import { runCli } from '../src/cli/run';

export { findDuplicateActiveMemberships, DuplicateGroup } from '../src/cli/findDuplicateMemberships';

if (require.main === module) {
    runCli(['find-duplicate-memberships', ...process.argv.slice(2)]).then((code) => process.exit(code));
}
