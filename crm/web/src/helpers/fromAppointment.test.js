import test from 'node:test';
import assert from 'node:assert/strict';

import {
  startFromAppointment, endFromAppointment, stillTheFormulasAnswer,
  asColumnDate, PAYMENT_START_OFFSET_DAYS,
} from './fromAppointment.js';
import { payableDaysFor, payableFromDays } from './payable.js';

/**
 * ***************************************************
 * * This side of the contract
 * ***************************************************
 *
 * api/v1/shared/fromAppointment.helper.js is the other half and stays
 * authoritative. These pin THIS copy against the same worked examples, so
 * the two cannot drift without one of them going red.
 *
 * The row throughout is row 12 of docs/boss/references/master.xlsx, Thomas
 * Snelling, INDIGO: appointment 2026-01-20, preset July 2026, monthly 1000.
 */

const D = (iso) => new Date(`${iso}T00:00:00.000Z`);

test('the offset is 90, matching the sheet rather than his documents', () => {
  assert.equal(PAYMENT_START_OFFSET_DAYS, 90);
});

test('the two derivations match his own formulas', () => {
  assert.equal(asColumnDate(startFromAppointment(D('2026-01-20'))), '2026-04-20');
  assert.equal(asColumnDate(endFromAppointment(D('2026-01-20'))), '2027-01-20');
});

test('it takes the cache shape too, which is a string', () => {
  // Cached rows are raw Postgres columns, so a date arrives as YYYY-MM-DD.
  assert.equal(asColumnDate(startFromAppointment('2026-01-20')), '2026-04-20');
});

test('no appointment derives nothing', () => {
  assert.equal(startFromAppointment(null), null);
  assert.equal(endFromAppointment(''), null);
  assert.equal(startFromAppointment('Ongoing'), null);
});

test('29 February rolls to 1 March, the way Excel DATE does', () => {
  assert.equal(asColumnDate(endFromAppointment(D('2028-02-29'))), '2029-03-01');
});

test('an empty cell has nothing to protect', () => {
  assert.equal(stillTheFormulasAnswer(null, '2026-01-20', 'start'), true);
});

test('a cell still equal to the old formula is the formula', () => {
  assert.equal(stillTheFormulasAnswer('2026-04-20', '2026-01-20', 'start'), true);
  assert.equal(stillTheFormulasAnswer('2027-01-20', '2026-01-20', 'end'), true);
});

test('a cell a human typed over is not', () => {
  // The Indigo pair: he used 2026-08-01 where the formula gives 2026-08-26.
  assert.equal(stillTheFormulasAnswer('2026-08-01', '2026-05-28', 'start'), false);
});

/**
 * ===============================
 * * The day count, and the bug it was hiding
 * ===============================
 * withPayable worked the amount out from `row.payable_days`, the count from
 * BEFORE the edit, so moving a payment start painted the new date beside an
 * amount computed against the old one until the refetch landed.
 */

test('the day count is the sheet column I', () => {
  const preset = '2026-07-01'; // July, 31 days
  assert.equal(payableDaysFor('2026-04-20', preset), 31, 'started before the month');
  assert.equal(payableDaysFor('2026-07-14', preset), 18, '14 July to 31 July inclusive');
  assert.equal(payableDaysFor('2026-07-01', preset), 31, 'the first day is a whole month');
  assert.equal(payableDaysFor('2026-08-18', preset), 0, 'starts after the month ended');
});

test('a blank start is Ongoing: no recorded start, full month', () => {
  assert.equal(payableDaysFor(null, '2026-07-01'), 31);
  assert.equal(payableDaysFor('', '2026-07-01'), 31);
});

test('no preset means no month to measure, so the count is unknown', () => {
  // Null, not zero. Zero is "owed nothing", null is "we do not know".
  assert.equal(payableDaysFor('2026-04-20', null), null);
});

test('February is 28 days, never a fixed 30', () => {
  assert.equal(payableDaysFor('2026-01-15', '2026-02-01'), 28);
  assert.equal(payableDaysFor('2024-01-15', '2024-02-01'), 29, 'a leap year');
});

test('the whole chain agrees with his sheet, end to end', () => {
  // Appointment 2026-04-15 -> start 2026-07-14 -> 18 days -> 580.65.
  const start = startFromAppointment('2026-04-15');
  const days = payableDaysFor(start, '2026-07-01');
  const amount = payableFromDays({ monthlyAmount: 1000, presetOn: '2026-07-01', payableDays: days });
  assert.equal(asColumnDate(start), '2026-07-14');
  assert.equal(days, 18);
  assert.equal(amount, 580.65);
});
