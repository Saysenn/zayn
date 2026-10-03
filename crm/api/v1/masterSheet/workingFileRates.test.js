const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const template = require('../templates/xlsx/masterSheet');

/**
 * ***************************************************
 * * THE WORKING FILE CARRIES THE RATES, EXCEPT ON THE WAGE
 * ***************************************************
 *
 * TWO INCIDENTS, one cure, 2026-09-22.
 *
 * FIRST: this template forwarded neither `rates` nor `cryptoPercent`, so a
 * PERSON level add on reached no figure in it. Zayn printed 4,000 where
 * his own sheet says 4,200 and the Maid 4,700 against his 4,935. Only the
 * deal's own `addon_percent` applied, because that rides on the row.
 *
 * SECOND, and the reason the cure is not simply "forward them": this is
 * the one file that is UPLOADED BACK.
 *
 *   Payable amount  `mapSheetRow` IGNORES it and recomputes from Monthly,
 *                   so a rated Payable costs nothing on the way in.
 *   Monthly amount  it READS as the wage. A rated Monthly returns as a
 *                   raise, and next month's export rates that again.
 *
 * This tab prints no "Add ons" block, so `declaredRatesIn` has nothing to
 * reverse and would not catch it. That is the incident `reverseRates.js`
 * was written about, and it compounds silently, monthly, on money.
 */

const RATE = new Map([['maid', { addon: 5, fee: 0 }]]);

const ROW = () => ({
  id: 1,
  group_name: 'INDIGO',
  role_label: 'Maid',
  person_id: 'maid',
  person_name: 'Maid',
  company: 'Workforce',
  currency: 'GBP',
  monthly_amount: 4700,
  payable_amount: 4700,
  payable_days: 30,
  payment_method: 'bank',
  preset_on: '2026-09-01',
  source: 'import',
});

/** { monthly, payable } as the built file actually holds them. */
async function amounts(opts) {
  const wb = await template.build([ROW()], opts);
  const ws = wb.worksheets[0];
  let m = 0;
  let p = 0;
  ws.getRow(1).eachCell((c, n) => {
    if (String(c.value) === 'Monthly amount') m = n;
    if (String(c.value) === 'Payable amount') p = n;
  });
  const read = (n) => {
    const v = ws.getRow(2).getCell(n).value;
    return v && typeof v === 'object' && v.result !== undefined ? v.result : v;
  };
  return { monthly: read(m), payable: read(p) };
}

// ===============================
// * The rates reach the file
// ===============================

test('A PERSON LEVEL ADD ON REACHES THE PAYABLE AMOUNT', async () => {
  const { payable } = await amounts({ rates: RATE });
  assert.equal(payable, 4935, 'the 5% on the person did not reach the file');
});

test('AND THE TEMPLATE FORWARDS BOTH RATE OPTIONS', async () => {
  // Named, not spread, so each one has to be listed by hand and each one
  // can be forgotten by hand. Both were.
  const source = fs.readFileSync(path.join(__dirname, '..', 'templates', 'xlsx', 'masterSheet.js'), 'utf8');
  const args = source.match(/build: \(rows, \{[^}]*\}/)?.[0];
  assert.ok(args, 'the build signature has changed shape');
  assert.match(args, /rates/);
  assert.match(args, /cryptoPercent/);
});

// ===============================
// * And the wage column stays raw
// ===============================

test('THE MONTHLY AMOUNT IS THE STORED WAGE, never the rated one', async () => {
  const { monthly } = await amounts({ rates: RATE });
  assert.equal(monthly, 4700, 'a rated wage re-uploads as a raise and compounds every month');
});

test('BOTH AT ONCE, which is the whole contract', async () => {
  assert.deepEqual(await amounts({ rates: RATE }), { monthly: 4700, payable: 4935 });
});

test('A PERSON WITH NO RATE IS UNTOUCHED', async () => {
  assert.deepEqual(await amounts({ rates: new Map() }), { monthly: 4700, payable: 4700 });
});

/**
 * RE-EXPORTING WHAT A RE-UPLOAD WOULD STORE MUST NOT DRIFT. The upload
 * keeps the wage, so the second file equals the first. This is the
 * compounding, written as arithmetic: with a rated Monthly it would read
 * 5,181.75 and then 5,440.84.
 */
test('THE ROUND TRIP DOES NOT COMPOUND', async () => {
  const first = await amounts({ rates: RATE });
  const stored = { ...ROW(), monthly_amount: first.monthly, payable_amount: first.monthly };
  const wb = await template.build([stored], { rates: RATE });
  const ws = wb.worksheets[0];
  let p = 0;
  ws.getRow(1).eachCell((c, n) => { if (String(c.value) === 'Payable amount') p = n; });
  const v = ws.getRow(2).getCell(p).value;
  const second = v && typeof v === 'object' && v.result !== undefined ? v.result : v;
  assert.equal(second, first.payable, 'the rate was charged twice on the second export');
});

/**
 * AND EVERY OTHER DOCUMENT STILL RATES BOTH. `rawMonthly` is this
 * template's alone: the payout sheets and the month generation are not
 * uploaded back, and their totals read the Monthly column.
 */
test('rawMonthly IS OFF BY DEFAULT in the builder', async () => {
  const { buildMasterSheetWorkbook } = require('./buildWorkbook');
  const wb = await buildMasterSheetWorkbook([ROW()], { singleTab: true, rates: RATE });
  const ws = wb.worksheets[0];
  let m = 0;
  ws.getRow(1).eachCell((c, n) => { if (String(c.value) === 'Monthly amount') m = n; });
  const v = ws.getRow(2).getCell(m).value;
  const monthly = v && typeof v === 'object' && v.result !== undefined ? v.result : v;
  assert.equal(monthly, 4935, 'the default changed, and it is not this template that owns it');
});

/**
 * ===============================
 * * AND THE SINGLE TAB'S FORMULA MUST NOT UNDO IT
 * ===============================
 * Found while pinning the above. That tab writes Payable as a live Excel
 * formula, "Monthly over the days in the month, times the days payable".
 * With the Monthly column holding the RAW wage, the formula recomputed a
 * RAW payable and the rate vanished again: 4,700 where his sheet says
 * 4,935, on the layout the per-group fix had already got right.
 *
 * `sheetFormulas` now skips that one formula on a row carrying
 * `rate_parts`, the same way it already skips the end date formula on a
 * row carrying his words. A row with no rate keeps the live formula,
 * because that is what the tab is for.
 */

/** The payable cell for one person, and whether it is a live formula. */
async function payableCell(person, opts) {
  const rows = [
    { ...ROW(), id: 1, assigned_on: '2025-01-01' },
    {
      ...ROW(),
      id: 2,
      person_id: 'plain',
      person_name: 'Plain',
      role_label: 'Mid 1',
      monthly_amount: 1000,
      payable_amount: 1000,
      assigned_on: '2025-01-01',
    },
  ];
  const wb = await template.build(rows, opts);
  const ws = wb.worksheets[0];
  let p = 0;
  let n = 0;
  ws.getRow(1).eachCell((c, i) => {
    if (String(c.value) === 'Payable amount') p = i;
    if (String(c.value) === 'Name of individual') n = i;
  });
  for (let r = 2; r <= ws.rowCount; r += 1) {
    if (String(ws.getRow(r).getCell(n).value) !== person) continue;
    const v = ws.getRow(r).getCell(p).value;
    const isFormula = Boolean(v && typeof v === 'object' && v.formula !== undefined);
    return { value: isFormula ? v.result : v, isFormula };
  }
  return null;
}

test('ON THE SINGLE TAB A RATED ROW GETS THE FIGURE, not a formula off the wage', async () => {
  const maid = await payableCell('Maid', { rates: RATE });
  assert.equal(maid.isFormula, false, 'the formula recomputed a raw payable from the raw wage');
  assert.equal(maid.value, 4935);
});

test('AND AN UNRATED ROW KEEPS ITS LIVE FORMULA', async () => {
  const plain = await payableCell('Plain', { rates: RATE });
  assert.equal(plain.isFormula, true, 'the tab he works in stopped being live');
  assert.equal(plain.value, 1000);
});

test('THE PER GROUP LAYOUT AGREES WITH IT, to the penny', async () => {
  const one = await payableCell('Maid', { rates: RATE });
  const tabs = await payableCell('Maid', { rates: RATE, perGroupTabs: true });
  assert.equal(tabs.value, one.value, 'the two layouts disagree about the same money');
});

/**
 * AND THE SKIP IS THE WORKING FILE'S ALONE. Caught in the audit right
 * after writing it: the skip first read only `rate_parts`, which fires on
 * every document. Everywhere else the Monthly column IS rated, so the
 * formula reads a rated wage and lands on the same penny. Skipping it
 * there would have taken the live formula off the month tab for nothing.
 */
test('EVERY OTHER DOCUMENT KEEPS ITS LIVE FORMULA ON A RATED ROW', async () => {
  const { buildMasterSheetWorkbook } = require('./buildWorkbook');
  const wb = await buildMasterSheetWorkbook([{ ...ROW(), assigned_on: '2025-01-01' }], {
    singleTab: true, breakdown: false, companyList: false, rates: RATE,
  });
  const ws = wb.worksheets[0];
  let p = 0;
  ws.getRow(1).eachCell((c, n) => { if (String(c.value) === 'Payable amount') p = n; });
  const v = ws.getRow(2).getCell(p).value;
  assert.ok(v && typeof v === 'object' && v.formula !== undefined, 'the month tab lost its formula');
  // Same penny either way, which is why it can keep it.
  assert.equal(v.result, 4935);
});
