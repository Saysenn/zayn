import test from 'node:test';
import assert from 'node:assert/strict';
import { aedAmount } from './expenseAed.js';

/**
 * ***************************************************
 * * CONTRACT: this half must agree with the database
 * ***************************************************
 *
 * The server's answer is the generated column in
 * api/v1/migrations/055_expenses.sql. This half only has to survive
 * between the keystroke and the refetch, but if it rounds differently the
 * row visibly corrects itself, which is the lag optimistic writes exist to
 * remove. The api side pins its half in expenseIsolation.test.js.
 */

test('raw amount times this row\'s own rate', () => {
  assert.equal(aedAmount(100, 3.6725), 367.25);
  assert.equal(aedAmount(5000, 0.0644), 322);
});

test('strings off an input are coerced, not concatenated', () => {
  assert.equal(aedAmount('100', '3.6725'), 367.25);
});

test('ROUNDED TO 2, HALF UP, the way Postgres rounds a numeric', () => {
  // 1.005 * 100 is 100.49999999999999 in a float, so a plain Math.round
  // gives 1.00 here and the database gives 1.01. That is a penny of
  // disagreement visible on every refetch.
  assert.equal(aedAmount(1, 1.005), 1.01);
  assert.equal(aedAmount(1, 1.004), 1);
});

test('NULL IN, NULL OUT: a missing rate is not a rate of 1', () => {
  assert.equal(aedAmount(100, null), null);
  assert.equal(aedAmount(100, undefined), null);
  assert.equal(aedAmount(100, ''), null);
  assert.equal(aedAmount(null, 3.6725), null);
  assert.equal(aedAmount('', 3.6725), null);
});

test('nonsense in is null, never NaN on the screen', () => {
  assert.equal(aedAmount('abc', 3.6725), null);
  assert.equal(aedAmount(100, 'abc'), null);
});

test('zero is a real amount and converts to zero, not to nothing', () => {
  assert.equal(aedAmount(0, 3.6725), 0);
});

test('THE FLIPPED RATE IS 885 TIMES TOO BIG, and nothing here hides it', () => {
  // The rate is AED per ONE UNIT. Typing 57 for the peso, which is PHP per
  // dollar, books a ₱5,000 taxi fare as AED 285,000. The helper computes
  // it faithfully: catching it is the add form's live sentence, not this.
  const right = aedAmount(5000, 0.0644);
  const flipped = aedAmount(5000, 57);
  assert.equal(right, 322);
  assert.equal(flipped, 285000);
  assert.ok(flipped / right > 800);
});

test('the sanity rule holds: weaker than a dirham means a smaller figure', () => {
  assert.ok(aedAmount(5000, 0.0644) < 5000);   // PHP
  assert.ok(aedAmount(5000, 4.9643) > 5000);   // GBP
  assert.equal(aedAmount(5000, 1), 5000);      // AED, locked at 1
});
