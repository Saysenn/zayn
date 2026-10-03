import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: what the master sheet tab can now be configured with
 * ***************************************************
 *
 * His call 2026-09-23, three things:
 *
 *   the header band's colour, including the one with a sheen
 *   a switch for the column that says what went on top, in words
 *   a per person picker, so one person's deals can be a file of their own
 *
 * THE PEOPLE PICKER IS NOT A NEW CONTROL. It has been in this modal since
 * the payout tabs, searchable, multi select, keyed by id and labelled by
 * name, and it already narrows WITH the groups. A second one in a settings
 * panel would be two controls for one filter and two places for it to
 * drift. The whole change is one flag on one mode.
 *
 * NO IMPORT ACROSS THE BOUNDARY and no .jsx into node:test: this reads its
 * own source text, like exportColumns.test.js beside it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const MODAL = fs.readFileSync(path.join(here, 'MasterSheetExportModal.jsx'), 'utf8');
const CONTROLS = fs.readFileSync(path.join(here, 'ExportControls.jsx'), 'utf8');
// Code only. A doesNotMatch over the whole file catches the comment that
// explains the very thing it guards.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CODE = code(MODAL);
const MODES = CODE.match(/const MODES = \[[\s\S]*?\n\];/)?.[0];
const MASTER = MODES?.match(/\{\s*key: 'current'[\s\S]*?\n {2}\},/)?.[0];

// ===============================
// * One person, on this tab too
// ===============================

test('THE MASTER SHEET TAB OFFERS THE PEOPLE PICKER', () => {
  assert.ok(MASTER, "the 'current' mode has been renamed");
  assert.match(MASTER, /template: 'master-sheet'/);
  assert.match(MASTER, /people: true/);
});

test('AND IT IS THE SAME ONE THE PAYOUT TABS USE', () => {
  // One picker, one gate, one param. A second Select bound to its own
  // state would be the duplicate this avoids.
  const gates = [...CODE.matchAll(/const showPeople = /g)];
  assert.equal(gates.length, 1, 'there is more than one people gate now');
  const pickers = [...CODE.matchAll(/label="People"/g)];
  assert.equal(pickers.length, 1, 'a second people picker was added');
  assert.match(CODE, /personId: showPeople && people\.length > 0 \? people\.join\(','\) : undefined/);
});

test('IT IS BY ID, never by name', () => {
  const picker = CODE.match(/label="People"[\s\S]{0,400}/)?.[0]
    ?? CODE.match(/options=\{\(options\?\.people[\s\S]{0,200}/)?.[0];
  assert.ok(picker, 'the people picker has gone');
  assert.match(CODE, /value: p\.personId/);
  assert.match(CODE, /label: p\.name/);
});

// ===============================
// * The header colour
// ===============================

test('THE TAB CLAIMS A HEADER COLOUR, and sends it on its own', () => {
  assert.match(MASTER, /headerColor: true/);
  assert.match(CODE, /const showHeaderColor = Boolean\(MODE_BY_KEY\.get\(mode\)\?\.headerColor\)/);
  // Sent apart from the breakdown block, which also carries a design, a
  // secondary and a percentages table. This file has none of them.
  //
  // AND ONLY ONCE IT HAS A VALUE. The colour starts null and takes the
  // server's default when the palette lands, so an unguarded send reaches
  // the server as the string "null".
  assert.match(CODE, /\.\.\.\(showHeaderColor && primaryColor \? \{ primaryColor \} : \{\}\)/);
});

test('AND IT REUSES THE SHARED SWATCHES', () => {
  assert.match(CODE, /import \{ SettingRow, Choice, Swatches \}/);
  assert.match(CODE, /<Swatches\b/);
});

/**
 * THE DEFAULT COLOUR IS THE SERVER'S, never typed here. It was 'orange'
 * in this file AND in palette.js, so the picker could open on one colour
 * while an export that sent none took another. The breakdown design had
 * already been through this; the colours had not.
 */
test('NEITHER COLOUR NAMES A DEFAULT OF ITS OWN', () => {
  assert.match(CODE, /useState\(null\);\s*\n\s*const \[secondaryColor, setSecondaryColor\] = useState\(null\)/);
  for (const id of ["'orange'", "'grey'", "'blue-white'"]) {
    assert.ok(!CODE.includes(id), `the modal hardcodes the colour ${id}`);
  }
  assert.match(CODE, /breakdownMeta\?\.defaultColor \?\? null/);
  assert.match(CODE, /breakdownMeta\?\.defaultSecondary \?\? null/);
});

/**
 * A PALE COLOUR NEEDS AN OUTLINE. `blue-white` is #DDEBF7, so the split
 * dot is a near-white disc among five coloured ones and reads as the empty
 * option. The outline is the TYPE that will sit on the band, which is the
 * same thing that makes it legible in the file.
 *
 * It drew a gradient before, for the sheen that version of the colour had.
 * That colour printed a WHITE header in Excel and the gradient is gone.
 */
test('THE SWATCH OUTLINES A COLOUR THAT TAKES BLACK TYPE', () => {
  const swatch = code(CONTROLS).match(/export function Swatches[\s\S]*?\n\}/)?.[0];
  assert.ok(swatch, 'Swatches has been renamed or removed');
  assert.match(swatch, /c\.headText/);
  // Data driven off the served colour, never a hardcoded id: a second
  // light colour must need no edit here.
  assert.ok(!/blue-white/.test(swatch), 'the swatch hardcodes a colour id');
  // And no gradient, which is what made the file print a blank band.
  assert.ok(!/gloss/.test(swatch), 'the gradient is back in the swatch');
});

// ===============================
// * The rates column switch
// ===============================

test('THE RATES COLUMN IS A SWITCH, beside the other two', () => {
  const marks = CODE.match(/const MARKS = \[[\s\S]*?\n\];/)?.[0];
  assert.ok(marks, 'the MARKS table has gone');
  assert.match(marks, /key: 'showRates'/);
  // It writes no single column of his, so it declares no `needs`: it
  // ADDS its own. Claiming one would hide it behind a column it creates.
  const rates = marks.match(/\{[^{]*key: 'showRates'[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(!/needs:/.test(rates), 'the rates switch claims a column it adds itself');
});

test('AND THE MODAL NAMES NO COLUMN KEYS FOR IT', () => {
  // The server owns which column the switch adds and where it sits. A key
  // written here would be a second definition of it.
  assert.ok(!/rates_text/.test(CODE), 'the modal names the opt in column key');
});

test('THE SETTINGS PANEL OPENS FOR THE COLOUR ALONE', () => {
  // Without this the panel stays shut on a tab whose only setting is the
  // colour, and the control is unreachable.
  assert.match(CODE, /showMarks \|\| showHeaderColor\) && \(/);
});
