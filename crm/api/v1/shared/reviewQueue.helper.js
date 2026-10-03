const reviewRepo = require('../repos/monthlyReview.repo');
const { ratedRows } = require('./ratedRows.helper');

/**
 * ***************************************************
 * * THE REVIEW QUEUE, WITH THE RATES ALREADY ON IT
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-21. The queue printed `monthly_amount` straight
 * off the row, so Zayn read **AED 3,809.52** where he is paid **4,000**:
 * the stored wage with his 5% add on left off. Diane said it, the panel
 * showed it, and the export warning totalled it.
 *
 * `rates.helper.js` says it plainly: a row goes through `withRates` ONCE,
 * as early as possible, and every reader after it adds the numbers in
 * front of it. The queue was the one read model that never did.
 *
 * SIX CALLERS, SO IT CANNOT BE PER CALLER. Four of Diane's tools, the
 * panel's route and the export warning all read this queue, and a rate
 * applied in five of them is a figure that disagrees with itself. Same
 * lesson as `owedThisMonth.helper.js`: adding a reader means adding it
 * HERE, not copying the arithmetic.
 *
 * THE RAW IS KEPT. `withRates` leaves `monthly_amount_raw` and
 * `rate_parts` on any row it touches, and returns an unrated row
 * untouched, so nothing rounds a figure that carries no rate.
 */

/**
 * @param {string} period 'YYYY-MM'
 * @param {object} filters passed straight to the repo: group, personId,
 *   company, answered.
 * @returns {Promise<object[]>} the queue, every row rated.
 */
async function dueThisMonth(period, filters = {}) {
  return ratedRows(await reviewRepo.queue(period, filters));
}

/**
 * How many are waiting and what they COST, off the same rated rows.
 *
 * Not the repo's `pending`, which sums `monthly_amount` in SQL and so
 * cannot see a rate. The count is identical either way; the money is not.
 *
 * PER CURRENCY, NEVER ONE NUMBER. The queue holds GBP, EUR and AED deals
 * at once, and a single total across them is two currencies added together
 * wearing one symbol. `totalsOf` on the web half exists for the same
 * reason.
 */
async function pendingThisMonth(period) {
  const rows = await dueThisMonth(period, { answered: false });
  const byCurrency = {};
  for (const row of rows) {
    const currency = row.currency ?? 'GBP';
    byCurrency[currency] = (byCurrency[currency] ?? 0) + (Number(row.monthly_amount) || 0);
  }
  return { count: rows.length, byCurrency };
}

/**
 * ===============================
 * * WHY THIS ROW IS IN THE QUEUE, which is also which TAB it belongs to
 * ===============================
 * TWO THINGS PUT A DEAL HERE and they are both facts about the DEAL: a
 * date that has passed, or somebody having ticked it. The company's status
 * is not one of them any more, and that is the 2026-09-21 change: the
 * queue used to sweep in every live deal on a liquidating company, so the
 * checklist's "ticked deals join the Review list" was a promise it did not
 * keep.
 *
 * SO THE TICK DECIDES WHETHER, AND THE STATUS DECIDES WHICH:
 *
 *   liquidation  ticked, on a company winding down. Money is being
 *                renegotiated per deal.
 *   review       ticked, on a company he has put under review, OR ticked
 *                with no status behind it, which is his sheet writing
 *                "Reviewed monthly" on the row. Both mean the same thing:
 *                somebody asked for this deal every month.
 *   past end     not ticked, so it is here because of a DATE.
 *
 * A TICKED DEAL IS NEVER "past a year", even when its date has also gone.
 * It is here because somebody asked, and reading the date out instead
 * tells them a deadline nobody set.
 *
 * `whyHere` in the review tool, the panel's tabs and the sign-in briefing
 * all read THIS, rather than each deciding again.
 */
const REVIEW_REASON = Object.freeze({
  LIQUIDATION: 'liquidation',
  REVIEW: 'review',
  PAST_END: 'past_end',
});

// The two company statuses that ask about their deals. Mirrors
// companies.repo REVIEWED_MONTHLY; named here so this file needs no repo.
const LIQUIDATION_STATUS = 'liquidation';

function reviewReason(row) {
  if (!row?.review_monthly) return REVIEW_REASON.PAST_END;
  return row.company_status === LIQUIDATION_STATUS
    ? REVIEW_REASON.LIQUIDATION
    : REVIEW_REASON.REVIEW;
}

module.exports = {
  dueThisMonth, pendingThisMonth, reviewReason, REVIEW_REASON,
};
