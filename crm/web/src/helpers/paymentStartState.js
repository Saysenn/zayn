/**
 * The boss's own three conditional-format rules from master.xlsx.
 *
 *   notStarted        start >  EOMONTH(preset)   red
 *   startedThisMonth  start >= preset            amber
 *   running           start <  preset            green
 *
 * Two cells decide it, the start and the preset. Not payable days, not the
 * amount, not the end date.
 *
 * A DELIBERATE MIRROR of paymentStartState() in
 * api/v1/masterSheet/buildWorkbook.js, same arrangement as payable.js: the
 * server stays authoritative and this exists so the tint moves on the
 * optimistic row rather than 450ms later. If the two disagree, fix this
 * one. The state NAMES must match the server's exactly.
 */

export const START_STATE = Object.freeze({
  RUNNING: 'running',
  STARTED_THIS_MONTH: 'startedThisMonth',
  NOT_STARTED: 'notStarted',
});

/** Last day of the month `d` falls in, UTC. Excel's EOMONTH(d, 0). */
function endOfMonth(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
}

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {*} endOn  only read when `useEndDate` is on, which is the
 *   Settings toggle. Off by default: that is his original three rules
 *   exactly, and an export nobody touches stays the document it was.
 */
/**
 * @param {*} stoppedOn LAST AND OPTIONAL so every existing call still reads
 *   correctly. A stop is NOT behind `useEndDate`: the end date is the
 *   sheet's provisional formula and takes part only when the setting says
 *   so, while this is somebody saying the deal is over. Mirrors
 *   `isOwedThisMonth` in api/v1/shared/owedThisMonth.helper.js.
 */
/**
 * @param {*} specialCaseDeal LAST AND OPTIONAL, same treatment `stoppedOn`
 *   got above and for the same reason: every existing call still reads
 *   correctly. `special_case_deal`, migration 064, somebody saying this month
 *   pays the deal whatever the start derives. It is the MIRROR of a stop,
 *   so a stop still beats it.
 */
export function paymentStartState(
  paymentStartOn, presetOn, endOn, useEndDate = false, stoppedOn = null, specialCaseDeal = false,
) {
  const start = asDate(paymentStartOn);
  const preset = asDate(presetOn);
  const end = useEndDate ? asDate(endOn) : null;
  const stopped = asDate(stoppedOn);
  // No preset is the standing roster, owed every month. Unless somebody
  // stopped it: an explicit stop beats a default meant for rows nobody
  // spoke about.
  if (!preset) return stopped ? START_STATE.NOT_STARTED : START_STATE.RUNNING;

  const at = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monthStart = at(preset);
  const monthEnd = endOfMonth(preset);

  // A STOP BEATS THE TOGGLE, so it is asked first. Same order as
  // isOwedThisMonth on the server.
  if (stopped && at(stopped) < monthStart) return START_STATE.NOT_STARTED;
  // Somebody said this month pays it, and the toggle forces the WHOLE
  // month, so it is never a part month and never amber.
  if (specialCaseDeal) return START_STATE.RUNNING;

  // A blank start is the sheet's "Ongoing", owed every month, so it never
  // reaches the start rules. The end rules still apply to it.
  if (start && at(start) > monthEnd) return START_STATE.NOT_STARTED;
  if (end && at(end) < monthStart) return START_STATE.NOT_STARTED;
  if (start && at(start) >= monthStart) return START_STATE.STARTED_THIS_MONTH;
  // The month a deal stops in is a PART MONTH: paid up to the stop, amber.
  if (stopped && at(stopped) <= monthEnd) return START_STATE.STARTED_THIS_MONTH;
  if (end && at(end) <= monthEnd) return START_STATE.STARTED_THIS_MONTH;
  return START_STATE.RUNNING;
}

/**
 * ===============================
 * * WHICH RULE FIRED, not which rules could have
 * ===============================
 * The preview said "Starts after this month, or ended before it" and left
 * the reader to work out which, and the row's own label said "Finished
 * months ago" while the cell was GREEN because the toggle was off. A reason
 * has to be about THIS row in THIS toggle state or it is worse than none.
 *
 * THE ORDER BELOW IS paymentStartState's ORDER, line for line, and it is
 * directly under it so the two cannot be read apart. A test asserts every
 * reason implies the state that function returns.
 */
export const START_REASON = Object.freeze({
  SPECIAL_CASE_DEAL: 'specialCaseDeal',
  STARTS_AFTER: 'startsAfter',
  ENDED_BEFORE: 'endedBefore',
  STARTS_INSIDE: 'startsInside',
  ENDS_INSIDE: 'endsInside',
  RUNNING: 'running',
  NO_START: 'noStart',
});

export function paymentStartReason(
  paymentStartOn, presetOn, endOn, useEndDate = false, specialCaseDeal = false,
) {
  const start = asDate(paymentStartOn);
  const preset = asDate(presetOn);
  const end = useEndDate ? asDate(endOn) : null;
  if (!preset) return START_REASON.NO_START;

  const at = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monthStart = at(preset);
  const monthEnd = endOfMonth(preset);

  // FIRST, because it is the only reason that is a decision rather than a
  // date comparison, and the cell is green because of it and nothing else.
  if (specialCaseDeal) return START_REASON.SPECIAL_CASE_DEAL;
  if (start && at(start) > monthEnd) return START_REASON.STARTS_AFTER;
  if (end && at(end) < monthStart) return START_REASON.ENDED_BEFORE;
  if (start && at(start) >= monthStart) return START_REASON.STARTS_INSIDE;
  if (end && at(end) <= monthEnd) return START_REASON.ENDS_INSIDE;
  return start ? START_REASON.RUNNING : START_REASON.NO_START;
}

/**
 * Has the end date passed before the month this row is marked for?
 *
 * ASKED WITHOUT THE SETTING ON PURPOSE, unlike everything above. The colour
 * rules only look at an end date when the toggle says so; this asks the
 * question the toggle is currently suppressing, so the end date cell can
 * say what turning it on would cost. Mirrors `endedBeforeMonth` in
 * api/v1/shared/owedThisMonth.helper.js, which is gated by its caller.
 */
export function endedBeforeMonth(endOn, presetOn) {
  const end = asDate(endOn);
  const preset = asDate(presetOn);
  if (!end || !preset) return false;
  const at = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return at(end) < Date.UTC(preset.getUTCFullYear(), preset.getUTCMonth(), 1);
}

/**
 * Is the start date past the end of the preset month?
 *
 * NOT_STARTED above covers two different facts, a start that has not
 * arrived and an end that has passed, because the boss's sheet paints them
 * the same red. The BADGE has to tell them apart, so it asks this.
 * The colour rule is untouched: this only reads the same two cells again.
 */
export function startsAfterMonth(paymentStartOn, presetOn) {
  const start = asDate(paymentStartOn);
  const preset = asDate(presetOn);
  if (!start || !preset) return false;
  const at = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return at > endOfMonth(preset);
}

/**
 * ===============================
 * * WHAT THE END DATE TOGGLE IS COSTING THIS ROW
 * ===============================
 * Null when flipping it changes nothing, which is most rows. Otherwise the
 * colour now and the colour it would be, so a cell can say "green only
 * because the end date is out of the formula" instead of leaving somebody
 * to work out that a deal which finished in January is still being paid.
 *
 * IT ASKS THE SAME FUNCTION WITH THE FLAG FLIPPED, so it can never claim a
 * colour the rules would not actually produce.
 *
 * @returns {{now: string, other: string, endedBefore: boolean}|null}
 */
export function ifToggled(paymentStartOn, presetOn, endOn, useEndDate) {
  const now = paymentStartState(paymentStartOn, presetOn, endOn, useEndDate);
  const other = paymentStartState(paymentStartOn, presetOn, endOn, !useEndDate);
  if (now === other) return null;
  return { now, other, endedBefore: endedBeforeMonth(endOn, presetOn) };
}

/**
 * The rules, in his words, for the Settings preview.
 *
 * Derived from the same order the function checks them in, so the table
 * cannot drift from what the sheet actually does.
 */
export function paymentStartRules(useEndDate) {
  const rules = [
    { state: START_STATE.NOT_STARTED, when: 'Payment start is after the preset month', means: 'not started yet' },
    { state: START_STATE.STARTED_THIS_MONTH, when: 'Payment start is inside the preset month', means: 'started this month' },
    { state: START_STATE.RUNNING, when: 'Payment start is before the preset month', means: 'already running' },
    { state: START_STATE.RUNNING, when: 'No payment start, or no preset', means: 'ongoing, owed every month' },
  ];
  if (!useEndDate) return rules;
  return [
    rules[0],
    { state: START_STATE.NOT_STARTED, when: 'End date is before the preset month', means: 'already finished' },
    rules[1],
    { state: START_STATE.STARTED_THIS_MONTH, when: 'End date is inside the preset month', means: 'last month of payment' },
    rules[2],
    rules[3],
  ];
}

/**
 * The xlsx's own tints, so the screen and the file are the same colour.
 * Kept in step with START_FILL in buildWorkbook.js by hand.
 *
 * WRITTEN OUT AS WHOLE CLASS NAMES, never built from a variable. Tailwind
 * scans the source for literals, so `bg-[${hex}]` produces no css at all
 * and the cell silently comes out unpainted.
 */
export const PAYMENT_START_CLASS = {
  [START_STATE.RUNNING]: 'bg-[#CDEBD5]',
  [START_STATE.STARTED_THIS_MONTH]: 'bg-[#FFE3A3]',
  [START_STATE.NOT_STARTED]: 'bg-[#F8C9C4]',
};
