const test = require('node:test');
const assert = require('node:assert/strict');
const { namedSomeoneElse, writeTarget } = require('./namedOther');

const NAMES = ['Casey Test', 'Drew', 'Ruth Harper', 'Casey'];

test('A CHANGE FOR SOMEONE THEY DID NOT NAME IS CAUGHT (live 2026-09-30, Casey to Drew)', () => {
  assert.equal(namedSomeoneElse("set casey test's fee to 3%", 'Drew', NAMES), 'Casey Test');
});

test('the person they named is never refused', () => {
  assert.equal(namedSomeoneElse("set casey test's fee to 3%", 'Casey Test', NAMES), null);
  assert.equal(namedSomeoneElse("change drew's monthly to 1300", 'Drew', NAMES), null);
});

test('a message naming nobody points at the screen, and is left alone', () => {
  assert.equal(namedSomeoneElse('change his fee to 3%', 'Drew', NAMES), null);
  assert.equal(namedSomeoneElse('yes', 'Drew', NAMES), null);
});

test('the target is read from whichever key the tool uses', () => {
  assert.equal(writeTarget({ targetPerson: 'Drew' }), 'Drew');
  assert.equal(writeTarget({ person: 'Ruth Harper' }), 'Ruth Harper');
  assert.equal(writeTarget({ id: 5 }), null);
});
