/**
 * Two scorecards side by side: what got more right, what got slower or
 * dearer, and which cases newly fail. A run saves itself (run.mjs); this
 * only reads.
 *
 *   node scripts/dianeSuite/compare.mjs                  main: its last two runs
 *   node scripts/dianeSuite/compare.mjs eval3            a held out set, last two
 *   node scripts/dianeSuite/compare.mjs library library-v2-gpt-5.4
 *        v1 against v2: the newest run of each (2026-10-09)
 */
import { savedRuns, compareRuns } from './scorecard.mjs';

const [a = 'main', b] = process.argv.slice(2);
if (b) {
  const [before] = savedRuns(a);
  const [after] = savedRuns(b);
  if (!before || !after) { console.error(`need a saved run of both "${a}" and "${b}"`); process.exit(1); }
  console.log(compareRuns(before, after));
  process.exit(0);
}
const [after, before] = savedRuns(a);
if (!after) { console.error(`no saved run of "${a}" yet: run the suite first`); process.exit(1); }
if (!before) { console.log(`only one saved run of "${a}" (${after.at}): nothing to compare yet`); process.exit(0); }
console.log(compareRuns(before, after));
