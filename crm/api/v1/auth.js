const { Router } = require('express');
const { loginLimiter, verifyLimiter } = require('../configs/rateLimit');
const loginTickets = require('../configs/loginTickets');
const { verifyCredentials, verifySecretCode } = require('./shared/auth.helper');
const { readSession, issueSession, clearSession } = require('./shared/session.helper');

/**
 * SIGNING IN IS TWO REQUESTS, AND THE FIRST ISSUES NOTHING.
 *
 * `/login` proves the password and hands back a pending ticket.
 * `/login/verify` proves the secret code and is the ONLY place that calls
 * issueSession. A right password with a wrong code leaves the caller
 * holding a ticket that grants no access to anything.
 *
 * Splitting it this way is the whole point. A code step that ran after the
 * cookie was already set would be a browser formality: anyone with the
 * username and password could skip the UI and call the API directly.
 */

const router = Router();

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const valid = await verifyCredentials(username, password);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
    res.json({ ticket: loginTickets.issue(username) });
  } catch (err) {
    next(err);
  }
});

router.post('/login/verify', verifyLimiter, async (req, res, next) => {
  try {
    const { ticket, code } = req.body || {};
    const pending = loginTickets.read(ticket);
    // Expired, already spent, or invented. `restart` tells the card to go
    // back to username and password rather than ask again into a ticket
    // that no longer exists.
    if (!pending) {
      return res.status(401).json({ error: 'That took too long. Sign in again.', restart: true });
    }

    const status = await verifySecretCode(pending.username, code);

    if (status === 'not-set') {
      loginTickets.burn(ticket);
      return res.status(403).json({
        error: 'No secret code is set on this account. Run the seed-admin script to set one.',
        restart: true,
      });
    }

    if (status !== 'ok') {
      const { burned, left } = loginTickets.fail(ticket);
      return res.status(401).json({
        error: burned
          ? 'Too many wrong codes. Sign in again.'
          : `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
        restart: burned,
      });
    }

    // One ticket, one session. Burned before the cookie is set so a
    // replayed ticket cannot mint a second.
    loginTickets.burn(ticket);
    await issueSession(res, pending.username);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await clearSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/session', async (req, res, next) => {
  try {
    res.json({ loggedIn: await readSession(req) });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
