const test = require('node:test');
const assert = require('node:assert/strict');
const { dealWords } = require('./dealWords');

test('Diane calls sheet records deals in every user-facing answer', () => {
  assert.equal(
    dealWords('Nothing from 3 rows. Open row #9. That row is inactive.'),
    'Nothing from 3 deals. Open deal #9. That deal is inactive.',
  );
});

test('unrelated words are untouched', () => {
  assert.equal(
    dealWords('The arrow points to Brown Road and Brown Row.'),
    'The arrow points to Brown Road and Brown Row.',
  );
});

test('both model and computed replies pass through the deal vocabulary', () => {
  const source = require('node:fs').readFileSync(require.resolve('./runAgent'), 'utf8');
  assert.ok((source.match(/dealWords\(/g) ?? []).length >= 2);
});
