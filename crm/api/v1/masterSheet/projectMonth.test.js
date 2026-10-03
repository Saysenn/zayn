const test = require('node:test');
const assert = require('node:assert/strict');
const { projectMonth } = require('./projectMonth');

const deal = (over = {}) => ({
  id: 1,
  monthly_amount: 3100,
  payable_amount: 1,
  payable_days: 1,
  payment_start_on: '2026-01-01',
  preset_on: '2026-09-01',
  ...over,
});

test('a projected full month uses the target month', () => {
  const [out] = projectMonth([deal()], '2026-10');
  assert.equal(out.preset_on, '2026-10-01');
  assert.equal(out.payable_days, 31);
  assert.equal(out.payable_amount, 3100);
});

test('a payment starting within the target month is prorated', () => {
  const [out] = projectMonth([deal({ payment_start_on: '2026-10-16' })], '2026-10');
  assert.equal(out.payable_days, 16);
  assert.equal(out.payable_amount, 1600);
});

test('a payment starting after the target month is zero', () => {
  const [out] = projectMonth([deal({ payment_start_on: '2026-11-01' })], '2026-10');
  assert.equal(out.payable_days, 0);
  assert.equal(out.payable_amount, 0);
});

test('a standing deal keeps no preset and its full monthly amount', () => {
  const [out] = projectMonth([deal({ preset_on: null, payable_amount: 200 })], '2026-10');
  assert.equal(out.preset_on, null);
  assert.equal(out.payable_amount, 3100);
});

test('projection never changes the live deal', () => {
  const live = deal();
  projectMonth([live], '2026-10');
  assert.equal(live.preset_on, '2026-09-01');
  assert.equal(live.payable_amount, 1);
});

test('an invalid month is refused', () => {
  assert.throws(() => projectMonth([deal()], 'October'), /Not a month/);
  assert.throws(() => projectMonth([deal()], '2026-13'), /Not a month/);
});
