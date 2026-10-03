import test from 'node:test';
import assert from 'node:assert/strict';

import { recomputeWarning, keepingPayable, RECOMPUTE_INPUTS } from './recomputeWarning.js';

/**
 * A HAND TYPED PAYABLE AMOUNT DOES NOT SURVIVE THE NEXT DATE EDIT.
 *
 * It wins in its own patch and is then silently recomputed by the next edit
 * to any of its five inputs. Nothing said so, and the same figure IS
 * protected from an upload, so the admin had every reason to think it was
 * safe.
 */

const ROW = {
  id: 1,
  monthly_amount: 3000,
  preset_on: '2026-10-01',
  payment_start_on: '2026-10-12',
  assigned_on: '2026-07-14',
  payable_days: 20,
  payable_amount: 5000,
  manually_overridden_fields: ['payable_amount'],
};

test('it fires on a typed amount, and says what the figure becomes', () => {
  const out = recomputeWarning(ROW, { assignedOn: '2026-07-20' });
  assert.ok(out);
  assert.equal(out.was, 5000);
  // 3,000 over October's 31 days, from a start the new appointment gives.
  assert.ok(out.willBe !== 5000 && out.willBe > 0);
  assert.deepEqual(out.labels, ['Appointment date']);
});

test('all five inputs fire it', () => {
  const patches = {
    monthlyAmount: 4000,
    payableDays: 9,
    paymentStartOn: '2026-10-20',
    presetOn: '2026-11-01',
    assignedOn: '2026-07-20',
  };
  for (const [key, value] of Object.entries(patches)) {
    assert.ok(recomputeWarning(ROW, { [key]: value }), key);
  }
  assert.deepEqual(Object.keys(patches).sort(), Object.keys(RECOMPUTE_INPUTS).sort());
});

// It must stay quiet on the ordinary row, or it fires on every date edit in
// the CRM and everybody clicks through it, which is the same as not asking.
test('NOT on a row nobody typed into', () => {
  assert.equal(recomputeWarning({ ...ROW, manually_overridden_fields: [] }, { assignedOn: '2026-07-20' }), null);
  assert.equal(recomputeWarning({ ...ROW, manually_overridden_fields: undefined }, { payableDays: 9 }), null);
});

test('NOT when the same patch sets the amount: they are setting it right now', () => {
  assert.equal(recomputeWarning(ROW, { assignedOn: '2026-07-20', payableAmount: 4200 }), null);
});

test('NOT on a column that changes nothing', () => {
  assert.equal(recomputeWarning(ROW, { phone: '07700900001' }), null);
  assert.equal(recomputeWarning(ROW, { currency: 'AED' }), null);
});

test('NOT when the formula lands on the same figure anyway', () => {
  // 3,000 over 31 days at 31 days is 3,000, and the typed value is 3,000.
  const row = {
    ...ROW,
    payable_amount: 3000,
    payable_days: 31,
    payment_start_on: '2026-10-01',
  };
  assert.equal(recomputeWarning(row, { paymentStartOn: '2026-09-28' }), null);
});

test('keeping it needs no new API: the amount rides along with the edit', () => {
  const patch = keepingPayable({ assignedOn: '2026-07-20' }, ROW);
  assert.deepEqual(patch, { assignedOn: '2026-07-20', payableAmount: 5000 });
  // And with it in the patch the warning is gone, which is the server's
  // own rule: an explicit amount wins.
  assert.equal(recomputeWarning(ROW, patch), null);
});
