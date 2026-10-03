const test = require('node:test');
const assert = require('node:assert/strict');
const { dayText, monthText } = require('./dayText.helper');

/**
 * ***************************************************
 * * THE DAY THAT WAS OFF BY ONE, IN A YEAR NOBODY COULD SEE
 * ***************************************************
 *
 * Two tools printed a date with `String(value).slice(0, 10)`. Postgres
 * hands a `date` column back as a Date OBJECT, so that took the first ten
 * characters of "Wed Dec 31 2025 16:00:00 GMT-0800" and printed
 * "Wed Dec 31" for a deal ending 2026-01-01.
 *
 * The year was gone AND the day was wrong, and Diane read those dates
 * aloud beside money. Found 2026-09-17.
 */

test('A STRING IS READ, NEVER PARSED', () => {
  // Handing it to `new Date` is what introduces a zone at all.
  assert.equal(dayText('2026-01-01'), '1 January 2026');
  assert.equal(dayText('2026-03-01'), '1 March 2026');
  assert.equal(dayText('2026-12-31'), '31 December 2026');
});

test('AND A TIMESTAMP STRING IS READ THE SAME WAY', () => {
  assert.equal(dayText('2026-01-01T00:00:00.000Z'), '1 January 2026');
});

test('A DATE USES ITS LOCAL PARTS, which is where pg put midnight', () => {
  // node-postgres parses a `date` to LOCAL midnight, so the local getters
  // are the ones that agree with what the column says.
  assert.equal(dayText(new Date(2026, 0, 1)), '1 January 2026');
  assert.equal(dayText(new Date(2026, 11, 31)), '31 December 2026');
});

test('THE YEAR IS ALWAYS THERE', () => {
  // "ended Thu Jan 01" could be any year, and two of the live rows were
  // four years apart.
  for (const year of [2024, 2025, 2026, 2027]) {
    assert.match(dayText(`${year}-06-05`), new RegExp(`${year}$`));
  }
});

test('AND THE DAY NEVER SHIFTS', () => {
  // The old code turned 1 January into 31 December on any host behind UTC.
  assert.doesNotMatch(dayText('2026-01-01'), /December/);
  assert.doesNotMatch(dayText('2026-01-01'), /2025/);
});

/**
 * ===============================
 * * NO MONTH IS EVER CUT SHORT
 * ===============================
 * She reads these aloud. "5 Jan 2026" comes out of the voice as a cut
 * syllable, so every month is spelled out. His call 2026-09-21.
 */
test('EVERY MONTH IS SPELLED OUT, all twelve', () => {
  const said = Array.from({ length: 12 }, (_, i) => (
    dayText(`2026-${String(i + 1).padStart(2, '0')}-05`)
  ));
  assert.deepEqual(said, [
    '5 January 2026', '5 February 2026', '5 March 2026', '5 April 2026',
    '5 May 2026', '5 June 2026', '5 July 2026', '5 August 2026',
    '5 September 2026', '5 October 2026', '5 November 2026', '5 December 2026',
  ]);
  // The abbreviations themselves, so a month reverting is caught by name
  // and not only by the list above.
  for (const short of ['Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']) {
    assert.ok(!said.some((s) => s.includes(` ${short} `)), `${short} was abbreviated`);
  }
});

test('NOTHING IS NULL, never a guess or an "Invalid Date"', () => {
  assert.equal(dayText(null), null);
  assert.equal(dayText(undefined), null);
  assert.equal(dayText(''), null);
  assert.equal(dayText('Ongoing'), null, 'the sheet writes prose in date columns');
  assert.equal(dayText(new Date('nonsense')), null);
});

test('monthText names the month for a heading', () => {
  assert.equal(monthText('2026-09'), 'September 2026');
  assert.equal(monthText('2026-01'), 'January 2026');
  assert.equal(monthText('2026-13'), null, 'not a month');
  assert.equal(monthText(''), null);
});
