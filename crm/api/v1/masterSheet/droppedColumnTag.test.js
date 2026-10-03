const test = require('node:test');
const assert = require('node:assert/strict');
const template = require('../templates/xlsx/masterSheet');
const { listSheetPresets, buildMasterSheetWorkbook } = require('./buildWorkbook');
const { GOING_CONCERN, REVIEWED_MONTHLY } = require('../shared/endNote.helper');

/**
 * ***************************************************
 * * A TAG HAS NOWHERE TO GO WHEN ITS COLUMN WAS DROPPED
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-22. Exporting the master sheet on the Bank preset
 * failed outright:
 *
 *   Couldn't build that export
 *   Out of bounds. Excel supports columns from 1 to 16384
 *
 * `writeTag` asked for the end date column with exceljs's own
 * `sheet.getColumn('end_on')`, which THROWS on a key the sheet does not
 * have. The guard on the next line, `if (!column?.number) return`, was
 * written for exactly this and could never run.
 *
 * Every preset but All drops the end date column, so the whole file was
 * lost whenever a dropped column met a row carrying his words. Two
 * conditions, which is why it passed every earlier check: the unit tests
 * built tagged rows with all the columns, and column-set tests built every
 * preset with untagged rows.
 *
 * The cure is `cellByKey`, which was already in the same file for this
 * reason: "the column selector can legitimately drop any non-required
 * column, so every per-column tint has to ask rather than assume".
 */

const BASE = {
  group_name: 'INDIGO',
  role_label: 'Mid 1',
  company: 'Workforce',
  currency: 'GBP',
  monthly_amount: 1000,
  payable_amount: 1000,
  payable_days: 30,
  payment_method: 'bank',
  bank_details: 'X',
  account_number: '1',
  sort_code: '20',
  location: 'Main City',
  preset_on: '2026-09-01',
  payment_start_on: '2025-04-01',
  // THE FIELD THAT MADE IT THROW. Without an appointment the formula is
  // skipped for its own reasons and the tag path is never reached.
  assigned_on: '2025-01-01',
  source: 'import',
};

const ROWS = [
  { ...BASE, id: 1, person_name: 'Plain' },
  { ...BASE, id: 2, person_name: 'Noted', end_on: null, end_note: GOING_CONCERN },
  { ...BASE, id: 3, person_name: 'Ticked', end_on: null, review_monthly: true },
  { ...BASE, id: 4, person_name: 'Dated', end_on: '2027-12-31' },
];

// ===============================
// * It must not throw, on any of them
// ===============================

test('EVERY PRESET BUILDS WITH TAGS ON, both layouts', async () => {
  for (const preset of listSheetPresets()) {
    for (const perGroupTabs of [false, true]) {
      await template.build(ROWS, { columns: preset.columns, perGroupTabs, includeTags: true });
    }
  }
});

test('AND THE ONE THAT BROKE IS NAMED, so this cannot pass vacuously', async () => {
  const bank = listSheetPresets().find((p) => p.id === 'bank');
  assert.ok(bank, 'the bank preset has gone');
  assert.ok(!bank.columns.includes('end_on'), 'bank now carries the end date, which is what threw');
  await template.build(ROWS, { columns: bank.columns, includeTags: true });
});

/** Every string anywhere on a tab, so a tag written elsewhere cannot hide. */
function textOf(ws) {
  const out = [];
  ws.eachRow((row) => row.eachCell({ includeEmpty: false }, (c) => out.push(String(c.text ?? ''))));
  return out;
}

test('NO END DATE COLUMN MEANS NO TAG, not a tag somewhere else', async () => {
  const bank = listSheetPresets().find((p) => p.id === 'bank');
  const wb = await template.build(ROWS, { columns: bank.columns, includeTags: true });
  for (const ws of wb.worksheets) {
    const text = textOf(ws);
    assert.ok(!text.includes(GOING_CONCERN), `"${GOING_CONCERN}" landed in a column it does not belong to`);
    assert.ok(!text.includes(REVIEWED_MONTHLY), 'a tag was written with no column to hold it');
  }
});

/**
 * AND THE COLUMN THAT DOES CARRY IT STILL DOES. Guarding the throw by
 * never tagging anything would be a cure worse than the fault.
 */
test('WITH THE COLUMN PRESENT, HIS WORDS ARE STILL PRINTED', async () => {
  const wb = await buildMasterSheetWorkbook(ROWS, { singleTab: true, includeTags: true });
  const text = textOf(wb.worksheets[0]);
  assert.ok(text.includes(GOING_CONCERN), 'the tag stopped being written at all');
  assert.ok(text.includes(REVIEWED_MONTHLY));
});
