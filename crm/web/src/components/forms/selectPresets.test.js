import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: the preset rail names documents, it does not define them
 * ***************************************************
 *
 * His call 2026-09-22. Eleven columns out of twenty one, picked by hand
 * every month, to make the same four documents. The rail turns each into
 * one click.
 *
 * THE KEYS LIVE ON THE SERVER, beside the column list they name, and ride
 * in on the same response. A list of column keys written into this
 * component would be a second definition: the day a key changed, the rail
 * would select nothing for it and say nothing, and the file would come out
 * short and look deliberate.
 *
 * NO IMPORT ACROSS THE BOUNDARY and no .jsx into node:test: this reads its
 * own source text, like exportColumns.test.js does.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SELECT = fs.readFileSync(path.join(here, 'Select.jsx'), 'utf8');
const MODAL = fs.readFileSync(
  path.join(here, '..', 'export', 'MasterSheetExportModal.jsx'),
  'utf8',
);

// Code only. A doesNotMatch over the whole file catches the comment that
// explains the very thing it guards.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SELECT_CODE = code(SELECT);
const MODAL_CODE = code(MODAL);

// ===============================
// * It is served, never written here
// ===============================

test('THE RAIL DEFINES NO COLUMN KEYS OF ITS OWN', () => {
  for (const key of ['payable_days', 'payment_method', 'bank_details', 'sort_code', 'postcode']) {
    assert.ok(!SELECT_CODE.includes(key), `Select.jsx names the column ${key}`);
  }
  for (const label of ['standard', 'crypto']) {
    assert.ok(!SELECT_CODE.includes(`'${label}'`), `Select.jsx hardcodes the preset ${label}`);
  }
});

test('IT COMES FROM THE SAME RESPONSE AS THE OPTIONS', () => {
  assert.match(MODAL_CODE, /columnInfo\?\.presets \?\? \[\]/);
  assert.match(MODAL_CODE, /presets=\{columnPresets\}/);
  // One request for one control. Two would be two chances to disagree.
  const fetches = MODAL_CODE.match(/exports\.columns\(/g) ?? [];
  assert.equal(fetches.length, 1, 'the presets are being fetched separately');
});

test('AND THE OPTIONS STILL COME OFF THE SAME OBJECT', () => {
  // The query used to unwrap to `.columns`. Both halves are needed now, so
  // an unwrap that came back would leave the picker empty.
  assert.match(MODAL_CODE, /columnInfo\?\.columns \?\? \[\]/);
  assert.ok(!MODAL_CODE.includes('=> d.columns'), 'the response is being unwrapped again');
});

// ===============================
// * What a click does
// ===============================

test('A PRESET REPLACES THE VALUE, it never adds to it', () => {
  // `onChange(preset.columns, …)`, not a spread over what is already ticked.
  assert.match(SELECT_CODE, /onClick=\{\(\) => onChange\(preset\.columns, preset\)\}/);
  assert.ok(
    !/onChange\(\[\s*\.\.\.selected[^)]*preset/.test(SELECT_CODE),
    'a preset is adding to the selection rather than being the answer',
  );
});

test('IT LIGHTS UP ONLY WHEN IT IS EXACTLY WHAT IS SELECTED', () => {
  const lit = SELECT_CODE.match(/const on = [\s\S]*?;\n/)?.[0];
  assert.ok(lit, 'the lit test has gone');
  // Both halves: same count AND every key present. Either alone lights the
  // smaller set whenever a bigger one contains it.
  assert.match(lit, /preset\.columns\.length === selected\.length/);
  assert.match(lit, /preset\.columns\.every/);
});

// ===============================
// * And it stays put while the list scrolls
// ===============================

test('THE OPTIONS SCROLL, THE RAIL DOES NOT', () => {
  // One row, rail beside list. The overflow is on the <ul> alone, so the
  // answers stay on screen while twenty one options move behind them.
  assert.match(SELECT_CODE, /<div className="flex min-h-0">/);
  assert.match(SELECT_CODE, /<ul ref=\{listRef\}[^>]*overflow-y-auto/);
  const rail = SELECT_CODE.match(/\{hasRail && \([\s\S]*?\n {12}\)\}/)?.[0];
  assert.ok(rail, 'the rail block has gone');
  assert.ok(!/overflow-y-auto|overflow-auto/.test(rail), 'the rail scrolls with the list');
  assert.match(rail, /shrink-0/);
});

/**
 * AND THE PANEL GROWS BY THE RAIL'S WIDTH. The floor is 224px; a rail
 * taken out of that left the options 112px and clipped every one. One
 * definition of the width, because it is both a style and a term in the
 * sum, and the two drifting apart is the same clipped list.
 */
test('THE RAIL IS ADDED TO THE PANEL FLOOR, not taken out of it', () => {
  assert.match(SELECT_CODE, /const MIN_W = \d+ \+ \(hasRail \? RAIL_W : 0\);/);
  assert.match(SELECT_CODE, /^const RAIL_W = \d+;$/m);
  // Placed while open, so the width has to be recomputed when it changes.
  assert.match(SELECT_CODE, /\}, \[open, hasRail\]\);/);
  // Never a second number: w-28 beside RAIL_W is two definitions of one width.
  const rail = SELECT_CODE.match(/\{hasRail && \([\s\S]*?\n {12}\)\}/)?.[0];
  assert.match(rail, /style=\{\{ width: RAIL_W \}\}/);
  assert.ok(!/\bw-\d/.test(rail), 'the rail carries a width class as well as RAIL_W');
});

test('AND IT IS NOT RENDERED WHEN THERE IS NOTHING TO OFFER', () => {
  // A single-value control cannot take a whole set, and a payout tab is
  // served no presets at all. Both must leave the control as it was.
  assert.match(SELECT_CODE, /const hasRail = multiple && presets\.length > 0;/);
  assert.match(SELECT_CODE, /\{hasRail && \(/);
  assert.match(SELECT_CODE, /presets = \[\],/);
});
