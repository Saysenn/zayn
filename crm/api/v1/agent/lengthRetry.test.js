const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ***************************************************
 * * A truncated reply is a FAILED TURN
 * ***************************************************
 *
 * Two ways the token budget shows, and only the first was ever caught:
 *
 *   EMPTY    the model reasons before it writes and that reasoning is
 *            charged against max_tokens, so a hard question spends the
 *            whole allowance and emits nothing.
 *   CUT OFF  a long answer that did not fit. Worse, because it LOOKS like
 *            an answer: asked to relay thirty rows of changes she wrote a
 *            paragraph that stopped mid-list and nothing said so.
 *
 * The guard was `!raw && finishReason === 'length'`, so only the empty case
 * retried. Read as text: the retry lives inside a long streaming loop that
 * needs a live provider to exercise.
 */

const SRC = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');

test('the retry fires on length whether or not content came back', () => {
  assert.match(
    SRC,
    /if \(finishReason === 'length' && !raisedBudget\) \{/,
    'a truncated reply must retry, not be handed over cut off',
  );
  assert.ok(
    !SRC.includes("if (!raw && finishReason === 'length'"),
    'the old empty-only guard must be gone',
  );
});

test('it retries ONCE, so the headroom is paid for only when needed', () => {
  assert.match(SRC, /raisedBudget = true;/);
  assert.match(SRC, /let raisedBudget = false;/);
});

test('the retry cap clears the longest honest answer she has', () => {
  const cap = Number(SRC.match(/const RETRY_MAX_TOKENS = (\d+);/)?.[1]);
  // Forty rows of changes, each a heading plus its field diffs, verbatim
  // and with every date written out. 3,000 covered about half.
  assert.ok(cap >= 8000, `RETRY_MAX_TOKENS is ${cap}, too small for the changes relay`);

  const base = Number(SRC.match(/const MAX_TOKENS = (\d+);/)?.[1]);
  assert.ok(base < cap, 'the ordinary cap stays small; the retry is what pays');
});

test('history is not the limit here', () => {
  // 200,000 characters, about 50k tokens. The relay never approaches it, so
  // a short reply is never the history budget's doing.
  const budget = Number(SRC.match(/: (\d+);\s*$/m)?.[1]);
  assert.ok(SRC.includes('HISTORY_CHAR_BUDGET'));
  assert.ok(budget >= 200000, `history budget is ${budget}`);
});
