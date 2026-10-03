import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentStartState, START_STATE } from './paymentStartState.js';
import { paymentPeriodOf, PERIOD } from './paymentPeriod.js';

/**
 * ***************************************************
 * * CONTRACT: the tint agrees with the server about a STOP
 * ***************************************************
 *
 * This half exists so the cell repaints before the refetch lands. The
 * server's half is api/v1/shared/owedThisMonth.helper.js and its own test
 * beside it; the two repos share no file, so each states the rule and
 * proves its own side.
 *
 * THE RULE: a stop is NOT behind `useEndDate`. The end date is the sheet's
 * provisional formula and only counts when the setting says so; a stop is
 * somebody saying the deal is over.
 */

const AUGUST = '2026-08-01';
const START = '2025-01-01';

// (paymentStartOn, presetOn, endOn, useEndDate, stoppedOn)
const state = (stoppedOn, useEndDate = false, endOn = null) =>
  paymentStartState(START, AUGUST, endOn, useEndDate, stoppedOn);

test('A STOP IS NOT BEHIND THE SETTING', () => {
  assert.equal(state('2026-07-31'), START_STATE.NOT_STARTED, 'setting OFF');
  assert.equal(state('2026-07-31', true), START_STATE.NOT_STARTED, 'and ON');
});

test('an END DATE still is behind the setting, unchanged', () => {
  // The contrast that makes the rule above readable.
  assert.equal(state(null, false, '2026-07-31'), START_STATE.RUNNING);
  assert.equal(state(null, true, '2026-07-31'), START_STATE.NOT_STARTED);
});

test('the month a deal STOPS in is amber, a part month', () => {
  assert.equal(state('2026-08-20'), START_STATE.STARTED_THIS_MONTH);
  assert.equal(state('2026-08-31'), START_STATE.STARTED_THIS_MONTH);
  assert.equal(state('2026-08-01'), START_STATE.STARTED_THIS_MONTH);
});

test('NO PRESET is the standing roster, unless somebody stopped it', () => {
  assert.equal(paymentStartState(START, null, null, false, null), START_STATE.RUNNING);
  assert.equal(
    paymentStartState(START, null, null, false, '2020-01-01'),
    START_STATE.NOT_STARTED,
  );
});

test('EVERY EXISTING CALL STILL READS CORRECTLY without the new argument', () => {
  // It is last and optional precisely so the twenty call sites that never
  // heard of a stop keep the answer they always had.
  assert.equal(paymentStartState(START, AUGUST, null, false), START_STATE.RUNNING);
  assert.equal(paymentStartState('2026-11-01', AUGUST, null, false), START_STATE.NOT_STARTED);
});

test('THE BADGE FOLLOWS THE TINT, so a stopped deal reads Ended', () => {
  const row = (stopped) => ({
    payment_start_on: START, preset_on: AUGUST, end_on: null, stopped_on: stopped,
  });
  assert.equal(paymentPeriodOf(row(null)), PERIOD.ACTIVE);
  assert.equal(paymentPeriodOf(row('2026-08-20')), PERIOD.ACTIVE, 'part month is still active');
  assert.equal(paymentPeriodOf(row('2026-07-31')), PERIOD.ENDED);
});

test('NOT STARTED still beats ENDED on the word', () => {
  // A row that has not begun cannot also have finished.
  assert.equal(
    paymentPeriodOf({
      payment_start_on: '2026-11-01', preset_on: AUGUST, end_on: null, stopped_on: '2026-07-31',
    }),
    PERIOD.NOT_STARTED,
  );
});
