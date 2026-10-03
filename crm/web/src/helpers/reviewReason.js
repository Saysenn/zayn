import { COMPANY_STATUS } from '../configs/companyStatus.js';

/**
 * ***************************************************
 * * CONTRACT: why a deal is in the review queue
 * ***************************************************
 *
 * MIRRORED, NEVER IMPORTED. The server's half is
 * api/v1/shared/reviewQueue.helper.js `reviewReason`, which Diane's long
 * answer and the sign-in briefing both read. The two codebases share no
 * file, so each states the rule and pins its own half
 * (helpers/reviewReason.test.js).
 *
 * ===============================
 * * THE TICK SAYS WHETHER, THE COMPANY SAYS WHICH
 * ===============================
 * TWO THINGS PUT A DEAL HERE and both are facts about the DEAL: a date
 * that has passed, or somebody having ticked it.
 *
 * The queue used to sweep in every live deal on a liquidating company, so
 * the status screen's checklist promised "ticked deals join the Review
 * list every month" and unticking one removed nothing. His call
 * 2026-09-21: he marks a company and then chooses which of its deals it
 * actually touches.
 *
 * So the company's status decides only WHICH TAB:
 *
 *   liquidation  ticked, on a company winding down. Money is being
 *                renegotiated per deal.
 *   review       ticked, on a company under review, OR ticked with no
 *                status behind it, which is his sheet writing "Reviewed
 *                monthly" on the row. Both mean somebody asked for it.
 *   past end     not ticked, so it is here because of a DATE.
 *
 * A TICKED DEAL IS NEVER "past a year", even when its date has also gone:
 * it is here because somebody asked, and reading the date out instead
 * tells them a deadline nobody set.
 */

export const REVIEW_REASON = Object.freeze({
  LIQUIDATION: 'liquidation',
  REVIEW: 'review',
  PAST_END: 'past_end',
});

export function reviewReason(row) {
  if (!row?.review_monthly) return REVIEW_REASON.PAST_END;
  return row.company_status === COMPANY_STATUS.LIQUIDATION
    ? REVIEW_REASON.LIQUIDATION
    : REVIEW_REASON.REVIEW;
}

/**
 * The tabs, in the order the panel shows them: the biggest thing that can
 * be happening first, the ordinary case last.
 *
 * A TAB WITH NOTHING IN IT IS STILL SHOWN, with a zero. Hiding it would
 * make the tabs move under somebody's hand as they answer rows.
 */
export const REVIEW_TABS = Object.freeze([
  { key: REVIEW_REASON.LIQUIDATION, label: 'Liquidation' },
  { key: REVIEW_REASON.REVIEW, label: 'Marked for review' },
  { key: REVIEW_REASON.PAST_END, label: 'Past a year' },
]);

/** How many rows sit under each tab. */
export function countByReason(rows) {
  const counts = Object.fromEntries(REVIEW_TABS.map((tab) => [tab.key, 0]));
  for (const row of rows ?? []) counts[reviewReason(row)] += 1;
  return counts;
}
