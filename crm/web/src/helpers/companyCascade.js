import { today } from './formatDate.js';
import { paymentPeriodOf } from './paymentPeriod.js';

/**
 * ***************************************************
 * * WHAT A STATUS CHANGE DOES TO THE DEALS, PAINTED IMMEDIATELY
 * ***************************************************
 *
 * A company PATCH carries two id lists that are INSTRUCTIONS, not columns:
 * `reviewMonthlyDealIds` says which deals are reviewed monthly from now on,
 * `stopDealIds` which a closure stops. The server acts on them; they are
 * not fields on the company row.
 *
 * Spreading them onto the cached row therefore wrote two junk keys nothing
 * renders, while the thing they actually change sat on the server's last
 * answer. A closure repainted the word "Closed" instantly and left every
 * deal it had just stopped reading Active until the refetch landed, which
 * is the exact pause optimism exists to remove. Found 2026-09-21.
 *
 * IN helpers/, NOT IN THE HOOK. The hook pulls in React and the query
 * client, so anything written inside it can only be tested by reading it as
 * text. This is the same reasoning as `patchRow`, and for the same reason:
 * a restatement in a test file is a test of the restatement.
 *
 * MIRRORS `v1/shared/companyStatus.helper.js`. The server is still the one
 * that decides; this only has to agree with it until the refetch lands.
 */

// The two keys that are instructions. Everything else is a column.
export const INSTRUCTIONS = Object.freeze(['reviewMonthlyDealIds', 'stopDealIds']);

/**
 * Mirrors the server's `REOPEN_THE_COMPANY`. A reopen puts back only what
 * the CLOSURE stopped, so the reason has to be written, not just a date: a
 * deal somebody stopped by hand was its own decision and stays stopped.
 */
export const CLOSURE_STOP = 'company_closed';

// Mirrors companyStatus.js TERMINAL_STATUS. Kept here rather than imported
// so this file stays free of anything but dates and rows.
const TERMINAL = Object.freeze(['dissolved', 'closed']);

/**
 * The badge is DERIVED, here as in SQL, so a deal whose stop just changed
 * has to go back through the same predicate. Copying `stopped_on` alone
 * left `payment_period` reading Active beside a deal that had just ended.
 * Same reasoning as `withPeriod` in hooks/useMasterSheet.js.
 */
function withPeriod(deal, useEndDate) {
  return { ...deal, payment_period: paymentPeriodOf(deal, useEndDate) };
}

/**
 * @param {object[]} deals the cached deals, snake_case
 * @param {object} fields the PATCH body, camelCase
 * @param {boolean} useEndDate the Settings toggle, for the derived badge
 *
 * SET AND CLEARED TOGETHER for the review flag, exactly as
 * `setReviewMonthlyForCompany` does: unticking a row takes it out of the
 * review as surely as ticking puts it in.
 *
 * ABSENT IS NOT EMPTY for the stop list. A closure with no list stops every
 * live deal, which is what Diane sends because she has no checklist. An
 * empty array is somebody having unticked the lot, and stops none.
 */
export function patchedDeals(deals, fields = {}, useEndDate = false) {
  if (!Array.isArray(deals)) return deals;
  const { reviewMonthlyDealIds: reviewIds, stopDealIds, status } = fields;

  const stopping = TERMINAL.includes(status);
  const reopening = status !== undefined && !stopping;
  const stopIds = Array.isArray(stopDealIds) ? new Set(stopDealIds) : null;

  return deals.map((deal) => {
    let out = deal;

    if (Array.isArray(reviewIds)) {
      out = { ...out, review_monthly: reviewIds.includes(deal.id) };
    }

    if (stopping && !deal.stopped_on && (!stopIds || stopIds.has(deal.id))) {
      // THE BROWSER'S DAY, and it can be one off the server's business
      // clock. The badge is what moves on screen and it is derived from a
      // stop having happened, not from which day; the server's own date
      // lands on the refetch and is the one that sticks.
      out = withPeriod({ ...out, stopped_on: today(), stopped_reason: CLOSURE_STOP }, useEndDate);
    }

    if (reopening && deal.stopped_reason === CLOSURE_STOP) {
      out = withPeriod({ ...out, stopped_on: null, stopped_reason: null }, useEndDate);
    }

    return out;
  });
}

/** The columns half: everything in the body that is not an instruction. */
export function columnsOnly(fields = {}) {
  const out = { ...fields };
  for (const key of INSTRUCTIONS) delete out[key];
  return out;
}
