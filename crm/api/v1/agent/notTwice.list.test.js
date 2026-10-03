const test = require('node:test');
const assert = require('node:assert/strict');

const { drawnAlready, lastListed, LISTED } = require('./notTwice.list');

/**
 * ***************************************************
 * * "Are you sure that's 30?" must not reprint thirty rows
 * ***************************************************
 *
 * Re-running the tool is the RIGHT answer to "are you sure": it asks
 * whether she checked. Redrawing the whole list to say yes is not.
 */

const listed = (ids) => ({
  role: 'assistant',
  content: `[listed ${ids.length} deals: ${ids.map((id) => `#${id} Someone`).join(', ')}]`,
});

const list = (ids) => ({ rows: ids.map((id) => ({ id, name: 'Someone' })) });

test('the same list twice running is caught', () => {
  const history = [listed([132, 12, 29])];
  assert.equal(drawnAlready(list([132, 12, 29]), history), true);
});

test('a DIFFERENT list is drawn, however similar', () => {
  const history = [listed([132, 12, 29])];
  assert.equal(drawnAlready(list([132, 12, 30]), history), false, 'one id apart is a new answer');
  assert.equal(drawnAlready(list([132, 12]), history), false, 'a narrower list is a new answer');
});

test('ORDER counts, because a re-sorted list is a real answer', () => {
  const history = [listed([1, 2, 3])];
  assert.equal(drawnAlready(list([3, 2, 1]), history), false);
});

test('only the MOST RECENT list blocks', () => {
  // Coming back to the same set later in a conversation is ordinary. Twice
  // in a row is the fault, and nothing else is.
  const history = [
    listed([1, 2, 3]),
    { role: 'user', content: 'now show me milkman' },
    listed([9, 8, 7]),
    { role: 'user', content: 'and indigo again?' },
  ];
  assert.equal(drawnAlready(list([1, 2, 3]), history), false);
  assert.equal(drawnAlready(list([9, 8, 7]), history), true);
});

test('no list yet, nothing to block', () => {
  assert.equal(drawnAlready(list([1]), []), false);
  assert.equal(drawnAlready(list([1]), [{ role: 'user', content: 'hi' }]), false);
  assert.equal(lastListed([]), null);
});

test('an empty list is never a repeat', () => {
  assert.equal(drawnAlready({ rows: [] }, [listed([1])]), false);
  assert.equal(drawnAlready(undefined, [listed([1])]), false);
});

test("THE CLIENT'S FORMAT IS THE CONTRACT", () => {
  // AgentOverlay.jsx writes this line. If its shape changes and this regex
  // is not changed with it, the guard silently stops working.
  assert.match('[listed 2 deals: #7 Ada, #9 Bo]', LISTED);
  assert.match('[listed 1 deal: #7 Ada]', LISTED);
  assert.equal(lastListed([listed([7, 9])]), '7,9');
  // A card line is not a list line.
  assert.equal(lastListed([{ role: 'assistant', content: "[showed Ada's deal, row #7]" }]), null);
});
