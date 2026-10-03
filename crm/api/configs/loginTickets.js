const crypto = require('crypto');

/**
 * The gap between "the password was right" and "a session exists".
 *
 * A ticket carries NO ACCESS. It is not a JWT and never becomes the session
 * cookie, so `readSession` cannot be fooled by one: the only thing it buys
 * is the right to try the secret code.
 *
 * SERVER SIDE, not a claim inside a token, for one reason: the attempt
 * count has to be un-replayable. Counting inside the ticket means an
 * attacker resends the original and gets three fresh tries, forever.
 *
 * In memory, same as sessionStore and for the same reasons. A restart drops
 * pending tickets, which costs somebody one re-login inside a two minute
 * window.
 */

const TICKET_TTL_MS = 2 * 60 * 1000;

// Wrong codes allowed on one ticket before it is burned and the whole sign
// in starts again. Three, not ten: each ticket already cost a correct
// password, so this is not the thing standing between an attacker and the
// door. It is what stops one stolen ticket becoming an unlimited guessing
// budget.
const MAX_ATTEMPTS = 3;

const tickets = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, t] of tickets) if (t.expiresAt <= now) tickets.delete(id);
}

const loginTickets = {
  issue(username) {
    sweep();
    const id = crypto.randomUUID();
    tickets.set(id, { username, attempts: 0, expiresAt: Date.now() + TICKET_TTL_MS });
    return id;
  },

  read(id) {
    sweep();
    if (typeof id !== 'string') return null;
    return tickets.get(id) ?? null;
  },

  // A wrong code. Returns whether the ticket survived, and how many tries
  // are left, so the route can say so rather than failing the same way
  // three times and then differently.
  fail(id) {
    const t = tickets.get(id);
    if (!t) return { burned: true, left: 0 };
    t.attempts += 1;
    const left = MAX_ATTEMPTS - t.attempts;
    if (left <= 0) {
      tickets.delete(id);
      return { burned: true, left: 0 };
    }
    return { burned: false, left };
  },

  burn(id) {
    tickets.delete(id);
  },
};

module.exports = loginTickets;
