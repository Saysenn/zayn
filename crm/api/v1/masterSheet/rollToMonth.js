const { isForMonth, currentMonth } = require('../shared/presetMonth.helper');
const { endedBeforeMonth } = require('../shared/owedThisMonth.helper');

/**
 * The sheet for one month, out of what the CRM holds.
 *
 * THE PRESET IS THE BOSS'S, AND NOTHING HERE TOUCHES IT. He decides which
 * month a row is for; he edits it on the Master Sheet page; it comes out of
 * an export exactly as he left it. This function used to stamp the run's
 * month onto every row and recompute the two figures from it, which meant a
 * row he had deliberately marked September was silently re-labelled August
 * and paid as part of August's run. The figures are the ones computed at
 * upload against his own preset, and they come out untouched too.
 *
 * WHAT IT STILL DOES is answer two questions ABOUT the month asked for,
 * without changing a single stored value:
 *
 *   period_ended      has this deal's payment period FINISHED by that
 *                     month. Not "is it owed": a deal starting later has
 *                     not ended. Against the month, never against today.
 *   for_this_month    does this row's own preset say that month. Rows that
 *                     say otherwise stay on the sheet and stay out of the
 *                     total.
 *
 * IN MEMORY, NEVER WRITTEN. Nothing here touches tb_mastersheet. The boss
 * gets a file, edits it the way he always has, and it comes back through
 * the normal upload, where the preset lands like any other column: shown in
 * the diff, accepted or rejected per row.
 *
 * WHY DATES ARE STRINGS HERE, not Date objects. A JS Date handed to a
 * `date` column is resolved in the server's local timezone, so on any host
 * behind UTC "1 August" is stored as 31 July and the run lands in the
 * wrong month. That bug already shifted every date in the live database by
 * a day. A YYYY-MM-DD string has no instant to convert and cannot move.
 */

/** The preset date for a run: the first of that month, as a plain date. */
function presetDateFor(month) {
  return `${month}-01`;
}

// `currentMonth` is re-exported from shared/, not defined twice: this file
// kept a copy and the two disagreed the moment one learned about timezones.

/** `2026-08` -> a real Date at UTC midnight on the 1st, for the arithmetic. */
function monthStartUtc(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return new Date(Date.UTC(y, m - 1, 1));
}

/**
 * @param {object[]} rows  tb_mastersheet rows, as the repo returns them
 * @param {string} month   'YYYY-MM' being paid for
 * @param {boolean} [opts.useEndDate] the Settings toggle. An end date ends
 *   a period only when it says so.
 * @returns {{ rows, stats }} rows carry `rolled_from` and `period_ended`
 *   alongside the recomputed figures; stats is what the modal reports.
 */
function rollToMonth(rows, month, { useEndDate = false } = {}) {
  if (!monthStartUtc(month)) throw new Error(`Not a month: ${month}`);

  let ended = 0;
  let unresolved = 0;
  let otherMonth = 0;

  const out = rows.map((r) => {
    // ENDED MEANS FINISHED, NEVER "NOT STARTED YET". Both paint the cell
    // red and both make isOwedThisMonth false, but a company whose deals
    // begin in November is still an active company in August.
    // Against the MONTH, not today. Gated by the Settings toggle.
    // NO OVERRIDE BRANCH. It read the stored `status` when a human had
    // claimed it, which made `period_ended` disagree with `countsTowardTotal`
    // on the same row: the export skipped it from the warnings panel while
    // its money stayed in the total. Removed 2026-09-09, see
    // shared/paymentPeriod.helper.js.
    const periodEnded = Boolean(useEndDate && endedBeforeMonth(r, monthStartUtc(month)));
    if (periodEnded) ended += 1;

    // WHICH MONTH THIS ROW IS FOR is the boss's own preset, untouched. It is
    // not counted in this run's total unless it says this month.
    if (!isForMonth(r, month)) otherMonth += 1;

    if (r.payable_days === null || r.payable_amount === null) unresolved += 1;

    // NOTHING IS REWRITTEN. The preset comes out exactly as he left it, and
    // so do the two figures computed against it at upload. The export used
    // to stamp the run's month onto every row and recompute from it, which
    // is why a row he had marked September could never be seen as anything
    // but part of the August run.
    return {
      ...r,
      rolled_to: month,
      period_ended: periodEnded,
      for_this_month: isForMonth(r, month),
    };
  });

  return {
    rows: out,
    stats: {
      month,
      total: out.length,
      ended,
      // On the sheet, out of the total, because their preset says another
      // month. The number worth seeing before sending: it is what a "why is
      // the total so low" question will be about.
      otherMonth,
      zero: out.filter((r) => Number(r.payable_amount) === 0).length,
      unresolved,
    },
  };
}

module.exports = { rollToMonth, currentMonth, presetDateFor };
