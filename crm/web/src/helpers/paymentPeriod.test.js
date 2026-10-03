import test from 'node:test';
import assert from 'node:assert/strict';

import { paymentPeriodOf, PERIOD_INPUTS, PERIOD_FILTER_OPTIONS } from './paymentPeriod.js';
// The whole module, so a test can assert something is NOT exported.
import * as helpers from './paymentPeriod.js';
import { paymentStartState, START_STATE } from './paymentStartState.js';

/**
 * ***************************************************
 * * The badge is the colour, in words
 * ***************************************************
 *
 * ONE CONDITION, THREE CONSUMERS: the payment start cell's colour, the
 * month's total, and this badge. GREEN or AMBER is Active, RED is not.
 *
 * It read the end date directly, so six NEXUS deals on one August preset
 * came out four Ended and two Active purely because their end dates were
 * appointment plus a year.
 */

const row = (over) => ({
  payment_start_on: '2025-04-01', preset_on: '2026-08-01', end_on: null, ...over,
});

test('running already, or starting inside the month, is active', () => {
  assert.equal(paymentPeriodOf(row()), 'active');
  assert.equal(paymentPeriodOf(row({ payment_start_on: '2026-08-15' })), 'active');
});

test('starting after the month is NOT STARTED, never ended', () => {
  // Eleven rows on page one of the live sheet said Ended while starting in
  // October or November, none of them with an end date at all.
  assert.equal(paymentPeriodOf(row({ payment_start_on: '2026-09-01' })), 'not_started');
  assert.equal(paymentPeriodOf(row({ payment_start_on: '2026-11-03' })), 'not_started');
});

test('ENDED means finished, and needs the setting on to happen at all', () => {
  // With the toggle off the end date is never read, so 'ended' could only
  // ever have meant "has not started". That is what made the word useless.
  const finished = row({ payment_start_on: '2025-04-01', end_on: '2026-01-01' });
  assert.equal(paymentPeriodOf(finished, true), 'ended');
  assert.equal(paymentPeriodOf(finished, false), 'active');
});

test('not started beats finished when a row is somehow both', () => {
  // Same order as the server's CASE: a row that has not begun cannot have
  // finished, whatever its end date says.
  const both = row({ payment_start_on: '2026-11-03', end_on: '2026-01-01' });
  assert.equal(paymentPeriodOf(both, true), 'not_started');
});

test('THE SIX NEXUS DEALS ARE ALL ACTIVE, whatever their end dates', () => {
  const nexus = [
    ['Abe', '2025-06-04', '2026-03-06'],
    ['Juan Estrada', '2025-06-04', '2026-03-06'],
    ['Gloria', '2025-04-01', '2026-01-01'],
    ['Pino', '2025-04-01', '2026-01-01'],
    ['Dewell', '2025-11-04', '2026-08-06'],
    ['Drew', '2025-11-04', '2026-08-06'],
  ];
  for (const [who, start, end] of nexus) {
    assert.equal(
      paymentPeriodOf(row({ payment_start_on: start, end_on: end })), 'active',
      `${who} should be active`,
    );
  }
});

test('the end date only counts when the setting says so', () => {
  const r = row({ end_on: '2026-01-01' });
  assert.equal(paymentPeriodOf(r, false), 'active');
  assert.equal(paymentPeriodOf(r, true), 'ended');
});

test('ending INSIDE the month is still active, even with the setting on', () => {
  // The boss pays a deal that ended on the 26th for the whole month.
  assert.equal(paymentPeriodOf(row({ end_on: '2026-08-26' }), true), 'active');
});

test('no preset is no month to measure, so active', () => {
  assert.equal(paymentPeriodOf({ preset_on: null, end_on: '2020-01-01' }), 'active');
});

test('A HAND-SET STATUS IS IGNORED. The dates decide, and only the dates', () => {
  // It used to win. That let a row read Ended beside a GREEN payment start
  // cell with its amount still in the month's total, because
  // isOwedThisMonth never saw the claim and the money never moved. Gloria
  // carried four deals with identical dates and read Ended on two of them.
  // Removed 2026-09-09; migration 052 cleared the claims left behind.
  const held = { manually_overridden_fields: ['status'] };
  // A stale 'ended' on a row whose dates say it is running.
  assert.equal(paymentPeriodOf({ ...row(), status: 'ended', ...held }), 'active');
  // And a stale 'active' on a row that has not begun.
  assert.equal(
    paymentPeriodOf({ ...row({ payment_start_on: '2026-12-01' }), status: 'active', ...held }),
    'not_started',
  );
});

test('THE BADGE AND THE COLOUR CANNOT DISAGREE', () => {
  // The third state splits the WORD, never the arithmetic: red is still
  // exactly "not active", so no total and no tint moves. Both non-active
  // words must map back to red, and active to green or amber.
  const starts = [null, '2025-04-01', '2026-08-01', '2026-08-20', '2026-09-05'];
  const ends = [null, '2026-01-01', '2026-08-26', '2027-01-01'];
  let sawNotStarted = false;
  let sawEnded = false;

  for (const useEndDate of [false, true]) {
    for (const s of starts) {
      for (const e of ends) {
        const red = paymentStartState(s, '2026-08-01', e, useEndDate) === START_STATE.NOT_STARTED;
        const period = paymentPeriodOf(row({ payment_start_on: s, end_on: e }), useEndDate);
        const where = `start=${s} end=${e} useEndDate=${useEndDate}`;

        assert.equal(period !== 'active', red, where);
        if (period === 'not_started') sawNotStarted = true;
        if (period === 'ended') sawEnded = true;
      }
    }
  }

  // Guards the guard: `period !== 'active'` would hold if one of the two
  // never occurred, and then this test would prove nothing about the split.
  assert.ok(sawNotStarted, 'no case produced not_started');
  assert.ok(sawEnded, 'no case produced ended');
});

test('THERE IS NO EDIT LIST. The period cannot be picked anywhere', () => {
  // `periodEditOptions` and `PERIOD_EDIT_OPTIONS` fed the three cells that
  // could set it by hand: the Master sheet, the Person page and the Company
  // page. All three are badges now.
  const mod = helpers;
  assert.equal(mod.periodEditOptions, undefined);
  assert.equal(mod.PERIOD_EDIT_OPTIONS, undefined);
});

test('FILTERING still offers all three, because all three are real answers', () => {
  // Reading was never the problem. Only writing was.
  assert.deepEqual(PERIOD_FILTER_OPTIONS.map((o) => o.value), ['active', 'ended', 'not_started']);
});

test('the payment START is one of the columns a patch watches', () => {
  // It was not, while this read the end date, so moving somebody's start
  // date left the badge behind.
  assert.deepEqual([...PERIOD_INPUTS].sort(), ['endOn', 'paymentStartOn', 'presetOn', 'status']);
});
