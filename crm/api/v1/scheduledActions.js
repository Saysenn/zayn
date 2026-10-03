const { Router } = require('express');
const queue = require('./repos/scheduledActions.repo');
const { runDue } = require('./agent/scheduled/runner');
const { resolveContext } = require('./agent/contexts');
const { currentMonth } = require('./shared/presetMonth.helper');
const logger = require('../configs/logger');
const { AppError } = require('./middlewares/errors');

/**
 * ***************************************************
 * * MONTH START: the parked work
 * ***************************************************
 *
 * Called by the boot screen on every sign in. Safe to call every time:
 * what RUNS is decided by `status` in the table, not by the caller, so a
 * second tab, a second device or a third sign in finds nothing to do.
 *
 * That is deliberate. The preset roll counts its tries in localStorage,
 * which is per browser — the same work could run again on a different
 * machine. Here the queue is the only authority.
 */
const router = Router();

router.get('/scheduled-actions', async (req, res, next) => {
  try {
    const month = currentMonth();
    res.json({
      month,
      upcoming: await queue.upcoming(month),
      ran: await queue.ranIn(month),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * RUN WHAT IS DUE. Must come AFTER the preset roll: the roll recomputes
 * payable from the new preset, and a parked change to an amount applied
 * before it would be silently overwritten.
 */
router.post('/scheduled-actions/run', async (req, res, next) => {
  try {
    const { tools } = resolveContext('master-sheet');
    const report = await runDue({ tools });
    if (report.ran.length || report.skipped.length || report.failed.length) {
      logger.info({
        month: report.month,
        ran: report.ran.length,
        skipped: report.skipped.length,
        failed: report.failed.length,
      }, 'diane: parked work applied');
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.post('/scheduled-actions/:id/cancel', async (req, res, next) => {
  try {
    const row = await queue.cancel(Number(req.params.id));
    if (!row) return next(new AppError(404, 'That is not parked any more.'));
    res.json({ cancelled: row });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
