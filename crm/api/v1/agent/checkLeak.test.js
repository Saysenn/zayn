const test = require('node:test');
const assert = require('node:assert/strict');
const { checkLeak } = require('./checkLeak');

// check_rates' own directions, read out to the admin 2026-09-25.
test("check_rates' directions, read out, are a leak", () => {
  assert.equal(checkLeak('They hold 2 deals. Use those figures; do not work a range out of the lines.').ok, false);
  assert.equal(checkLeak('A rate on a DEAL stacks on top of it, never replacing it.').ok, false);
});

test('her own words about the same rates are not', () => {
  assert.equal(checkLeak('No. Dov is on 2% fee, not 5%. It stacks with any rate on his deals.').ok, true);
});
