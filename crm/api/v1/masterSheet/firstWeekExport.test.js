const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { applyFormulas, resultsFor, BUILD } = require('./sheetFormulas');
const { lastFridayOfMonthThree } = require('../shared/fromAppointment.helper');

/**
 * ***************************************************
 * * THE FILE HAS TO SAY THE SAME THING THE SCREEN DOES
 * ***************************************************
 *
 * The exported master sheet is LIVE: the four derived columns go out as
 * formulas and Excel recalculates them on open. A first week deal stores
 * the last Friday of month 3 as its payment start, so the ORDINARY day
 * count formula would recalculate to two days and quietly undo the rule
 * in the one file he actually reads.
 *
 * So month 3 of a first week deal gets HIS OWN full month expression,
 * `DAY(EOMONTH(G,0))`, which appears four times across his two columns
 * already. Still live: move the preset to a 30 day month and it says 30.
 *
 * Fake rows throughout. No database, no reference file.
 */

const COLUMNS = ['assigned_on', 'payment_start_on', 'preset_on', 'end_on', 'payable_days', 'payable_amount', 'monthly_amount'];

function sheetFor(row) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Deals');
  ws.addRow(COLUMNS);
  const sheetRow = ws.addRow(COLUMNS.map((c) => row[c] ?? null));
  const cellFor = (r, key) => {
    const at = COLUMNS.indexOf(key);
    return at === -1 ? null : r.getCell(at + 1);
  };
  const written = applyFormulas(sheetRow, row, cellFor);
  return { sheetRow, cellFor, written };
}

// Appointed Mon 3 Aug 2026, inside the first week (August's first Friday is
// the 7th). Month 3 is October, and the stored start is Friday 30 October.
const WEEK_ONE = {
  assigned_on: '2026-08-03',
  payment_start_on: '2026-10-30',
  preset_on: '2026-10-01',
  end_on: '2027-08-03',
  monthly_amount: 3000,
  payable_days: 31,
  payable_amount: 3000,
};

// Appointed 12 Aug, outside it. Nothing about this row changes.
const ORDINARY = {
  assigned_on: '2026-08-12',
  payment_start_on: '2026-11-10',
  preset_on: '2026-11-01',
  end_on: '2027-08-12',
  monthly_amount: 3000,
  payable_days: 21,
  payable_amount: 2100,
};

test('month 3 of a first week deal exports HIS full month expression', () => {
  const { sheetRow, cellFor } = sheetFor(WEEK_ONE);
  const cell = cellFor(sheetRow, 'payable_days');

  // A FORMULA, not a dead value. He can still click it.
  assert.ok(cell.value.formula, 'payable days left as a literal');
  assert.match(cell.value.formula, /DAY\(EOMONTH\(C2,0\)\)/);
  // And NOT the pro rata chain, which is what would recalculate to 2.
  assert.doesNotMatch(cell.value.formula, /DAY\(B2\)/, 'still counting from the start date');
  // The cached result agrees with the formula, so the file does not change
  // under him the moment Excel recalculates.
  assert.equal(cell.value.result, 31);
});

test('and the amount formula needs no change: 31 days gives the full month', () => {
  const { sheetRow, cellFor } = sheetFor(WEEK_ONE);
  const amount = cellFor(sheetRow, 'payable_amount');
  assert.match(amount.value.formula, /ROUND\(G2\/DAY\(EOMONTH\(C2,0\)\)\*E2,2\)/);
  assert.equal(amount.value.result, 3000);
});

test('an ordinary deal keeps the pro rata chain, untouched', () => {
  const { sheetRow, cellFor } = sheetFor(ORDINARY);
  const cell = cellFor(sheetRow, 'payable_days');
  assert.match(cell.value.formula, /DAY\(B2\)/, 'the pro rata branch is gone');
  assert.equal(cell.value.result, 21);
});

test('month 4 of the SAME first week deal is ordinary again', () => {
  const { sheetRow, cellFor } = sheetFor({
    ...WEEK_ONE, preset_on: '2026-11-01', payable_days: 30, payable_amount: 3000,
  });
  const cell = cellFor(sheetRow, 'payable_days');
  assert.match(cell.value.formula, /DAY\(B2\)/, 'still forced past month 3');
  // The ordinary chain returns a full month here on its own: the stored
  // start sits before November begins.
  assert.equal(cell.value.result, 30);
});

test('a 30 day month 3 gives 30, never a hardcoded 31', () => {
  // Appointed Wed 1 July 2026, first week. Month 3 is September, 30 days.
  const row = {
    assigned_on: '2026-07-01',
    payment_start_on: '2026-09-25',
    preset_on: '2026-09-01',
    end_on: '2027-07-01',
    monthly_amount: 3000,
    payable_days: 30,
    payable_amount: 3000,
  };
  const { sheetRow, cellFor } = sheetFor(row);
  assert.equal(cellFor(sheetRow, 'payable_days').value.result, 30);
  assert.equal(cellFor(sheetRow, 'payable_amount').value.result, 3000);
});

/**
 * ===============================
 * * THE START DATE HAS TO MATCH ITS OWN FORMULA
 * ===============================
 * Found by building the file and reading it back: this wrote `=E+90` on
 * every row, so a first week deal carried a CACHED 30 October under a
 * formula saying 1 November. Excel recalculates on open, the date flips,
 * and a re-upload stores the wrong one.
 *
 * The day count survived it, because it reads the preset rather than this
 * cell. So the money was right and the DATE was wrong, which is the harder
 * kind to notice.
 */
test('a first week start exports the LAST FRIDAY formula, not +90', () => {
  const { sheetRow, cellFor } = sheetFor(WEEK_ONE);
  const cell = cellFor(sheetRow, 'payment_start_on');
  assert.doesNotMatch(cell.value.formula, /A2\+90/, 'still +90, so it flips on open');
  assert.match(cell.value.formula, /EOMONTH\(A2,2\)-MOD\(WEEKDAY\(EOMONTH\(A2,2\)\)-6,7\)/);
  assert.equal(cell.value.result.toISOString().slice(0, 10), '2026-10-30');
});

test('and the Excel expression gives the dates the helper gives', () => {
  // Excel's WEEKDAY default has Sunday as 1, so Friday is 6. Worked here
  // rather than by calling the helper, then compared against it.
  const eomonth = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0));
  const mod = (a, n) => (((a % n) + n) % n);
  const cases = {
    '2026-08-03': '2026-10-30',
    '2026-09-02': '2026-11-27',
    '2026-11-03': '2027-01-29',
    '2026-12-03': '2027-02-26',
    '2027-12-03': '2028-02-25',
  };
  for (const [appt, expected] of Object.entries(cases)) {
    const d = new Date(`${appt}T00:00:00Z`);
    const end = eomonth(d, 2);
    const excel = new Date(end);
    excel.setUTCDate(end.getUTCDate() - mod((end.getUTCDay() + 1) - 6, 7));
    assert.equal(excel.toISOString().slice(0, 10), expected, appt);
    assert.equal(lastFridayOfMonthThree(d).toISOString().slice(0, 10), expected, `${appt} helper`);
  }
});

test('an ordinary row keeps +90, and both keep the end date formula', () => {
  const { sheetRow, cellFor } = sheetFor(ORDINARY);
  assert.match(cellFor(sheetRow, 'payment_start_on').value.formula, /A2\+90/);
  for (const row of [WEEK_ONE, ORDINARY]) {
    const built = sheetFor(row);
    assert.match(built.cellFor(built.sheetRow, 'end_on').value.formula, /YEAR\(A2\)\+1/);
  }
});

/**
 * THE ROW REACHES THE FORMULA BUILDER. Without it the week 1 branch can
 * never fire, and the only symptom is a number being wrong in his file.
 */
test('BUILD.payable_days is given the row, not just the addresses', () => {
  const at = (key) => ({ assigned_on: 'A2', payment_start_on: 'B2', preset_on: 'C2' }[key] ?? 'Z2');
  const forced = BUILD.payable_days(at, WEEK_ONE);
  const ordinary = BUILD.payable_days(at, ORDINARY);
  assert.notEqual(forced, ordinary);
  // Called with NO row at all it must fall back to the ordinary chain
  // rather than throwing: every other caller passes one, and a crash in
  // the export is worse than a pro rata day count.
  assert.equal(BUILD.payable_days(at, undefined), ordinary);
});

test('the cached results match what the CRM stores', () => {
  const results = resultsFor(WEEK_ONE);
  assert.equal(results.payable_days, 31);
  assert.equal(results.payable_amount, 3000);
  assert.equal(results.payment_start_on.toISOString().slice(0, 10), '2026-10-30');
});
