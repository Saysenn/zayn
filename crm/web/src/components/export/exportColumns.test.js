import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: the column picker counts what it offers
 * ***************************************************
 *
 * The label read "Columns · 21" beside a control holding 17, because it
 * summed the chosen columns and the four that are never offered. Two numbers
 * for one control reads as a bug. The four always written are named in the
 * hint instead.
 *
 * Second half: the Master sheet tab opens on EVERY column, alone among the
 * tabs. It is the working copy, so a column left out is an edit nobody can
 * make. The payout tabs keep opening on the layout they have always written.
 *
 * NO IMPORT ACROSS THE BOUNDARY, and no import of a .jsx into node:test
 * either: this reads its own source text, like exportMonth.test.js beside it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, 'MasterSheetExportModal.jsx'), 'utf8');

// The expression itself, never the comment above it. A doesNotMatch over the
// whole file would catch the comment explaining the very thing it guards.
const LABEL = SOURCE.match(/label=\{`Columns · [^`]*`\}/)?.[0];
const CHOSEN = SOURCE.match(/const chosen = picked \?\?[^\n]*/)?.[0];
const MODES = SOURCE.match(/const MODES = \[[\s\S]*?\n\];/)?.[0];

test('THE COUNT IN THE LABEL IS OVER THE OFFERED LIST, NOT THE FILE', () => {
  assert.ok(LABEL, 'the Columns label has been renamed or removed');
  assert.match(LABEL, /\$\{chosen\.length\} of \$\{optional\.length\}/);
  // required.length is what made it 21. It belongs in the hint.
  assert.doesNotMatch(LABEL, /required/);
});

test('the four always-written columns are still named somewhere', () => {
  assert.match(SOURCE, /hint=\{popup\.exportColumns\(required\.map/);
});

test('THE MASTER SHEET TAB OPENS ON EVERY COLUMN', () => {
  assert.ok(MODES, 'the MODES array has been renamed or removed');
  const current = MODES.match(/\{\s*key: 'current',[\s\S]*?\n {2}\},/)?.[0];
  assert.ok(current, "the 'current' mode has been renamed or removed");
  assert.match(current, /allColumns: true/);
});

test('and it is the ONLY tab that does', () => {
  // "only here" was the whole ask. A second tab picking it up silently
  // widens three payout files that are meant to keep their fixed shape.
  assert.equal((MODES.match(/allColumns: true/g) ?? []).length, 1);
});

test('the opening set is read off the tab, not hardcoded', () => {
  assert.ok(CHOSEN, 'the chosen default has been renamed or removed');
  assert.match(CHOSEN, /allColumns \? allSet : sendSet/);
});
