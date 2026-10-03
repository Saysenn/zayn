const { isForMonth } = require('./presetMonth.helper');

/**
 * ***************************************************
 * * Is this deal in the month's run, and how much of it?
 * ***************************************************
 *
 * ONE CONDITION, TWO CONSUMERS, and neither reads the other:
 *
 *     isOwedThisMonth()  ─┬─→ paymentStartState()  the COLOUR
 *                         └─→ countsTowardTotal()  the TOTAL
 *
 * The colour is a rendering. Deciding money by asking "is the cell red"
 * would tie a figure to a presentation choice, so renaming a tint or
 * adding a fourth one would silently move a total. The predicates below
 * are the fact; red is one of the things the fact produces.
 *
 * IN shared/, NOT in buildWorkbook. This is a business rule about what a
 * month owes, and it was living inside the xlsx builder: anything else
 * that needed it (the Division Sheet, Diane, a dashboard later) had to
 * import a spreadsheet writer to ask a money question.
 *
 * NO MODULE-LEVEL FLAG. `useEndDate` is an argument on every call. It was
 * a `let` set by one of two entry points, so the Division Sheet's totals
 * silently ignored the setting entirely.
 *
 * Mirrored in web/src/helpers/paymentStartState.js for the optimistic
 * cell tint. Two codebases, never a shared import.
 */

const START_STATE = Object.freeze({
  RUNNING: 'running',
  STARTED_THIS_MONTH: 'startedThisMonth',
  NOT_STARTED: 'notStarted',
});

/** A real Date, or null. pg hands dates back as Date, uploads as strings. */
function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The day itself, no time. A `date` column carries midnight in some zone. */
function dayOf(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Last day of the month `d` falls in. Excel's EOMONTH(d, 0). */
function endOfMonth(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
}

function startsAfterMonth(row, preset) {
  const start = asDate(row.payment_start_on);
  return Boolean(start && dayOf(start) > endOfMonth(preset));
}

function endedBeforeMonth(row, preset) {
  const end = asDate(row.end_on);
  return Boolean(end && dayOf(end) < dayOf(preset));
}

function startsWithinMonth(row, preset) {
  const start = asDate(row.payment_start_on);
  if (!start) return false;
  return dayOf(start) >= dayOf(preset) && dayOf(start) <= endOfMonth(preset);
}

function endsWithinMonth(row, preset) {
  const end = asDate(row.end_on);
  if (!end) return false;
  return dayOf(end) >= dayOf(preset) && dayOf(end) <= endOfMonth(preset);
}

/**
 * ===============================
 * * A STOP IS NOT THE END DATE, AND IT IS NOT BEHIND THE SETTING
 * ===============================
 * `end_on` is the sheet's own formula, appointment + one year, and it is
 * provisional: it only takes part when `color_uses_end_date` says so, and
 * that defaults false. `stopped_on` is somebody saying this deal is over.
 *
 * SO IT ALWAYS COUNTS. Putting it behind `useEndDate` would mean a deal
 * answered "no, stop paying" carried on being paid until a setting nobody
 * remembers was switched on.
 */
function stoppedBeforeMonth(row, preset) {
  const stopped = asDate(row.stopped_on);
  return Boolean(stopped && dayOf(stopped) < dayOf(preset));
}

function stopsWithinMonth(row, preset) {
  const stopped = asDate(row.stopped_on);
  if (!stopped) return false;
  return dayOf(stopped) >= dayOf(preset) && dayOf(stopped) <= endOfMonth(preset);
}

/**
 * ===============================
 * * SOMEBODY SAID THIS MONTH PAYS IT
 * ===============================
 * The mirror of `stopped_on`: one says the deal is OVER and beats the
 * derived end, this says the month PAYS and beats the derived start.
 * Migration 064.
 *
 * A COLUMN OF ITS OWN, never `manually_overridden_fields`. That list means
 * "do not let an upload overwrite this cell", and an upload, the
 * appointment cascade and Diane can all add to it without anybody deciding
 * anything. Nothing that happens by accident may move a total.
 */
function specialCaseDeal(row) {
  return Boolean(row?.special_case_deal);
}

/**
 * Is anything owed for the month this row is marked for?
 *
 * A row with NO PRESET is the standing roster: owed every month, so there
 * is no month to measure it against and the answer is yes.
 */
function isOwedThisMonth(row, { useEndDate = false } = {}) {
  const preset = asDate(row.preset_on);
  // NO PRESET IS THE STANDING ROSTER, owed every month. Unless somebody
  // stopped it: that is an explicit statement about THIS deal, and it beats
  // a default that exists for rows nobody has said anything about.
  if (!preset) return !row.stopped_on;
  // A STOP STILL WINS. Somebody saying the deal is over beats somebody
  // saying this month pays it, and the order here is the whole of that.
  if (stoppedBeforeMonth(row, preset)) return false;
  if (specialCaseDeal(row)) return true;
  if (startsAfterMonth(row, preset)) return false;
  if (useEndDate && endedBeforeMonth(row, preset)) return false;
  return true;
}

/**
 * The boss's own three conditional formats, rendered off the predicates.
 *
 *   notStarted        red    nothing owed
 *   startedThisMonth  amber  a part month, at either edge
 *   running           green  the whole month
 */
function paymentStartState(row, { useEndDate = false } = {}) {
  const preset = asDate(row.preset_on);
  if (!preset) return START_STATE.RUNNING;
  if (!isOwedThisMonth(row, { useEndDate })) return START_STATE.NOT_STARTED;
  // THE TOGGLE FORCES THE WHOLE MONTH, so this row is never a part month
  // and never amber. Asked before the three part month tests, or a start
  // inside the month would paint amber over a full month's pay.
  if (specialCaseDeal(row)) return START_STATE.RUNNING;
  // A blank start is the sheet's "Ongoing", so it never trips the start
  // half; the end half still applies to it.
  if (startsWithinMonth(row, preset)) return START_STATE.STARTED_THIS_MONTH;
  // The month a deal stops in is a PART MONTH: it was paid up to the stop
  // and amber says so. Same shape the end date gets, without the setting.
  if (stopsWithinMonth(row, preset)) return START_STATE.STARTED_THIS_MONTH;
  if (useEndDate && endsWithinMonth(row, preset)) return START_STATE.STARTED_THIS_MONTH;
  return START_STATE.RUNNING;
}

/**
 * Does this row's money reach the month's figure?
 *
 * TWO SEPARATE RULES, and only the first was ever in question:
 *   1. is anything owed at all (above)
 *   2. is it marked for THIS month, which is `for_this_month`
 *
 * The second is not the end date's business: a row whose own preset says
 * September stays on the sheet, tinted, and out of August's figure.
 */
/**
 * @param {string} [month] 'YYYY-MM' the document is FOR. Only read when the
 *   row was not rolled: `rollToMonth` stamps `for_this_month` and that wins.
 *
 * WITHOUT IT THIS ASKED ABOUT TODAY. An unrolled row was judged against the
 * month the server happens to be in, so a workbook built for August in
 * September counted nothing at all. In production the rows are rolled first
 * and carry the flag, which masked it; thirteen tests found it at midnight
 * on the first of the month, and pointed at the breakdown writer.
 */
function countsTowardTotal(row, { useEndDate = false, month } = {}) {
  if (!isOwedThisMonth(row, { useEndDate })) return false;
  return row.for_this_month ?? isForMonth(row, month);
}

module.exports = {
  START_STATE,
  isOwedThisMonth,
  specialCaseDeal,
  paymentStartState,
  countsTowardTotal,
  startsAfterMonth,
  endedBeforeMonth,
  startsWithinMonth,
  endsWithinMonth,
  stoppedBeforeMonth,
  stopsWithinMonth,
};
