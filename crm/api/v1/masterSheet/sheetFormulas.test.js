const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMasterSheetWorkbook, listExportColumns } = require('./buildWorkbook');
const { resultsFor } = require('./sheetFormulas');
const { RUNNING_ARGB, STARTED_ARGB, NOT_STARTED_ARGB } = require('./buildWorkbook');
const { payableDaysFor, payableFromDays } = require('../calculator/computePayable');

/**
 * ***************************************************
 * * The exported master sheet computes itself
 * ***************************************************
 *
 * With every column selected our letters are his: E Appointment,
 * F Payment start, G Preset, H End date, I Payable days, K Monthly,
 * L Payable amount. Row 2 is the first deal.
 *
 * These pin the FORMULA STRINGS and the CACHED RESULTS separately, because
 * the two failing apart is the bug that matters: a file whose numbers
 * change the moment Excel recalculates it.
 */

const COL = {
  assigned_on: 'E', payment_start_on: 'F', preset_on: 'G', end_on: 'H',
  payable_days: 'I', monthly_amount: 'K', payable_amount: 'L',
};
const CELL = { E: 5, F: 6, G: 7, H: 8, I: 9, K: 11, L: 12 };

const deal = (over = {}) => ({
  id: 1,
  group_name: 'INDIGO',
  role_label: 'Director',
  person_name: 'Thomas Snelling',
  company: 'Umbrella UK Holdings',
  assigned_on: new Date('2026-01-20T00:00:00Z'),
  payment_start_on: new Date('2026-04-20T00:00:00Z'),
  preset_on: new Date('2026-07-01T00:00:00Z'),
  end_on: new Date('2027-01-20T00:00:00Z'),
  payable_days: 31,
  monthly_amount: 1000,
  payable_amount: 1000,
  currency: 'GBP',
  ...over,
});

function sheetOf(rows, opts = {}) {
  const wb = buildMasterSheetWorkbook(rows, { singleTab: true, ...opts });
  return wb.getWorksheet('Master sheet');
}

const cellAt = (sheet, letter, row = 2) => sheet.getRow(row).getCell(CELL[letter]);
const at = (sheet, letter, row = 2) => cellAt(sheet, letter, row).value;
// THE CELL'S OWN `result`, never `value.result`. exceljs leaves an empty
// cached result off the value object entirely, and does the same for every
// dependent cell of a shared formula. readSheets.js reads it this way for
// the same reason, so the test reads a written cell the way the parser
// would read it back.
const resultAt = (sheet, letter, row = 2) => cellAt(sheet, letter, row).result;

test('the four derived cells are formulas, the three inputs are not', () => {
  const s = sheetOf([deal()]);

  for (const letter of ['F', 'H', 'I', 'L']) {
    assert.equal(typeof at(s, letter), 'object', `${letter} is a formula cell`);
    assert.ok(at(s, letter).formula, `${letter} carries a formula`);
  }
  // He types these. A cell holding a formula is a cell he cannot type into.
  for (const letter of ['E', 'G', 'K']) {
    assert.equal(typeof at(s, letter)?.formula, 'undefined', `${letter} stays literal`);
  }
});

test('payment start is his own formula, appointment + 90', () => {
  const s = sheetOf([deal()]);
  assert.equal(at(s, 'F').formula, 'IF(NOT(ISNUMBER(E2)),"",E2+90)');
});

test('the end date is appointment + a year, and NOTHING reads it', () => {
  const s = sheetOf([deal()]);
  assert.equal(at(s, 'H').formula, 'IF(NOT(ISNUMBER(E2)),"",DATE(YEAR(E2)+1,MONTH(E2),DAY(E2)))');
  // THE COPY-PASTE ERROR THIS CORRECTS. His rows 74-85 divide by
  // EOMONTH(H), the end date's month, which pays up to £160 a head wrong
  // across 17 people. The end date must not appear in the money at all.
  assert.doesNotMatch(at(s, 'L').formula, /EOMONTH\(H/);
  assert.doesNotMatch(at(s, 'I').formula, /H2/);
});

test('payable days measures the preset MONTH, not the preset cell', () => {
  // His `F<=G` agrees with the month only while every preset is the 1st.
  // Row 4 of his own file is the 2nd. computePayable has always measured
  // the month, so the formula does too.
  const s = sheetOf([deal()]);
  const f = at(s, 'I').formula;
  assert.match(f, /DATE\(YEAR\(G2\),MONTH\(G2\),1\)/);
  assert.match(f, /EOMONTH\(G2,0\)/);
});

test('payable amount always divides by the preset month, and is ROUNDED', () => {
  const s = sheetOf([deal()]);
  const f = at(s, 'L').formula;
  assert.match(f, /ROUND\(K2\/DAY\(EOMONTH\(G2,0\)\)\*I2,2\)/);
  // No preset month is no pro-rata period, so the whole monthly is owed —
  // what his own sheet does on all twelve of its "NA" rows.
  assert.match(f, /IF\(NOT\(ISNUMBER\(G2\)\),K2,/);
});

test('THE CACHED RESULT IS WHAT THE FORMULA COMPUTES, so the file cannot change on open', () => {
  // Appointment 2026-04-15 -> start 2026-07-14 -> 18 days of July -> 580.65.
  const s = sheetOf([deal({
    assigned_on: new Date('2026-04-15T00:00:00Z'),
    payment_start_on: new Date('2026-07-14T00:00:00Z'),
    payable_days: 18,
    payable_amount: 580.65,
  })]);
  assert.equal(resultAt(s, 'F').toISOString().slice(0, 10), '2026-07-14');
  assert.equal(resultAt(s, 'H').toISOString().slice(0, 10), '2027-04-15');
  assert.equal(resultAt(s, 'I'), 18);
  assert.equal(resultAt(s, 'L'), 580.65);
});

test('the cached result follows the CHAIN, never the stored row', () => {
  // THE INDIGO PAIR. Payment start is stored as 2026-08-01 where
  // appointment + 90 gives 2026-08-26, £1,612.90 apart. His call: the file
  // follows the formula. A day count left over from the stored value would
  // no longer match the cell above it and Excel would move it on open.
  const row = deal({
    assigned_on: new Date('2026-05-28T00:00:00Z'),
    payment_start_on: new Date('2026-08-01T00:00:00Z'),
    preset_on: new Date('2026-08-01T00:00:00Z'),
    payable_days: 31,
    payable_amount: 1000,
  });
  const s = sheetOf([row]);
  assert.equal(resultAt(s, 'F').toISOString().slice(0, 10), '2026-08-26', 'the formula wins');
  assert.equal(resultAt(s, 'I'), 6, '26 to 31 August inclusive, not the stored 31');
  // And it agrees with the CRM's own arithmetic on that same reading.
  const days = payableDaysFor(new Date('2026-08-26T00:00:00Z'), row.preset_on);
  assert.equal(resultAt(s, 'L'), payableFromDays({
    monthlyAmount: 1000, presetOn: row.preset_on, payableDays: days,
  }));
});

test('an Ongoing row stays BLANK, never 30 March 1900', () => {
  // The twelve standing rows. `=E+90` on a blank is 1900-03-30, which is
  // the state his own file avoids by leaving those cells as text.
  const s = sheetOf([deal({ assigned_on: null, payment_start_on: null, end_on: null })]);
  assert.equal(resultAt(s, 'F'), '');
  assert.equal(resultAt(s, 'H'), '');
  // No recorded start is a FULL MONTH, never zero.
  assert.equal(resultAt(s, 'I'), 31);
});

test('an NA preset pays the full monthly amount, never #VALUE!', () => {
  // Twelve of his rows carry the text "NA", and his own Payable amount
  // column pays the whole month on every one of them.
  const s = sheetOf([deal({ preset_on: null, payable_days: null })]);
  assert.equal(resultAt(s, 'I'), '');
  assert.equal(resultAt(s, 'L'), 1000);
});

test('A DROPPED COLUMN LEAVES THE CELL FLAT, never #REF!', () => {
  // The selector can drop Appointment date. A formula pointing at a column
  // that is not in the file is #REF! in a document about money.
  const keys = listExportColumns().map((c) => c.key).filter((k) => k !== 'assigned_on');
  const wb = buildMasterSheetWorkbook([deal()], { singleTab: true, columns: keys });
  const s = wb.getWorksheet('Master sheet');
  const header = {};
  s.getRow(1).eachCell({ includeEmpty: false }, (c, i) => { header[String(c.text).trim()] = i; });

  const start = s.getRow(2).getCell(header['Payment start date']).value;
  assert.equal(typeof start?.formula, 'undefined', 'no appointment column, no formula');
  assert.ok(start instanceof Date, 'it keeps the stored value it has today');
  // Payable days still works: it needs the payment start COLUMN, which is
  // present, not the payment start FORMULA.
  const days = s.getRow(2).getCell(header['Payable days this month']).value;
  assert.ok(days.formula, 'the rest of the chain is untouched');
});

test('THE MONTH TABS STAY FLAT. Their totals are static and would drift', () => {
  // buildSingleTab only. The per-group tabs write totals in column C
  // through countsTowardTotal, which reads the colour setting, and no Excel
  // formula can reach a settings row.
  const wb = buildMasterSheetWorkbook([deal()], { breakdown: false });
  const tab = wb.worksheets.find((w) => w.name !== 'Master sheet');
  const row = tab.getRow(2);
  let formulas = 0;
  row.eachCell({ includeEmpty: false }, (c) => { if (c.formula) formulas += 1; });
  assert.equal(formulas, 0);
});

test('resultsFor is the one arithmetic, not a second copy', () => {
  const row = deal({ assigned_on: new Date('2026-04-15T00:00:00Z') });
  const out = resultsFor(row);
  const days = payableDaysFor(out.payment_start_on, row.preset_on);
  assert.equal(out.payable_days, days);
  assert.equal(out.payable_amount, payableFromDays({
    monthlyAmount: row.monthly_amount, presetOn: row.preset_on, payableDays: days,
  }));
});

/**
 * ===============================
 * * The end date column follows the setting
 * ===============================
 * His own send does not carry it. But with the colour setting on,
 * `isOwedThisMonth` drops a row whose end date is behind the month, so the
 * payment start turns red BECAUSE OF A DATE THE FILE DOES NOT SHOW.
 */
const inSend = (opts) => listExportColumns(opts).filter((c) => c.inSend).map((c) => c.key);

test('the end date is out of the default set while it decides nothing', () => {
  assert.equal(inSend().includes('end_on'), false);
  assert.equal(inSend({ useEndDate: false }).includes('end_on'), false);
  // The thirteen of his own send, unchanged.
  assert.equal(inSend().length, 13);
});

test('the end date JOINS the default set when the setting is on', () => {
  assert.equal(inSend({ useEndDate: true }).includes('end_on'), true);
  assert.equal(inSend({ useEndDate: true }).length, 14);
});

test('the setting moves that column and nothing else', () => {
  const off = new Set(inSend({ useEndDate: false }));
  const on = inSend({ useEndDate: true }).filter((k) => !off.has(k));
  assert.deepEqual(on, ['end_on']);
});

/**
 * ===============================
 * * THE PAYMENT START COLOUR IS LIVE, NOT PAINTED
 * ===============================
 * The single-tab export never carried it at all: `addDealRow` tints the
 * month tabs and `buildSingleTab` only ever tinted manual rows. Found
 * 2026-09-09.
 *
 * Conditional formatting rather than a fill, because a fill is dead paint
 * that lies the moment he edits a preset. His own sheet already does it
 * this way: five expression blocks on column F, and these are his three
 * conditions unchanged.
 */

const rulesOf = (sheet) => (sheet.conditionalFormattings ?? []);

test('the colour is CONDITIONAL FORMATTING, so it moves with the preset', () => {
  const s = sheetOf([deal(), deal({ id: 2, person_name: 'B' })]);
  const blocks = rulesOf(s);
  assert.equal(blocks.length, 1, 'ONE block, not his five hand grown ranges');
  assert.equal(blocks[0].ref, 'F2:F3', 'every written row and no more');
  assert.equal(blocks[0].rules.length, 3);
  for (const rule of blocks[0].rules) assert.equal(rule.type, 'expression');
});

test('his three conditions, in the order that makes them mean something', () => {
  const [red, amber, green] = rulesOf(sheetOf([deal()]))[0].rules;
  // A row that has not begun cannot also be running, so the start is asked
  // about first. Lower priority number wins in Excel.
  assert.match(red.formulae[0], /F2>EOMONTH\(G2,0\)/);
  assert.equal(red.style.fill.fgColor.argb, NOT_STARTED_ARGB);
  assert.match(amber.formulae[0], /F2>=G2,F2<=EOMONTH\(G2,0\)/);
  assert.equal(amber.style.fill.fgColor.argb, STARTED_ARGB);
  assert.match(green.formulae[0], /F2<G2/);
  assert.equal(green.style.fill.fgColor.argb, RUNNING_ARGB);
  assert.deepEqual([red.priority, amber.priority, green.priority], [1, 2, 3]);
});

test('AN NA PRESET OR AN Ongoing START PAINTS NOTHING', () => {
  // EOMONTH on text is #VALUE!, and a rule that errors simply does not
  // paint, so his twelve NA rows were uncoloured by accident. ISNUMBER says
  // so on purpose, and keeps a blank start uncoloured too: `Ongoing` is not
  // a date and must not read as "starts before the month".
  for (const rule of rulesOf(sheetOf([deal()]))[0].rules) {
    assert.match(rule.formulae[0], /ISNUMBER\(F2\)/);
    assert.match(rule.formulae[0], /ISNUMBER\(G2\)/);
  }
});

test('a dropped column writes NO rules rather than painting the wrong one', () => {
  const keys = listExportColumns().map((c) => c.key).filter((k) => k !== 'preset_on');
  const wb = buildMasterSheetWorkbook([deal()], { singleTab: true, columns: keys });
  assert.deepEqual(rulesOf(wb.getWorksheet('Master sheet')), []);
});

test('an empty sheet writes no rules', () => {
  assert.deepEqual(rulesOf(sheetOf([])), []);
});
