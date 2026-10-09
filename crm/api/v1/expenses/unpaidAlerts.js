const logger = require('../../configs/logger');
const checks = require('../repos/expenseChecks.repo');

// ***************************************************
// * STILL NOT REFUNDED: A FLAG FOR THE CRM ADMIN, FROM THE 1ST, WEEKLY
// ***************************************************
//
// His call 2026-10-08: someone not refunded by the 1st of the next month
// is never settled on its own. Their expenses carry over (tagged unpaid,
// then overdue after 2 paydays) and the CRM admin gets a flag on the
// Flagged page, again every week until it is sorted. Only while the
// Expenses check is on. Hourly; the 7 day rule in raiseUnpaid keeps it weekly.

const HOUR = 60 * 60 * 1000;

function startUnpaidAlerts() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (await checks.switchOn()) {
        const n = await checks.raiseUnpaid();
        if (n) logger.info({ flagged: n }, 'expenses not refunded: flagged for the CRM admin');
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'expenses not refunded: the flag run failed');
    } finally {
      running = false;
    }
  };
  setImmediate(tick);
  const timer = setInterval(tick, HOUR);
  timer.unref();
  return timer;
}

module.exports = { startUnpaidAlerts };
