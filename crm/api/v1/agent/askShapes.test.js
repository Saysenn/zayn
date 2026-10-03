const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asksComparison, asksSuperlative, asksCombined, asksEarnings,
  asksBreakdown, asksToConvert, isFollowUp,
} = require('./askShapes');

/**
 * ***************************************************
 * * EVERY PHRASING HERE WAS ACTUALLY SAID
 * ***************************************************
 *
 * Taken from the live transcripts of 2026-09-07 and 09-08. Nothing invented:
 * a list that grows by imagination ends up matching ordinary prose, and then
 * the guard on top of it gets widened away.
 *
 * The `false` cases matter more than the `true` ones. Each is a sentence
 * that WOULD have been caught by a looser pattern, and each would have cost
 * a retry on an answer that was already correct.
 */

test('a comparison is one period against another', () => {
  for (const said of [
    'did we earn more than last month',
    'did we gain or lose over the past 3 months',
    'is it up or down',
  ]) assert.equal(asksComparison(said), true, said);
});

test('and her OWN "vs" wording is not a comparison question', () => {
  // "Sept 2026 vs Aug 2026" is the panel note she reads back. Matching it
  // would fire the guard on every turn that quotes the dashboard.
  assert.equal(asksComparison('Sept 2026 vs Aug 2026'), false);
  assert.equal(asksComparison('whats the total for this month'), false);
  assert.equal(asksComparison('compare august to december'), false);
});

test('a superlative asks which ONE, and she has no answer', () => {
  for (const said of [
    'who is on the most money',
    'which of those three earned most',
  ]) assert.equal(asksSuperlative(said), true, said);
});

/**
 * THE BOUNDARY, WRITTEN DOWN RATHER THAN WIDENED.
 *
 * "whats the biggest group" was said live and is NOT caught here, because
 * it has no who/which/whose. That is deliberate: she answered it correctly
 * from tool counts ("INDIGO is the biggest group by deal count, with 39
 * deals"), and it is a question about a COUNT, not about money.
 *
 * Adding "what is the" to the pattern would catch "whats the total for this
 * month" with it, which is the widening that makes a guard useless.
 * `checkQuestion` carries the real protection anyway: it only fires when
 * the REPLY states money.
 */
test('a superlative with no "which" is left to checkQuestion\'s money test', () => {
  assert.equal(asksSuperlative('whats the biggest group'), false);
  assert.equal(asksSuperlative('that is the most i can do'), false);
  assert.equal(asksSuperlative('show me the biggest deals'), false);
});

test('combined asks for several subjects as one figure', () => {
  for (const said of [
    'add gloria and zayn together',
    'give me their totals combined',
    'add those two together for me',
  ]) assert.equal(asksCombined(said), true, said);
});

test('an earnings question is about the span', () => {
  for (const said of [
    'did we earn past months?',
    'how much did we make over the past 3 months',
    'did we gain or lose since june',
  ]) assert.equal(asksEarnings(said), true, said);
});

test('a plain month question asks for no total across months', () => {
  assert.equal(asksEarnings('show me the last 3 months'), false);
  assert.equal(asksEarnings('what are the next 3 months looking like'), false);
});

test('the breakdown report is asked for by name', () => {
  for (const said of [
    'break that down by group',
    'show MANBAT and NEXUS August breakdowns',
    'how much goes to the uk',
  ]) assert.equal(asksBreakdown(said), true, said);
});

test('and a bare follow-up is not a request for one', () => {
  // "whats the rate", then "and last august?" returned the five group
  // payment workbook.
  assert.equal(asksBreakdown('and last august?'), false);
  assert.equal(asksBreakdown('what about nexus'), false);
});

test('converting needs a target currency, asking the rate does not', () => {
  assert.equal(asksToConvert('convert it to usd'), true);
  assert.equal(asksToConvert('convert milkman total to usd'), true);
  // A question ABOUT the rate must fall through to the rate answer.
  assert.equal(asksToConvert('what did you convert august at'), false);
  assert.equal(asksToConvert('whats the rate'), false);
  assert.equal(asksToConvert('what rate are you converting at'), false);
});

test('a follow-up is short and carries the line before it', () => {
  for (const said of ['and last august?', 'what about nexus', 'same for milkman', 'and the month after']) {
    assert.equal(isFollowUp(said), true, said);
  }
  assert.equal(isFollowUp('show me nexus deals'), false);
  assert.equal(isFollowUp('whats the total for this month'), false);
});
