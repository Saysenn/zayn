const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ratesFor, amountWithRates, adjustmentLabel, withRates,
} = require('../shared/rates.helper');
const { paymentBreakdown } = require('./groupTables');

/**
 * ***************************************************
 * * What a crypto payment costs us in gas
 * ***************************************************
 *
 * ONE RATE, from Settings, ADDED to a row whose method is crypto. The boss
 * calls it a fee; in the CRM a fee is a DEDUCTION, so it is an add on and
 * the sheet heads its block "Crypto charges".
 *
 * ON THE ROW, not on a subtotal. It used to be worked out on the crypto
 * subtotal inside one breakdown design and printed in one cell, so no total
 * anywhere contained it.
 */

const deal = (over = {}) => ({
  person_id: 'abe', person_name: 'Abe', payable_amount: 1000,
  payment_method: 'crypto', currency: 'GBP', location: 'Main City',
  addon_percent: 0, fee_percent: 0, preset_on: '2026-08-01', ...over,
});

test('a crypto row is worth its amount PLUS the rate', () => {
  const { crypto, net } = amountWithRates(deal(), null, { cryptoPercent: 1 });
  assert.equal(crypto, 10);
  assert.equal(net, 1010, 'we pay the gas, so it goes on top');
});

test('a row paid any other way is untouched', () => {
  for (const payment_method of ['cash', 'bank', 'Bank Transfer', '', null]) {
    const { crypto, net } = amountWithRates(deal({ payment_method }), null, { cryptoPercent: 1 });
    assert.equal(crypto, 0, String(payment_method));
    assert.equal(net, 1000, String(payment_method));
  }
});

test('the method is matched loosely, as the sheet writes it', () => {
  for (const payment_method of ['crypto', 'Crypto', 'CRYPTO', 'crypto (usdt)']) {
    assert.equal(amountWithRates(deal({ payment_method }), null, { cryptoPercent: 1 }).crypto, 10);
  }
});

test('it STACKS with a person rate, it does not replace one', () => {
  // 5% hers plus 1% the rail's. Two lines in two blocks, one row.
  const people = new Map([['abe', { addon: 5, fee: 0 }]]);
  const { addon, crypto, net } = amountWithRates(deal(), people, { cryptoPercent: 1 });
  assert.equal(addon, 50);
  assert.equal(crypto, 10);
  assert.equal(net, 1060);
});

test('crypto is its OWN component, never folded into the add on', () => {
  // The sheet prints them in two blocks: what a PERSON costs and what the
  // RAIL costs are different questions even though both add.
  const r = ratesFor(deal({ addon_percent: 3 }), null, { cryptoPercent: 1 });
  assert.deepEqual(r, { addon: 3, crypto: 1, fee: 0 });
});

test('a fee is taken off the amount PLUS both add ons', () => {
  const people = new Map([['abe', { addon: 5, fee: 2 }]]);
  const { fee, net } = amountWithRates(deal(), people, { cryptoPercent: 1 });
  assert.equal(fee, 21.2, '2% of 1,060');
  assert.equal(net, 1038.8);
});

test('no rate set means no charge, never NaN', () => {
  for (const opts of [{}, undefined, { cryptoPercent: null }, { cryptoPercent: 'x' }]) {
    const out = amountWithRates(deal(), null, opts);
    assert.equal(out.crypto, 0, JSON.stringify(opts));
    assert.ok(Number.isFinite(out.net));
  }
});

test('it reaches the TOTAL, which is the whole point', () => {
  // The old block printed the charge and no total contained it.
  const rows = [deal(), deal({ person_id: 'neo', person_name: 'Neo', payment_method: 'cash' })];
  // RATED FIRST. paymentBreakdown stopped applying rates when they moved
  // onto the Monthly amount; it reads the parts off the row now.
  const b = paymentBreakdown(rows.map((r) => withRates(r, null, { cryptoPercent: 1 })));

  const crypto = b.methods.find((m) => /crypto/i.test(m.method));
  assert.equal(crypto.totals[0].total, 1010, '1,000 owed plus 10 gas');

  const cash = b.methods.find((m) => /cash/i.test(m.method));
  assert.equal(cash.totals[0].total, 1000, 'cash is untouched');
  assert.equal(b.grand.find((g) => g.currency === 'GBP').total, 2010);
});

test('it is NAMED per person on the sheet, not aggregated', () => {
  const { adjustments } = paymentBreakdown([withRates(deal(), null, { cryptoPercent: 1 })])
    .methods[0].locations[0].lines[0];

  assert.deepEqual(adjustments, [{ name: 'Abe', kind: 'crypto', percent: 1, value: 10 }]);
  assert.equal(adjustmentLabel(adjustments[0]), 'Abe: 1% crypto');
  assert.equal(adjustmentLabel(adjustments[0], { withKind: false }), 'Abe: 1%');
});

test('the old subtotal block is GONE, or the charge is counted twice', () => {
  // It computed 1% on the crypto method total in USD. With the charge on
  // the rows, that total already carries it.
  const src = require('node:fs').readFileSync(
    require.resolve('./breakdowns/withUsd.js'), 'utf8',
  );
  assert.ok(!src.includes('CRYPTO_FEE_RATE'), 'the constant is replaced by the setting');
  assert.ok(!src.includes('cryptoAddOns'), 'the subtotal helper is gone');
  assert.ok(!src.includes('Crypto to send'), 'the old three lines are gone');
  assert.match(src, /\['crypto', 'Crypto charges'\]/, 'and replaced by a named block');
});

test('the printed RATE keeps six decimals', () => {
  // Conversions already used the full rate; printing 1.36 meant a reader
  // checking 9,275 GBP by hand landed 23 dollars out.
  const src = require('node:fs').readFileSync(
    require.resolve('./breakdowns/withUsd.js'), 'utf8',
  );
  assert.match(src, /RATE_FMT = '#,##0\.000000'/);
  assert.match(src, /usdPerGbp, \{ fmt: RATE_FMT/);
  assert.match(src, /AED_PER_USD, \{ fmt: RATE_FMT/);
});
