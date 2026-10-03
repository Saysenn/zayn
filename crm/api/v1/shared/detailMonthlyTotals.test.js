const test = require('node:test');
const assert = require('node:assert/strict');
const { detailMonthlyTotals } = require('./detailMonthlyTotals.helper');

function deal(overrides = {}) {
  return {
    monthly_amount: 1000,
    payable_days: 30,
    payable_amount: 99999,
    currency: 'GBP',
    preset_on: '2026-09-01',
    payment_start_on: '2026-09-01',
    end_on: null,
    ...overrides,
  };
}

test('detail totals recalculate payable from the preset month and days', () => {
  const totals = detailMonthlyTotals([
    deal({ monthly_amount: 1000, payable_days: 15, payable_amount: 99999 }),
  ], { month: '2026-09' });

  assert.deepEqual(totals, { GBP: 500 });
});

test('detail totals count only the requested preset month and keep currencies separate', () => {
  const totals = detailMonthlyTotals([
    deal({ monthly_amount: 900, payable_days: 30, currency: 'GBP' }),
    deal({ monthly_amount: 310, payable_days: 30, currency: 'AED', preset_on: '2026-08-01' }),
    deal({ monthly_amount: 200, payable_days: 4, currency: 'AED', preset_on: null }),
  ], { month: '2026-09' });

  assert.deepEqual(totals, { GBP: 900, AED: 200 });
});

test('detail totals follow the existing optional end date rule', () => {
  const ended = deal({ end_on: '2026-08-31' });

  assert.deepEqual(detailMonthlyTotals([ended], { month: '2026-09', useEndDate: false }), { GBP: 1000 });
  assert.deepEqual(detailMonthlyTotals([ended], { month: '2026-09', useEndDate: true }), {});
});

test('a start after the preset month contributes nothing', () => {
  const totals = detailMonthlyTotals([
    deal({ payment_start_on: '2026-10-01', payable_days: 30 }),
  ], { month: '2026-09' });

  assert.deepEqual(totals, {});
});

// ===============================
// * THE PAGE TOTAL IS RATED, as Diane's and the sheet's are
// ===============================
// 2026-09-25: a person on a 5% add on read 3,000 on their page and 3,150
// from her. Both levels stack, the fee comes off after, and the rail counts.
test('detail totals apply both rate levels in order, and crypto on a coin row', () => {
  const totals = detailMonthlyTotals([
    deal({ monthly_amount: 500, person_addon_percent: 5, addon_percent: 3, fee_percent: 2 }),
    deal({ monthly_amount: 1000, currency: 'AED', payment_method: 'crypto' }),
  ], { month: '2026-09', cryptoPercent: 1 });

  // 500 + 8% = 540, less 2% of 540 = 529.20. 1000 + 1% crypto = 1010.
  assert.deepEqual(totals, { GBP: 529.2, AED: 1010 });
});

test('a payable amount SET BY HAND is the figure, not the days worked out again', () => {
  const totals = detailMonthlyTotals([
    deal({ monthly_amount: 3000, payable_days: 30, payable_amount: 3500, manually_overridden_fields: ['payable_amount'] }),
  ], { month: '2026-09' });
  assert.deepEqual(totals, { GBP: 3500 });
});
