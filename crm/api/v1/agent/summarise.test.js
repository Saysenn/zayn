const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMemory, SUMMARY_VERSION } = require('./summarise');

test('conversation memory keeps structured decisions and unresolved work', () => {
  const memory = parseMemory(JSON.stringify({
    text: 'The admin confirmed the September export layout.',
    topics: ['September export'],
    decisions: ['Keep fees inside the USD total.'],
    corrections: ['Rows should be called deals.'],
    preferences: ['Use short replies.'],
    unresolved: ['Check the October snapshot.'],
  }));

  assert.equal(memory.version, SUMMARY_VERSION);
  assert.deepEqual(memory.decisions, ['Keep fees inside the USD total.']);
  assert.deepEqual(memory.unresolved, ['Check the October snapshot.']);
});

test('a provider returning plain text still produces searchable memory', () => {
  const memory = parseMemory('The admin changed the company tier.');
  assert.equal(memory.text, 'The admin changed the company tier.');
  assert.deepEqual(memory.decisions, []);
});

test('empty summaries are not stored as knowledge', () => {
  assert.equal(parseMemory(''), null);
  assert.equal(parseMemory('{"text":""}'), null);
});
