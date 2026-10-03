const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');

// 2026-09-28: with no balance she said "I'm being rate limited, give me a moment".
// No key, no credit or a refused key LOCKS her; a plain rate limit does not.

const SUBJECT = require.resolve('./aiStatus');
const CLIENT = require.resolve('./chatClient');

function load(create) {
  const calls = [];
  const client = create && { chat: { completions: { create: async (a) => { calls.push(a); return create(a); } } } };
  const mod = loadWith(SUBJECT, { [CLIENT]: { getClient: () => client } });
  return { mod, calls };
}
const fail = (status, code) => () => { throw Object.assign(new Error('x'), { status, error: { code } }); };

test('NO KEY IS LOCKED, and nothing is called', async () => {
  const { mod } = load(null);
  assert.deepEqual(await mod.aiStatus(), { available: false, reason: 'no_key' });
});

test('NO CREDIT AND A REFUSED KEY LOCK; A RATE LIMIT DOES NOT', async () => {
  assert.equal((await load(fail(429, 'insufficient_quota')).mod.aiStatus()).reason, 'no_credit');
  assert.equal((await load(fail(402)).mod.aiStatus()).reason, 'no_credit');
  assert.equal((await load(fail(401, 'invalid_api_key')).mod.aiStatus()).reason, 'bad_key');
  assert.equal((await load(fail(429, 'rate_limit_exceeded')).mod.aiStatus()).available, true);
  assert.equal((await load(fail(500)).mod.aiStatus()).available, true, 'could not tell is not a lock');
});

test('A WORKING KEY IS ASKED ONCE, with the smallest call there is', async () => {
  const { mod, calls } = load(() => ({}));
  await Promise.all([mod.aiStatus(), mod.aiStatus()]);
  await mod.aiStatus();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].max_tokens, 1);
});

test('A REAL CALL THAT RUNS OUT LOCKS AT ONCE, before the next check', async () => {
  const { mod, calls } = load(() => ({}));
  assert.equal((await mod.aiStatus()).available, true);
  assert.equal(mod.noteAiFailure({ status: 429, error: { code: 'insufficient_quota' } }), 'no_credit');
  assert.deepEqual(await mod.aiStatus(), { available: false, reason: 'no_credit' });
  assert.equal(calls.length, 1, 'the lock came from the failure, not a new check');
  assert.equal(mod.noteAiFailure({ status: 429, error: { code: 'rate_limit_exceeded' } }), null);
});

// A CONTRACT with web/src/configs/aiLock.js AI_LOCK_REASON, which pins the same three.
test('THE LOCK REASONS ARE THE PAGE\'S THREE, and each has a sentence', () => {
  const { AI_LOCK } = require('./aiStatus');
  const { messages } = require('../shared/messages');
  assert.deepEqual(Object.values(AI_LOCK).sort(), ['bad_key', 'no_credit', 'no_key']);
  for (const reason of Object.values(AI_LOCK)) assert.ok(messages.agent.locked[reason], reason);
});
