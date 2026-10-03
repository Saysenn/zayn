require('./pgTypes'); // before any query: `date` columns come back as 'YYYY-MM-DD'
const { Pool } = require('pg');
const env = require('./env');
const logger = require('./logger');

// Supabase is always the cloud, regardless of NODE_ENV, so SSL is
// unconditional here (unlike cors.js, which does branch on env).
const pool = new Pool({
  connectionString: env.databaseUrl,
  // DB_SSL=false only for a local test database, which has no TLS.
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },

  /**
   * ===============================
   * * THIS SESSION IS UTC AND STAYS UTC
   * ===============================
   *
   * Deliberate, and stated here because the obvious "fix" is to set the
   * session zone and it does not work: this connects through the SUPABASE
   * POOLER, which swallows startup `options`, and a `SET TIME ZONE` on
   * pool.on('connect') cannot be awaited, so it races the first real query
   * on a new connection. Both were tried. The first came back UTC anyway.
   *
   * So no SQL may ask what day it is. `currentMonth()` in
   * `shared/presetMonth.helper` is the ONE authority and the month travels
   * as a bound parameter. Two authorities disagreeing between midnight and
   * 7am UTC is a bug nobody can reproduce: the total said August while the
   * "starts this month" filter said September, off one screen.
   *
   * `now()` and interval arithmetic are untouched by any of this: an
   * instant is an instant, and a `date` column has no zone to convert.
   */

  // ---- why these three exist -------------------------------------------
  // Measured, not guessed: the first query after startup took 14,853ms
  // while a warm one took 481ms. That fourteen seconds is a cold TCP
  // connection plus TLS handshake plus auth to Supabase in ap-south-1, and
  // it was landing on whichever request happened to arrive first — usually
  // Diane's, which then looked like the model hanging.
  //
  // Keeping connections alive is what stops it recurring: pg's default
  // idleTimeoutMillis is 10s, so a quiet minute closed every connection and
  // the next request paid the full cost all over again.
  min: 2,                       // never drop to zero, so the handshake is already paid
  idleTimeoutMillis: 0,         // 0 = never close an idle client
  keepAlive: true,              // TCP keepalive, so a NAT/idle timeout can't silently drop it
  connectionTimeoutMillis: 20000, // a genuine cold connect can take ~15s; failing at 10 would be wrong
});

// A dropped backend (Supabase restart, network blip) surfaces as an error
// on an IDLE client, which is an unhandled 'error' event and takes the
// process down if nobody listens. pg replaces the client itself; this just
// has to not crash.
pool.on('error', (err) => {
  logger.error({ err }, 'db: idle client error (pool will replace it)');
});

/**
 * Open the connections at boot instead of on the first request.
 *
 * Deliberately fire-and-forget: the server must still start if the
 * database is briefly unreachable, exactly as it did before. This only
 * moves WHEN the cost is paid, never whether it can fail.
 */
async function warmUp() {
  const started = Date.now();
  try {
    await Promise.all([pool.query('SELECT 1'), pool.query('SELECT 1')]);
    logger.info({ ms: Date.now() - started }, 'db: pool warmed');
  } catch (err) {
    logger.warn({ err }, 'db: warm-up failed, first real query will pay the cost instead');
  }
}

module.exports = pool;
module.exports.warmUp = warmUp;
