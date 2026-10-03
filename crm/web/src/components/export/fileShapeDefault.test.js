import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: a tab per group, and only where one can be built
 * ***************************************************
 *
 * His call 2026-09-22, two halves.
 *
 * THE DEFAULT is GROUP_TABS. It is how he reads the sheet, it is still one
 * file to open, and the tab name is what puts each row back in its group
 * on a re-upload. ZIPPED stays the deliberate act: a zip is work before
 * you have seen anything.
 *
 * THE GATE is the half that was already broken. "One workbook, tab per
 * group" was offered on every tab and honoured by ONE: only the
 * master-sheet template reads `perGroupTabs`. Picking it on Cash or Bank
 * promised five tabs and handed back a single sheet, silently. Making it
 * the default would have made that the normal outcome on five tabs.
 *
 * NO IMPORT ACROSS THE BOUNDARY and no .jsx into node:test: this reads its
 * own source text, like exportColumns.test.js beside it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, 'MasterSheetExportModal.jsx'), 'utf8');
// Code only. A doesNotMatch over the whole file catches the comment that
// explains the very thing it guards.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MODES = CODE.match(/const MODES = \[[\s\S]*?\n\];/)?.[0];

test('THE MODAL OPENS ON A TAB PER GROUP', () => {
  assert.match(CODE, /useState\(SHAPE\.GROUP_TABS\)/);
  // Not the zip. That one is several files and has always been opt in.
  assert.ok(!/useState\(SHAPE\.ZIPPED\)/.test(CODE), 'the modal defaults to a zip');
});

test('AND THE THREE SHAPES ARE STILL NAMED VALUES, not two booleans', () => {
  assert.match(CODE, /const SHAPE = Object\.freeze\(\{[^}]*ONE_BOOK[^}]*GROUP_TABS[^}]*ZIPPED[^}]*\}\)/);
});

// ===============================
// * Only the template that can split offers it
// ===============================

test('ONE MODE CLAIMS groupTabs, AND IT IS THE MASTER SHEET', () => {
  assert.ok(MODES, 'the MODES table has gone');
  const claims = [...MODES.matchAll(/groupTabs: true/g)];
  assert.equal(claims.length, 1, 'a second tab claims to split, and only one template can');
  const masterSheet = MODES.match(/\{\s*key: 'current'[\s\S]*?\n {2}\},/)?.[0];
  assert.ok(masterSheet, "the 'current' mode has been renamed");
  assert.match(masterSheet, /template: 'master-sheet'/);
  assert.match(masterSheet, /groupTabs: true/);
});

test('THE OPTION IS HIDDEN WHERE IT CANNOT BE HONOURED', () => {
  assert.match(CODE, /const canGroupTabs = Boolean\(MODE_BY_KEY\.get\(mode\)\?\.groupTabs\)/);
  // Spread in conditionally, so the control does not list a lie.
  assert.match(CODE, /\.\.\.\(canGroupTabs\s*\n?\s*\? \[\{ value: SHAPE\.GROUP_TABS/);
});

test('AND THE PARAM IS NEVER SENT FROM A TAB THAT CANNOT SPLIT', () => {
  const sent = CODE.match(/\.\.\.\(canMultiFile && shape === SHAPE\.GROUP_TABS[\s\S]{0,80}/)?.[0];
  assert.ok(sent, 'perGroupTabs is no longer sent off the derived shape');
  assert.match(sent, /perGroupTabs: 'true'/);
});

/**
 * THE SHAPE IS DERIVED, NEVER RESET. Switching to Cash must not discard
 * the choice: it reads as one workbook while you are there and comes back
 * when you return to a tab that can split.
 */
test('AN UNAVAILABLE SHAPE FALLS BACK WITHOUT LOSING THE CHOICE', () => {
  assert.match(
    CODE,
    /const shape = canGroupTabs \|\| fileShape !== SHAPE\.GROUP_TABS \? fileShape : SHAPE\.ONE_BOOK;/,
  );
  // The control is the only writer. A `setFileShape(...)` call anywhere
  // would be something clearing the choice behind you, which is the thing
  // deriving it avoids.
  assert.ok(
    !/setFileShape\(/.test(CODE),
    'something now calls setFileShape instead of letting the shape derive',
  );
  assert.match(CODE, /onChange=\{setFileShape\}/);
});

test('AND EVERY READER USES THE DERIVED ONE', () => {
  // A reader left on the raw state would ask for a shape the tab cannot build.
  assert.ok(
    !/fileShape === SHAPE\./.test(CODE),
    'a comparison still reads the raw fileShape instead of the derived shape',
  );
});
