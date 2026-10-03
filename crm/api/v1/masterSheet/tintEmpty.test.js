const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMasterSheetWorkbook } = require('./buildWorkbook');
const { layoutOptions } = require('./exportQuery');
const masterSheetTemplate = require('../templates/xlsx/masterSheet');

/**
 * ***************************************************
 * * Tinting the empty cells, on the Master sheet tab
 * ***************************************************
 *
 * A PROOFREADING PASS on the working copy: which cells is it missing.
 * Off by default, because a sheet of red is unreadable and most blanks are
 * legitimately blank.
 *
 * IT CHANGES NO ROW AND NO FIGURE. It paints what is already there, which
 * is why the export's count does not move when it is flipped.
 */

const deal = (over = {}) => ({
  id: 1, group_name: 'ALPHA', person_name: 'Alex Example', company: 'Northstar Care',
  role_label: 'Director', payable_amount: '1000', monthly_amount: '1000', payable_days: 30,
  currency: 'GBP', payment_method: 'bank', preset_on: '2026-08-01',
  location: '', postcode: '', phone: '', door_number: '',
  bank_details: '', account_number: '', sort_code: '', accepting_postals: '',
  source: 'import', ...over,
});

/** Every cell of the first written row, as { header: fill argb or null }. */
async function firstRow(opts) {
  const wb = await buildMasterSheetWorkbook([deal()], { singleTab: true, ...opts });
  const sheet = wb.getWorksheet('Master sheet');
  const header = sheet.getRow(1);
  const row = sheet.getRow(2);
  const out = new Map();
  row.eachCell({ includeEmpty: true }, (cell, n) => {
    out.set(String(header.getCell(n).value ?? n), cell.fill?.fgColor?.argb ?? null);
  });
  return out;
}

const EMPTY = 'FFFDECEC';
// The mark on an amount out of the month's figure. READ OFF THE PALETTE,
// never typed: it follows the picked secondary, so a literal hex would
// pass on the default and lie about every other colour.
const MARK = require('./breakdowns/palette').fillsFor().tint.fgColor.argb;

test('OFF BY DEFAULT. Nothing is tinted unless it is asked for', async () => {
  const cells = await firstRow({});
  for (const [name, fill] of cells) assert.equal(fill, null, `${name} was tinted`);
});

test('ON, an EMPTY cell is tinted', async () => {
  const cells = await firstRow({ tintEmpty: true });
  assert.equal(cells.get('Postcode'), EMPTY);
  assert.equal(cells.get('Sort code'), EMPTY);
});

test('AND A FILLED ONE IS NOT', async () => {
  const cells = await firstRow({ tintEmpty: true });
  assert.equal(cells.get('Name of individual'), null);
  assert.equal(cells.get('Company in question'), null);
  assert.equal(cells.get('Currency'), null);
});

test('ZERO IS A VALUE, NEVER A GAP', async () => {
  // A payable amount of 0 and a day count of 0 are real answers the sheet
  // gives. Tinting them sends somebody looking for a value already there.
  const wb = await buildMasterSheetWorkbook(
    [deal({ payable_amount: '0', monthly_amount: '0', payable_days: 0 })],
    { singleTab: true, tintEmpty: true },
  );
  const sheet = wb.getWorksheet('Master sheet');
  const header = sheet.getRow(1);
  const row = sheet.getRow(2);
  const at = (name) => {
    let found = null;
    row.eachCell({ includeEmpty: true }, (cell, n) => {
      if (String(header.getCell(n).value) === name) found = cell.fill?.fgColor?.argb ?? null;
    });
    return found;
  };
  assert.equal(at('Payable days this month'), null, '0 days is an answer');
  assert.equal(at('Monthly amount'), null, '0 is an answer');
});

/**
 * BOTH SHAPES, because they are two writers. The single tab paints its own
 * rows and the per group tabs go through addDealRow, and a first draft of
 * this test checked only the single tab: putting the cream fill back in
 * addDealRow left it green, on exactly the shape the fault was reported on.
 */
test('A MANUAL ROW IS NOT MARKED AT ALL, and its gaps still show', async () => {
  // It used to wash all twenty-one columns in cream, which hid the gap
  // tint under it. His call 2026-09-23 removed the row fill: "added by
  // hand" is not a fact about any single column, so nothing replaced it.
  for (const [opts, tab] of [
    [{ singleTab: true }, 'Master sheet'],
    [{ month: '2026-08' }, 'ALPHA'],
  ]) {
    const wb = await buildMasterSheetWorkbook(
      [deal({ source: 'manual' })], { ...opts, tintEmpty: true },
    );
    const row = wb.getWorksheet(tab).getRow(2);
    const fills = new Set();
    row.eachCell({ includeEmpty: true }, (cell) => fills.add(cell.fill?.fgColor?.argb ?? null));
    assert.equal(fills.has('FFFFF6DC'), false, `${tab}: the manual row fill came back`);
    assert.equal(fills.has(EMPTY), true, `${tab}: the gap tint is standing down for it`);
  }
});

test('THE QUERY PARAM IS OFF UNLESS IT SAYS true', () => {
  assert.equal(layoutOptions({}).tintEmpty, false);
  assert.equal(layoutOptions({ tintEmpty: 'false' }).tintEmpty, false);
  assert.equal(layoutOptions({ tintEmpty: 'anything' }).tintEmpty, false);
  assert.equal(layoutOptions({ tintEmpty: 'true' }).tintEmpty, true);
});

test('THE TEMPLATE CARRIES IT, and still takes nothing else', async () => {
  // It used to drop every option but `columns`, so the switch reached the
  // route and stopped there.
  const wb = await masterSheetTemplate.build([deal()], { tintEmpty: true });
  const row = wb.getWorksheet('Master sheet').getRow(2);
  const fills = new Set();
  row.eachCell({ includeEmpty: true }, (cell) => fills.add(cell.fill?.fgColor?.argb ?? null));
  assert.equal(fills.has(EMPTY), true, 'the switch must reach the workbook');

  // And a month-tab switch must not reach a file with no totals to switch.
  const wb2 = await masterSheetTemplate.build([deal()], { groupTotals: true, companyTotals: true });
  const sheet = wb2.getWorksheet('Master sheet');
  assert.equal(sheet.rowCount, 2, 'one header and one deal, no total lines');
});

test('AND THE UNCOUNTED MARK SITS BESIDE IT, on the amount alone', async () => {
  // It used to own the whole row, so the gap tint stood down entirely.
  // His call 2026-09-23 put it on the figure it is about, which leaves
  // the two saying different things about different cells on one line.
  //
  // `for_this_month` EXPLICITLY. A production row is rolled and carries
  // the flag; a fixture without it is judged against the month the server
  // is in today, so the first draft of this test was uncounted by accident
  // and passed for the wrong reason.
  const wb = await buildMasterSheetWorkbook(
    [deal({ for_this_month: false })],
    { month: '2026-08', tintEmpty: true },
  );
  const sheet = wb.getWorksheet('ALPHA');
  const header = sheet.getRow(1);
  const row = sheet.getRow(2);
  const fills = new Set();
  let onAmount = null;
  row.eachCell({ includeEmpty: true }, (cell, n) => {
    fills.add(cell.fill?.fgColor?.argb ?? null);
    if (String(header.getCell(n).value) === 'Payable amount') onAmount = cell.fill?.fgColor?.argb ?? null;
  });
  assert.equal(onAmount, MARK, 'the amount lost its mark');
  assert.equal(fills.has(EMPTY), true, 'the gap tint is still standing down for it');
});

test('IT REACHES THE MONTH TABS TOO, on an ordinary counted row', async () => {
  const wb = await buildMasterSheetWorkbook(
    [deal({ for_this_month: true })],
    { month: '2026-08', tintEmpty: true },
  );
  const fills = new Set();
  wb.getWorksheet('ALPHA').getRow(2)
    .eachCell({ includeEmpty: true }, (c) => fills.add(c.fill?.fgColor?.argb ?? null));
  assert.equal(fills.has(EMPTY), true);
  assert.equal(fills.has(MARK), false, 'a counted row carries no uncounted mark');
});

/**
 * ===============================
 * * THE FOUR DERIVED COLUMNS ARE FORMULAS, AND THEY RENDER EMPTY
 * ===============================
 * Found 2026-09-17, on the first real export: the payment start and the
 * end date were blank on screen and untinted on every row with no
 * appointment date. The cell holds `{ formula, result }`, an OBJECT, so a
 * plain check called them filled.
 */
const NO_DATES = () => deal({ assigned_on: null, payment_start_on: null, end_on: null });

async function singleTabRow(row, opts) {
  const wb = await buildMasterSheetWorkbook([row], { singleTab: true, ...opts });
  const sheet = wb.getWorksheet('Master sheet');
  const header = sheet.getRow(1);
  const cells = new Map();
  sheet.getRow(2).eachCell({ includeEmpty: true }, (cell, n) => {
    cells.set(String(header.getCell(n).value ?? n), cell.fill?.fgColor?.argb ?? null);
  });
  return cells;
}

test('A FORMULA THAT RENDERS EMPTY IS TINTED', async () => {
  const cells = await singleTabRow(NO_DATES(), { tintEmpty: true });
  assert.equal(cells.get('Payment start date'), EMPTY, 'no appointment, so it renders ""');
  assert.equal(cells.get('Provisional payment end date'), EMPTY);
  assert.equal(cells.get('Appointment date'), EMPTY, 'the literal cell it derives from');
});

test('AND A FORMULA THAT PRODUCES A VALUE IS NOT', async () => {
  const cells = await singleTabRow(deal({ assigned_on: '2026-01-01' }), { tintEmpty: true });
  assert.equal(cells.get('Payment start date'), null, 'appointment + 90 is a real date');
  assert.equal(cells.get('Provisional payment end date'), null);
  assert.equal(cells.get('Payable days this month'), null);
  assert.equal(cells.get('Payable amount'), null);
});

test('THE FORMULA ITSELF IS UNTOUCHED. Only the fill is written', async () => {
  const wb = await buildMasterSheetWorkbook(
    [NO_DATES()], { singleTab: true, tintEmpty: true },
  );
  const sheet = wb.getWorksheet('Master sheet');
  const header = sheet.getRow(1);
  let start = null;
  sheet.getRow(2).eachCell({ includeEmpty: true }, (cell, n) => {
    if (String(header.getCell(n).value) === 'Payment start date') start = cell;
  });
  assert.match(start.value.formula, /ISNUMBER/, 'the sheet must still compute itself');
  assert.equal(start.fill?.fgColor?.argb, EMPTY, 'and it is still tinted');
  // NOT the cached result. exceljs drops an empty one on the way in, which
  // is the whole reason the tint asks sheetFormulas instead of the cell.
});
