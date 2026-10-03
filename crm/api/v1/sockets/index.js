const { Server } = require('socket.io');
const cookie = require('cookie');
const cookieParser = require('cookie-parser');
const env = require('../../configs/env');
const { cookieName } = require('../../configs/session');
const { isSessionValid } = require('../shared/session.helper');
const { noteWrite } = require('../shared/writeTap.helper');

let io = null;

// Same check as requireSession, just reading the cookie off a handshake
// instead of an Express req — nothing here duplicates the session logic
// itself. Unauthenticated sockets never get a connection at all, since this
// channel carries concern and message content, not just UI refresh pings.
//
// Every step guarded and wrapped: a connection attempt with no cookie, a
// malformed cookie header, or a stale/cleared one is the NORMAL case for an
// unauthenticated visitor, not an exceptional one — cookie-parser's
// signedCookie throws on undefined input, and letting that escape this
// function would crash the whole process on the first anonymous connection
// attempt, not just reject that one socket.
async function isAuthed(socket) {
  try {
    const raw = socket.handshake.headers.cookie;
    if (!raw) return false;
    const value = cookie.parse(raw)[cookieName];
    if (!value) return false;
    const signed = cookieParser.signedCookie(value, env.cookieSecret);
    return signed ? await isSessionValid(signed) : false;
  } catch {
    return false;
  }
}

// One shared room, not one per group. At 1-3 admins and modest message
// volume, per-group room bookkeeping buys nothing — every event carries its
// own groupName, and each page (chat vs. the global flagged queue) decides
// for itself what to do with an event, rather than the server guessing
// which groups a client currently cares about.
const ADMIN_ROOM = 'admin';

function initSocket(server) {
  io = new Server(server, { cors: { origin: env.corsOrigin, credentials: true } });

  io.use(async (socket, next) => {
    // belt and suspenders: isAuthed already can't throw, but a middleware
    // callback throwing (instead of calling next(err)) is exactly the shape
    // of bug that takes the whole process down — worth guarding here too,
    // not just inside isAuthed.
    try {
      if (!(await isAuthed(socket))) return next(new Error('unauthorized'));
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    socket.join(ADMIN_ROOM);
  });

  return io;
}

// groupName kept as a param (not read from payload) so every call site stays
// explicit about which group an event belongs to — payload rows already
// carry group_name themselves (from Postgres), so it isn't re-added here.
function broadcast(groupName, event, payload) {
  // A broadcast is a write that happened: Diane's runtime reads this.
  noteWrite();
  io?.to(ADMIN_ROOM).emit(event, payload);
}

module.exports = { initSocket, broadcast };
