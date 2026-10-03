// ***************************************************
// * How many months of history exist, in one number
// ***************************************************

/**
 * TWELVE, AND IT IS NOT A SETTING.
 *
 * How many months of frozen history the scheduler keeps. His call
 * 2026-09-09, and the reason it is a constant rather than configurable is
 * the reason it matters:
 *
 * A snapshot froze the sheet as it stood that day and CANNOT BE REBUILT
 * from anything. A dropdown driving this would mean moving it from 12 to 3
 * deletes nine of them, permanently, on the next cron tick, with nobody
 * watching. The most destructive control in the app, and the only one whose
 * damage lands later.
 *
 * So the dropdown caps the DASHBOARD instead: see
 * `dashboard_history_months` and DASHBOARD_HISTORY_OPTIONS below. Retention
 * always keeps twelve, which is what makes raising that setting instant and
 * free rather than a year of history nobody can get back.
 */
const SNAPSHOT_MONTHS = 12;

/**
 * ===============================
 * * A DISPLAY CAP, NOT A RETENTION RULE
 * ===============================
 * How far back the dashboard OFFERS to look. Never how far back it keeps.
 *
 * At 3 the range dropdown shows 1 and 3, and the six and twelve month
 * snapshots still sit there untouched. Offering 6 when only 3 are drawable
 * would be offering a chart of empty points; deleting the other nine to
 * make the number honest would be worse.
 */
const DASHBOARD_HISTORY_OPTIONS = Object.freeze([3, 6, 12]);
const DEFAULT_DASHBOARD_HISTORY = 3;

/** An unknown or absent value is the default, never a throw: the dashboard
 *  refusing to load over a settings row is worse than a shorter dropdown. */
function dashboardHistoryMonths(stored) {
  const months = Number(stored);
  return DASHBOARD_HISTORY_OPTIONS.includes(months) ? months : DEFAULT_DASHBOARD_HISTORY;
}

/**
 * WHICH MONTHS TO DELETE, given what is stored.
 *
 * PRUNED AFTER THE WRITE, NEVER BEFORE. Deleting to make room first would
 * leave eleven months and nothing to replace the twelfth if the snapshot
 * then failed. So a run takes September, counts thirteen, and drops the
 * oldest; a run that takes nothing drops nothing.
 *
 * Newest first by month string, which sorts correctly because months are
 * `YYYY-MM`.
 *
 * @param {string[]} stored every month held, in any order
 * @param {number} keep how many to keep
 * @returns {string[]} the months to remove, oldest first
 */
function monthsToPrune(stored, keep = SNAPSHOT_MONTHS) {
  const months = [...new Set(stored.filter(Boolean).map(String))].sort();
  if (months.length <= keep) return [];
  return months.slice(0, months.length - keep);
}

module.exports = {
  SNAPSHOT_MONTHS,
  monthsToPrune,
  DASHBOARD_HISTORY_OPTIONS,
  DEFAULT_DASHBOARD_HISTORY,
  dashboardHistoryMonths,
};
