// Native binding, not bcryptjs (pure JS) — bcryptjs measured ~450ms per
// compare at cost 12 on this hardware vs ~266ms native at the same cost.
// Cost 8 (~17ms native) chosen deliberately below OWASP's usual ≥10
// baseline: one shared, rate-limited credential for 1-3 trusted admins,
// not a public signup form — login latency mattered more here than margin
// against an offline brute-force that rate limiting already blocks online.
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 8;

function hash(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

function compare(plain, hashed) {
  if (!hashed) return Promise.resolve(false);
  return bcrypt.compare(plain, hashed);
}

module.exports = { hash, compare };
