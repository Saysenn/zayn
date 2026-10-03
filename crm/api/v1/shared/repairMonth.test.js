const test = require('node:test');
const assert = require('node:assert/strict');

const { repairMonth, monthForRead, monthNamed } = require('./guessedYear.helper');

/**
 * ***************************************************
 * * A BARE MONTH HAS A RIGHT ANSWER
 * ***************************************************
 *
 * Dropping the guessed year was half a fix. Asked "nicola total for august"
 * she passed 2024-08; the guard dropped it, the reply answered SEPTEMBER,
 * and then she asked "did you mean September 2026, or August 2024?". The
 * admin said August, got a different month, and a question about a year
 * nobody had mentioned.
 *
 * A month word with no year means the NEAREST one. Ties go to the past,
 * because a total is asked about a month that has happened.
 *
 * READS ONLY. A write with a guessed year still refuses and asks: repairing
 * a preset would silently change what a row is owed. `farOffPreset` owns
 * that and is pinned separately.
 */

// The business month these are all reasoned against.
const NOW = '2026-09';

test('THE ACTUAL FAILURE: "august" is the nearest August, not 2024', () => {
  assert.equal(repairMonth('2024-08', 'nicola total for august', NOW), '2026-08');
});

test('and it is not answered as THIS month either, which was the old fix', () => {
  // Dropping meant September. They asked for August.
  assert.equal(monthForRead('2024-08', 'nicola total for august', NOW), '2026-08');
});

test('A YEAR THEY SAID IS THEIRS, and nothing repairs it', () => {
  // "what about september 2024" is a real question about 2024.
  assert.equal(repairMonth('2024-09', 'what about september 2024', NOW), null);
  assert.equal(monthForRead('2024-09', 'what about september 2024', NOW), '2024-09');
});

test('NO MONTH WORD MEANS NOTHING TO REPAIR TO, so it still drops', () => {
  // She invented the whole thing. There is no month in the sentence to
  // take a year from, and guessing a second time is not a fix.
  assert.equal(repairMonth('2024-08', 'nicola total please', NOW), null);
  assert.equal(monthForRead('2024-08', 'nicola total please', NOW), undefined);
});

test('AN ORDINARY MONTH IS LEFT ALONE', () => {
  // Within the near window, so it was never suspect.
  assert.equal(repairMonth('2026-08', 'nicola total for august', NOW), null);
  assert.equal(monthForRead('2026-08', 'nicola total for august', NOW), '2026-08');
  assert.equal(monthForRead('2026-10', 'next month', NOW), '2026-10');
});

test('NEAREST WINS, and it can be the year ahead', () => {
  // January from September: 2027-01 is four months away, 2026-01 is eight.
  assert.equal(repairMonth('2023-01', 'total for january', NOW), '2027-01');
  // December from September is three months ahead, and the year does not turn.
  assert.equal(repairMonth('2021-12', 'total for december', NOW), '2026-12');
});

test('A TIE GOES TO THE PAST', () => {
  // March from September is six months either way. A total is about a month
  // that has happened, so the one just gone wins.
  assert.equal(repairMonth('2020-03', 'total for march', NOW), '2026-03');
});

test('THE CURRENT MONTH NAMED IS THE CURRENT MONTH', () => {
  assert.equal(repairMonth('2024-09', 'total for september', NOW), '2026-09');
});

test('it reads the month word, not a word that contains one', () => {
  // "Mayah" is a handler on the sheet, and she is not a month.
  assert.equal(monthNamed('total for mayah'), null);
  assert.equal(monthNamed('total for may'), 5);
  // "Augustine" must not read as August either.
  assert.equal(monthNamed('augustine total'), null);
});

test('EVERY MONTH NAME RESOLVES, so one of them is not quietly missing', () => {
  const names = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
  names.forEach((name, i) => {
    assert.equal(monthNamed(`total for ${name}`), i + 1, name);
    const fixed = repairMonth('2019-01', `total for ${name}`, NOW);
    assert.match(fixed, new RegExp(`-${String(i + 1).padStart(2, '0')}$`), name);
  });
});

test('a repaired month is always within a year of the business month', () => {
  // The repair must never produce something the guard would reject again,
  // or a read bounces between the two rules and answers neither month.
  const { farOffMonth } = require('./guessedYear.helper');
  for (const name of ['january', 'april', 'july', 'october']) {
    const fixed = repairMonth('2015-06', `total for ${name}`, NOW);
    assert.equal(farOffMonth(fixed, `total for ${name}`, NOW), false, `${name} -> ${fixed}`);
  }
});
