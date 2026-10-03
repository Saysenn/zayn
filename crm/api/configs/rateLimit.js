const rateLimit = require('express-rate-limit');

// One shared credential gates the whole dashboard, so a brute-force attempt
// against /login compromises everything at once — throttle it harder than a
// typical per-user login would need.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

// The secret code step gets its OWN budget rather than sharing the one
// above. Sharing it would halve the real number of sign in attempts
// overnight, because signing in is two requests now instead of one, and a
// fumbled evening would lock the boss out of his own payroll.
//
// Looser on purpose: loginTickets already caps guesses at 3 per ticket and
// every ticket costs a correct password, so this is a backstop against
// scripted retries, not the thing doing the protecting.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
});

module.exports = { loginLimiter, verifyLimiter };
