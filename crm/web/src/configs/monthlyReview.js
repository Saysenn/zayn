/**
 * ***************************************************
 * * CONTRACT: the three answers to "is it still running?"
 * ***************************************************
 *
 * MIRRORED, NEVER IMPORTED. The server's half is
 * api/v1/repos/monthlyReview.repo.js (`STOPS_AT`, which is also where the
 * dates come from), and migration 057 has the same three in a CHECK. The
 * two codebases share no file, so each states the set and pins its own half
 * (web/src/configs/monthlyReview.test.js).
 *
 * THE VALUES ARE THE WIRE. The labels are ours; the server never sees them.
 */

export const REVIEW_ANSWER = Object.freeze({
  YES: 'yes',
  FINAL: 'final',
  NO: 'no',
});

export const REVIEW_ANSWER_LABEL = Object.freeze({
  yes: 'Still running',
  final: 'Final month',
  no: 'Already ended',
});

export const REVIEW_WAITING_LABEL = 'Waiting';

/**
 * ===============================
 * * WHICH ANSWER TAKES THE ROW OFF THE LIST
 * ===============================
 * His call 2026-09-29. `no` stops the deal at the end of LAST month, so it is
 * out of this month entirely and the list stops being where it is read.
 * `final` is still paid in full this month and stays until the month turns.
 *
 * The list is not the way back: History is, and its undo restores the stop
 * with it. That is why there is no Undo answer button any more.
 *
 * CONTRACT with api/v1/repos/monthlyReview.repo.js STAYS_AFTER_STOP, which
 * drops the same rows from the queue. This copy only spares the optimistic
 * paint a round trip to agree.
 */
export const REVIEW_ANSWER_LEAVES_LIST = Object.freeze([REVIEW_ANSWER.NO]);

// The badge class per answer: green runs on, amber pays this month then stops, red is over.
export const REVIEW_ANSWER_TONE = Object.freeze({ yes: 'active', final: 'in_progress', no: 'open' });
// Undecided is not an alarm, so it takes the quiet grey, never the red "ended" wears.
export const REVIEW_WAITING_TONE = 'sent';

// CONTRACT with api/v1/shared/reviewAnswerLog.helper.js: the field History logs an answer under.
export const REVIEW_ANSWER_LOG_FIELD = 'reviewAnswer';

/**
 * What each answer does to the money, in one clause. The wording every
 * confirm and every badge reads from, so the difference between final and
 * no is described the same way everywhere.
 *
 * THE GAP BETWEEN THE LAST TWO IS ONE MONTH'S MONEY for one person, which
 * is why they are two buttons and not a checkbox.
 */
export const REVIEW_ANSWER_MEANS = Object.freeze({
  yes: 'stays on the master sheet and is asked again next month',
  final: 'is paid in full this month, then stops at the end of the month',
  no: 'is treated as already over, so it stops at the end of last month',
});

/** 'YYYY-MM' to "August 2026". Never the browser's idea of the month. */
export function monthLabel(period) {
  if (!period) return 'this month';
  const [year, month] = String(period).split('-').map(Number);
  if (!year || !month) return 'this month';
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
