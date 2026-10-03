const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isOwedThisMonth, paymentStartState, countsTowardTotal, START_STATE,
} = require('./owedThisMonth.helper');
const { paymentPeriodSql, periodFor, PERIOD } = require('./paymentPeriod.helper');

/**
 * ***************************************************
 * * A STOPPED DEAL IS OUT OF THE MONTH, ALWAYS
 * ***************************************************
 *
 * `stopped_on` is the first thing in this CRM that can end a deal. Its
 * whole point is that it is NOT the end date: `end_on` is the sheet's own
 * provisional formula and takes part only when `color_uses_end_date` says
 * so, which defaults FALSE. A stop behind that toggle would mean a deal
 * answered "no, stop paying" carried on being paid.
 *
 * One condition, three consumers, and all three are pinned here.
 */

const AUGUST = '2026-08-01';
const live = (over = {}) => ({
  preset_on: AUGUST,
  payment_start_on: '2025-01-01',
  end_on: null,
  stopped_on: null,
  for_this_month: true,
  ...over,
});

// ===============================
// * THE PREDICATE
// ===============================

test('a live deal is owed, with the setting off and on', () => {
  assert.equal(isOwedThisMonth(live()), true);
  assert.equal(isOwedThisMonth(live(), { useEndDate: true }), true);
});

test('A STOP IS NOT BEHIND THE SETTING, which is the whole point', () => {
  const stopped = live({ stopped_on: '2026-07-31' });
  assert.equal(isOwedThisMonth(stopped), false, 'out with the setting OFF');
  assert.equal(isOwedThisMonth(stopped, { useEndDate: true }), false, 'and on');
});

test('an END DATE still is behind the setting, unchanged', () => {
  // The contrast that makes the rule above readable. If this ever matches
  // the stop's behaviour, one of the two has lost its meaning.
  const ended = live({ end_on: '2026-07-31' });
  assert.equal(isOwedThisMonth(ended), true, 'off: the end date does nothing');
  assert.equal(isOwedThisMonth(ended, { useEndDate: true }), false);
});

test('stopped INSIDE the month is still owed: it was paid up to the stop', () => {
  assert.equal(isOwedThisMonth(live({ stopped_on: '2026-08-20' })), true);
});

test('stopped on the LAST day of the month is still owed', () => {
  assert.equal(isOwedThisMonth(live({ stopped_on: '2026-08-31' })), true);
});

test('stopped on the FIRST day of the month is still owed, not before it', () => {
  assert.equal(isOwedThisMonth(live({ stopped_on: '2026-08-01' })), true);
});

test('NO PRESET IS THE STANDING ROSTER, unless somebody stopped it', () => {
  // "A row with no preset is always counted" is a default for rows nobody
  // has said anything about. A stop is somebody saying something.
  assert.equal(isOwedThisMonth(live({ preset_on: null })), true);
  assert.equal(isOwedThisMonth(live({ preset_on: null, stopped_on: '2020-01-01' })), false);
});

// ===============================
// * THE COLOUR
// ===============================

test('the month a deal STOPS in is amber, a part month', () => {
  assert.equal(
    paymentStartState(live({ stopped_on: '2026-08-20' })),
    START_STATE.STARTED_THIS_MONTH,
  );
});

test('stopped before the month is red, with the setting off', () => {
  assert.equal(
    paymentStartState(live({ stopped_on: '2026-07-31' })),
    START_STATE.NOT_STARTED,
  );
});

// ===============================
// * THE TOTAL
// ===============================

test('a stopped deal leaves the total, and its money with it', () => {
  assert.equal(countsTowardTotal(live()), true);
  assert.equal(countsTowardTotal(live({ stopped_on: '2026-07-31' })), false);
});

test('stopped inside the month still counts: the part month is owed', () => {
  assert.equal(countsTowardTotal(live({ stopped_on: '2026-08-20' })), true);
});

// ===============================
// * THE BADGE
// ===============================

test('THE BADGE FOLLOWS THE TINT, so a stopped deal reads Ended', () => {
  // The contract: green or amber is Active, red is Ended or Not yet paying.
  // A badge that disagreed with the colour beside it is the fault the
  // override was removed for.
  assert.equal(periodFor(live()), PERIOD.ACTIVE);
  assert.equal(periodFor(live({ stopped_on: '2026-08-20' })), PERIOD.ACTIVE, 'part month is still active');
  assert.equal(periodFor(live({ stopped_on: '2026-07-31' })), PERIOD.ENDED);
});

test('NOT STARTED still beats ENDED on the word, order unchanged', () => {
  // A row that has not begun cannot also have finished. Splitting the badge
  // must not quietly relabel eleven future deals.
  const future = live({ payment_start_on: '2026-11-01', stopped_on: '2026-07-31' });
  assert.equal(periodFor(future), PERIOD.NOT_STARTED);
});

test('THE SQL MIRRORS THE JS, branch for branch', () => {
  const sql = paymentPeriodSql('d');
  // The stop is checked, and NOT behind the settings lookup.
  assert.match(sql, /d\.stopped_on IS NOT NULL AND d\.stopped_on </);
  const stopBranch = sql.indexOf('d.stopped_on IS NOT NULL AND');
  const settingBranch = sql.indexOf('color_uses_end_date');
  assert.ok(stopBranch < settingBranch, 'the stop is decided before the setting is even read');
  /**
   * NOT STARTED STILL BEATS ENDED ON THE WORD, and it is now decided
   * INSIDE the stop branch. `special_case_deal` had to sit between the stop
   * and the plain not started test, so a flat ordering could no longer
   * carry both rules; the stop branch owns its own nested CASE. Asserted
   * on that structure rather than on where a word falls in the string.
   */
  const notStartedInStop = sql.indexOf('not_started', stopBranch);
  const endedInStop = sql.indexOf("ELSE 'ended' END", stopBranch);
  assert.ok(notStartedInStop > 0 && notStartedInStop < endedInStop,
    'a row that has not begun cannot have finished');
  // And the toggle is asked AFTER the stop: somebody saying the deal is
  // over beats somebody saying this month pays it. Migration 064.
  assert.ok(stopBranch < sql.indexOf('special_case_deal'), 'the toggle outranks a stop');
  // The no preset row: standing roster, unless stopped.
  assert.match(sql, /d\.preset_on IS NULL AND d\.stopped_on IS NOT NULL THEN 'ended'/);
});
