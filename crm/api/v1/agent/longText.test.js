const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/**
 * ***************************************************
 * * She reads the whole message, however long
 * ***************************************************
 *
 * A 30,000 character paste reached her as the first 12,000 and a
 * "… (trimmed)" marker, so she answered on 40% of what was sent and
 * nothing on screen said so. The ceiling was right for OLDER messages and
 * wrong for the one being answered.
 *
 * The function is not exported (it is internal to one turn), so it is
 * lifted out of the source and exercised here. That keeps the rule pinned
 * without widening the module's surface for a test.
 */

const SRC = fs.readFileSync(require.resolve('./runAgent.js'), 'utf8');

function loadTrimHistory() {
  const body = SRC.match(/function trimHistory\(history\) \{[\s\S]*?\n\}/);
  assert.ok(body, 'trimHistory must be findable in the source');
  // eslint-disable-next-line no-new-func
  return new Function(
    'MAX_MESSAGE_CHARS', 'HISTORY_CHAR_BUDGET',
    `${body[0]}\nreturn trimHistory;`,
  )(12000, 200000);
}

const trimHistory = loadTrimHistory();
const long = (n) => 'x'.repeat(n);

test('THE MESSAGE BEING REPLIED TO IS NEVER CUT', () => {
  const paste = long(30000);
  const [kept] = trimHistory([{ role: 'user', content: paste }]);

  assert.equal(kept.content.length, 30000, 'every character reaches her');
  assert.ok(!kept.content.includes('(trimmed)'));
});

test('however long: a hundred thousand characters still arrives whole', () => {
  const paste = long(100000);
  const [kept] = trimHistory([{ role: 'user', content: paste }]);
  assert.equal(kept.content.length, 100000);
});

test('OLDER messages keep their ceiling, or one paste fills the window', () => {
  // The reason the cap exists. It was never wrong for history, only for
  // the thing being answered.
  const kept = trimHistory([
    { role: 'user', content: long(30000) },
    { role: 'assistant', content: 'noted' },
    { role: 'user', content: 'and now?' },
  ]);

  assert.equal(kept[0].content.length, 12000 + '\n… (trimmed)'.length);
  assert.ok(kept[0].content.includes('(trimmed)'), 'and it says it was cut');
  assert.equal(kept[2].content, 'and now?', 'the newest is untouched');
});

test('the newest is never DROPPED either, whatever the budget', () => {
  // Replying to nothing is worse than any size.
  const kept = trimHistory([
    { role: 'user', content: long(11000) },
    { role: 'user', content: long(11000) },
    { role: 'user', content: long(300000) },
  ]);

  assert.equal(kept.at(-1).content.length, 300000, 'the newest survives whole');
  assert.ok(kept.length >= 1);
});

test('a normal conversation is untouched', () => {
  const history = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'what is Gloria owed' },
  ];
  assert.deepEqual(trimHistory(history), history);
});

/* ===============================
 * * a truncated REPLY is a failed turn, both times
 * =============================== */

test('a second truncation is caught, not passed off as an answer', () => {
  // The retry only fires once. Past the raised cap the cut-off reply used
  // to be returned as though it were finished, which is the exact case the
  // rule exists for: half an answer that looks whole.
  assert.match(SRC, /if \(finishReason === 'length' && raw\) \{/);
  assert.match(SRC, /truncated even at the raised cap/);
  assert.match(SRC, /that answer is cut off/, 'and the reply says so');
  assert.match(SRC, /truncated: true/, 'and the caller can see it');
});

test('the truncated return has the SAME shape as a normal one', () => {
  // A different shape here would break whatever reads changedRowIds.
  const block = SRC.slice(SRC.indexOf("if (finishReason === 'length' && raw) {"));
  const ret = block.slice(0, block.indexOf('};'));
  for (const key of ['reply', 'changedRowIds', 'context']) {
    assert.ok(ret.includes(`${key}`), `${key} must travel like any other turn`);
  }
});
