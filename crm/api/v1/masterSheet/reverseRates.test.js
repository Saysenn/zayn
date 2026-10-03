const test = require('node:test');
const assert = require('node:assert/strict');

const { withRates } = require('../shared/rates.helper');
const { reverseRates } = require('./reverseRates');

/**
 * ***************************************************
 * * CONTRACT: export then import leaves the wage where it was
 * ***************************************************
 *
 * The export writes Maid's Monthly as 4,935, her 4,700 wage with her 5%
 * inside it. Stored as the wage, the next export reads 5,181.75 and the one
 * after 5,440.84: compounding, every month, with nothing on screen saying
 * why. These pin the reverse, including that it leaves alone the rows it
 * must never touch.
 */

const PEOPLE = new Map([
  ['maid', { addon: 5, fee: 0 }],
  ['gloria', { addon: 5, fee: 0 }],
]);

/**
 * One full lap: rate a stored row, hand it back as a parsed one.
 *
 * THE DECLARED MAP IS WHAT THE EXPORT WOULD PRINT, which is the total that
 * was actually applied to the figure: the person's rate, the deal's own,
 * and the rail's, already stacked. `withRates` hands that back in
 * `rate_parts.percent`, so the lap declares exactly what it baked in
 * rather than a second guess at it.
 */
function lap(stored, opts = {}) {
  const out = withRates(stored, PEOPLE, opts);
  const declared = new Map([[stored.person_id, out.rate_parts.percent]]);
  return reverseRates([{
    personId: stored.person_id,
    paymentMethod: stored.payment_method,
    addonPercent: stored.addon_percent,
    feePercent: stored.fee_percent,
    monthlyAmount: out.monthly_amount,
    payableAmount: out.payable_amount,
  }], declared)[0];
}

test('a plain 5% comes back to the wage exactly', () => {
  const back = lap({
    person_id: 'maid', payment_method: 'cash', monthly_amount: 4700, payable_amount: 4700,
  });
  assert.equal(back.monthlyAmount, 4700);
  assert.equal(back.payableAmount, 4700);
});

test('a stacked person and deal rate comes back too', () => {
  const back = lap({
    person_id: 'gloria', payment_method: 'cash', addon_percent: 3,
    monthly_amount: 1000, payable_amount: 1000,
  });
  assert.equal(back.monthlyAmount, 1000, '8% out, 8% back');
});

test('all three kinds at once, including the fee off the subtotal', () => {
  const back = lap(
    {
      person_id: 'maid', payment_method: 'crypto', fee_percent: 5,
      monthly_amount: 4700, payable_amount: 4700,
    },
    { cryptoPercent: 1 },
  );
  assert.equal(back.monthlyAmount, 4700, '4,732.90 back to 4,700');
});

test('a PART MONTH payable comes back to its own figure, not the monthly', () => {
  const back = lap({
    person_id: 'maid', payment_method: 'cash', monthly_amount: 4700, payable_amount: 1880,
  });
  assert.equal(back.monthlyAmount, 4700);
  assert.equal(back.payableAmount, 1880);
});

test('THREE CYCLES DO NOT DRIFT, which is the whole point', () => {
  let monthly = 4700;
  for (let i = 0; i < 3; i += 1) {
    const back = lap({
      person_id: 'maid', payment_method: 'cash', monthly_amount: monthly, payable_amount: monthly,
    });
    monthly = back.monthlyAmount;
  }
  assert.equal(monthly, 4700, 'compounding is what this exists to stop');
});

test('A ROW WITH NO RATE IS NOT TOUCHED', () => {
  // Nothing was added to it, so dividing it would quietly cut a wage.
  const rows = [{ personId: 'nobody', monthlyAmount: 4700, payableAmount: 4700 }];
  assert.deepEqual(reverseRates(rows, PEOPLE), rows);
});

test('and neither is a zero, which would divide to a false figure', () => {
  const rows = [{ personId: 'maid', monthlyAmount: 0, payableAmount: 0 }];
  assert.deepEqual(reverseRates(rows, PEOPLE)[0], rows[0]);
});

test('a 100% fee is left exactly as it came rather than dividing by zero', () => {
  // Every wage maps to the same net at 100%, so it cannot be unwound. The
  // figure is kept rather than turned into Infinity.
  const rows = [{ personId: 'x', monthlyAmount: 0.01, payableAmount: 0.01 }];
  const declared = new Map([['x', { addon: 0, crypto: 0, fee: 100 }]]);
  const back = reverseRates(rows, declared)[0];
  assert.equal(back.monthlyAmount, 0.01);
  assert.ok(Number.isFinite(back.monthlyAmount));
});
