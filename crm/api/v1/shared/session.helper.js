const jwtHelper = require('./jwt.helper');
const cookieHelper = require('./cookie.helper');
const sessionStore = require('../../configs/sessionStore');
const { cookieName } = require('../../configs/session');

// A JWT alone can't be revoked — it stays valid until it expires. Every
// session's jti is also a row in sessionStore (tb_sessions), so logout can
// kill one token while it is still correctly signed and unexpired. Async
// because the store may have to ask Postgres.
//
// Pure — takes the already-unsigned token value, not a request. That's what
// lets sockets/index.js authenticate a WebSocket handshake with the exact
// same check as every HTTP route, instead of a second, divergent copy of it.
function decode(token) {
  if (!token) return null;
  try {
    return jwtHelper.verify(token);
  } catch {
    return null;
  }
}

async function isSessionValid(token) {
  const decoded = decode(token);
  if (!decoded) return false;
  try {
    return await sessionStore.isValid(decoded.jti);
  } catch {
    return false;
  }
}

async function readSession(req) {
  return isSessionValid(req.signedCookies?.[cookieName]);
}

// `sub` is the admin's username, so a route can say WHO without a DB read.
async function issueSession(res, username) {
  const jti = await sessionStore.issue(username);
  const token = jwtHelper.sign(username ? { jti, sub: username } : { jti });
  cookieHelper.setSessionCookie(res, token);
}

// Revokes only the session this request carries; other admins stay in.
async function clearSession(req, res) {
  const decoded = decode(req.signedCookies?.[cookieName]);
  cookieHelper.clearSessionCookie(res);
  if (decoded?.jti) await sessionStore.revoke(decoded.jti);
}

/** The signed-in admin's username, or null for a token issued before `sub`. */
function sessionUser(req) {
  return decode(req.signedCookies?.[cookieName])?.sub ?? null;
}

module.exports = { readSession, issueSession, clearSession, isSessionValid, sessionUser };
