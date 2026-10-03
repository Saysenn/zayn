const test = require('node:test');
const assert = require('node:assert/strict');
const { listSheetPresets } = require('./buildWorkbook');
const { applyFilters } = require('./exportQuery');
const { fileLabelOf, templateFor } = require('../templates/xlsx');
const { exportFileName } = require('../shared/exportFileName.helper');

/**
 * ***************************************************
 * * A PAYMENT RUN IS ROWS AND COLUMNS, NOT JUST COLUMNS
 * ***************************************************
 *
 * His call 2026-09-22: "selecting bank should only include those paid in
 * bank per group, selecting cash should only include those paid in cash".
 *
 * The Bank document is the bank rows in bank columns. Offering its columns
 * over every row hands him sort codes beside the 54 people paid in cash,
 * and three files that each claim to be the run.
 *
 * NO NEW FILTER WAS WRITTEN for this. `applyFilters` has had `method`
 * since the payout tabs, so the preset only has to name one.
 */

const ROWS = [
  { id: 1, person_id: 'a', group_name: 'NEXUS', payment_method: 'bank' },
  { id: 2, person_id: 'b', group_name: 'NEXUS', payment_method: 'cash' },
  { id: 3, person_id: 'c', group_name: 'INDIGO', payment_method: 'cash' },
  { id: 4, person_id: 'd', group_name: 'INDIGO', payment_method: 'crypto' },
];

const by = () => Object.fromEntries(listSheetPresets().map((p) => [p.id, p]));

test('THE THREE PAYMENT RUNS EACH NAME A METHOD', () => {
  const p = by();
  assert.equal(p.bank.method, 'bank');
  assert.equal(p.cash.method, 'cash');
  assert.equal(p.crypto.method, 'crypto');
});

/**
 * AND THE OTHER TWO NAME NONE. A filter that has to be spelled out to be
 * switched off is one that gets left on: All and Standard are the whole
 * sheet, and `null` is what the browser reads to clear it.
 */
test('ALL AND STANDARD FILTER NOTHING', () => {
  const p = by();
  assert.equal(p.all.method, null);
  assert.equal(p.standard.method, null);
});

test('EVERY PRESET CARRIES THE KEY, so the browser reads one shape', () => {
  for (const preset of listSheetPresets()) {
    assert.ok('method' in preset, `${preset.id} has no method key at all`);
  }
});

// ===============================
// * What each one actually selects
// ===============================

test('A METHOD PRESET NARROWS THE ROWS, and the others do not', () => {
  const picked = (preset) => applyFilters(ROWS, { method: preset.method ?? undefined })
    .map((r) => r.person_id).join(',');
  const p = by();
  assert.equal(picked(p.all), 'a,b,c,d');
  assert.equal(picked(p.standard), 'a,b,c,d');
  assert.equal(picked(p.bank), 'a');
  assert.equal(picked(p.cash), 'b,c');
  assert.equal(picked(p.crypto), 'd');
});

test('AND IT NARROWS WITHIN EVERY GROUP, not to one of them', () => {
  const cash = by().cash;
  const out = applyFilters(ROWS, { method: cash.method });
  assert.deepEqual([...new Set(out.map((r) => r.group_name))].sort(), ['INDIGO', 'NEXUS']);
});

// ===============================
// * And a filtered run is a different file
// ===============================

/**
 * THE FILENAME HAS TO CARRY IT. Bank, cash, crypto and the whole sheet all
 * came down as "MASTER SHEET - <date>" and overwrote each other in his
 * downloads folder: the exact collision `exportFileName.helper` was
 * written to stop, in its own words.
 */
test('THE METHOD IS IN THE FILENAME', () => {
  const ms = templateFor('master-sheet');
  assert.equal(fileLabelOf(ms), 'MASTER SHEET');
  assert.equal(fileLabelOf(ms, 'bank'), 'MASTER SHEET - BANK');
  assert.equal(fileLabelOf(ms, 'cash'), 'MASTER SHEET - CASH');
  assert.equal(fileLabelOf(ms, 'crypto'), 'MASTER SHEET - CRYPTO');
});

test('SO THE FOUR FILES CANNOT SHARE A NAME', () => {
  const ms = templateFor('master-sheet');
  const names = [null, 'bank', 'cash', 'crypto']
    .map((m) => exportFileName(null, fileLabelOf(ms, m), '2026-09-22'));
  assert.equal(new Set(names).size, names.length, `two of these collide: ${names}`);
});

/**
 * AND A LABEL THAT ALREADY SAYS IT IS LEFT ALONE. The Bank payout tab is
 * called BANK and must not come down as "BANK - BANK".
 */
test('A LABEL THAT ALREADY NAMES THE METHOD IS NOT DOUBLED', () => {
  assert.equal(fileLabelOf(templateFor('bank'), 'bank'), 'BANK');
  assert.equal(fileLabelOf(templateFor('cash'), 'cash'), 'CASH');
});

test('BUT A DIFFERENT METHOD ON THAT SHAPE STILL SHOWS, for Diane crypto runs', () => {
  // Crypto is not a template, it is the bank shape filtered to the method.
  assert.equal(fileLabelOf(templateFor('bank'), 'crypto'), 'BANK - CRYPTO');
});
