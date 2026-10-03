import test from 'node:test';
import assert from 'node:assert/strict';

import { dateNoticesFor } from './dateNotices.js';

/**
 * ***************************************************
 * * Which of the three cells gets a marker, and what it may do
 * ***************************************************
 *
 * The rule the screenshot asked for: an empty date cell says nothing unless
 * the sheet's own formula can answer it. A row carrying none of the three
 * is the `Ongoing` roster and stays bare.
 */

const row = (over) => ({
  assigned_on: null, payment_start_on: null, end_on: null, ...over,
});

test('a row with none of the three is left alone', () => {
  // Richard, Sp, SV and TTT. Marking these would put the standing roster in
  // icons for nothing.
  assert.deepEqual(dateNoticesFor(row()), {});
});

test('a row with all three, agreeing, is left alone', () => {
  assert.deepEqual(dateNoticesFor(row({
    assigned_on: '2026-01-20', payment_start_on: '2026-04-20', end_on: '2027-01-20',
  })), {});
});

test('a missing end date is marked on the END DATE cell, not the appointment', () => {
  const out = dateNoticesFor(row({ assigned_on: '2026-01-20', payment_start_on: '2026-04-20' }));
  assert.deepEqual(Object.keys(out), ['end_on']);
  // GOLD, not green. The cell is empty and one press fills it, so it is
  // work rather than context, and in green it was scrolled past.
  assert.equal(out.end_on.tone, 'action');
  assert.deepEqual(out.end_on.fields, { endOn: '2027-01-20' });
  assert.equal(out.end_on.saveLabel, 'end date');
  assert.match(out.end_on.body.join(' '), /January 20, 2027/);
  assert.match(out.end_on.body.join(' '), /appointment \+ 1 year/);
});

test('the payment start says the offset in words, read off the constant', () => {
  const out = dateNoticesFor(row({ assigned_on: '2026-05-28', end_on: '2027-05-28' }));
  assert.deepEqual(Object.keys(out), ['payment_start_on']);
  assert.match(out.payment_start_on.body.join(' '), /appointment \+ 90 days/);
  assert.deepEqual(out.payment_start_on.fields, { paymentStartOn: '2026-08-26' });
});

test('two missing dates put a marker on BOTH, each accepting the whole patch', () => {
  const out = dateNoticesFor(row({ assigned_on: '2026-01-20' }));
  assert.deepEqual(Object.keys(out).sort(), ['end_on', 'payment_start_on']);
  const patch = { paymentStartOn: '2026-04-20', endOn: '2027-01-20' };
  assert.deepEqual(out.end_on.fields, patch, 'accepting either fills both');
  assert.deepEqual(out.payment_start_on.fields, patch);
  assert.equal(out.end_on.accept, 'Fill both');
  assert.equal(out.end_on.saveLabel, 'dates');
  assert.match(out.end_on.body.join(' '), /fills the payment start/);
});

test('NO APPOINTMENT IS AMBER, and it is the only marker on the row', () => {
  // The other empty cells here follow from a date the CRM invented, so an
  // ordinary grey "this follows the formula" on them would misreport it.
  const out = dateNoticesFor(row({ payment_start_on: '2026-04-20' }));
  assert.deepEqual(Object.keys(out), ['assigned_on']);
  assert.equal(out.assigned_on.tone, 'warning');
  assert.deepEqual(out.assigned_on.fields, {
    assignedOn: '2026-01-20', endOn: '2027-01-20',
  });
  assert.match(out.assigned_on.body.join(' '), /cannot recover it/);
  assert.match(out.assigned_on.body.join(' '), /payment start date/);
});

test('A DATE SET BY HAND IS REPORTED AND CANNOT BE ACCEPTED', () => {
  // The INDIGO pair. No `fields`, so CellSuggestion draws no button.
  const out = dateNoticesFor(row({
    assigned_on: '2026-05-28', payment_start_on: '2026-08-01', end_on: '2027-05-28',
  }));
  assert.deepEqual(Object.keys(out), ['payment_start_on']);
  assert.equal(out.payment_start_on.fields, undefined, 'nothing to write');
  assert.equal(out.payment_start_on.accept, undefined);
  // Green, and it is the only one of the three that is: nothing to do.
  assert.equal(out.payment_start_on.tone, 'info');
  assert.match(out.payment_start_on.body.join(' '), /August 1, 2026/);
  assert.match(out.payment_start_on.body.join(' '), /August 26, 2026/);
});

test('a suggestion and a hand-set date land on DIFFERENT cells, never fighting', () => {
  // Appointment and a typed start, no end: the end is suggested, the start
  // is reported. One marker per fact, on the column it is about.
  const out = dateNoticesFor(row({ assigned_on: '2026-05-28', payment_start_on: '2026-08-01' }));
  assert.deepEqual(Object.keys(out).sort(), ['end_on', 'payment_start_on']);
  assert.ok(out.end_on.fields, 'the end date can be filled');
  assert.equal(out.payment_start_on.fields, undefined, 'the typed start is left alone');
});

/**
 * ===============================
 * * What the end date toggle is costing, said on the cell
 * ===============================
 * With the end date out of the paying decision, a deal that finished months
 * ago still reads Active, still tints green, and its amount is still in the
 * month's figure. Correct, and invisible, which is how somebody pays a
 * finished deal. Gloria's four rows all ended 1 January 2026 against a
 * September 2026 preset and every one of them was still being counted.
 */

const gloria = (over) => row({
  assigned_on: '2025-01-01',
  payment_start_on: '2025-04-01',
  preset_on: '2026-09-01',
  end_on: '2026-01-01',
  payable_amount: 500,
  currency: 'GBP',
  ...over,
});

/**
 * A PASSED END DATE IS A REVIEW, NOT A CLOSURE. It used to say the row was
 * still counting and point at the Settings toggle. The end date ends
 * nothing: a company's life is its status, and a deal's is decided by
 * answering it in the Review list. An end date before the month is the
 * FIRST of that queue's three reasons, monthlyReview.repo DUE_SQL.
 */
test('THE TOGGLE OFF: the end date cell says the deal is up for review', () => {
  const out = dateNoticesFor(gloria(), { useEndDate: false });
  assert.equal(out.end_on.tone, 'warning');
  assert.match(out.end_on.label, /Up for review this month/);
  const body = out.end_on.body.join(' ');
  assert.match(body, /January 1, 2026/);
  assert.match(body, /in the Review list/);
  assert.match(body, /still in the total/);
  assert.doesNotMatch(body, /Settings/, 'no toggle decides this any more');
  assert.equal(out.end_on.fields, undefined, 'nothing to accept, it is not a suggestion');
});

test('THE TOGGLE ON: nothing to warn about, the row already reads Ended', () => {
  const out = dateNoticesFor(gloria(), { useEndDate: true });
  assert.equal(out.end_on, undefined);
});

test('an end date INSIDE the preset month is not passed', () => {
  // Ending on the 26th is still a paid part month, not a finished deal.
  // The cell may still carry something else (this row's end date is not
  // what its appointment implies, so it gets the set-by-hand note), which
  // is why this asserts the WARNING is absent rather than the cell is bare.
  const out = dateNoticesFor(gloria({ end_on: '2026-09-26' }), { useEndDate: false });
  assert.notEqual(out.end_on?.label, 'Up for review this month');
  assert.notEqual(out.end_on?.tone, 'warning');
});

test('it names the money when there is money, and stays quiet when there is not', () => {
  const withMoney = dateNoticesFor(gloria(), { useEndDate: false });
  assert.match(withMoney.end_on.body.join(' '), /500/);
  const without = dateNoticesFor(gloria({ payable_amount: 0 }), { useEndDate: false });
  assert.match(without.end_on.body.join(' '), /its amount is still in the total/);
});

test('IT WINS THE CELL over a note about the formula', () => {
  // A deal that finished months ago and is still being paid outranks
  // "this end date is not what the appointment implies".
  const out = dateNoticesFor(gloria({ end_on: '2026-02-02' }), { useEndDate: false });
  assert.equal(out.end_on.tone, 'warning');
  assert.match(out.end_on.label, /Up for review this month/);
});

test('the default is the toggle OFF, which is the CRM default', () => {
  assert.ok(dateNoticesFor(gloria()).end_on, 'no options means the setting is off');
});
