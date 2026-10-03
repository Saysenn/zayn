const test = require('node:test');
const assert = require('node:assert/strict');
const { closeMonth } = require('./closeMonth');

test('the immutable snapshot completes before the destructive burn', async () => {
  const order = [];
  const saved = await closeMonth({
    snapshot: async (month) => {
      order.push(`snapshot ${month}`);
      return { month, existed: false, row_count: 96 };
    },
    burn: async () => { order.push('burn'); },
  });
  assert.match(order[0], /^snapshot \d{4}-\d{2}$/);
  assert.equal(order[1], 'burn');
  assert.equal(saved.row_count, 96);
});

test('a failed snapshot prevents the burn', async () => {
  let burned = false;
  await assert.rejects(() => closeMonth({
    snapshot: async () => { throw new Error('snapshot failed'); },
    burn: async () => { burned = true; },
  }), /snapshot failed/);
  assert.equal(burned, false);
});
