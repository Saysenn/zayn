const test = require('node:test');
const assert = require('node:assert');
const { route, asEdit } = require('./router');

const r = (over) => ({ kind: 'single_edit', sure: true, person: 'zayn', group: '', everyDeal: false, field: 'payableDays', op: 'add', value: '5', ...over });

test('A SURE SINGLE EDIT becomes the edit the parser would read', () => {
  assert.deepEqual(asEdit(r()), { person: 'zayn', group: null, allDeals: false, field: 'payableDays', op: 'add', value: 5 });
  assert.deepEqual(asEdit(r({ field: 'monthlyAmount', op: 'add', value: '-1,500', group: 'INDIGO' })).value, -1500);
  assert.equal(asEdit(r({ field: 'overridePaid', op: 'set', value: 'true' })).value, true);
  assert.equal(asEdit(r({ field: 'notes', op: 'set', value: 'checked' })).value, 'checked');
});

test('ANYTHING IT IS NOT SURE OF, OR MISSING, goes to her as before', () => {
  assert.equal(asEdit(r({ sure: false })), null);
  assert.equal(asEdit(r({ value: '' })), null);
  assert.equal(asEdit(r({ person: '' })), null);
  assert.equal(asEdit(r({ value: 'lots' })), null, 'not a number');
  assert.equal(asEdit(r({ field: 'notes', op: 'add', value: 'x' })), null, 'text is never added to');
  assert.equal(asEdit(r({ kind: 'question' })), null);
});

test('THE ROUTE comes back in the fixed shape, and nothing is asked with no message', async () => {
  const client = { chat: { completions: { create: async (req) => {
    assert.equal(req.response_format.json_schema.strict, true);
    return { choices: [{ message: { content: JSON.stringify(r({ kind: 'question', field: '', op: '', value: '' })) } }] };
  } } } };
  assert.equal((await route('how much is zayn owed', { client })).kind, 'question');
  assert.equal(await route('   ', { client }), null);
});
