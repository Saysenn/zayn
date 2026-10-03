const test = require('node:test');
const assert = require('node:assert/strict');
const { checkQuestion, INSTEAD } = require('./checkQuestion');

const ONE_MONTH = { computedMonths: ['2026-09'], summary: 'September 2026: GBP 80,850.' };
const TWO_MONTHS = { computedMonths: ['2026-08', '2026-09'], summary: 'August and September.' };
const ROWS = { rows: [{ id: 1, personName: 'Gloria' }, { id: 2, personName: 'Zayn' }] };

// ***************************************************
// * A COMPARISON NEEDS TWO PERIODS
// ***************************************************
//
// Live 2026-09-07: "did we earn more than last month" called the totals
// tool twice, once per month, and answered with September alone.
test('THE REAL FAULT: a comparison answered with one month', () => {
  const reply = 'the whole sheet is owed GBP 80,850 for September 2026.';
  const check = checkQuestion(reply, 'did we earn more than last month', [ONE_MONTH]);

  assert.equal(check.ok, false);
  assert.equal(check.kind, 'comparison');
  assert.match(INSTEAD.comparison, /BOTH months/);
});

test('and it passes once two months were computed', () => {
  const reply = 'August was GBP 77,220.95 and September is GBP 80,850, so it is up.';
  assert.equal(checkQuestion(reply, 'did we earn more than last month', [TWO_MONTHS]).ok, true);
});

// ***************************************************
// * A SUPERLATIVE NEEDS SOMETHING TO RANK
// ***************************************************
//
// "who is on the most money" answered with the whole sheet's total.
test('THE REAL FAULT: a superlative answered with a total', () => {
  const reply = 'the whole sheet is owed GBP 80,850 for September 2026.';
  const check = checkQuestion(reply, 'who is on the most money', [ONE_MONTH]);

  assert.equal(check.ok, false);
  assert.equal(check.kind, 'ranking');
});

// ROWS ARE NOT AN ORDERING. She has no ranking read and is not getting one:
// "who earned the most this month" is not a question she answers. Ranking
// deals by eye is exactly the guess this prevents, so it fires whether or
// not rows came back.
test('rows do not make a superlative answerable', () => {
  const reply = 'Gloria is owed the most, GBP 2,100.';
  const check = checkQuestion(reply, 'who is on the most money', [ROWS]);

  assert.equal(check.ok, false);
  assert.equal(check.kind, 'ranking');
  assert.match(INSTEAD.ranking, /cannot rank them/);
  assert.match(INSTEAD.ranking, /do NOT try to rank them yourself/i);
});

// SAYING SHE CANNOT IS THE ANSWER WE WANT, and must never be retried into
// an attempt.
test('declining passes both checks', () => {
  for (const reply of [
    'I cannot rank people by what they are owed yet.',
    "I don't have a tool that compares two months like that.",
  ]) {
    assert.equal(checkQuestion(reply, 'who is on the most money', [ONE_MONTH]).ok, true, reply);
  }
});

// THE FALSE ALARMS THAT WOULD GET THIS WIDENED AWAY.
test('an ordinary answer is never flagged', () => {
  const honest = [
    ['the whole sheet is owed GBP 80,850 for September 2026.', 'whats the total for this month'],
    ['Gloria has 4 deals.', 'gloria details'],
    ['MILKMAN has 33 deals held by 27 people.', 'whats the biggest group'],
    ['Nothing has changed in the last 24 hours.', 'recent changes'],
  ];
  for (const [reply, said] of honest) {
    assert.equal(checkQuestion(reply, said, [ONE_MONTH]).ok, true, said);
  }
});

// "vs" is her own output wording, not a question. Flagging it would fire on
// every panel note she reads back.
test('her own "vs" phrasing is not read as a comparison question', () => {
  const reply = 'Sept 2026 vs Aug 2026: the whole sheet is owed GBP 80,850.';
  assert.equal(checkQuestion(reply, 'whats the total', [ONE_MONTH]).ok, true);
});
