const crypto = require('crypto');

// One row per session in tb_sessions (migration 070), keyed by the JWT's
// jti. Several admins can be signed in at once, a restart keeps them all,
// and logout revokes only the session that asked.
//
// The Map is a read-through cache (id -> expiry ms) so the hot path, every
// request and socket handshake, doesn't hit Postgres. Revocation removes
// the id here too; single process, so the cache can't go stale elsewhere.
//
// db is required lazily so unit tests that load this module without a
// database never open a pool.
const jwtConfig = require('./jwt');

// Row expiry follows the JWT lifetime ('12h', '30m', '7d' or seconds), so
// the cookie and the row die together.
function lifetimeMs(expiresIn) {
  if (typeof expiresIn === 'number') return expiresIn * 1000;
  const m = /^(\d+)\s*([smhd])$/.exec(String(expiresIn).trim());
  if (!m) return 12 * 60 * 60 * 1000;
  return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]];
}

const SESSION_TTL_MS = lifetimeMs(jwtConfig.expiresIn);

const cache = new Map();

function db() {
  return require('./db');
}

const sessionStore = {
  async issue(username = null) {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db().query(
      'INSERT INTO tb_sessions (id, admin_username, expires_at) VALUES ($1, $2, $3)',
      [id, username, expiresAt],
    );
    cache.set(id, expiresAt.getTime());
    return id;
  },
  async isValid(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return false;
    const cached = cache.get(sessionId);
    if (cached != null) {
      if (cached > Date.now()) return true;
      cache.delete(sessionId);
      return false;
    }
    const { rows } = await db().query(
      `SELECT expires_at FROM tb_sessions
        WHERE id::text = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [sessionId],
    );
    if (!rows.length) return false;
    cache.set(sessionId, new Date(rows[0].expires_at).getTime());
    return true;
  },
  async revoke(sessionId) {
    if (!sessionId) return;
    cache.delete(sessionId);
    await db().query(
      'UPDATE tb_sessions SET revoked_at = now() WHERE id::text = $1 AND revoked_at IS NULL',
      [sessionId],
    );
  },
};

module.exports = sessionStore;
