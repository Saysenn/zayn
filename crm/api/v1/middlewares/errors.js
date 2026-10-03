const crypto = require('crypto');
const { isDevMode } = require('../shared/devMode.helper');
const { captureLog } = require('../shared/captureLog.helper');

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function notFound(req, res, next) {
  next(new AppError(404, 'Not found'));
}

// A 4xx's message is one we wrote ourselves (AppError, or a route's own
// `res.status(400).json(...)`) — always safe to show as-is. A 5xx's message
// is whatever the failing thing said — a stack trace, a driver error, an
// internal hostname — and must never reach the browser unless dev mode is
// deliberately on. Captured to `logs` either way dev mode allows it, so a
// 500 that flashed by is still visible on the Logs page afterwards.
// 4xx codes that are normal traffic, not something to debug. A 404 for a
// mistyped URL and a 401 from an expired cookie happen constantly and
// would bury the real entries; everything else (a rejected upload, a bad
// date, a refused transcription) is exactly what the Logs page is for.
const NOT_WORTH_LOGGING = new Set([401, 403, 404]);

/**
 * A short handle shared by the toast and the log entry.
 *
 * A 500's real message must not reach the browser, which is right and also
 * left "Something went wrong. Please try again." as the only thing anyone
 * had to go on: an upload commit failing on a one-line constraint
 * violation took a database query to identify. The reference is in the
 * toast AND in the message captureLog writes, so the Logs page finds it
 * with a search for those six characters.
 *
 * Six hex characters, not a UUID: it has to be readable off a screen and
 * typed into a search box, and it only has to be unique among the errors
 * anyone is looking at today.
 */
function errorRef() {
  return crypto.randomBytes(3).toString('hex');
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const ref = status >= 500 ? errorRef() : null;

  if (status >= 500) {
    req.log?.error({ err, ref });
    // fire-and-forget: logging a failure must never delay or risk the response
    captureLog({
      source: 'api',
      level: 'error',
      // The ref leads the message so it is the first thing matched by a
      // search, and survives the message itself being truncated.
      message: `[${ref}] ${err.message || 'Internal server error'}`,
      detail: { ref, stack: err.stack, method: req.method, path: req.originalUrl },
    });
  } else if (!NOT_WORTH_LOGGING.has(status)) {
    // 4xx used to be dropped entirely, which meant a rejected upload, a
    // failed transcription or a rate limit left no trace anywhere except
    // the console. Those are the failures most worth debugging, so they're
    // captured too — at `warn`, since the request was refused on purpose
    // rather than something breaking.
    captureLog({
      source: 'api',
      level: 'warn',
      message: err.message || `Request refused (${status})`,
      detail: { status, method: req.method, path: req.originalUrl },
    });
  }

  /**
   * ===============================
   * * DEV MODE SHOWS THE REAL MESSAGE, AND STILL HAS TO SHOW THE REFERENCE
   * ===============================
   * It dropped the ref entirely on the one path where you are debugging.
   * Setting an appointment date came back as a bare, truncated driver
   * line, "null value in column payable_days of relation tb_mastersheet
   * violates not-null...", with nothing to search the Logs page for. The
   * full message, the stack and the request are all in `logs` under that
   * ref, and there was no way to reach any of it from the toast.
   *
   * Same six characters in both branches, so the toast and the log entry
   * always name each other whichever mode is on.
   */
  const message =
    status >= 500 && !isDevMode()
      ? `Something went wrong. Search the Logs page for ${ref}.`
      : [err.message || 'Internal server error', ref && `(${ref})`].filter(Boolean).join(' ');

  // An AppError may carry `matches` — the existing rows that made a
  // create a duplicate. Passed through so the page can offer "open that
  // one" instead of just saying no, which is the whole point of checking.
  // Only on refusals, never on a 500: a server fault has no matches and
  // shouldn't leak whatever happened to be attached to the error.
  const body = { error: message };
  // Also as its own field, so a caller can show or copy it without
  // parsing the sentence it sits in.
  if (ref) body.ref = ref;
  if (status < 500 && Array.isArray(err.matches)) body.matches = err.matches;

  res.status(status).json(body);
}

module.exports = { AppError, notFound, errorHandler };
