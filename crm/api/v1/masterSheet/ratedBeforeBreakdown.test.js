const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentBreakdown } = require('./groupTables');
const { withRates } = require('../shared/rates.helper');

/**
 * ***************************************************
 * * RATE THE ROWS, THEN BREAK THEM DOWN
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-16. `paymentBreakdown` accepted `rates` and
 * `cryptoPercent` and USED NEITHER: it reads the rates back off
 * `row.rate_parts`, which `withRates` puts there. Two callers passed them
 * instead of rating the rows, and both were silently short by every add on
 * and every crypto charge.
 *
 *   Diane's historical breakdown  answered 1,000 against a sheet saying 1,050
 *   THE DIVISION SHEET EXPORT     shipped the same gap, in a real payout file
 *
 * The month sheet was correct throughout, because buildWorkbook rates at
 * the top of its build. So one export was right and the other was wrong off
 * the same rows, which is the shape of fault this pins.
 *
 * Both options are GONE from the signature now. The wrong call is an
 * unknown option rather than a quiet zero.
 */

const deal = (over = {}) => ({
  person_id: 'a', person_name: 'Alex Example', group_name: 'ALPHA',
  payable_amount: '1000', monthly_amount: '1000', currency: 'GBP',
  payment_method: 'cash', location: 'UK', preset_on: '2026-08-01',
  ...over,
});

const gbp = (breakdown) => breakdown.grand.find((g) => g.currency === 'GBP').total;

test('paymentBreakdown TAKES NO RATES. The options are gone', () => {
  // The signature is the guard: a caller cannot pass them any more.
  assert.doesNotMatch(paymentBreakdown.toString(), /\brates\b\s*=/);
  assert.doesNotMatch(paymentBreakdown.toString(), /\bcryptoPercent\b\s*=/);
});

test('RAW ROWS CARRY NO RATES, so the breakdown is the bare amount', () => {
  const rows = [deal()];
  assert.equal(gbp(paymentBreakdown(rows)), 1000);
});

test('RATED ROWS CARRY THE ADD ON into the grand total', () => {
  const rates = new Map([['a', { addon: 5, fee: 0 }]]);
  const rated = [deal()].map((row) => withRates(row, rates, {}));
  assert.equal(gbp(paymentBreakdown(rated)), 1050, '1,000 plus 5%');
});

test('AND THE CRYPTO CHARGE, on a crypto row only', () => {
  const rated = [deal({ payment_method: 'crypto' })]
    .map((row) => withRates(row, null, { cryptoPercent: 1 }));
  assert.equal(gbp(paymentBreakdown(rated)), 1010, '1,000 plus 1% gas');

  const cash = [deal({ payment_method: 'cash' })]
    .map((row) => withRates(row, null, { cryptoPercent: 1 }));
  assert.equal(gbp(paymentBreakdown(cash)), 1000, 'not on a cash row');
});

test('THE TWO STACK, in that order', () => {
  // An add on is ADDED and a fee is DEDUCTED AFTER IT. 500 at 8% then 2%
  // is 529.20, never 529.00. See shared/rates.helper.
  const rates = new Map([['a', { addon: 8, fee: 2 }]]);
  const rated = [deal({ payable_amount: '500', monthly_amount: '500' })]
    .map((row) => withRates(row, rates, {}));
  assert.equal(gbp(paymentBreakdown(rated)), 529.2);
});

test('THE DIVISION SHEET RATES ITS ROWS, like the month sheet', () => {
  // Source text: it forwarded opts.rates into the breakdown, where it was
  // ignored. A workbook cannot be asserted on without building one, so
  // what is pinned is that withRates runs and nothing is forwarded.
  const { readFileSync } = require('node:fs');
  const src = readFileSync(new URL('./buildDivisionSheet.js', `file://${__filename.replace(/\\/g, '/')}`), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  assert.match(src, /withRates\(/, 'it must apply the rates itself');
  // SCOPED TO THE CALL, not the file. `cryptoPercent: opts.cryptoPercent`
  // inside withRates is the CORRECT usage, and a blunt match flagged it.
  const call = src.slice(src.indexOf('paymentBreakdown('));
  assert.doesNotMatch(call.slice(0, 300), /\brates\b/, 'and never forward them to the breakdown');
  assert.doesNotMatch(call.slice(0, 300), /\bcryptoPercent\b/);
});

test('AND SO DOES DIANE\'S HISTORICAL BREAKDOWN', () => {
  const { readFileSync } = require('node:fs');
  const src = readFileSync(
    new URL('../agent/tools/historicalBreakdown.js', `file://${__filename.replace(/\\/g, '/')}`),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(src, /withRates\(/);
  assert.doesNotMatch(src, /paymentBreakdown\([\s\S]{0,200}?\brates,/);
});
