const test = require('node:test');
const assert = require('node:assert/strict');
const { expenseKey } = require('./expenseIdentity');

/**
 * ***************************************************
 * * sync_key finds CANDIDATES, it never merges
 * ***************************************************
 *
 * The whole risk of an expenses import is silent: a composite key that
 * collapses two real duplicate spends into one, or no key at all doubling
 * the ledger on a re-upload. These pin the half the key is responsible for.
 */

const FARE = {
  spentOn: '2026-09-12',
  payee: 'Careem',
  rawAmount: 5000,
  currency: 'PHP',
  description: 'Taxi to the airport',
};

test('the same spend typed twice resolves to one key', () => {
  const messy = {
    spentOn: '2026-09-12',
    payee: '  careem ',
    rawAmount: 5000,
    currency: 'php',
    description: 'Taxi  to the Airport',
  };
  assert.equal(expenseKey(messy), expenseKey(FARE));
});

test('TWO IDENTICAL FARES SHARE A KEY, and that is correct', () => {
  // Two real taxi rides on one day are two expenses. The key matching is
  // exactly why the import must put them on a tab rather than merge them:
  // if this ever stops being true, the import's whole premise changes.
  assert.equal(expenseKey({ ...FARE }), expenseKey({ ...FARE }));
});

test('a different amount, date, payee or description is a different key', () => {
  const base = expenseKey(FARE);
  assert.notEqual(expenseKey({ ...FARE, rawAmount: 5001 }), base);
  assert.notEqual(expenseKey({ ...FARE, spentOn: '2026-09-13' }), base);
  assert.notEqual(expenseKey({ ...FARE, payee: 'Uber' }), base);
  assert.notEqual(expenseKey({ ...FARE, description: 'Taxi home' }), base);
  assert.notEqual(expenseKey({ ...FARE, currency: 'AED' }), base);
});

test('THE RATE IS NOT IN THE KEY', () => {
  // Correcting a rate must not orphan the row from its own history, the
  // same reason money and dates are out of dealKey.
  assert.equal(expenseKey({ ...FARE, exchangeRate: 0.0644 }), expenseKey(FARE));
});

test('a Date object and its ISO string agree', () => {
  // Excel hands over Date objects. The two paths into this must not produce
  // two keys for one row.
  assert.equal(
    expenseKey({ ...FARE, spentOn: new Date('2026-09-12T00:00:00Z') }),
    expenseKey(FARE),
  );
});

test('snake_case rows off the database key the same as camelCase bodies', () => {
  assert.equal(
    expenseKey({
      spent_on: '2026-09-12',
      payee: 'Careem',
      raw_amount: 5000,
      currency: 'PHP',
      description: 'Taxi to the airport',
    }),
    expenseKey(FARE),
  );
});
