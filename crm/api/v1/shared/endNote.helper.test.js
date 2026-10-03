const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readEndNote, isEndNote, GOING_CONCERN, REVIEWED_MONTHLY,
} = require('./endNote.helper');

/**
 * ***************************************************
 * * WORDS IN THE END DATE COLUMN
 * ***************************************************
 *
 * 31 of the 92 rows on his September sheet hold a phrase here, and every
 * one was dropped in silence: `endOn` came back null, the row was not
 * flagged, and the import diff said nothing.
 *
 * TWO PHRASES, OPPOSITE MEANINGS, which is the whole reason this is not
 * one "prose" case:
 *
 *   Going concern     no end date, it keeps running. Null is CORRECT.
 *   Reviewed monthly  decided month by month. Null was BACKWARDS: the
 *                     review queue asks whether the end date has passed,
 *                     so it kept those 12 out of the screen meant to ask
 *                     about them.
 */

test('the two he uses are known, and only one asks for a review', () => {
  assert.deepEqual(readEndNote(GOING_CONCERN), {
    note: 'Going concern', reviewMonthly: false, known: true,
  });
  assert.deepEqual(readEndNote(REVIEWED_MONTHLY), {
    note: 'Reviewed monthly', reviewMonthly: true, known: true,
  });
});

// A human types these, so the match cannot be byte exact. The note comes
// back in the CANONICAL spelling either way, because the cell's tag and
// the web mirror both compare against it.
test('case and spacing do not matter, and the note comes back canonical', () => {
  for (const messy of ['reviewed monthly', 'REVIEWED MONTHLY', '  Reviewed   Monthly ']) {
    const out = readEndNote(messy);
    assert.equal(out.note, 'Reviewed monthly', messy);
    assert.equal(out.reviewMonthly, true, messy);
    assert.equal(out.known, true, messy);
  }
  assert.equal(readEndNote(' going  CONCERN ').note, 'Going concern');
});

/**
 * A THIRD PHRASE IS KEPT, NEVER GUESSED AT. The words survive, no flag is
 * set, and `known: false` is what makes the row flag itself and the diff
 * report it. Silence here is how the first 31 were lost.
 */
test('a phrase nobody has taught it keeps its words and sets no flag', () => {
  const out = readEndNote('Ends when the contract does');
  assert.equal(out.note, 'Ends when the contract does');
  assert.equal(out.reviewMonthly, false);
  assert.equal(out.known, false);
});

test('a date, a blank and a null are not notes', () => {
  assert.equal(readEndNote(new Date('2026-11-18')), null);
  assert.equal(readEndNote(null), null);
  assert.equal(readEndNote(undefined), null);
  assert.equal(readEndNote(''), null);
  assert.equal(readEndNote('   '), null);
  assert.equal(readEndNote(42), null);
});

test('isEndNote agrees with it on every one of those', () => {
  assert.equal(isEndNote('Going concern'), true);
  assert.equal(isEndNote(''), false);
  assert.equal(isEndNote(new Date()), false);
  assert.equal(isEndNote(null), false);
});

/**
 * THE CONTRACT WITH THE WEB. `web/src/configs/sheetValues.js` compares a
 * stored `end_note` against these exact strings to choose the cell's tag.
 * The two codebases share no file, so each pins its own half and the
 * strings must match character for character.
 */
test('the two strings are exactly what the web half compares against', () => {
  assert.equal(GOING_CONCERN, 'Going concern');
  assert.equal(REVIEWED_MONTHLY, 'Reviewed monthly');
});
