const test = require('node:test');
const assert = require('node:assert');

const { resolveDerived } = require('./resolveDerived.helper');
const { recomputePayable } = require('./recomputePayable.helper');

/**
 * ***************************************************
 * * A derived column follows its inputs, never the file
 * ***************************************************
 *
 * The fault these pin: the upsert decided every column on its own, so a
 * claimed `monthly_amount` stayed at the admin's 2000 while `payable_amount`
 * took the file's figure, computed off 1100. The row then printed a number
 * that followed neither its own rate nor its own dates.
 */

// July 2026: 31 days, so a full month is 31 and the divisor is 31.
const PRESET = new Date('2026-07-01T00:00:00.000Z');
const START = new Date('2026-04-01T00:00:00.000Z');

const ALL_COLUMNS = new Set([
  'payment_start_on', 'preset_on', 'monthly_amount', 'payable_days', 'payable_amount',
]);

const storedRow = (over) => ({
  payment_start_on: START,
  preset_on: PRESET,
  monthly_amount: 2000,
  payable_days: 31,
  payable_amount: 2000,
  ...over,
});

const incomingRow = (over) => ({
  paymentStartOn: START,
  presetOn: PRESET,
  monthlyAmount: 1100,
  payableDays: 31,
  payableAmount: 1100,
  ...over,
});

test('nothing claimed and the file carried everything: the parser wins, untouched', () => {
  const out = resolveDerived(incomingRow(), storedRow(), new Set(), ALL_COLUMNS);
  // null means "leave the row alone", which also preserves the parser's
  // startUnknown handling. Recomputing here without it would turn "we do
  // not know" into a full month.
  assert.equal(out, null);
});

test('a new row has nothing to resolve against', () => {
  assert.equal(resolveDerived(incomingRow(), null, new Set(), ALL_COLUMNS), null);
});

test('THE BUG: a claimed monthly amount drags the payable amount with it', () => {
  const out = resolveDerived(
    incomingRow(), storedRow(), new Set(['monthly_amount']), ALL_COLUMNS,
  );
  // Not the file's 1100. The admin's 2000 survived the guard, so the
  // amount has to be worked out from 2000.
  assert.equal(out.payableAmount, 2000);
  assert.equal(out.payableDays, 31);
});

test('a claimed monthly amount and a moving payment start agree with each other', () => {
  // The file brings a start of 14 July: 18 of 31 days.
  const incoming = incomingRow({ paymentStartOn: new Date('2026-07-14T00:00:00.000Z') });
  const out = resolveDerived(incoming, storedRow(), new Set(['monthly_amount']), ALL_COLUMNS);
  assert.equal(out.payableDays, 18);
  // 2000 / 31 * 18, to the penny. The protected rate against the new date.
  assert.equal(out.payableAmount, 1161.29);
});

test('a hand typed payable amount survives an upload', () => {
  const claimed = new Set(['monthly_amount', 'payable_amount']);
  const out = resolveDerived(incomingRow(), storedRow({ payable_amount: 1234.5 }), claimed, ALL_COLUMNS);
  assert.equal(out.payableAmount, 1234.5);
});

test('a hand typed payable days is what the amount is computed from', () => {
  const claimed = new Set(['payable_days']);
  const out = resolveDerived(incomingRow(), storedRow({ payable_days: 10 }), claimed, ALL_COLUMNS);
  assert.equal(out.payableDays, 10);
  // 1100 / 31 * 10. The rate was not claimed, so the file's rate is right.
  assert.equal(out.payableAmount, 354.84);
});

test('a column the file never carried keeps the stored value', () => {
  // A file with no monthly amount column has no opinion on the rate, so
  // the stored 2000 stands and the amount follows it.
  const carried = new Set(['payment_start_on', 'preset_on', 'payable_days', 'payable_amount']);
  const out = resolveDerived(incomingRow(), storedRow(), new Set(), carried);
  assert.equal(out.payableAmount, 2000);
});

test('a claimed preset changes the divisor, not just the month', () => {
  // Stored preset is February 2026, so the divisor is 28 rather than 31.
  const stored = storedRow({ preset_on: new Date('2026-02-01T00:00:00.000Z') });
  // The start has to precede that month or the answer is 0 whatever the
  // divisor is, which is what a start of 1 April against February means.
  const incoming = incomingRow({ paymentStartOn: new Date('2026-01-15T00:00:00.000Z') });
  const out = resolveDerived(incoming, stored, new Set(['preset_on', 'monthly_amount']), ALL_COLUMNS);
  assert.equal(out.payableDays, 28, 'started before February, so the whole month');
  assert.equal(out.payableAmount, 2000, '2000 / 28 * 28, the protected rate over the shorter month');
});

test('a start after the preset month owes nothing, whatever the rate', () => {
  // The other half of the case above, kept because it is the one that
  // caught the test being wrong rather than the code.
  const stored = storedRow({ preset_on: new Date('2026-02-01T00:00:00.000Z') });
  const out = resolveDerived(incomingRow(), stored, new Set(['preset_on', 'monthly_amount']), ALL_COLUMNS);
  assert.equal(out.payableDays, 0);
  assert.equal(out.payableAmount, 0);
});

/**
 * ===============================
 * * recomputePayable reports what it derived
 * ===============================
 * The other half of the same fault: the repo claimed every key in the
 * patch, so one edit to the rate froze the amount for good.
 */

test('it reports the keys it added and never the ones it was given', () => {
  const fields = { monthlyAmount: 2000 };
  const derived = recomputePayable(
    { monthly_amount: 1100, preset_on: PRESET, payment_start_on: START, payable_days: 31 },
    fields,
  );
  assert.deepEqual(derived, ['payableAmount']);
  assert.ok(!derived.includes('monthlyAmount'), 'the human typed the rate, so it is not derived');
});

test('a date edit derives the day count too', () => {
  const fields = { paymentStartOn: new Date('2026-07-14T00:00:00.000Z') };
  const derived = recomputePayable(
    { monthly_amount: 1100, preset_on: PRESET, payment_start_on: START, payable_days: 31 },
    fields,
  );
  assert.deepEqual(derived, ['payableDays', 'payableAmount']);
  assert.equal(fields.payableDays, 18);
});

test('an explicit amount is the admin overriding the formula, so nothing is derived', () => {
  const fields = { monthlyAmount: 2000, payableAmount: 999 };
  const derived = recomputePayable({ preset_on: PRESET, payable_days: 31 }, fields);
  assert.deepEqual(derived, []);
  assert.equal(fields.payableAmount, 999);
});

test('an edit that touches no input derives nothing', () => {
  const fields = { location: 'Main City' };
  assert.deepEqual(recomputePayable({ preset_on: PRESET }, fields), []);
  assert.equal(fields.payableAmount, undefined);
});
