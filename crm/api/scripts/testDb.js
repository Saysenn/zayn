/**
 * ***************************************************
 * * WHERE TESTS RUN: THE DEV DATABASE, NEVER LIVE
 * ***************************************************
 * His call 2026-10-08: no local Postgres on this machine, so every test runs
 * on DEV, the Supabase copy of LIVE. Named in `.env`:
 *
 *   TEST_DATABASE_URL  where tests run (DEV)
 *   LIVE_URL           read only, to refresh DEV and to refuse LIVE
 *
 * A run that needs its own data (the Diane suite) empties DEV, rebuilds it
 * from the migrations, seeds, runs, and then puts the LIVE copy back with
 * refreshFromLive(), so DEV is a copy of LIVE again whenever nothing runs.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { execFileSync } = require('child_process');
require('../configs/pgTypes');
const { Client } = require('pg');

const API_DIR = path.join(__dirname, '..');
const isLocal = (url) => ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
const ssl = (url) => (isLocal(url) ? false : { rejectUnauthorized: false });
const sameDb = (a, b) => {
  const x = new URL(a); const y = new URL(b);
  return x.hostname === y.hostname && x.username === y.username && x.pathname === y.pathname;
};

/** The test database, refused when it is LIVE or not named at all. */
function testDbUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set in crm/api/.env (the DEV database).');
  if (process.env.LIVE_URL && sameDb(url, process.env.LIVE_URL)) throw new Error('REFUSED: TEST_DATABASE_URL is the LIVE database.');
  if (!isLocal(url) && !process.env.LIVE_URL) throw new Error('LIVE_URL must be set in .env so a remote test database can be told apart from LIVE.');
  return url;
}

/** Every table gone, then the migrations from the first. DEV only. */
async function emptyDb(url = testDbUrl()) {
  const c = new Client({ connectionString: url, ssl: ssl(url) });
  await c.connect();
  try {
    const { rows } = await c.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    if (rows.length) await c.query(`DROP TABLE ${rows.map((r) => `public."${r.tablename}"`).join(', ')} CASCADE`);
  } finally {
    await c.end();
  }
  execFileSync(process.execPath, ['scripts/migrate.js'], {
    cwd: API_DIR, stdio: 'ignore', env: { ...process.env, DATABASE_URL: url, DB_SSL: 'false' },
  });
}

/** DEV back to a copy of LIVE. LIVE is only read. See cloneLive.js. */
function refreshFromLive(url = testDbUrl()) {
  if (!process.env.LIVE_URL) throw new Error('LIVE_URL is not set, so DEV cannot be refreshed.');
  execFileSync(process.execPath, ['scripts/cloneLive.js'], {
    cwd: API_DIR,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      CLONE_URL: url,
      CLONE_REMOTE_OK: decodeURIComponent(new URL(url).username),
    },
  });
}

/**
 * ONE RUN ON DEV AT A TIME. 2026-10-09: two suite runs from two sessions
 * emptied DEV under each other, and both came back as "fetch failed" and
 * "migrate failed". A session-level advisory lock on DEV itself, held for
 * the whole run: a second run WAITS for the first instead of colliding.
 * Returns the release function.
 */
async function holdDevLock(url = testDbUrl(), { waitMinutes = 120, log = console.log } = {}) {
  const c = new Client({ connectionString: url, ssl: ssl(url) });
  await c.connect();
  const KEY = 7_172_026; // any fixed number: "the Diane suite"
  const deadline = Date.now() + waitMinutes * 60_000;
  let told = false;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1) AS ok', [KEY]);
    if (rows[0].ok) break;
    if (!told) { log('another suite run holds DEV: waiting for it to finish…'); told = true; }
    if (Date.now() > deadline) { await c.end(); throw new Error('DEV stayed busy with another run'); }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 20_000));
  }
  return async () => { await c.query('SELECT pg_advisory_unlock($1)', [KEY]).catch(() => {}); await c.end().catch(() => {}); };
}

module.exports = { testDbUrl, emptyDb, refreshFromLive, isLocal, ssl, holdDevLock };
