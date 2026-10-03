const test = require('node:test');
const assert = require('node:assert/strict');
const { checkMonths, claimedMonths } = require('./checkMonths');

/**
 * ***************************************************
 * * The Nicola turn, pinned from both sides
 * ***************************************************
 *
 * A guard on money has to be tested in BOTH directions or it is worth
 * nothing: catching the real fault proves it fires, and passing the honest
 * sentences proves it will not be widened away the first week it cries
 * wolf. checkFigures carries that warning in its own header.
 */

// What `total_master_sheet` actually returned for the August question.
const AUGUST_TOOL = {
  summary: 'Nicola, for August 2026. THESE FIGURES ARE COMPUTED, use them exactly'
    + '\n\nCounted (0):\n  none\n\nTOTAL OWED: 0\n',
};

const SEPTEMBER_TOOL = {
  summary: 'Nicola, for September 2026. THESE FIGURES ARE COMPUTED'
    + '\n\nCounted (3):\n  Acqua resourcing 700\n  Leadstone solutions 800\n'
    + '  Ackerman Pearce payroll 1400\n\nTOTAL OWED: GBP 2,900\n',
};

test('THE REAL FAULT: a month she never computed', () => {
  // Her exact reply. One tool call, for August, and two months answered.
  const reply = 'Nicola is owed nothing for August 2026. Nothing from 3 rows, because marked '
    + 'for another month. Nicola is also owed nothing for September 2026. The same rows apply '
    + 'as for August.';

  const check = checkMonths(reply, [AUGUST_TOOL]);
  assert.equal(check.had, true);
  assert.equal(check.ok, false, 'she answered for September and nothing computed September');
  assert.deepEqual(check.uncovered, ['2026-09']);
});

test('and it passes once September WAS computed', () => {
  const reply = 'Nicola is owed nothing for August 2026, and GBP 2,900 for September 2026.';
  const check = checkMonths(reply, [AUGUST_TOOL, SEPTEMBER_TOOL]);
  assert.equal(check.ok, true);
});

test('the same month name in the wrong year is still the wrong month', () => {
  const check = checkMonths('Zayn is owed nothing for August 2024.', [AUGUST_TOOL]);
  assert.equal(check.ok, false);
  assert.deepEqual(check.uncovered, ['2024-08']);
});

test('A MONTH WITHOUT A MONEY CLAIM IS NOT A CLAIM', () => {
  // The false alarm that would make this guard get widened away. Every one
  // of these names a month and asserts nothing about what is owed.
  const honest = [
    'Her payment starts in November, so nothing is owed yet.',
    'That deal ends in April 2027.',
    'The appointment was in February and the preset is March.',
    'I moved her preset to October, sweetheart.',
  ];
  for (const reply of honest) {
    const check = checkMonths(reply, [AUGUST_TOOL]);
    assert.equal(check.ok, true, `flagged an honest sentence: ${reply}`);
  }
});

test('a money claim with NO month is left to checkFigures', () => {
  // Not this guard's job. checkFigures already owns bare figures.
  const check = checkMonths('She is owed GBP 2,900 in total.', [AUGUST_TOOL]);
  assert.equal(check.ok, true);
});

test('SILENT when no tool named a month', () => {
  // Answering off a card is legitimate, and with nothing to compare
  // against a month in the reply is not evidence of anything.
  const check = checkMonths('Nicola is owed nothing for September.', [{ summary: 'a card' }]);
  assert.equal(check.had, false);
  assert.equal(check.ok, true);
});

// ***************************************************
// * NOTHING RAN IS NOT THE SAME AS A TOOL THAT NAMED NO MONTH
// ***************************************************
//
// Live 2026-09-07. "whats coming next month" and "and the month after"
// returned September's figures under October's and November's names, with
// NO tool call on either turn. An empty toolResults looked the same to this
// guard as a card, so the fault it was written for walked past it.
test('a money claim for a month with NO tool call at all is flagged', () => {
  const reply = 'For October 2026, the whole sheet is owed EURO 3,510 and GBP 80,850.';
  const check = checkMonths(reply, []);

  assert.equal(check.ok, false);
  assert.equal(check.had, true);
  assert.deepEqual(check.uncovered, ['2026-10']);
});

test('and it stays silent when a tool ran but named no month', () => {
  // Unchanged: that is the card case, and the exemption is deliberate.
  const check = checkMonths('Nicola is owed nothing for October.', [{ summary: 'a card' }]);
  assert.equal(check.ok, true);
  assert.equal(check.had, false);
});

// Live 2026-09-07: "whos not paying yet" answered "No one is marked as not
// started or unpaid for September 2026" with no tool call, while nineteen
// deals were marked not started. No money word appears in that sentence.
test('payment state FOR a month is a claim, with or without a figure', () => {
  const reply = 'No one is marked as not started or unpaid for September 2026.';
  const check = checkMonths(reply, []);

  assert.equal(check.ok, false);
  assert.deepEqual(check.uncovered, ['2026-09']);
});

test('and a payment date is still not a claim', () => {
  // The precision that keeps the guard usable: the month must be what the
  // claim is FOR, so a date the payment starts on is untouched.
  assert.equal(checkMonths('Her payment starts in November, so nothing is owed yet.', []).ok, true);
  assert.equal(checkMonths('The preset is September 2026 and the end date is January 2027.', []).ok, true);
});

test('a reply with no month claim is still silent with no tools', () => {
  // The guard must not fire on ordinary conversation.
  for (const honest of [
    'Hello, what can I help with?',
    'Her payment starts in November, so nothing is owed yet.',
    'I can show you the master sheet, totals and recent changes.',
  ]) {
    assert.equal(checkMonths(honest, []).ok, true, honest);
  }
});

test('DETAIL CARD DATES ARE NOT COMPUTED MONEY MONTHS', () => {
  const details = {
    summary: 'Payment start August 2026. Preset September 2026.',
    computedMonths: [],
  };
  const reply = 'Nicola is owed nothing for August 2026 and nothing for September 2026.';
  const check = checkMonths(reply, [details]);

  assert.equal(check.had, true);
  assert.equal(check.ok, false);
  assert.deepEqual(check.uncovered, ['2026-08', '2026-09']);
});

test('claimedMonths reads the sentence, not the whole reply', () => {
  // The money claim is in one sentence and the other month in another, so
  // only the first is a claim about money.
  const reply = 'She is owed nothing for August. Her next deal starts in December.';
  assert.deepEqual([...claimedMonths(reply)], ['august']);
});
