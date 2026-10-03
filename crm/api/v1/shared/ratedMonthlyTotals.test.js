const test = require('node:test');
const assert = require('node:assert/strict');
const { ratedMonthlyTotals } = require('./rates.helper');

// The People and Companies LISTS summed the raw wage in SQL while every
// other surface rated it. The list now hands over the parts and this rates them.
test('each deal is rated on its own, then summed per currency', () => {
  const totals = ratedMonthlyTotals({
    GBP: [
      { monthly_amount: 2000, person_addon_percent: 5 },
      { monthly_amount: 1000, fee_percent: 2 },
    ],
    AED: [{ monthly_amount: 3000 }],
  });
  assert.deepEqual(totals, { GBP: 3080, AED: 3000 });
});

test('pg numeric strings are numbers, and nothing is nothing', () => {
  assert.deepEqual(ratedMonthlyTotals({ GBP: [{ monthly_amount: '1000.00', person_fee_percent: '2.00' }] }), { GBP: 980 });
  assert.deepEqual(ratedMonthlyTotals(null), {});
});
