import test from 'node:test';
import assert from 'node:assert/strict';
import { speakableReply } from './speakableReply.js';

/**
 * ***************************************************
 * * SHE READS EVERYTHING SHE SAYS. His call, 2026-09-17.
 * ***************************************************
 *
 * This file used to pin the opposite: a reply of four lines or more spoke
 * its first line only, and a first line that looked like a heading was
 * replaced with an apology for not reading it. So the longer and more
 * detailed the answer, the less of it she said.
 *
 * "ensure diane reads any response she sent. no cutting."
 */

const lines = (n) => Array.from({ length: n }, (_, i) => `Record ${i + 1}`).join('\n');

test('a compact money breakdown is spoken in full', () => {
  const answer = [
    'Nicola is owed GBP 2,900 for September 2026.',
    'Acqua resourcing: GBP 700.',
    'Leadstone solutions: GBP 800.',
    'Ackerman Pearce payroll: GBP 1,400.',
    'Social work partners PR is GBP 0 because payment starts 3 November 2026.',
  ].join('\n');
  assert.equal(speakableReply(answer), answer);
});

// THE ONE THAT USED TO BE CUT. It spoke "Here are the records I found."
// and dropped twenty rows.
test('a long data block is spoken in full, opener and all', () => {
  const answer = `Here are the records I found.\n${lines(20)}`;
  assert.equal(speakableReply(answer), answer);
});

// And the one that got no reading at all: an opener the old shape test
// rejected was replaced with "that one is a long one, lovely".
test('an opener that looks like a heading is no longer an excuse to stay quiet', () => {
  const answer = `payable days:\n${lines(20)}`;
  const said = speakableReply(answer);
  assert.equal(said, answer);
  assert.doesNotMatch(said, /on screen for you to read/);
});

test('the exchange rate answer is spoken in full', () => {
  const answer = [
    'Here are the current exchange rates:',
    '1 GBP = 1.348492 USD.',
    '1 USD = 3.6725 AED, fixed peg.',
    'Current cached rate, published Thu, 03 Sep 2026 00:02:31 +0000.',
  ].join('\n');
  assert.equal(speakableReply(answer), answer);
});

test('a one line answer is itself', () => {
  assert.equal(speakableReply("Richard's payable days: 30."), "Richard's payable days: 30.");
});

test('nothing to say stays nothing, never the string "null"', () => {
  assert.equal(speakableReply(null), '');
  assert.equal(speakableReply(undefined), '');
  assert.equal(speakableReply('   '), '');
});
