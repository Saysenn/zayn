/**
 * DEV back to a copy of LIVE, by hand or from the nightly run. LIVE is only
 * read. `node scripts/refreshDev.js`. See scripts/testDb.js.
 */
const { refreshFromLive } = require('./testDb');

try {
  refreshFromLive();
  console.log('DEV is a copy of LIVE again.');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
