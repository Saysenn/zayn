import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * THE RATE BOX READS THE WAY THE BOSS READS XE.COM
 * ***************************************************
 *
 * `1 GBP = 1.36 USD`, his call 2026-10-13 (migration 085). The box took
 * "1 USD = X GBP" (065, 2026-09-23) and he typed xe.com's 1.36 into it,
 * which would have made every pound total a fifth too low.
 *
 * HISTORY, so neither direction is changed again by accident:
 *   before 2026-09-23  USD per unit, inverted in this file; a sentence beside
 *                      it read the other way, and three of four rates were
 *                      entered upside down.
 *   065                units per USD, typed straight through.
 *   085 (now)          USD per unit again, the way he reads it, but STORED
 *                      EXACTLY AS TYPED in its own unscaled column, so the
 *                      round trip that broke the first version (3.75 home as
 *                      3.74999995) cannot happen: nothing is inverted on the
 *                      way into the box or out of it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, 'ConversionRates.jsx'), 'utf8');

test('THE BOX IS "1 CODE = [ value ] USD", left to right', () => {
  assert.match(SRC, /<span className=\{CODE\}>1 \{code\} =<\/span>/);
  assert.match(SRC, /<span className=\{UNIT\}>USD<\/span>/);
});

test('THE BOX SAYS ITS DIRECTION OUT LOUD', () => {
  assert.match(SRC, /aria-label=\{`US dollars for one \$\{code\}`\}/);
  assert.doesNotMatch(SRC, /for one US dollar/, 'the old direction survived in a label');
});

test('WHAT IS TYPED IS SENT AS TEXT, so it is stored exactly', () => {
  // A number would go through a float on the way; the text is stored by
  // the server into an unscaled numeric column as it is.
  assert.match(SRC, /onSave\(code, value\.trim\(\)\)/);
  assert.match(SRC, /onAdd\(wanted, value\.trim\(\)\)/);
});

test('BOTH DOORS WRITE THE SAME FIELD', () => {
  assert.match(SRC, /onSave=\{\(next, usdPerUnit\) => setRate\.mutate\(\{ code: next, usdPerUnit \}\)\}/);
  assert.match(SRC, /onAdd=\{\(code, usdPerUnit\) => setRate\.mutate\(\{ code, usdPerUnit \}\)\}/);
});

test('THE BOX COMES BACK AS IT WAS TYPED', () => {
  // The saved figure is shown as stored, never worked out from per_usd,
  // unless the row predates 085 and has nothing else.
  assert.match(SRC, /if \(saved\.usdPerUnit != null\) return String\(saved\.usdPerUnit\)/);
});

test('NO SENTENCE REPEATS THE BOX: the row says only where its rate is from', () => {
  // His call 2026-10-13: "we dont need long descriptions". The inverse is in the icon.
  assert.doesNotMatch(SRC, /1 \{code\} = \{value\.trim\(\)\} USD/);
  assert.match(SRC, /\*\*1 USD = \$\{readable\(1 \/ typed\)\} \$\{code\}\*\*/);
});

test('SAVE COMPARES TEXT, so an untouched row never lights up', () => {
  assert.match(SRC, /const changed = valid && value !== shown/);
});

test('A ROW NOT SET BY HAND STILL SAYS WHAT IT CONVERTS AT', () => {
  // Today's pulled rate is the hint in the box and the line beside it.
  assert.match(SRC, /placeholder=\{pulled \? readable\(pulled\) : 'Value'\}/);
  assert.match(SRC, /daily: 'Auto'/);
});

test('A PULL REPLACES A MANUAL RATE: the row shows the pulled one', () => {
  assert.match(SRC, /const auto = source === 'daily' && pulled/);
  assert.match(SRC, /const shown = auto \? readable\(pulled\) : shownFor\(saved\)/);
});
