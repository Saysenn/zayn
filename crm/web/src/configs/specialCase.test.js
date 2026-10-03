import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SPECIAL_CASE_SWITCH } from './specialCase.js';

/**
 * ***************************************************
 * * WEB'S HALF OF THE SPECIAL CASE NAME
 * ***************************************************
 *
 * `api/v1/shared/specialCase.js` holds the other half and pins this same
 * literal in its own test. The two codebases share no file, so this is a
 * CONTRACT written twice, not an import.
 *
 * It matters that they agree. Diane's tool description names the switch so
 * that "make Mayah a special case" reaches `specialCaseDeal` and not
 * `overrideShouldBePaid`, which carries no month and drops the row out of
 * a payout instead. When this label drifts, the admin says what the screen
 * calls it and she reaches for the wrong field. That is what happened at
 * the rename on 2026-09-23.
 */

test('THE NAME ITSELF, spelled out, as the contract', () => {
  assert.equal(SPECIAL_CASE_SWITCH, 'Make this deal Special Case');
});

test('THE MONTH IS NOT IN IT', () => {
  // The panel this hangs in already says which month is owed nothing, and
  // repeating it made the switch the longest line there.
  assert.doesNotMatch(SPECIAL_CASE_SWITCH, /january|february|march|april|may|june|july|august|september|october|november|december|\d{4}/i);
});

test('the page uses the constant, never its own copy', () => {
  const page = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'pages', 'MasterSheetPage.jsx'), 'utf8',
  );
  assert.match(page, /switchLabel = SPECIAL_CASE_SWITCH/);
  assert.match(page, /from '\.\.\/configs\/specialCase'/);
});

test('NOTHING READS THE API FILE. A contract, not a share', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'specialCase.js'), 'utf8');
  assert.doesNotMatch(src, /require\(|from ['"]/, 'web reached across the boundary');
});
