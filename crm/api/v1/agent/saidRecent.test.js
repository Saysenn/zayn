const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * A FOLLOW UP IS STILL THE SAME QUESTION
 * ***************************************************
 *
 * Live: "add gloria and gloria difference then convert it to usd", answered
 * with a USD figure. Then "I think thats wrong. double check", and she
 * answered without dollars and finished with *"You asked for a USD
 * conversion but the figures did not include that, so should I convert it
 * to dollars now"*. She offered to do what she had done one line earlier.
 *
 * `said` is ONE turn, deliberately: a name from an earlier question must
 * never resolve the current one. So intent gets its own injected value
 * rather than widening the one that resolves names.
 *
 * TWO TURNS, NOT THE CONVERSATION. Any wider and dollars asked for ten
 * minutes ago start appearing on unrelated answers, which is the fault the
 * dollars guard was written for in the first place.
 */

const SRC = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
const TOOL = fs.readFileSync(path.join(__dirname, 'tools', 'masterSheet.js'), 'utf8');

test('runAgent INJECTS it, like `said` and never as a parameter', () => {
  assert.match(SRC, /args\.saidRecent = recentSaid\(history\);/);
  // Injected means she cannot satisfy it by writing the word herself.
  assert.doesNotMatch(TOOL, /saidRecent:\s*\{\s*type:/, 'saidRecent must not be a tool parameter');
});

test('`said` STAYS ONE TURN, so a name cannot leak between questions', () => {
  assert.match(SRC, /args\.said = lastSaid\(history\);/);
  assert.match(SRC, /function lastSaid/);
});

test('TWO TURNS, and the number is named once', () => {
  const turns = Number(SRC.match(/const INTENT_TURNS = (\d+);/)?.[1]);
  assert.equal(turns, 2, `INTENT_TURNS is ${turns}; wider and it re-creates the unasked dollars`);
  assert.match(SRC, /function recentSaid\(history = \[\], turns = INTENT_TURNS\)/);
});

test('the dollars guard READS IT, and still falls back to one turn', () => {
  assert.match(TOOL, /ASKED_FOR_USD\.test\(String\(args\.saidRecent \?\? args\.said \?\? ''\)\)/);
});

/* ===============================
 * * recentSaid itself
 * =============================== */

// Reached the same way lengthRetry.test.js reaches its guard: the module
// does not export it, so the behaviour is pinned through a small harness
// rather than by loading a live provider.
const recentSaid = (history, turns = 2) => {
  const out = [];
  for (let i = history.length - 1; i >= 0 && out.length < turns; i -= 1) {
    if (history[i]?.role === 'user') out.push(String(history[i].content ?? ''));
  }
  return out.join('\n');
};

const ASKED_FOR_USD = /\b(dollars?|usd|\$|in one currency|one currency|convert(ed)? (it|them|that|to)?)\b/i;

const HISTORY = [
  { role: 'user', content: 'show me total of gloria and gloria difference' },
  { role: 'assistant', content: 'GBP 2,000 and AED 150.' },
  { role: 'user', content: 'cool, add gloria and gloria difference then convert it to usd' },
  { role: 'assistant', content: 'USD 2,883.' },
  { role: 'user', content: 'I think thats wrong. double check' },
];

test('THE ACTUAL FAILURE: "double check" keeps the conversion', () => {
  assert.equal(ASKED_FOR_USD.test('I think thats wrong. double check'), false, 'the old behaviour');
  assert.equal(ASKED_FOR_USD.test(recentSaid(HISTORY)), true);
});

test('AND IT FORGETS, so an old request does not follow them around', () => {
  const later = [...HISTORY,
    { role: 'assistant', content: 'USD 2,883.' },
    { role: 'user', content: 'ok now show me milkman' },
    { role: 'assistant', content: '33 deals.' },
    { role: 'user', content: 'what is nicola owed' },
  ];
  assert.equal(
    ASKED_FOR_USD.test(recentSaid(later)),
    false,
    'dollars from three questions ago would be tacked onto an unrelated total',
  );
});

test('it reads USER turns only', () => {
  const said = recentSaid([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'convert it to usd' },
    { role: 'user', content: 'second' },
  ]);
  assert.equal(said.includes('convert'), false, 'her own words must not count as their request');
  assert.equal(said, 'second\nfirst');
});

test('an empty or one turn history is fine', () => {
  assert.equal(recentSaid([]), '');
  assert.equal(recentSaid([{ role: 'user', content: 'only' }]), 'only');
});
