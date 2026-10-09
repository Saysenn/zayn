const test = require('node:test');
const assert = require('node:assert');
const { spelledOut, answeredAll } = require('./autoConfirm');

const tool = { parameters: { properties: { confirmed: {} } } };
const add50 = { perPerson: [{ person: 'Zayn', allDeals: true, add: { monthlyAmount: 50 } }] };

test('A CHANGE SPELLED OUT IN FULL skips the preview, and only that', () => {
  assert.equal(spelledOut('bulk_update_master_sheet', tool, add50, 'add 50 to all zayn deals'), true);
  assert.equal(spelledOut('bulk_update_master_sheet', tool, add50, 'add 50 to both of zayn'), true);
  // A bare "both" names nobody, and may mean the deal already changed.
  assert.equal(spelledOut('bulk_update_master_sheet', tool, add50, 'both'), false);
  // Every deal, but they never said so.
  assert.equal(spelledOut('bulk_update_master_sheet', tool, add50, 'add 50 to zayn'), false);
  // A group is not a person they named.
  assert.equal(spelledOut('bulk_update_master_sheet', tool, { group: 'MILKMAN', set: { payableDays: 5 } }, 'all of milkman to 5 days'), false);
  // Ending a deal always asks.
  const ends = { perPerson: [{ person: 'Zayn', allDeals: true, set: { endOn: '2026-10-31' } }] };
  assert.equal(spelledOut('bulk_update_master_sheet', tool, ends, 'end all zayn deals'), false);
  assert.equal(spelledOut('bulk_update_master_sheet', { ...tool, stops: true }, add50, 'add 50 to all zayn deals'), false);
});

test('AN UNDO ALWAYS ASKS which changes it puts back', () => {
  assert.equal(spelledOut('undo_master_sheet_change', tool, { last: 2, batch: true }, 'undo the last 2 changes'), false);
  assert.equal(spelledOut('undo_master_sheet_change', tool, { batch: true }, 'revert it'), false);
});

test('"BOTH" TO HER OWN "WHICH GROUP, OR BOTH?" is spelled out (2026-10-09)', () => {
  const asked = 'Zayn has 2 deals. Which group should get the change, or both?';
  for (const r of ['both', 'Both.', 'yes both', 'all of them', 'both groups']) assert.equal(answeredAll(asked, r), true, r);
  // more than an answer, or not to her question: still asks
  for (const r of ['both, and make it 200', 'milkman', 'not both']) assert.equal(answeredAll(asked, r), false, r);
  assert.equal(answeredAll('Done. Anything else?', 'both'), false);
  assert.equal(spelledOut('bulk_update_master_sheet', tool, add50, 'add 50 to zay n\nboth', { allAnswered: true }), true);
  // a stop is never skipped, answered or not
  const stop = { perPerson: [{ person: 'Zayn', allDeals: true, set: { stopOn: '2026-10-31' } }] };
  assert.equal(spelledOut('bulk_update_master_sheet', tool, stop, 'stop zayn\nboth', { allAnswered: true }), false);
});

test('THE PERSON\'S PAID SWITCH names every deal of theirs (PAY-010, 2026-10-10)', () => {
  const paid = { perPerson: [{ person: 'Kiran Vale', allDeals: true, set: { overridePaid: true } }] };
  assert.equal(spelledOut('bulk_update_master_sheet', tool, paid, 'mark kiran vale paid'), true);
  // a money change on all their deals still needs "all" said
  const money = { perPerson: [{ person: 'Kiran Vale', allDeals: true, set: { monthlyAmount: 900 } }] };
  assert.equal(spelledOut('bulk_update_master_sheet', tool, money, 'make kiran vale 900'), false);
});
