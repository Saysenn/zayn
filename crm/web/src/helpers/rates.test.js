import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ratesFor, partsOf, hasRates, withRates } from './rates.js';

/**
 * ***************************************************
 * * CONTRACT: this file and the API agree about money
 * ***************************************************
 *
 * `api/v1/shared/rates.helper.js` is the other half. NEITHER READS THE
 * OTHER: the two codebases share no file, so the rule is written twice and
 * each side pins it. The API's half is `shared/rates.helper.test.js`,
 * asserting the same worked examples against the same figures.
 *
 * If these two ever disagree, the browser paints one number and the
 * exported file carries another.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const row = (over = {}) => ({
  payment_method: 'cash', monthly_amount: 4700, payable_amount: 4700,
  person_addon_percent: 5, ...over,
});

test('his own figure: 4,700 at 5% reads 4,935', () => {
  const out = withRates(row());
  assert.equal(out.monthly_amount, 4935);
  assert.equal(out.monthly_amount_raw, 4700, 'the wage is never overwritten');
});

test('THE ORDER COMMUTES, so a part month is the same to the penny', () => {
  const part = withRates(row({ payable_amount: 1880 }));
  assert.equal(part.payable_amount, 1974);
  const full = withRates(row());
  assert.equal(Math.round((full.monthly_amount / 30) * 12 * 100) / 100, 1974);
});

test('person and deal rates are ADDITIVE, never compounding', () => {
  const out = withRates(row({ monthly_amount: 1000, payable_amount: 1000, addon_percent: 3 }));
  assert.equal(out.monthly_amount, 1080, 'not 1081.50');
});

test('the fee comes off the raw PLUS the add ons', () => {
  // The popup's own worked example: 4,732.90, not 4,747.
  const out = withRates(row({ payment_method: 'crypto', fee_percent: 5 }), { cryptoPercent: 1 });
  assert.deepEqual(out.rate_parts.monthly, {
    addon: 235, crypto: 47, fee: 249.1, net: 4732.9,
  });
});

test('the crypto charge belongs to the RAIL, not the person', () => {
  assert.equal(ratesFor(row({ payment_method: 'cash' }), { cryptoPercent: 1 }).crypto, 0);
  assert.equal(ratesFor(row({ payment_method: 'crypto' }), { cryptoPercent: 1 }).crypto, 1);
});

test('a row with no rate is the SAME OBJECT back', () => {
  // Rebuilding it would round figures nobody rated and break the reference
  // equality a memoised table row leans on.
  const clean = { payment_method: 'cash', monthly_amount: 4700, payable_amount: 4700 };
  assert.equal(withRates(clean), clean);
  assert.equal(hasRates(clean), false);
  assert.equal(hasRates({ ...clean, addon_percent: 5 }), true);
});

test('THE MIRROR: the API states it is one, and so does this', () => {
  // A mirror nobody knows is a mirror is a copy, and a copy drifts.
  assert.match(fs.readFileSync(path.join(here, 'rates.js'), 'utf8'), /DELIBERATE MIRROR/);
});

test('partsOf is exported, because the popup draws exactly these rows', () => {
  assert.deepEqual(partsOf(1000, { addon: 5, crypto: 0, fee: 0 }), {
    addon: 50, crypto: 0, fee: 0, net: 1050,
  });
});

/* ===============================
 * * THE POPUP IS A SUM, LAID OUT LIKE ONE
 * =============================== */

test('the rate popup is ROWS, not sentences with figures buried in them', () => {
  const config = fs.readFileSync(path.join(here, '..', 'configs', 'popups.config.js'), 'utf8');
  const entry = config.slice(config.indexOf('rateBreakdown:'), config.indexOf('sheetSays:'));

  assert.ok(entry.includes('rows: ['), 'a two column table, aligned');
  assert.ok(entry.includes("total: ['Total'"), 'with the answer under a rule');

  // NO DASH ANYWHERE IN THE COPY. It read "Raw — AED 4,700.00", which is
  // both unaligned and against the house rule. The only minus left is the
  // one inside a negative figure, which is data.
  const labels = [...entry.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  for (const label of labels) {
    assert.ok(!label.includes('—'), `em dash in "${label}"`);
    assert.ok(!label.includes(' - '), `dash in "${label}"`);
  }
});

test('the fee row prints NEGATIVE, so the column adds up down the page', () => {
  const config = fs.readFileSync(path.join(here, '..', 'configs', 'popups.config.js'), 'utf8');
  const entry = config.slice(config.indexOf('rateBreakdown:'), config.indexOf('sheetSays:'));
  assert.ok(entry.includes('money(-parts.fee, currency)'), 'the fee is shown as a deduction');
});

test('CellInfo can DRAW rows, or the config shape renders as [object Object]', () => {
  const cell = fs.readFileSync(
    path.join(here, '..', 'components', 'display', 'CellInfo.jsx'), 'utf8',
  );
  assert.ok(cell.includes('function renderRows'), 'the renderer exists');
  assert.ok(cell.includes("typeof para === 'object'"), 'and renderPopupBody reaches it');
  assert.ok(cell.includes('tabular-nums'), 'the figures line up column by column');
});
