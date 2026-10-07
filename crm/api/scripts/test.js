/**
 * `npm test`. Run by a person, never by the app.
 *
 * THE TESTS NEVER TOUCH LIVE DATA. A few reach the database through the
 * shared pool; under `.env` that was the LIVE database, and once every test
 * folder ran (2026-10-07) they hit its connection limit and failed at
 * random ("max clients reached"). They run against the local clone
 * (docker `crm-clone`, port 54329) instead, CLAUDE.md rule 9. TEST_DATABASE_URL
 * points them somewhere else if needed. dotenv never overrides a variable
 * already set, so `.env` cannot pull them back to live.
 *
 * A script rather than inline variables so it runs the same on Windows.
 */
const { spawnSync } = require('child_process');

const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://postgres:localtest@127.0.0.1:54329/crm_clone',
  DB_SSL: 'false',
};
const args = ['--test', '--test-force-exit', 'v1/**/*.test.js', ...process.argv.slice(2)];
const run = spawnSync(process.execPath, args, { stdio: 'inherit', env, cwd: require('path').join(__dirname, '..') });
process.exit(run.status ?? 1);
