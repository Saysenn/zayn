/**
 * `npm test`. Run by a person, never by the app.
 *
 * THE TESTS NEVER TOUCH LIVE DATA. A few reach the database through the
 * shared pool; under `.env` that was the LIVE database, and once every test
 * folder ran (2026-10-07) they hit its connection limit and failed at
 * random ("max clients reached"). They run against DEV, the Supabase copy
 * of LIVE (2026-10-08; there is no local Postgres here), named in `.env` as
 * TEST_DATABASE_URL and refused if it is LIVE. See scripts/testDb.js.
 * dotenv never overrides a variable already set, so `.env` cannot pull
 * them back to live.
 *
 * FEWER FILES AT ONCE: each test file is its own process with its own pool,
 * and Supabase's pooler caps clients. TEST_CONCURRENCY overrides it.
 *
 * A script rather than inline variables so it runs the same on Windows.
 */
const { spawnSync } = require('child_process');
const { testDbUrl } = require('./testDb');

const env = {
  ...process.env,
  DATABASE_URL: testDbUrl(),
  DB_SSL: 'false',
};
const concurrency = `--test-concurrency=${process.env.TEST_CONCURRENCY || 4}`;
const args = ['--test', '--test-force-exit', concurrency, 'v1/**/*.test.js', ...process.argv.slice(2)];
const run = spawnSync(process.execPath, args, { stdio: 'inherit', env, cwd: require('path').join(__dirname, '..') });
process.exit(run.status ?? 1);
