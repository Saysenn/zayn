const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDays, daysIn, daysFrom } = require('./checkDays');

/**
 * ***************************************************
 * * THE RICHARD TURN
 * ***************************************************
 *
 * Live 2026-09-17. "set his payable days to 0" was read back as "changing
 * Richard's payable days from 31 to 0". The sheet holds ONE Richard, on 30
 * payable days, and nothing that turn produced a 31.
 *
 * The shape below is `find_and_show_details`' real one: a card, a
 * summarized row, and a summary built from DETAIL_FIELDS. Copied from the
 * handler rather than imagined, because a guard tested against a shape the
 * code does not produce passes its own tests and catches nothing.
 */
const RICHARD = {
  summary: 'group: ALL GROUPS\nrole: Loss lead\nname: Richard\npayable days: 30\n'
    + 'monthly amount: 500\npayable amount: 500',
  cards: [{
    id: 91,
    name: 'Richard',
    groups: [
      {
        title: 'Money',
        cells: [
          { label: 'Monthly', value: 500, editField: 'monthlyAmount' },
          { label: 'Payable', value: 500, editField: 'payableAmount' },
          { label: 'Payable days', value: 30, editField: 'payableDays' },
        ],
      },
    ],
  }],
  rows: [{ id: 91, personName: 'Richard', payableAmount: 500 }],
};

test('the invented from-value is caught', () => {
  const reply = "I am about to change Richard's payable days from 31 to 0. Should I go ahead?";
  const check = checkDays(reply, [RICHARD]);
  assert.equal(check.had, true);
  assert.equal(check.ok, false);
  assert.deepEqual(check.unsupported, [31]);
});

test('the real value passes', () => {
  const check = checkDays("Richard's payable days are 30.", [RICHARD]);
  assert.equal(check.ok, true);
  assert.deepEqual(check.unsupported, []);
});

test('the value the admin asked for is not a claim about the row', () => {
  // "to 0" is their own instruction, not a reading of the sheet.
  const check = checkDays("Setting Richard's payable days to 0.", [RICHARD], 'set his payable days to 0');
  assert.equal(check.ok, true);
});

test('and it carries without the words, "make it 0"', () => {
  const check = checkDays("Richard's payable days go to 0.", [RICHARD], 'make it 0');
  assert.equal(check.ok, true);
});

test('but the invented from-value survives their own sentence', () => {
  // The admin said 0. They never said 31, and that is the whole fault.
  const reply = "changing Richard's payable days from 31 to 0";
  const check = checkDays(reply, [RICHARD], 'set his payable days to 0');
  assert.equal(check.ok, false);
  assert.deepEqual(check.unsupported, [31]);
});

test('a card cell counts even when no row key carries it', () => {
  const cardOnly = { cards: RICHARD.cards };
  assert.deepEqual([...daysFrom(cardOnly)], [30]);
  assert.equal(checkDays('payable days: 30', [cardOnly]).ok, true);
  assert.equal(checkDays('payable days: 31', [cardOnly]).ok, false);
});

test('a row key counts, snake case or camel', () => {
  assert.deepEqual([...daysFrom({ rows: [{ payable_days: 13 }] })], [13]);
  assert.deepEqual([...daysFrom({ rows: [{ payableDays: 13 }] })], [13]);
});

// ===============================
// * THE 90 DAY FORMULA MUST NOT CRY WOLF
// ===============================
// The payment start is the appointment plus 90 days and she explains it
// constantly. A bare day count is never checked, only "payable days".
test('the appointment formula is not a payable day count', () => {
  const reply = 'The payment start is the appointment plus 90 days.';
  assert.equal(checkDays(reply, [RICHARD]).ok, true);
  assert.deepEqual([...daysIn(reply)], []);
});

test('silent when no tool produced a day count', () => {
  const check = checkDays('payable days: 31', [{ summary: 'nothing to do with days' }]);
  assert.equal(check.had, false);
  assert.equal(check.ok, true);
});

test('both word orders are read', () => {
  assert.deepEqual([...daysIn('payable days from 31 to 0')], [31]);
  assert.deepEqual([...daysIn('payable days: 30')], [30]);
  assert.deepEqual([...daysIn('payable days is 30')], [30]);
  assert.deepEqual([...daysIn('31 payable days')], [31]);
});

test('it does not reach across a sentence', () => {
  // The number belongs to the next clause, not to the phrase.
  assert.deepEqual([...daysIn('payable days. That is 500 a month.')], []);
});
