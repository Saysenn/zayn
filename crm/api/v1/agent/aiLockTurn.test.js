const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');

// 2026-09-28: a key with no balance came back "I'm being rate limited, give me a
// moment". No moment helps: it says she is switched off, and the page locks.

test('A TURN THAT RUNS OUT OF CREDIT SAYS SHE IS OFF, not rate limited', async () => {
  const quota = Object.assign(new Error('quota'), { status: 429, error: { code: 'insufficient_quota' } });
  const client = { chat: { completions: { create: async () => { throw quota; } } } };
  const { runAgent } = loadWith(require.resolve('./runAgent'), {
    [require.resolve('./chatClient')]: { getClient: () => client },
    [require.resolve('../shared/captureLog.helper')]: { captureLog: () => {} },
  });
  const { aiStatus } = require('./aiStatus');
  await assert.rejects(
    () => runAgent([{ role: 'user', content: 'who is owed this month?' }], 'master-sheet', () => {}),
    (err) => err.status === 503 && /no balance left/.test(err.message),
  );
  const status = await aiStatus();
  assert.deepEqual(status, { available: false, reason: 'no_credit' });
});
