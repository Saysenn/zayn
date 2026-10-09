const http = require('http');
const env = require('./configs/env');
const logger = require('./configs/logger');
const app = require('./v1/app');
const pool = require('./configs/db');
const fxRates = require('./v1/shared/fxRates.helper');
const { initSocket } = require('./v1/sockets');

const server = http.createServer(app);
initSocket(server);

/**
 * ===============================
 * * A PORT ALREADY IN USE IS NOT A CRASH
 * ===============================
 * `EADDRINUSE` came out as an eleven line stack trace ending in
 * "app crashed", which reads as a bug in the code. It is almost always the
 * last `npm run dev` still running, and the fix is one command.
 *
 * Every other listen error still throws with its stack: an unexpected one
 * should look unexpected.
 */
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;

  const find = process.platform === 'win32'
    ? `Get-NetTCPConnection -LocalPort ${env.port} -State Listen | Select-Object OwningProcess`
    : `lsof -ti :${env.port}`;

  logger.error(
    `Port ${env.port} is already in use, so the API did not start. `
    + 'This is nearly always the previous dev server still running. '
    + `Find it with:  ${find}   then stop that process and try again.`,
  );
  process.exit(1);
});

server.listen(env.port, () => {
  logger.info(`CRM API listening on port ${env.port}`);
  // SAID AT BOOT, because getting it wrong is silent: every total, colour
  // and export would be for the wrong month for a few hours a night, and
  // nothing on screen would say so. A deployed box shows its zone here.
  logger.info(`Business timezone: ${env.timezone}${process.env.TIMEZONE ? '' : ' (from the host, TIMEZONE is unset)'}`);
  // Opens the database connections now rather than letting the first real
  // request pay a ~15s cold TLS handshake to Supabase. Not awaited: the
  // server must still come up if the database is momentarily unreachable.
  pool.warmUp();
  // DIANE'S HMRC & CIS KNOWLEDGE, refreshed from GOV.UK once a day (off with
  // HMRC_AUTO_REFRESH=off; never on a database with no knowledge loaded)
  // eslint-disable-next-line global-require
  require('./v1/agent/hmrc/knowledge').startAutoRefresh();
  // The rates too, and for the same reason plus one: a failed fetch is
  // SILENT otherwise, showing up later as a currency nobody can convert.
  // See shared/fxRates.helper.
  fxRates.warmUp();
});
