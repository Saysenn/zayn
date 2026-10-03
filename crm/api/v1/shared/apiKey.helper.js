const crypto = require('crypto');
const env = require('../../configs/env');

// Service-to-service auth for whatbot calling into the CRM — separate from
// the admin session cookie, since there's no browser and no login form on
// that side. One shared key, checked in constant time the same way the
// admin username is (see auth.helper.js).
function isValidApiKey(candidate) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.agentApiKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isValidApiKey };
