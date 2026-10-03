const test = require('node:test');
const assert = require('node:assert/strict');
const { watchWrites } = require('./writeTap.helper');
const { broadcast } = require('../sockets');

// 2026-09-25. A "which company?" and a refusal were remembered as finished
// writes, and the next "yes" made Diane claim changes nobody made. Whether a
// call wrote is read off its broadcast now, never off what it answered.

test('a call that broadcast wrote', async () => {
  const { result, wrote } = await watchWrites(async () => {
    await Promise.resolve();
    broadcast(null, 'people:changed', {});
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(wrote, true);
});

test('a call that only answered did not, however it was worded', async () => {
  const { wrote } = await watchWrites(async () => ({ summary: 'Updated. It is done.' }));
  assert.equal(wrote, false);
});

test('two calls side by side do not see each other\'s writes', async () => {
  const [a, b] = await Promise.all([
    watchWrites(async () => { await new Promise((r) => setTimeout(r, 5)); broadcast(null, 'x', {}); }),
    watchWrites(async () => { await new Promise((r) => setTimeout(r, 10)); }),
  ]);
  assert.equal(a.wrote, true);
  assert.equal(b.wrote, false);
});
