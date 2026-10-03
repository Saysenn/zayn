#!/usr/bin/env node
/**
 * The suite, run as though it were several future months.
 *
 * Thirteen tests failed at midnight on the first of a month with no code
 * change behind it. This is the check that stops that happening again.
 */
const { spawnSync } = require('node:child_process');

const MONTHS = [1, 5, 12, 25, 60];
let bad = 0;

for (const n of MONTHS) {
  const run = spawnSync(
    process.execPath,
    ['--test', '--require', './v1/testing/shiftClock.cjs', '"v1/**/*.test.js"'],
    // The glob needs a shell to expand, and --require needs a ./ prefix or
    // node reads the path as a module NAME and cannot find it.
    { env: { ...process.env, SHIFT_MONTHS: String(n) }, encoding: 'utf8', shell: true },
  );
  const out = run.stdout ?? '';
  const pass = (out.match(/^# pass (\d+)/m) ?? [])[1] ?? '?';
  const fail = (out.match(/^# fail (\d+)/m) ?? [])[1] ?? '?';
  if (fail !== '0') {
    bad += 1;
    console.log(`+${n} months  pass ${pass}  FAIL ${fail}`);
    for (const line of out.split('\n').filter((l) => l.startsWith('not ok'))) console.log(`   ${line}`);
  } else {
    console.log(`+${n} months  pass ${pass}`);
  }
}

console.log(bad === 0 ? '\nThe suite does not care what month it is.' : `\n${bad} of ${MONTHS.length} shifted runs failed.`);
process.exit(bad === 0 ? 0 : 1);
