const test = require('node:test');
const assert = require('node:assert/strict');
const { unseenCards } = require('./unseenCards');

test('the same deal card is emitted once in a turn even if the model repeats the lookup', () => {
  const seen = new Set();
  assert.deepEqual(unseenCards([{ id: 14 }, { id: 19 }], seen).map((card) => card.id), [14, 19]);
  assert.deepEqual(unseenCards([{ id: 14 }, { id: 19 }, { id: 30 }], seen).map((card) => card.id), [30]);
});

test('cards without a stable deal id are not silently discarded', () => {
  assert.equal(unseenCards([{ title: 'Information' }], new Set()).length, 1);
});
