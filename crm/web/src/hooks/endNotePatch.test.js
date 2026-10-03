import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ***************************************************
 * * A REAL DATE ENDS THE NOTE THAT EXPLAINED THE BLANK
 * ***************************************************
 *
 * `end_note` holds his words for why the end date cell is empty, and the
 * cell prints them in place of a date. The server drops the note the
 * moment a date is written (masterSheetRows.repo `end_note = NULL`), so an
 * optimistic patch carrying only `end_on` left the two disagreeing:
 * 31 December 2026 saved, "AUGUST TBC" still on screen until a refetch.
 * The toast said it had worked, and it had. Found 2026-09-21 in a browser.
 *
 * The hook needs React, so the step is rebuilt here and the WIRING is
 * asserted against the source, the arrangement patchDeal.test.js uses.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, f), 'utf8');

// Kept identical to useMasterSheet.js. The source assertions at the bottom
// are what stop this copy drifting from the real one.
function withEndNote(row, fields, oldRow) {
  const typed = Boolean(fields.endOn);
  const cascaded = Boolean(row.end_on) && row.end_on !== oldRow.end_on;
  if (!typed && !cascaded) return row;
  return { ...row, end_note: null };
}

const noted = { id: 1, end_on: null, end_note: 'AUGUST TBC' };

test('TYPING A DATE CLEARS HIS WORDS', () => {
  const row = { ...noted, end_on: '2026-12-31' };
  assert.equal(withEndNote(row, { endOn: '2026-12-31' }, noted).end_note, null);
});

test('A DERIVED DATE CLEARS THEM TOO', () => {
  // The server's recomputePayable adds `endOn` to its own patch when the
  // appointment cascade moves it, so the note goes there as well. Keying
  // off the typed field alone leaves the same disagreement behind an
  // appointment edit.
  const row = { ...noted, end_on: '2027-03-11' };
  assert.equal(withEndNote(row, { assignedOn: '2026-12-11' }, noted).end_note, null);
});

test('CLEARING THE DATE LEAVES THE WORDS, which still explain the blank', () => {
  const row = { ...noted, end_on: null };
  assert.equal(withEndNote(row, { endOn: null }, noted).end_note, 'AUGUST TBC');
  assert.equal(withEndNote(row, { endOn: '' }, noted).end_note, 'AUGUST TBC');
});

test('AN EDIT ELSEWHERE ON THE ROW TOUCHES NEITHER', () => {
  const row = { ...noted, monthly_amount: 900 };
  const out = withEndNote(row, { monthlyAmount: 900 }, noted);
  assert.equal(out.end_note, 'AUGUST TBC');
  assert.equal(out, row, 'an untouched row is returned as it came');
});

test('THE REVIEW FLAG IS NEVER TOUCHED HERE', () => {
  // It is a decision made on the company screen or by the import, not a
  // description of this cell, and a deal can have both. Same rule the
  // server states beside its own line.
  const row = { ...noted, end_on: '2026-12-31', review_monthly: true };
  assert.equal(withEndNote(row, { endOn: '2026-12-31' }, noted).review_monthly, true);
});

test('THE HOOK RUNS IT, after the derived dates and inside editedDeal', () => {
  const hook = src('./useMasterSheet.js');
  assert.match(hook, /function withEndNote\(row, fields, oldRow\)/);
  /**
   * BOTH CONDITIONS, WORD FOR WORD. The copy above is what the behaviour
   * tests exercise, so without this the real function can lose half its
   * rule with every one of them still green. Breaking it on purpose is how
   * that was found, and this is the line that caught it the second time.
   */
  assert.match(hook, /const typed = Boolean\(fields\.endOn\);/);
  assert.match(
    hook,
    /const cascaded = Boolean\(row\.end_on\) && row\.end_on !== oldRow\.end_on;/,
  );
  assert.match(hook, /if \(!typed && !cascaded\) return row;/);
  // AFTER withDerivedDates, or a cascaded date would not be visible to it,
  // and given the row BEFORE the edit so it can tell one apart.
  assert.match(hook, /const withNote = withEndNote\(withPayable\(patched, fields\), fields, row\)/);
  assert.match(hook, /return withPeriod\(withNote, fields, useEndDate\)/);
});

/**
 * A DELIBERATE MIRROR. The server's half of this rule lives in
 * api/v1/repos/masterSheetRows.repo.js `update`, and is pinned there by
 * its own test. The two codebases share no file, so each states the rule
 * and neither reads the other.
 */
