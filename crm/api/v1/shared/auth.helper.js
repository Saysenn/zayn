const adminsRepo = require('../repos/admins.repo');
const bcryptHelper = require('./bcrypt.helper');

// Never a valid hash for a real password — exists only so an unknown
// username still pays the same bcrypt.compare cost as a known one. Without
// this, a missing admin row returns instantly while a wrong password takes
// bcrypt's ~100ms, and that gap tells an attacker which usernames exist.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO0iM0Q7ct0mZKJz.XKgqvOsPibz4W2Ry';

async function verifyCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const admin = await adminsRepo.findByUsername(username);
  const passwordOk = await bcryptHelper.compare(password, admin ? admin.password_hash : DUMMY_HASH);
  return Boolean(admin) && passwordOk;
}

/**
 * The second gate. Three outcomes, not two.
 *
 * `not-set` is its own answer because it must never be silently treated as
 * `ok`: an account with no code set is locked, not exempt. The route says
 * so plainly, which is safe here because nothing reaches this function
 * without already having presented the right username and password.
 *
 * @returns {Promise<'ok'|'wrong'|'not-set'>}
 */
async function verifySecretCode(username, code) {
  if (typeof code !== 'string' || code === '') return 'wrong';
  const admin = await adminsRepo.findByUsername(username);
  if (!admin) return 'wrong';
  if (!admin.secret_code_hash) return 'not-set';
  return (await bcryptHelper.compare(code, admin.secret_code_hash)) ? 'ok' : 'wrong';
}

module.exports = { verifyCredentials, verifySecretCode };
