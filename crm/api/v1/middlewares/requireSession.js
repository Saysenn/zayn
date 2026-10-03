const { readSession } = require('../shared/session.helper');

// Async: the session check may hit tb_sessions. A DB failure goes to the
// error handler rather than hanging the request.
async function requireSession(req, res, next) {
  try {
    if (!(await readSession(req))) return res.status(401).json({ error: 'Not logged in' });
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireSession, readSession };
