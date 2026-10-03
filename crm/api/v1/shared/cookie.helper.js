const { cookieName, cookieOptions } = require('../../configs/session');

// signed: true makes cookie-parser append an HMAC (using COOKIE_SECRET) to
// the cookie value and verify it on the way back in — a second, independent
// check on top of the JWT's own signature, at the layer that reads the
// cookie before the JWT is ever parsed.
function setSessionCookie(res, token) {
  res.cookie(cookieName, token, { ...cookieOptions, signed: true });
}

function clearSessionCookie(res) {
  res.clearCookie(cookieName, cookieOptions);
}

module.exports = { setSessionCookie, clearSessionCookie };
