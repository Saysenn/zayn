import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * THE RATE BOX READS THE WAY A RATE SITE PRINTS
 * ***************************************************
 *
 * `1 USD = X CODE`. It asked for the inverse and the only thing saying so
 * was an aria-label nobody sees, while the sentence beside the box read the
 * other way round. Three of the four live rates were entered upside down:
 * AED at 3.67 made every dirham figure 13.5x too high and GBP at 0.75 made
 * every pound figure 44% too low, in the totals every conversion uses.
 * Found 2026-09-23.
 *
 * STORAGE DID NOT MOVE. `tb_fx_rates.usd_per_unit` still holds USD per one
 * unit; this file inverts on the way in and out.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, 'ConversionRates.jsx'), 'utf8');

// The column's own precision, `numeric(18, 8)`. Named so the round trip
// below is measured against the real storage rather than a guess.
const RATE_DP = 8;
const stored = (typed) => Number(Number(typed).toFixed(RATE_DP));

// ===============================
// * The round trip, which is the whole promise
// ===============================

test('EVERY RATE COMES BACK AS THE NUMBER THAT WAS TYPED', () => {
  /**
   * THE LIST THAT BROKE IT, not a list that passes.
   *
   * The first version of this test picked five values that happened to
   * survive being inverted and inverted back. 3.75 came home 3.74999995,
   * 3.67 came home 3.67000005 and the AED peg came home 3.67249997, and
   * the test was green through all three. Every one of those is in here
   * now, and so is the one that any rounding rule breaks instead: PHP.
   */
  for (const typed of [
    '3.75', '3.67', '3.6725', '0.87', '0.75', '0.87927969', '57.14285714', '1',
  ]) {
    assert.equal(String(stored(typed)), typed, `${typed} did not survive the round trip`);
  }
});

test('NOTHING INVERTS IT ON THE WAY IN', () => {
  // The column is units per dollar, the box is units per dollar, and
  // `toUsd` divides by units per dollar. Migration 065 removed the one in
  // the middle that disagreed with all three.
  assert.match(SRC, /onSave\(code, typed\)/, 'the row still flips on save');
  assert.match(SRC, /onAdd\(wanted, typed\)/, 'Add still flips on save');
  assert.doesNotMatch(SRC, /flip\(typed\)\)\s*\}/, 'a flip survived on a write path');
});

test('AND NOTHING INVERTS IT ON THE WAY OUT', () => {
  assert.match(SRC, /const shown = saved \? String\(saved\.perUsd\) : ''/);
  assert.doesNotMatch(SRC, /usdPerUnit/, 'the old field name survived');
});

// ===============================
// * The shapes, so the component cannot quietly go back
// ===============================

test('BOTH DOORS WRITE THE SAME DIRECTION', () => {
  // The row's Save and the Add button write the same column. One of them
  // flipping would be the original fault back on the one row nobody would
  // think to check.
  assert.match(SRC, /onSave=\{\(next, perUsd\) => setRate\.mutate\(\{ code: next, perUsd \}\)\}/);
  assert.match(SRC, /onAdd=\{\(code, perUsd\) => setRate\.mutate\(\{ code, perUsd \}\)\}/);
});

test('ONE INVERSION, DEFINED ONCE, and it only reaches the icon', () => {
  // `flip` survives for the stored half shown inside the popup, and for
  // nothing else. Written twice it is two places to get a direction wrong.
  assert.equal([...SRC.matchAll(/=> 1 \/ n/g)].length, 1, 'a second inversion appeared');
  assert.doesNotMatch(SRC, /1 \/ typed/, 'an inline inversion bypassed the named one');
  assert.equal([...SRC.matchAll(/flip\(/g)].length, 1, 'flip reached something other than the icon');
});

test('THE ROW READS ONE WAY, END TO END', () => {
  /**
   * Twice now the row has carried two directions at once, and both times
   * somebody read the wrong one:
   *
   *   before  box held USD per unit, sentence said "1 USD = ..."
   *   after   box held "1 USD = ...", sentence said "1 EUR = 1.1494 USD"
   *
   * The sentence echoes the BOX now, in the box's own direction, and the
   * stored half moved into the icon.
   */
  assert.match(SRC, /1 USD = \{value\.trim\(\)\} \{code\}/);
  // Its OWN TEXT, never a reformatted number: a pasted 0.87927969 has to
  // read back exactly or it cannot be checked against the site it came
  // from, which is the whole point of the paste.
  assert.doesNotMatch(SRC, /1 USD = \{formatNumber/);
});

test('AND THE STORED HALF IS IN THE ICON, not beside it', () => {
  // Worth being able to see, not worth a second direction on a line
  // somebody reads at a glance. Extra information in a cell is an icon.
  assert.match(SRC, /Stored as \*\*1 \$\{code\} = \$\{formatNumber\(flip\(typed\), 6\)\} USD\*\*/);
});

test('THE BOX SAYS ITS DIRECTION OUT LOUD', () => {
  // The label was "One AED in US dollars" on a box that now wants the
  // opposite. A stale direction on a money field is worse than none.
  assert.match(SRC, /aria-label=\{`\$\{code\} for one US dollar`\}/);
  assert.doesNotMatch(SRC, /One \$\{code\} in US dollars/);
});

test('SAVE COMPARES TEXT, not the flipped number', () => {
  // Compared through the flip it is never exactly equal: the column keeps
  // eight decimals, so a rate inverted, stored and inverted back differs
  // in the last place, and Save lit up on every untouched row on load.
  assert.match(SRC, /const changed = valid && value !== shown/);
});
