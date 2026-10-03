const test = require('node:test');
const assert = require('node:assert/strict');
const { recomputePayable } = require('./recomputePayable.helper');

/**
 * ***************************************************
 * * A DERIVATION THAT FAILED IS NOT A VALUE TO WRITE
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-22. Setting the appointment date on a hand added
 * deal failed with the database's own words in a toast:
 *
 *   Couldn't update FB's appointment date
 *   null value in column "payable_days" of relation "tb_mastersheet"
 *   violates not-null...
 *
 * `payableDaysFor` returns null when the preset is not a real date. That
 * row had no preset, because it was typed into the CRM rather than
 * uploaded, so the cascade put null in the patch and `payable_days` is
 * NOT NULL. The constraint threw and the WHOLE edit rolled back.
 *
 * It had nothing to do with appointments. Any date edit on any row with no
 * preset would have done it, and `payable_amount` is reachable the same
 * way and is NOT NULL too.
 *
 * THE RULE: could not be worked out is not zero and is not null. The
 * stored value stands, because it is the last thing anybody knew.
 */

const D = (iso) => new Date(`${iso}T00:00:00.000Z`);

/** A hand added deal: no preset, no payment start, no appointment. */
const HAND_ADDED = () => ({
  assigned_on: null,
  payment_start_on: null,
  preset_on: null,
  monthly_amount: 0,
  payable_days: 30,
  payable_amount: 0,
});

// ===============================
// * Neither NOT NULL column may be patched with null
// ===============================

test('SETTING AN APPOINTMENT ON A ROW WITH NO PRESET WRITES NO NULL', () => {
  const fields = { assignedOn: '2024-02-29' };
  recomputePayable(HAND_ADDED(), fields);
  assert.notEqual(fields.payableDays, null, 'payable_days is NOT NULL and this is the patch');
  assert.notEqual(fields.payableAmount, null, 'payable_amount is NOT NULL too');
});

test('AND IT LEAVES THE STORED DAY COUNT ALONE rather than guessing', () => {
  const fields = { assignedOn: '2024-02-29' };
  const derived = recomputePayable(HAND_ADDED(), fields);
  // Absent from the patch entirely, which is the only way the stored 30
  // survives. A zero here would be a figure nobody chose.
  assert.equal('payableDays' in fields, false);
  assert.ok(!derived.includes('payableDays'));
});

test('THE REST OF THE CASCADE STILL RUNS', () => {
  const fields = { assignedOn: '2024-02-29' };
  recomputePayable(HAND_ADDED(), fields);
  // Appointment + 90, and appointment + 1 year, both off the same date.
  assert.equal(fields.paymentStartOn, '2024-05-29');
  assert.equal(fields.endOn, '2025-03-01');
});

test('NO OTHER DATE EDIT WRITES NULL EITHER, on a row with no preset', () => {
  for (const patch of [{ paymentStartOn: '2026-01-01' }, { presetOn: null }]) {
    const fields = { ...patch };
    recomputePayable(HAND_ADDED(), fields);
    assert.notEqual(fields.payableDays, null, `${JSON.stringify(patch)} patched a null day count`);
    assert.notEqual(fields.payableAmount, null, `${JSON.stringify(patch)} patched a null amount`);
  }
});

/**
 * ===============================
 * * AND A ROW THAT CAN BE WORKED OUT STILL IS
 * ===============================
 * Guarding by never deriving would be a cure worse than the fault: the
 * whole point of this helper is that an edit moves the figures the way his
 * own sheet's formulas do.
 */
test('A ROW WITH A PRESET DERIVES EVERYTHING, unchanged', () => {
  const row = {
    assigned_on: D('2026-01-20'),
    payment_start_on: D('2026-04-20'),
    end_on: D('2027-01-20'),
    preset_on: D('2026-07-01'),
    monthly_amount: 1000,
    payable_days: 31,
    payable_amount: 1000,
  };
  const fields = { assignedOn: '2026-04-15' };
  const derived = recomputePayable(row, fields);
  assert.equal(fields.paymentStartOn, '2026-07-14');
  assert.equal(fields.endOn, '2027-04-15');
  assert.equal(fields.payableDays, 18);
  assert.equal(fields.payableAmount, 580.65);
  assert.deepEqual(derived, ['paymentStartOn', 'endOn', 'payableDays', 'payableAmount']);
});

test('AND A RATE EDIT STILL MOVES THE AMOUNT', () => {
  const row = {
    preset_on: D('2026-09-01'),
    payment_start_on: D('2025-04-01'),
    monthly_amount: 500,
    payable_days: 30,
    payable_amount: 500,
  };
  const fields = { monthlyAmount: 900 };
  recomputePayable(row, fields);
  assert.equal(fields.payableAmount, 900);
});
