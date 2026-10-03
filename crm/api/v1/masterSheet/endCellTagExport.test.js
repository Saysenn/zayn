const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMasterSheetWorkbook } = require('./buildWorkbook');
const template = require('../templates/xlsx/masterSheet');
const { layoutOptions } = require('./exportQuery');
const { GOING_CONCERN, REVIEWED_MONTHLY } = require('../shared/endNote.helper');

/**
 * ***************************************************
 * * HIS WORDS IN THE END DATE COLUMN OF THE EXPORTED FILE
 * ***************************************************
 *
 * THE INCIDENT, found in the browser 2026-09-22.
 *
 * The single tab export writes the end date as a LIVE FORMULA, appointment
 * plus a year, so the file is one he can work in. It was applied to every
 * row that had an appointment date, which is nearly all of them, including
 * the 19 rows where he wrote "Going concern" and the 12 where he wrote
 * "Reviewed monthly".
 *
 * So his own words came back out of the CRM as 31 December 2025: a date he
 * never wrote, over a word he did, in the column he reads. A row whose
 * whole point is "this deal has NO end date" was being given a computed
 * one.
 *
 * Nothing caught it because every unit test here builds rows without an
 * appointment date, so the formula was always skipped for its own reasons.
 */

const BASE = {
  group_name: 'INDIGO',
  role_label: 'Mid 1',
  company: 'Workforce',
  currency: 'AED',
  monthly_amount: 4700,
  payable_amount: 4700,
  payable_days: 30,
  payment_method: 'bank',
  preset_on: '2026-09-01',
  payment_start_on: '2025-04-01',
  // THE FIELD THAT EXPOSED IT. Without one the formula is skipped anyway.
  assigned_on: '2025-01-01',
  source: 'import',
};

const ROWS = [
  { ...BASE, id: 1, person_name: 'Maid', end_on: null, end_note: GOING_CONCERN },
  { ...BASE, id: 2, person_name: 'Ticked', end_on: null, review_monthly: true },
  { ...BASE, id: 3, person_name: 'Dated', end_on: '2027-12-31' },
];

/** The end date cell for one person, as the file actually holds it. */
async function endCell(person, opts) {
  const wb = await buildMasterSheetWorkbook(ROWS, opts);
  for (const ws of wb.worksheets) {
    let column = 0;
    ws.getRow(1).eachCell((c, n) => { if (String(c.value).includes('end date')) column = n; });
    if (!column) continue;
    for (let r = 2; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      const named = row.values.some((v) => v === person);
      if (!named) continue;
      const cell = row.getCell(column);
      const value = cell.value;
      return {
        isFormula: Boolean(value && typeof value === 'object' && value.formula !== undefined),
        text: value && typeof value === 'object' ? String(value.result ?? '') : value,
        fill: cell.fill?.fgColor?.argb ?? null,
      };
    }
  }
  return null;
}

// ===============================
// * The formula must not overwrite his word
// ===============================

test('A ROW CARRYING HIS WORD GETS NO COMPUTED END DATE', async () => {
  const maid = await endCell('Maid', { singleTab: true });
  assert.equal(maid.isFormula, false, 'appointment plus a year was written over "Going concern"');
});

test('AND NEITHER DOES A TICKED ROW', async () => {
  const ticked = await endCell('Ticked', { singleTab: true });
  assert.equal(ticked.isFormula, false);
});

/**
 * THE LIVE FORMULA STAYS FOR EVERY OTHER ROW. It is the whole reason that
 * tab exists: typing an appointment date moves the dates below it, exactly
 * as his own sheet does. Suppressing it everywhere would have been a cure
 * worse than the fault.
 */
test('AN ORDINARY ROW KEEPS ITS LIVE FORMULA', async () => {
  const dated = await endCell('Dated', { singleTab: true });
  assert.equal(dated.isFormula, true, 'the tab he works in stopped being live');
});

// ===============================
// * And the tag then fills the cell it left blank
// ===============================

test('WITH TAGS ON, HIS WORDS ARE PRINTED, ON YELLOW', async () => {
  const maid = await endCell('Maid', { singleTab: true, includeTags: true });
  assert.equal(maid.text, GOING_CONCERN);
  assert.ok(maid.fill, 'the tag has no fill');

  const ticked = await endCell('Ticked', { singleTab: true, includeTags: true });
  assert.equal(ticked.text, REVIEWED_MONTHLY);
});

test('WITH TAGS OFF, THE CELL IS BLANK, not a date he never wrote', async () => {
  const maid = await endCell('Maid', { singleTab: true });
  assert.ok(!maid.text, `the cell says "${maid.text}"`);
  assert.equal(maid.fill, null);
});

test('A ROW WITH A REAL DATE IS NEVER TAGGED', async () => {
  const dated = await endCell('Dated', { singleTab: true, includeTags: true });
  assert.equal(dated.fill, null, 'words were printed over a date that exists');
});

/**
 * BOTH LAYOUTS, because they take different paths: the per group tabs
 * write flat values and the single tab writes formulas, and the tag was
 * invisible on exactly one of them.
 */
test('THE PER GROUP LAYOUT TAGS THEM TOO', async () => {
  const maid = await endCell('Maid', { includeTags: true });
  assert.equal(maid.text, GOING_CONCERN);
  assert.ok(maid.fill);
});

// ===============================
// * The template has to forward what the modal sends
// ===============================

/**
 * `includeTags` was parsed from the query and then dropped: the template
 * named the options it forwards, and this was not among them. The switch
 * existed, was sent, and did nothing.
 */
test('THE TEMPLATE FORWARDS includeTags', async () => {
  const wb = await template.build(ROWS, { includeTags: true });
  const ws = wb.worksheets[0];
  let column = 0;
  ws.getRow(1).eachCell((c, n) => { if (String(c.value).includes('end date')) column = n; });
  const words = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const v = ws.getRow(r).getCell(column).value;
    if (typeof v === 'string') words.push(v);
  }
  assert.ok(words.includes(GOING_CONCERN), 'the switch is sent and ignored');
});

/**
 * ===============================
 * * ONE WORKBOOK, A TAB PER GROUP
 * ===============================
 * His call 2026-09-22. Distinct from `multiFile`, which hands back a zip
 * of separate files. The template hardcoded one tab, so this was not
 * reachable at all.
 */
test('perGroupTabs SPLITS ONE WORKBOOK BY GROUP', async () => {
  const rows = [
    { ...BASE, id: 1, person_name: 'Zayn', group_name: 'INDIGO' },
    { ...BASE, id: 2, person_name: 'Maid', group_name: 'MILKMAN' },
  ];
  const tabbed = await template.build(rows, { perGroupTabs: true });
  assert.deepEqual(tabbed.worksheets.map((w) => w.name).sort(), ['INDIGO', 'MILKMAN']);

  // And the default is still the working file's own shape: one tab.
  const single = await template.build(rows, {});
  assert.equal(single.worksheets.length, 1);
  assert.equal(single.worksheets[0].name, 'Master sheet');
});

test('AND THE QUERY CARRIES BOTH NEW OPTIONS', () => {
  const on = layoutOptions({ includeTags: 'true', perGroupTabs: 'true' });
  assert.equal(on.includeTags, true);
  assert.equal(on.perGroupTabs, true);
  // Absent means off, so a saved link without them keeps the shape it had.
  const off = layoutOptions({});
  assert.equal(off.includeTags, false);
  assert.equal(off.perGroupTabs, false);
});

// ===============================
// * And dropping the date columns does not break it
// ===============================

/**
 * His question, 2026-09-22: what happens if the date columns are left out?
 * `applyFormulas` skips a formula whose dependency column is absent, so
 * the cell keeps its flat value and the file still prints what the CRM
 * holds. Pinned because the answer is not obvious from the code.
 */
test('DROPPING EVERY DATE COLUMN PRINTS THE CRM VALUES, and throws nothing', async () => {
  const columns = ['group_name', 'role_label', 'person_name', 'company',
    'monthly_amount', 'payable_amount', 'currency'];
  const wb = await buildMasterSheetWorkbook(ROWS, { singleTab: true, columns });
  const ws = wb.worksheets[0];

  const headers = [];
  ws.getRow(1).eachCell((c) => headers.push(String(c.value)));
  assert.ok(!headers.some((h) => h.includes('end date')), 'the column was not dropped');

  const first = ws.getRow(2).values.filter((v) => v !== undefined && v !== null);
  assert.ok(first.includes('Maid') || first.includes('Zayn') || first.includes('Dated'));
  assert.ok(first.includes(4700), 'the stored figure did not survive');
  // No cell is a formula, because every dependency column is gone.
  ws.eachRow((row) => row.eachCell((cell) => {
    assert.ok(
      !(cell.value && typeof cell.value === 'object' && cell.value.formula !== undefined),
      'a formula survived with its dependencies dropped',
    );
  }));
});

/**
 * ***************************************************
 * * THE WORKING FILE IS DEAL ROWS AND NOTHING ELSE
 * ***************************************************
 *
 * Per group tabs and the month generation share one code path, and that
 * path writes the Active company list and the breakdown pivot
 * unconditionally: on a MONTH tab the whole point is that he stops
 * rebuilding them by hand.
 *
 * The master sheet is a different document. It is the working copy he
 * edits and uploads back, and it has never carried either. Splitting it
 * into tabs inherited both, so the first file out had a company list
 * pinned beside his rows and a Grand Total under them. Spotted on sight,
 * 2026-09-22.
 */

const PER_GROUP = [
  { ...BASE, id: 1, person_name: 'Juan', group_name: 'NEXUS', company: 'A J Rayson', location: 'Main City' },
  { ...BASE, id: 2, person_name: 'Abe', group_name: 'NEXUS', company: 'A J Rayson', location: 'Abu Dhabi' },
  { ...BASE, id: 3, person_name: 'Pino', group_name: 'INDIGO', company: 'Workforce', location: 'South East' },
];

/** Every string anywhere on a tab, so a stray block cannot hide. */
function textOf(ws) {
  const out = [];
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => out.push(String(c.text ?? ''))));
  return out;
}

test('THE TABBED MASTER SHEET HAS NO ACTIVE COMPANY LIST', async () => {
  const wb = await template.build(PER_GROUP, { perGroupTabs: true });
  for (const ws of wb.worksheets) {
    assert.ok(
      !textOf(ws).some((t) => t.startsWith('Active company list')),
      `the company list is pinned beside the rows on ${ws.name}`,
    );
  }
});

test('AND NO BREAKDOWN PIVOT UNDER THE ROWS', async () => {
  const wb = await template.build(PER_GROUP, { perGroupTabs: true });
  for (const ws of wb.worksheets) {
    const text = textOf(ws);
    assert.ok(!text.includes('Grand Total'), `a Grand Total was written on ${ws.name}`);
    assert.ok(!text.includes('Row Labels'), `a pivot was written on ${ws.name}`);
  }
});

test('IT STILL SPLITS BY GROUP, and keeps every column', async () => {
  const wb = await template.build(PER_GROUP, { perGroupTabs: true });
  assert.deepEqual(wb.worksheets.map((w) => w.name).sort(), ['INDIGO', 'NEXUS']);

  const headers = [];
  wb.worksheets[0].getRow(1).eachCell((c) => headers.push(String(c.value)));
  for (const wanted of ['Appointment date', 'Payment start date', 'Monthly amount', 'Sort code']) {
    assert.ok(headers.includes(wanted), `${wanted} was dropped from the working file`);
  }
});

/**
 * AND THE MONTH TAB KEEPS BOTH. The gate defaults ON, so the document that
 * genuinely wants a company list and a pivot is untouched. Turning them
 * off everywhere would have been a cure worse than the fault.
 */
test('THE MONTH LAYOUT STILL WRITES BOTH', async () => {
  const wb = await buildMasterSheetWorkbook(PER_GROUP, { month: '2026-09' });
  const text = textOf(wb.worksheets[0]);
  assert.ok(text.some((t) => t.startsWith('Active company list')), 'the month tab lost its list');
  assert.ok(text.includes('Grand Total'), 'the month tab lost its pivot');
});
