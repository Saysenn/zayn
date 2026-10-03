import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * CONTRACT: the two counts in the footer explain each other
 * ***************************************************
 *
 * The toolbar said "81 of 81 accepted" and the button said "Confirm 47 of
 * 96", and they read as a contradiction. They count different things: the
 * toolbar counts rows nobody rejected, the button counted rows that will
 * WRITE, and a row whose every cell is set to EXISTING writes nothing.
 *
 * The gap is now named, one line above the button: "49 ticked with nothing
 * to write". The button is a plain word, which also fixes the label running
 * to "Confirm 47 of 96 and 3 company statuses" whenever tiers are in play.
 *
 * Source text, like exportMonth.test.js beside it: a .jsx cannot be
 * imported into node:test, and this reads its own half of the boundary.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, 'ImportDiffModal.jsx'), 'utf8');

const NOTE = SOURCE.match(/const writeNote = \[[\s\S]*?\.join\(' · '\);/)?.[0];
const NOOPS = SOURCE.match(/const noOps = [^\n]*/)?.[0];

test('THE BUTTON IS A PLAIN WORD, NOT A RUNNING TOTAL', () => {
  // The ternary that renders it, never the comment above it.
  const label = SOURCE.match(/\{committing \? 'Writing…' : [^}]*\}/)?.[0];
  assert.ok(label, 'the Confirm label has been renamed or removed');
  assert.match(label, /'Confirm'/);
  assert.doesNotMatch(label, /confirmLabel|accept\.length|counts\./);
});

test('THE GAP BETWEEN THE TWO COUNTS IS NAMED', () => {
  assert.ok(NOOPS, 'noOps has been renamed or removed');
  // Ticked rows minus rows that will write. Anything else is a different
  // number and would not explain the toolbar.
  assert.match(NOOPS, /ticked - accept\.length/);

  assert.ok(NOTE, 'writeNote has been renamed or removed');
  assert.match(NOTE, /ticked with nothing to write/);
  assert.match(NOTE, /noOps > 0/);
});

test('ticked counts rows nobody rejected, the same set the toolbar counts', () => {
  const ticked = SOURCE.match(/const ticked = [^\n]*/)?.[0];
  assert.ok(ticked);
  assert.match(ticked, /\[\.\.\.changed, \.\.\.incoming\]/);
  assert.match(ticked, /!rejected\.has\(r\.syncKey\)/);
});

test('the note still names the company statuses, which the label used to', () => {
  assert.match(NOTE, /company \$\{tiers\.length === 1 \? 'status' : 'statuses'\}/);
});

test('an empty footer says so rather than printing "0 of 96"', () => {
  assert.match(SOURCE, /nothingToWrite \? 'Nothing to write' : writeNote/);
  // And it is the same condition that disables the button, so the words and
  // the state cannot disagree.
  assert.match(SOURCE, /disabled=\{committing \|\| deleting \|\| nothingToWrite\}/);
});
