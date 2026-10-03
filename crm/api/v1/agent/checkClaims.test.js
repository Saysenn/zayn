const test = require('node:test');
const assert = require('node:assert/strict');

const { checkClaims } = require('./checkClaims');

const results = [{
  summary: 'Alex Example is owed GBP 2,900 for August 2026 across 3 rows.',
  total: { GBP: 2900 },
  rows: [
    { personName: 'Alex Example', payableAmount: 900 },
    { personName: 'Alex Example', payableAmount: 1000 },
    { personName: 'Blake Example', payableAmount: 1000 },
  ],
}, {
  person: { addon: 5, fee: 0 },
  deals: [{ addonPercent: 5, feePercent: 0 }],
}];

test('typed totals, counts and percents compare as values', () => {
  const checked = checkClaims([
    { kind: 'total', value: 2900, currency: 'GBP', month: '2026-08', subject: 'Alex Example' },
    { kind: 'count', value: 3, unit: 'row' },
    { kind: 'percent', value: 5, rateKind: 'addon' },
  ], results);
  assert.equal(checked.ok, true, JSON.stringify(checked.invalid));
});

test('deal is the natural name for a row count', () => {
  const checked = checkClaims([{ kind: 'count', value: 3, unit: 'deal' }], results);
  assert.equal(checked.ok, true, JSON.stringify(checked.invalid));
});

test('an unsupported typed value is rejected without parsing reply prose', () => {
  const checked = checkClaims([
    { kind: 'total', value: 3700, currency: 'GBP', month: '2026-08' },
    { kind: 'count', value: 4, unit: 'row' },
    { kind: 'percent', value: 12, rateKind: 'addon' },
  ], results);
  assert.deepEqual(checked.invalid.map((claim) => claim.value), [3700, 4, 12]);
  assert.equal(checked.ok, false);
});

test('a total for a month no tool covered is rejected', () => {
  const checked = checkClaims([
    { kind: 'total', value: 2900, currency: 'GBP', month: '2026-09' },
  ], results);
  assert.equal(checked.ok, false);
  assert.equal(checked.invalid[0].reason, 'month');
});

test('empty claims are valid and leave the prose fallback in charge', () => {
  assert.deepEqual(checkClaims([], results), { ok: true, invalid: [], had: false });
});
