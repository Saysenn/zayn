import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * How much of the diff you can see without scrolling
 * ***************************************************
 *
 * Every one of these is about the modal's own height. A real file put nine
 * notes above the tabs and pushed the decisions below the fold, which is
 * the one thing this modal exists to put in front of you.
 *
 * Source text, like confirmNote.test.js beside it: a .jsx cannot be
 * imported into node:test, and this reads its own half of the boundary.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, 'ImportDiffModal.jsx'), 'utf8');

// Comments stripped, or a doesNotMatch guard happily matches its own
// explanation and passes on a broken file.
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

test('THE NOTES ARE FOLDED AWAY, and start closed', () => {
  // A repeated bank name or a repeated Yes/No is a line each. Nine of them
  // took more height than the diff they were introducing.
  assert.match(CODE, /useState\(false\)/);
  assert.match(CODE, /setNotesOpen\(\(open\) => !open\)/);
  assert.match(CODE, /aria-expanded=\{notesOpen\}/);
  assert.match(CODE, /\{notesOpen && \(/);
});

test('the fold says HOW MANY, so opening it is an informed click', () => {
  assert.match(CODE, /\{noteCount\} \{noteCount === 1 \? 'note' : 'notes'\}/);
  // Counted per LINE, not per block: the sentinel warnings are the ones
  // that grow, so counting their block as one would understate it.
  assert.match(CODE, /preview\.sentinelWarnings\?\.length \?\? 0/);
});

test('ONLY THE FIRST TAB ACCEPTS, the rest select', () => {
  // "Accept all" over a list of deals you are about to delete reads as
  // agreeing to the file rather than choosing what goes.
  assert.match(CODE, /const SELECT_LABELS = \{ on: 'Select all', off: 'Deselect all' \}/);
  assert.match(CODE, /const ACCEPT_LABELS = \{ on: 'Accept all', off: 'Reject all' \}/);
  assert.match(CODE, /labels=\{tab === 'changed' \? ACCEPT_LABELS : SELECT_LABELS\}/);
  // The company tab's own per group control is always a selection: the
  // shared select-all CHECKBOX (not an Accept button), ticking the group.
  assert.match(CODE, /<SelectAllBox\s+count=\{on\}\s+total=\{ids\.length\}\s+onChange=\{\(checked\) => onToggleGroup\(ids, checked\)\}/);
  // And the words are not written out at the button any more.
  assert.doesNotMatch(CODE, /'Reject all' : 'Accept all'/);
});

test('Similar deals is HIDDEN, not removed', () => {
  // It deletes nothing on its own and the file never writes through it, so
  // dropping `hidden` brings it back with no other change.
  assert.match(CODE, /\{ key: 'inFile', label: 'Similar deals', hidden: true \}/);
  assert.match(CODE, /TABS\.filter\(\(t\) => !t\.hidden && \(!t\.optional \|\| companyDiff\)\)/);
  // The tab is hidden; its data and its delete path are untouched.
  assert.match(CODE, /const DELETE_TABS = \['notInFile', 'inFile'\]/);
  assert.match(CODE, /const inFile = diff\?\.inFile \?\? \[\]/);
});
