// The extension is required here where it is optional elsewhere: node loads
// this file directly in the tests, and node ESM resolves no extensions.
import { paymentStartState, startsAfterMonth, START_STATE } from './paymentStartState.js';

// ***************************************************
// * The payment period IS the preset formula
// ***************************************************
//
// ONE CONDITION, THREE CONSUMERS. The payment start cell's colour, the
// month's total and this badge are three readings of the same question:
// is anything owed for the month this row is marked for?
//
//     GREEN or AMBER  →  Active
//     RED             →  Ended, or Not yet paying
//
// RED IS ONE COLOUR AND TWO FACTS. The boss's sheet paints "has not started"
// and "has finished" alike, and the badge used to say Ended for both, so a
// deal starting in November read as one that was over. The tint stays as he
// wrote it; only the word is split.
//
// So the badge can never contradict the colour sitting beside it, which is
// what happened while it read the end date directly: six NEXUS deals on one
// August preset came out four Ended and two Active, purely because their
// end dates were appointment plus a year.
//
// THE END DATE TAKES PART ONLY THROUGH THE SETTING, which is why it is an
// argument here rather than something this file decides.
//
// A DELIBERATE MIRROR of api/v1/shared/paymentPeriod.helper.js. The server's
// answer is the one that sticks; this closes the gap between pressing Enter
// and the refetch landing.

export const PERIOD = Object.freeze({
  ACTIVE: 'active',
  ENDED: 'ended',
  NOT_STARTED: 'not_started',
});

/**
 * @param {object} row  a cached master sheet row (snake_case columns)
 * @param {boolean} useEndDate  the Settings toggle
 * @returns {'active'|'ended'|'not_started'}
 */
/**
 * THE BADGE IS A FUNCTION OF THE TINT, with no exception.
 *
 *     green or amber -> Active
 *     red            -> Ended, or Not yet paying
 *
 * There WAS an override here, `status` in `manually_overridden_fields`
 * winning over the dates. It let a row read Ended beside a green payment
 * start cell with its amount still in the month's total, because
 * `isOwedThisMonth` never saw the claim. Removed 2026-09-09; nothing writes
 * `status` any more and migration 052 cleared the claims left behind.
 */
export function paymentPeriodOf(row, useEndDate = false) {
  const state = paymentStartState(
    row?.payment_start_on, row?.preset_on, row?.end_on, useEndDate, row?.stopped_on,
    // Somebody said this month pays it, migration 064. Read here as well
    // as in the tint, or the badge says Not yet paying over money that is
    // in the total: the fault the override above was removed for.
    row?.special_case_deal,
  );
  if (state !== START_STATE.NOT_STARTED) return PERIOD.ACTIVE;
  // Same order as the server's CASE: the start is asked about first,
  // because a row that has not begun cannot also have finished.
  return startsAfterMonth(row?.payment_start_on, row?.preset_on)
    ? PERIOD.NOT_STARTED
    : PERIOD.ENDED;
}

/**
 * How each state is said, for anything printing the value as text rather
 * than as a badge (the two PDF templates). `not_started` unlabelled reads
 * as a column name in the middle of an English sentence.
 *
 * StatusBadge holds the same three among its own labels; this is the one
 * the non-badge surfaces share.
 */
export const PERIOD_LABEL = Object.freeze({
  [PERIOD.ACTIVE]: 'active',
  [PERIOD.ENDED]: 'ended',
  [PERIOD.NOT_STARTED]: 'not yet paying',
});

/** The value as prose, falling back to whatever was stored. */
export function periodLabel(value) {
  return PERIOD_LABEL[value] ?? value;
}

/**
 * The two a HUMAN may set, for every editable period cell.
 *
 * Not three: "not yet paying" is a fact about the dates, never a decision.
 * Somebody who wants a future row treated as live sets Active, which is
 * exactly what the override is for.
 *
 * Four pages had their own copy of this pair and one of them rendered the
 * labels lowercase.
 */
/**
 * FILTERING ONLY. There is no edit list any more.
 *
 * `PERIOD_EDIT_OPTIONS` and `periodEditOptions()` fed the three cells that
 * could set the period by hand, on the Master sheet, the Person page and
 * the Company page. All three are badges now: the period is worked out from
 * the payment start, the preset and the end date, so those are what you
 * change. Reading and filtering were never the problem, so this stays, and
 * it offers all three states because all three are real answers.
 */
export const PERIOD_FILTER_OPTIONS = [
  { value: PERIOD.ACTIVE, label: 'Active' },
  { value: PERIOD.ENDED, label: 'Ended' },
  { value: PERIOD.NOT_STARTED, label: 'Not yet paying' },
];

/**
 * Which columns move the answer, so a patch knows when to recompute.
 *
 * The payment START is in here and was not while this read the end date,
 * so moving somebody's start date left the badge behind.
 */
export const PERIOD_INPUTS = ['presetOn', 'endOn', 'paymentStartOn', 'status'];
