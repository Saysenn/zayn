const logsRepo = require('../repos/logs.repo');
const { isDevMode } = require('./devMode.helper');

// The one place anything writes to the `logs` table. A no-op while dev mode
// is off, so normal operation never pays for it and the table never grows
// unbounded by accident. Never throws — a logging failure must not become a
// second error on top of the one it was trying to record.
async function captureLog({ source = 'api', level = 'error', message, detail }) {
  if (!isDevMode()) return;
  try {
    await logsRepo.create({ source, level, message, detail });
    await logsRepo.prune();
  } catch {
    // swallowed on purpose — see above
  }
}

module.exports = { captureLog };
