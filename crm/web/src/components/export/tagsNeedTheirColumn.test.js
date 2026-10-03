import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: a switch that writes into a column it does not have
 * ***************************************************
 *
 * "Include tags" puts his words into the END DATE cell. Four of the five
 * presets drop that column, so on Standard, Bank, Cash and Crypto the
 * switch was on screen, flippable, sent to the server, and did nothing at
 * all. Raised after the same dropped column crashed the export outright.
 *
 * NAMED AS A COLUMN, never as a list of presets. The picker is free: the
 * switch has the same problem the moment somebody unticks the end date by
 * hand, and a list of preset ids here would not cover that and would be a
 * second place for them to drift.
 *
 * NO IMPORT ACROSS THE BOUNDARY and no .jsx into node:test: this reads its
 * own source text, like exportColumns.test.js beside it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, 'MasterSheetExportModal.jsx'), 'utf8');
// Code only. A doesNotMatch over the whole file catches the comment that
// explains the very thing it guards.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MARKS = CODE.match(/const MARKS = \[[\s\S]*?\n\];/)?.[0];

test('THE TAG SWITCH DECLARES THE COLUMN IT WRITES INTO', () => {
  assert.ok(MARKS, 'the MARKS table has gone');
  const tags = MARKS.match(/\{[^{]*key: 'includeTags'[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(tags, 'includeTags has been renamed or removed');
  assert.match(tags, /needs: 'end_on'/);
});

test('AND THE OTHER SWITCH DECLARES NONE, because it needs none', () => {
  // Tinting empty cells works on whatever columns are there.
  const tint = MARKS.match(/\{[^{]*key: 'tintEmpty'[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(tint);
  assert.ok(!/needs:/.test(tint), 'tintEmpty now claims to need a column');
});

test('IT IS NOT RENDERED WHEN THAT COLUMN IS NOT PICKED', () => {
  assert.match(
    CODE,
    /MARKS\.filter\(\(m\) => !m\.needs \|\| chosen\.includes\(m\.needs\)\)\.map/,
    'the switch list is no longer filtered by the picked columns',
  );
});

test('AND IT IS NOT SENT EITHER, so a hidden one cannot travel', () => {
  const sent = CODE.match(/MARKS\.filter\(\(m\) => marks\[m\.key\][\s\S]{0,90}/)?.[0];
  assert.ok(sent, 'the params no longer filter the marks');
  assert.match(sent, /!m\.needs \|\| chosen\.includes\(m\.needs\)/);
});

/**
 * AND IT IS STILL OFFERED WHERE IT WORKS. Removing it everywhere would be
 * a cure worse than the fault: on the full column set it is the only thing
 * that prints "Going concern" into the file.
 */
test('THE SWITCH SURVIVES, it is only conditional', () => {
  assert.match(CODE, /key: 'includeTags'/);
  assert.match(CODE, /name: 'Include tags'/);
  // The gate is one expression in two places, not a hardcoded preset list.
  assert.ok(!/'standard'|'crypto'/.test(CODE), 'the modal now hardcodes preset ids');
});
