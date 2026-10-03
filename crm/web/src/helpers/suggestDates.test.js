import test from 'node:test';
import assert from 'node:assert/strict';

import { suggestDates, mismatchedDates } from './suggestDates.js';

/**
 * ***************************************************
 * * This side of the contract
 * ***************************************************
 *
 * api/v1/shared/suggestDates.helper.js is the other half and stays
 * authoritative. These are its own test's cases, run against THIS copy, so
 * the two cannot drift without one of them going red.
 */

const row = (over) => ({
  assigned_on: null, payment_start_on: null, end_on: null, ...over,
});

test('case 1, all three: nothing to suggest', () => {
  assert.equal(suggestDates(row({
    assigned_on: '2026-01-20', payment_start_on: '2026-04-20', end_on: '2027-01-20',
  })), null);
});

test('case 8, none of the three: correct as blank, never a fault', () => {
  // The twelve `Ongoing` rows, and the four on the screenshot that started
  // this. Marking them would put the standing roster in amber for nothing.
  assert.equal(suggestDates(row()), null);
});

test('case 2, the end date is missing: forward from the appointment', () => {
  const out = suggestDates(row({ assigned_on: '2026-01-20', payment_start_on: '2026-04-20' }));
  assert.equal(out.direction, 'forward');
  assert.deepEqual(out.fields, { endOn: '2027-01-20' });
  assert.equal(out.from, 'appointment date');
});

test('case 3, the payment start is missing: forward, the END FULL shape', () => {
  const out = suggestDates(row({ assigned_on: '2026-05-28', end_on: '2027-05-28' }));
  assert.equal(out.direction, 'forward');
  assert.deepEqual(out.fields, { paymentStartOn: '2026-08-26' });
});

test('case 4, only the appointment: both dates follow it', () => {
  const out = suggestDates(row({ assigned_on: '2026-01-20' }));
  assert.equal(out.direction, 'forward');
  assert.deepEqual(out.fields, { paymentStartOn: '2026-04-20', endOn: '2027-01-20' });
});

test('case 5, no appointment: BACKWARD, and it says so', () => {
  const out = suggestDates(row({ payment_start_on: '2026-04-20', end_on: '2027-01-20' }));
  assert.equal(out.direction, 'backward', 'so the cell can say this one is invented');
  assert.deepEqual(out.fields, { assignedOn: '2026-01-20' });
  assert.equal(out.from, 'payment start date');
});

test('case 6, only the payment start: the appointment and the end follow', () => {
  const out = suggestDates(row({ payment_start_on: '2026-04-20' }));
  assert.equal(out.direction, 'backward');
  assert.deepEqual(out.fields, { assignedOn: '2026-01-20', endOn: '2027-01-20' });
});

test('case 7, only the end date: minus a YEAR gives the appointment', () => {
  // The step that is easy to get wrong. The end date is built off the
  // APPOINTMENT, so end minus one year is the appointment, not the payment
  // start; the start is then that plus 90.
  const out = suggestDates(row({ end_on: '2027-01-20' }));
  assert.equal(out.direction, 'backward');
  assert.deepEqual(out.fields, { assignedOn: '2026-01-20', paymentStartOn: '2026-04-20' });
  assert.equal(out.from, 'end date');
});

test('the payment start is preferred over the end date when both exist', () => {
  const out = suggestDates(row({ payment_start_on: '2026-04-20', end_on: '2030-01-01' }));
  assert.equal(out.from, 'payment start date');
  assert.equal(out.fields.assignedOn, '2026-01-20');
});

test('prose in a date column is not a date', () => {
  assert.equal(suggestDates(row({ assigned_on: 'Ongoing', payment_start_on: 'Ongoing' })), null);
});

test('a row whose dates follow the formula is not flagged', () => {
  assert.equal(mismatchedDates(row({
    assigned_on: '2026-01-20', payment_start_on: '2026-04-20', end_on: '2027-01-20',
  })), null);
});

test('THE INDIGO PAIR: a typed start that disagrees is reported, never corrected', () => {
  const off = mismatchedDates(row({
    assigned_on: '2026-05-28', payment_start_on: '2026-08-01',
  }));
  assert.equal(off.length, 1);
  assert.deepEqual(off[0], {
    field: 'paymentStartOn', is: '2026-08-01', formula: '2026-08-26',
  });
});

test('with no appointment there is no formula to disagree with', () => {
  assert.equal(mismatchedDates(row({ payment_start_on: '2026-08-01' })), null);
});
