import test from 'node:test';
import assert from 'node:assert/strict';

import { dateNoticesFor } from './dateNotices.js';
import { endNoteTone, GOING_CONCERN, REVIEWED_MONTHLY } from '../configs/sheetValues.js';

/**
 * ***************************************************
 * * WHY THE END DATE CELL IS BLANK
 * ***************************************************
 *
 * 31 of 92 rows on his September sheet hold a phrase here rather than a
 * date, and the CRM dropped every one in silence. The cell now shows his
 * words and says which kind they are.
 *
 * THE DEAL'S NOTE WINS OVER THE COMPANY'S STATUS, and Workforce is why:
 * one company carrying 19 "Going concern" deals, 2 "Reviewed monthly" and
 * 2 with a real date, all at once. No single company status can say that.
 */

const ROW = {
  id: 1,
  assigned_on: '2025-07-14',
  payment_start_on: '2025-10-12',
  preset_on: '2026-09-01',
  end_on: null,
  monthly_amount: 500,
  currency: 'GBP',
  company_status: 'active',
};

test('the tone is keyed, never taken from the words themselves', () => {
  // The class is built from this. Arbitrary text would produce a class
  // name with spaces in it.
  assert.equal(endNoteTone(GOING_CONCERN), 'going_concern');
  assert.equal(endNoteTone(REVIEWED_MONTHLY), 'review_monthly');
  assert.equal(endNoteTone('Ends when the contract does'), 'end_note_unknown');
  assert.equal(endNoteTone(null), 'end_note_unknown');
});

test('Going concern reads as INFO: no end date, and nothing to do', () => {
  const out = dateNoticesFor({ ...ROW, end_note: GOING_CONCERN });
  assert.equal(out.end_on.tone, 'info');
  assert.match(out.end_on.label, /No end date/);
  assert.match(out.end_on.body.join(' '), /Going concern/);
});

test('Reviewed monthly reads as WARNING: somebody must answer it', () => {
  // That is the line this codebase already draws. Warning means act.
  const out = dateNoticesFor({ ...ROW, end_note: REVIEWED_MONTHLY });
  assert.equal(out.end_on.tone, 'warning');
  assert.match(out.end_on.label, /Up for review/);
  assert.match(out.end_on.body.join(' '), /in the Review list now, unanswered/);
});

test('and it says so once it HAS been answered, rather than still asking', () => {
  const out = dateNoticesFor({ ...ROW, end_note: REVIEWED_MONTHLY, review_answer: 'final' });
  assert.match(out.end_on.body.join(' '), /answered this month.*final/);
  assert.doesNotMatch(out.end_on.body.join(' '), /unanswered/);
});

test('a phrase nobody taught it is named verbatim, and warns', () => {
  const out = dateNoticesFor({ ...ROW, end_note: 'Ends when the contract does' });
  assert.equal(out.end_on.tone, 'warning');
  assert.match(out.end_on.body.join(' '), /Ends when the contract does/);
  assert.match(out.end_on.body.join(' '), /does not recognise/);
});

test('the company status is named, so you can see where the tag came from', () => {
  const out = dateNoticesFor({ ...ROW, end_note: GOING_CONCERN, company_status: 'going_concern' });
  assert.match(out.end_on.body.join(' '), /Going concern/);
});

/**
 * THE ORDERING THAT MATTERS. A cell holding a sentence has no date to
 * suggest, to check against a formula, or to call passed, so the note has
 * to beat every other marker competing for this cell.
 */
/**
 * BOTH SAY "Up for review this month", because both are true: a passed end
 * date and his "Reviewed monthly" are two of the queue's three reasons. The
 * BODY is what differs, and it is the reason, so that is what this reads.
 */
test('the note BEATS the end-date-passed marker on the same cell', () => {
  const passed = { ...ROW, end_on: '2026-01-01' };
  // Without a note that row is in the queue because the date ran out.
  const before = dateNoticesFor(passed, { useEndDate: false });
  assert.match(before.end_on.body.join(' '), /appointment plus one year/);

  // With one, his words win.
  const after = dateNoticesFor({ ...passed, end_note: REVIEWED_MONTHLY }, { useEndDate: false });
  assert.match(after.end_on.body.join(' '), /His sheet says/);
});

test('an ordinary row gets no end date marker at all', () => {
  // Every date agreeing with the formula and an end still ahead of the
  // preset month, so none of the other three markers has anything to say
  // either. Appointment + 90 is 14 Apr, appointment + 1 year is 14 Jan 27.
  const clean = {
    ...ROW,
    assigned_on: '2026-01-14',
    payment_start_on: '2026-04-14',
    end_on: '2027-01-14',
  };
  assert.deepEqual(dateNoticesFor(clean), {});
});
