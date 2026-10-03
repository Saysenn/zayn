const test = require('node:test');
const assert = require('node:assert/strict');

const { checkCounts, countsIn } = require('./checkCounts');

/**
 * ***************************************************
 * * A COUNT IS A CLAIM ABOUT THE SHEET
 * ***************************************************
 *
 * `checkFigures` guards money and ignores anything under 100 on purpose,
 * because "4 deals" is a count and flagging every honest sentence would be
 * worse than the fault. That left a hole and she walked into it:
 *
 *   tool:  3 rows, Zayn twice and Paddy once
 *   Diane: "two rows for Zayn and TWO for Paddy ... all FOUR rows"
 *
 * Paddy has ONE row. Nothing caught it, because the number was a WORD and
 * every other guard here counts digits.
 *
 * SCOPED TO A COUNTED NOUN. "One moment" and "a couple of things" are prose
 * and must never be flagged, or the check gets widened until it is off.
 */

// The tool result from the real turn, verbatim in shape.
const BULK = [{
  summary: 'NOTHING HAS BEEN CHANGED YET. This would set payable days to "25" on 3 rows:\n\n'
    + '  Zayn · Workforce · INDIGO\n  Zayn · Workforce · MILKMAN\n  Paddy · Workforce · ALL GROUPS\n',
  rows: [
    { person_id: 'zayn', group_name: 'INDIGO' },
    { person_id: 'zayn', group_name: 'MILKMAN' },
    { person_id: 'paddy', group_name: 'ALL GROUPS' },
  ],
}];

test('THE ACTUAL FAILURE is caught, and it was spelled as a word', () => {
  const out = checkCounts(
    'I found two rows for Zayn and two for Paddy. I will set payable days to 25 on all four rows.',
    BULK,
  );

  assert.equal(out.ok, false);
  assert.deepEqual(out.wrong.map((w) => w.said).sort((a, b) => a - b), [2, 4]);
  assert.equal(out.wrong[0].noun, 'row');
  // The correction has to name what the tool actually said.
  assert.deepEqual(out.wrong[0].known, [3]);
});

test('the HONEST version of the same sentence passes', () => {
  const out = checkCounts('That is 3 rows across 2 people: Zayn twice and Paddy once. Confirm?', BULK);
  assert.equal(out.ok, true, JSON.stringify(out.wrong));
});

test('DIGITS ARE CAUGHT TOO, not just words', () => {
  assert.equal(checkCounts('This would change 9 rows.', BULK).ok, false);
  assert.equal(checkCounts('This would change 3 rows.', BULK).ok, true);
});

test('PROSE NUMBERS ARE NEVER FLAGGED', () => {
  // The reason checkFigures ignores small numbers in the first place. If
  // this ever fails the guard is off within a week.
  for (const reply of [
    'Give me one moment, there are a couple of things to check.',
    'Two ways to do that, darling. Which would you like?',
    'I will do that in one go rather than three steps.',
  ]) {
    assert.equal(checkCounts(reply, BULK).ok, true, reply);
  }
});

test('a noun the tools never counted is not evidence of anything', () => {
  // They counted rows and people. A claim about MONTHS has nothing to
  // check against, and guessing would be the fault this prevents.
  assert.equal(checkCounts('That covers four months of history.', BULK).ok, true);
});

test('with NO tool counts at all it stays silent', () => {
  const out = checkCounts('There are 12 rows.', [{ summary: 'Nothing to report.' }]);
  assert.equal(out.had, false);
  assert.equal(out.ok, true);
});

test('THE ROWS THEMSELVES COUNT, even when no sentence counted them', () => {
  // "She has four deals" is supported by four rows coming back, whether or
  // not the tool wrote the number out.
  const four = [{ summary: 'Here she is.', rows: [{ person_id: 'g' }, { person_id: 'g' }, { person_id: 'g' }, { person_id: 'g' }] }];
  assert.equal(checkCounts('Gloria has four deals.', four).ok, true);
  assert.equal(checkCounts('Gloria has five deals.', four).ok, false);
});

test('DISTINCT PEOPLE, not rows, for a people count', () => {
  assert.equal(checkCounts('That is 2 people.', BULK).ok, true, 'zayn and paddy');
  assert.equal(checkCounts('That is 3 people.', BULK).ok, false, 'three rows is not three people');
});

test('twenty one is 21, and ninety-six is 96', () => {
  const said = countsIn('twenty one people and ninety-six deals');
  assert.ok(said.get('person').has(21));
  assert.ok(said.get('row').has(96));
});

test('a comma in a big number survives', () => {
  const many = [{ summary: 'Showing 1,200 rows.' }];
  assert.equal(checkCounts('There are 1,200 rows.', many).ok, true);
});

test('singular and plural are the same noun', () => {
  const one = [{ summary: 'This would change 1 row.' }];
  assert.equal(checkCounts('That is one row.', one).ok, true);
  assert.equal(checkCounts('That is two rows.', one).ok, false);
});

test('IT REPORTS, IT DOES NOT REWRITE', () => {
  // Same rule as checkFigures: a wrong count means the turn is wrong, and
  // silently editing it would be worse than either outcome.
  const out = checkCounts('all four rows', BULK);
  assert.equal(typeof out.ok, 'boolean');
  assert.ok(Array.isArray(out.wrong));
  assert.equal(out.reply, undefined, 'it must not hand back an edited reply');
});

/* ===============================
 * * And that it is actually WIRED
 * =============================== */

const fs = require('node:fs');
const path = require('node:path');

// Same reason as lengthRetry.test.js: the retry sits inside the streaming
// loop and needs a live provider to run, so the wiring is read as text.
const SRC = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');

test('runAgent CALLS IT, on the reply and the turn\'s tool results', () => {
  assert.match(SRC, /const counts = checkCounts\(raw, toolResults\);/);
  // `had` is the whole point: no tool count means nothing to check against.
  assert.match(SRC, /if \(counts\.had && !counts\.ok\)/);
});

test('IT HAS ITS OWN RETRY FLAG, not checkFigures\'s', () => {
  // A wrong count and a wrong amount are two different mistakes and each is
  // worth one correction. Sharing a flag means the second one is never
  // corrected in a turn that already got the first wrong.
  assert.match(SRC, /let countRetry = false;/);
  assert.match(SRC, /if \(raw && !countRetry\)/);
  assert.match(SRC, /countRetry = true;/);
  assert.ok(!/countRetry = false;\s*$/m.test(SRC.split('let countRetry')[1] ?? ''), 'it must retry once, not reset');
});

test('the correction NAMES the tool\'s number, so the retry has somewhere to go', () => {
  assert.match(SRC, /COUNT THE ROWS THE TOOL ACTUALLY RETURNED/);
  assert.match(SRC, /w\.known\.join\(' or '\)/);
});

test('and it is EVIDENCE, so the Logs page has the fabrication', () => {
  assert.match(SRC, /Diane stated a count no tool produced/);
});

test('A CAMELCASE ROW COUNTS ITS PEOPLE TOO', () => {
  // `summarizeRow` hands back `personName`, and this read only `person_id`
  // and `person_name`. So the people set was EMPTY on every list result and
  // a person count was never checked at all: she said "36 people in INDIGO
  // are paid in GBP" over 36 ROWS held by 28 people, and nothing flagged it.
  //
  // A guard that reads the wrong field name is not a guard.
  const listed = [{
    summary: '36 rows in INDIGO are paid in GBP.',
    rows: [
      { personName: 'Nicola', groupName: 'INDIGO' },
      { personName: 'Nicola', groupName: 'INDIGO' },
      { personName: 'Nathan', groupName: 'INDIGO' },
    ],
  }];

  // Three rows, two people. Both are true and they are different numbers.
  assert.equal(checkCounts('That is 3 rows.', listed).ok, true);
  assert.equal(checkCounts('That is 2 people.', listed).ok, true);
  assert.equal(checkCounts('That is 3 people.', listed).ok, false, 'a row count read as people');
  assert.equal(checkCounts('That is 1 group.', listed).ok, true);
});

test('and snake_case still works, because both shapes are in circulation', () => {
  const snake = [{ summary: 'ok', rows: [{ person_id: 'a', group_name: 'X' }, { person_id: 'b', group_name: 'X' }] }];
  assert.equal(checkCounts('2 people.', snake).ok, true);
  assert.equal(checkCounts('3 people.', snake).ok, false);
});

/**
 * ===============================
 * * A COUNT BORROWED FROM ANOTHER GROUP
 * ===============================
 * Live 2026-09-24, three turns and three different answers: "Past a year
 * (5)", then "2 deals in MILKMAN and 2 deals in MANBAT", then "3 deals in
 * MANBAT" after the admin corrected her.
 *
 * `checkCounts` could not see the middle one: the number 2 WAS produced by
 * a tool, so as a bare figure it checks out. What is wrong is the group it
 * is attached to.
 */
const { checkCountsByGroup } = require('./checkCounts');

const PAST_A_YEAR = [{
  rows: [
    { id: 488, group_name: 'MILKMAN' }, { id: 56, group_name: 'MILKMAN' },
    { id: 82, group_name: 'MANBAT' }, { id: 84, group_name: 'MANBAT' }, { id: 83, group_name: 'MANBAT' },
  ],
}];

test('THE BORROWED COUNT IS CAUGHT, and named', () => {
  const out = checkCountsByGroup(
    'There are 2 deals in MILKMAN and 2 deals in MANBAT, all held by 2 people each.',
    PAST_A_YEAR,
  );
  assert.equal(out.ok, false);
  assert.deepEqual(out.wrong, [{ group: 'MANBAT', said: 2, known: 3 }]);
});

test('the right counts pass, spelled or in digits', () => {
  assert.equal(checkCountsByGroup('2 deals in MILKMAN and 3 deals in MANBAT.', PAST_A_YEAR).ok, true);
  assert.equal(checkCountsByGroup('two deals in MILKMAN and three in MANBAT.', PAST_A_YEAR).ok, true);
});

test('A GROUP NOTHING LOOKED AT IS SILENT', () => {
  // A turn that returned no NEXUS rows has nothing to say about how many
  // NEXUS holds, and accusing on it is the same fault pointing the other
  // way.
  assert.equal(checkCountsByGroup('4 deals in NEXUS.', PAST_A_YEAR).ok, true);
});

test('nothing to check against means silence', () => {
  assert.equal(checkCountsByGroup('2 deals in MILKMAN', [{}]).ok, true);
  assert.equal(checkCountsByGroup('2 deals in MILKMAN', []).ok, true);
});

test('the same row from two calls counts ONCE', () => {
  // She calls the filter twice in a turn routinely; counting the rows
  // twice would flag a correct answer.
  assert.equal(
    checkCountsByGroup('2 deals in MILKMAN', [PAST_A_YEAR[0], PAST_A_YEAR[0]]).ok,
    true,
  );
});
