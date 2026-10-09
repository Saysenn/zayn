const test = require('node:test');
const assert = require('node:assert');
const { cisDeduction } = require('./cisCalc');

test('CIS DEDUCTION: labour only, at the rate for their status', () => {
  const r = cisDeduction({ gross: 3000, materials: 800, status: 'registered' });
  assert.deepEqual([r.labour, r.deduction, r.netPayment], [2200, 440, 2560]);
  assert.equal(cisDeduction({ gross: 3000, materials: 800, status: 'unregistered' }).deduction, 660);
  assert.equal(cisDeduction({ gross: 3000, materials: 800, status: 'gross' }).deduction, 0);
});

test('materials above the invoice never make a negative labour part', () => {
  const r = cisDeduction({ gross: 500, materials: 900, status: 'registered' });
  assert.deepEqual([r.labour, r.deduction, r.netPayment], [0, 0, 500]);
});

test('pennies are rounded, nonsense is refused', () => {
  assert.equal(cisDeduction({ gross: 1234.56, materials: 0, status: 'registered' }).deduction, 246.91);
  assert.ok(cisDeduction({ gross: -5, materials: 0, status: 'registered' }).error);
  assert.ok(cisDeduction({ gross: 100, materials: 0, status: 'weekly' }).error);
});
