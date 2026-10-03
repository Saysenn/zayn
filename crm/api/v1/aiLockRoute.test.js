const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('./testing/stubRepos');

// LOCKED IS LOCKED ON THE SERVER TOO: a stale tab can still post to her. 2026-09-28.

function load(status) {
  const ran = [];
  const { router } = loadWith(require.resolve('./masterSheet.js'), {
    [require.resolve('./agent/aiStatus.js')]: { aiStatus: async () => status },
    [require.resolve('./agent/runAgent.js')]: { runAgent: async (...a) => { ran.push(a); return { reply: 'hi' }; } },
  });
  const find = (method, path) => {
    const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  return { find, ran };
}

async function call(handler, body) {
  let failure = null;
  let payload = null;
  const res = {
    json(p) { payload = p; return this; }, status() { return this; }, setHeader() {}, flushHeaders() {},
    write() {}, end() {}, on() {},
  };
  await handler({ body, on() {} }, res, (e) => { failure = e; });
  return { failure, payload };
}

test('A LOCKED DIANE REFUSES THE TURN, and never reaches the model', async () => {
  const { find, ran } = load({ available: false, reason: 'no_credit' });
  const { failure } = await call(find('post', '/master-sheet/agent'), { history: [{ role: 'user', content: 'hi' }] });
  assert.equal(failure?.status ?? failure?.statusCode, 503);
  assert.match(failure.message, /no balance left/);
  assert.equal(ran.length, 0);
});

test('THE STATUS IS SERVED AS IT IS', async () => {
  const { find } = load({ available: false, reason: 'no_key' });
  const { payload } = await call(find('get', '/master-sheet/ai/status'));
  assert.deepEqual(payload, { available: false, reason: 'no_key' });
});
