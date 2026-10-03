/**
 * A deal's PAYMENT PERIOD, worked out at read time.
 *
 * `active` / `ended`, and it is about the PERSON on that row, never the
 * company. The sheet's own column is "Provisional payment end date", a
 * formula giving one year after that row's own payment start date, so two
 * handlers on one company legitimately end on different dates — three of
 * the thirty-three companies in the live sheet do exactly that. Calling
 * this "status" beside the company's own active/closed status is what made
 * it read as company life, and it never was.
 *
 * WHY IT IS COMPUTED HERE RATHER THAN READ FROM THE COLUMN.
 *
 * `tb_mastersheet.status` is written once, at upload, by identity.js's
 * statusFor. Nothing recomputed it, so the value went stale the day an end
 * date passed: a row said `active` all the way through the month after its
 * payment period had actually finished, and only a fresh upload or a hand
 * edit of that row put it right. Deriving it on every read means the page
 * is right with no upload. WHAT it is derived against is below, and it is
 * the row's own month rather than today.
 *
 * NO HAND-SET VALUE WINS ANY MORE, 2026-09-09.
 *
 * There was an override: 'status' in `manually_overridden_fields` and this
 * returned the stored column. It was documented as deliberate, and it was
 * wrong, because `isOwedThisMonth` never saw the claim so the money never
 * moved with it. A row read Ended beside a GREEN payment start cell with
 * its amount still in the month's total. See the block below.
 *
 * The stored column is still written at upload and still filtered on, so
 * this only changes what is DISPLAYED, never what is saved.
 *
 * @param {string} alias table alias holding the mastersheet row ('d', 'm')
 * @returns {string} a SQL expression yielding 'active' or 'ended'
 */
/**
 * ===============================
 * * DERIVED, NEVER SET. THE BADGE IS A FUNCTION OF THE TINT.
 * ===============================
 * There WAS an override: `status` in `manually_overridden_fields` and this
 * returned the stored column instead of computing. It is gone, 2026-09-09.
 *
 * It let a row read Ended beside a GREEN payment start cell with its amount
 * still in the month's total, because `isOwedThisMonth` never saw the
 * override and the money never moved. Gloria carried four deals with
 * identical dates and read Ended on two of them. The tooltip said the quiet
 * part out loud: "the end date on this deal is January 1, 2026, so it would
 * otherwise read active."
 *
 * So the contract holds without exception now:
 *
 *     green or amber -> Active
 *     red            -> Ended, or Not yet paying
 *
 * and red asks one extra question to say which. To change the period,
 * change the payment start, the preset or the end date. Nothing writes
 * `status`: `ROW_FIELDS` dropped it and the Person page's cell is a badge.
 * Migration 049 cleared every claim that was left.
 */

/**
 * ===============================
 * * THE PERIOD IS THE PRESET FORMULA, NOT THE END DATE
 * ===============================
 * ONE CONDITION, THREE CONSUMERS. `owedThisMonth.helper` decides whether
 * anything is owed for the month a row is marked for, and three things now
 * render that one answer:
 *
 *     isOwedThisMonth()  ─┬─→ paymentStartState()  the cell COLOUR
 *                         ├─→ countsTowardTotal()  the TOTAL
 *                         └─→ paymentPeriodSql()   this BADGE
 *
 * So a GREEN or AMBER payment start cell is Active and a RED one is not,
 * always, and the badge can no longer contradict the colour beside it.
 *
 * IT READ THE END DATE DIRECTLY, which is the reading the whole CRM moved
 * off. Six NEXUS deals with the same August preset came out four Ended and
 * two Active purely because their end dates were appointment + 1 year and
 * the appointments differed. Every one of them starts before August, so
 * every one is owed, and the boss's own file has no end dates on them at
 * all.
 *
 * THE END DATE TAKES PART ONLY THROUGH THE SETTING, read here in SQL rather
 * than threaded through every caller: it is one boolean on a one-row table,
 * and a page that forgot to pass it would quietly show a different answer
 * from the page next to it.
 *
 * NO PRESET IS NO MONTH TO MEASURE, so those are Active: the standing
 * roster, owed every month.
 *
 * ===============================
 * * NOT STARTED IS NOT ENDED
 * ===============================
 * A deal whose payment start is AFTER the month said `ended`, so a row that
 * has not begun read as one that had finished. Every Ended badge on the
 * first page of the live sheet was one of these: eleven rows starting in
 * October or November, not one of them with an end date.
 *
 * It also made the word meaningless. With the end date setting off, which
 * is the default, the end-date branch never fires, so `ended` could ONLY
 * ever have meant "has not started".
 *
 * THE MONEY WAS ALWAYS RIGHT. `isOwedThisMonth` excludes both alike and
 * still does; this splits the WORD, never the arithmetic, so no total and
 * no cell colour moves. The order matters: the start is asked about first,
 * because a row that has not begun cannot also have finished.
 */
const PERIOD = Object.freeze({
  ACTIVE: 'active',
  ENDED: 'ended',
  NOT_STARTED: 'not_started',
});

function paymentPeriodSql(alias = 'd') {
  const a = alias ? `${alias}.` : '';
  const monthStart = `date_trunc('month', ${a}preset_on)::date`;
  const monthEnd = `(date_trunc('month', ${a}preset_on) + interval '1 month - 1 day')::date`;
  /**
   * ===============================
   * * A STOP IS NOT BEHIND THE SETTING
   * ===============================
   * `end_on` takes part only when `color_uses_end_date` says so, because it
   * is the sheet's own provisional formula. `stopped_on` is somebody saying
   * this deal is over, so it counts always.
   *
   * MIRRORS `isOwedThisMonth` BRANCH FOR BRANCH, including the order: NOT
   * STARTED is still asked first, because a row that has not begun cannot
   * also have finished, and that is the split this CASE exists to keep.
   *
   * The no-preset row is the standing roster, Active, unless it was stopped:
   * an explicit stop beats a default meant for rows nobody spoke about.
   */
  // The word for a row the money has already ruled out. NOT STARTED is
  // asked first, because a row that has not begun cannot also have
  // finished, and that is the split this CASE exists to keep.
  const notStarted = `${a}payment_start_on IS NOT NULL AND ${a}payment_start_on > ${monthEnd}`;
  return `CASE
    WHEN ${a}preset_on IS NULL AND ${a}stopped_on IS NOT NULL THEN '${PERIOD.ENDED}'
    WHEN ${a}preset_on IS NULL THEN '${PERIOD.ACTIVE}'
    /**
     * A STOP BEATS THE TOGGLE, and it is asked first for that reason.
     * Somebody saying the deal is over beats somebody saying this month
     * pays it. The nested CASE is what keeps the WORD in step with
     * periodFor(): the money is settled here, and not started is still
     * asked before ended.
     */
    WHEN ${a}stopped_on IS NOT NULL AND ${a}stopped_on < ${monthStart}
      THEN CASE WHEN ${notStarted} THEN '${PERIOD.NOT_STARTED}' ELSE '${PERIOD.ENDED}' END
    -- Somebody said this month pays it. Migration 064, and the same branch
    -- in the same order as isOwedThisMonth.
    WHEN ${a}special_case_deal THEN '${PERIOD.ACTIVE}'
    WHEN ${notStarted} THEN '${PERIOD.NOT_STARTED}'
    WHEN COALESCE((SELECT color_uses_end_date FROM tb_settings LIMIT 1), false)
     AND ${a}end_on IS NOT NULL AND ${a}end_on < ${monthStart} THEN '${PERIOD.ENDED}'
    ELSE '${PERIOD.ACTIVE}'
  END`;
}

/**
 * The same rule in JS, for rows already in hand.
 *
 * ONE DEFINITION, TWO LANGUAGES, the same arrangement `isPeriodEnded` below
 * already uses. It defers to `isOwedThisMonth` rather than restating the
 * comparisons, so the badge cannot drift from the colour.
 */
function periodEnded(row, { useEndDate = false } = {}) {
  // Required lazily: owedThisMonth has no dependencies of its own, but
  // requiring it at the top would make two shared helpers circular the
  // moment either one grows.
  // eslint-disable-next-line global-require
  const { isOwedThisMonth } = require('./owedThisMonth.helper');
  return !isOwedThisMonth(row, { useEndDate });
}

/** Has this row's payment start not arrived by the end of its preset month? */
function startsAfterMonth(row) {
  const start = row?.payment_start_on ? new Date(row.payment_start_on) : null;
  const preset = row?.preset_on ? new Date(row.preset_on) : null;
  if (!start || !preset || Number.isNaN(start.getTime()) || Number.isNaN(preset.getTime())) {
    return false;
  }
  const monthEnd = Date.UTC(preset.getUTCFullYear(), preset.getUTCMonth() + 1, 0);
  const at = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  return at > monthEnd;
}

/**
 * The THREE-state period in JS, matching `paymentPeriodSql` branch for
 * branch. `periodEnded` above answers the money question, "is anything
 * owed"; this answers the WORD question, "why not".
 */
function periodFor(row, opts = {}) {
  if (!periodEnded(row, opts)) return PERIOD.ACTIVE;
  return startsAfterMonth(row) ? PERIOD.NOT_STARTED : PERIOD.ENDED;
}

/**
 * How each state is said out loud, for Diane's cards and anything else
 * printing the raw value. `not_started` unlabelled reads as a column name.
 *
 * A DELIBERATE MIRROR of web/src/components/badges/StatusBadge.jsx LABELS.
 */
const PERIOD_LABEL = Object.freeze({
  [PERIOD.ACTIVE]: 'Active',
  [PERIOD.ENDED]: 'Ended',
  [PERIOD.NOT_STARTED]: 'Not yet paying',
});

/**
 * A PERSON's pay status, from the deals underneath them.
 *
 * `paying` while any one of their deals is still in its payment period,
 * `ended` once every last one has finished. Deliberately not a count: the
 * People row already carries "1 of 3" for companies, and the question this
 * answers is the blunt one — is this person still being paid at all.
 *
 * Reads the `payment_period` that `paymentPeriodSql` already put on the
 * deals CTE rather than deriving it a second time, so there is exactly one
 * definition of when a period is over.
 *
 * Must be used inside an aggregate over their deals.
 *
 * @param {string} alias table alias holding the deals row
 * @returns {string} a SQL expression yielding 'paying' or 'ended'
 */
function payStatusSql(alias = 'd') {
  const a = alias ? `${alias}.` : '';
  // THREE, for the same reason the period has three. Somebody whose only
  // deals start in November has not finished being paid; they have not
  // begun. 'ended' is reserved for a person with nothing left to come.
  return `CASE
    WHEN COUNT(*) FILTER (WHERE ${a}payment_period = '${PERIOD.ACTIVE}') > 0 THEN 'paying'
    WHEN COUNT(*) FILTER (WHERE ${a}payment_period = '${PERIOD.NOT_STARTED}') > 0 THEN '${PERIOD.NOT_STARTED}'
    ELSE 'ended'
  END`;
}

/**
 * The same question in JS, for code holding rows rather than writing SQL.
 *
 * `period_ended` is set by rollToMonth, so it exists only on a sheet
 * rolled to a month. On a raw export it is undefined, and everything that
 * tested it alone therefore treated every finished deal as live: MANBAT's
 * six deals are all ended and its exported group total still printed GBP
 * 9,250, with the rows themselves untinted, while the export modal
 * promised a finished period was "marked in the file".
 *
 * So `payment_period` is the fallback, which is what `paymentPeriodSql`
 * above put on the row in the first place. One definition, two languages.
 */
function isPeriodEnded(row) {
  // NOT STARTED COUNTS AS NOT RUNNING HERE. Every caller asks "is this deal
  // in its payment period", and a row that has not begun is not. Splitting
  // the badge must not quietly make eleven future deals live in the Active
  // company list. Written as a set rather than `!== 'active'` so a row
  // carrying neither value keeps the answer it always had.
  const ended = [PERIOD.ENDED, PERIOD.NOT_STARTED];
  return row?.period_ended ?? ended.includes(row?.payment_period ?? row?.status);
}

module.exports = {
  paymentPeriodSql, payStatusSql, isPeriodEnded, periodEnded, periodFor,
  startsAfterMonth, PERIOD, PERIOD_LABEL,
};
