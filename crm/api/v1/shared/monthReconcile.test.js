const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileMonths } = require('./monthReconcile.helper');

// 2026-09-30: MILKMAN compared with last month said two deals were "removed
// from the sheet". They had moved to INDIGO and were still there.
test('A DEAL THAT MOVED GROUP IS NOT "REMOVED FROM THE SHEET"', () => {
  const deal = { id: 7, personName: 'Alex Example', company: 'Northstar Care', group: 'ALPHA', currency: 'GBP', amount: 1000, net: 1000 };
  const before = { month: '2026-08', deals: [deal], rows: [{ id: 7, group_name: 'ALPHA', company: 'Northstar Care' }] };
  const after = { month: '2026-09', deals: [{ ...deal, group: 'BETA' }], rows: [{ id: 7, group_name: 'BETA', company: 'Northstar Care' }] };
  const inAlpha = (d, row) => (row?.group_name ?? d?.group) === 'ALPHA';

  const out = reconcileMonths(before, after, { matches: inAlpha });
  assert.equal(out.removed.length, 0);
  assert.equal(out.notCounted.length, 1);
  assert.match(out.notCounted[0].reason, /moved to BETA, Northstar Care, still on the sheet/);
});

test('A ROW GONE ENTIRELY IS STILL REMOVED', () => {
  const deal = { id: 8, personName: 'Blake Example', group: 'ALPHA', currency: 'GBP', amount: 500, net: 500 };
  const out = reconcileMonths(
    { month: '2026-08', deals: [deal], rows: [{ id: 8, group_name: 'ALPHA' }] },
    { month: '2026-09', deals: [], rows: [] },
  );
  assert.equal(out.removed.length, 1);
});

// A LIVE month's rows are narrowed to the scope, so the move is only visible
// in the whole sheet it carries beside them.
test('A MOVE IS FOUND IN THE WHOLE SHEET WHEN THE ROWS ARE SCOPED', () => {
  const deal = { id: 9, personName: 'Casey Example', company: 'Northstar Care', group: 'ALPHA', currency: 'GBP', amount: 700, net: 700 };
  const out = reconcileMonths(
    { month: '2026-08', deals: [deal], rows: [{ id: 9, group_name: 'ALPHA' }] },
    { month: '2026-09', deals: [], rows: [], allRows: [{ id: 9, group_name: 'BETA', company: 'Northstar Care' }] },
    { matches: (d, row) => (row?.group_name ?? d?.group) === 'ALPHA' },
  );
  assert.equal(out.removed.length, 0);
  assert.match(out.notCounted[0].reason, /moved to BETA/);
});

test('A STOPPED DEAL SAYS STOPPED, not moved and not removed', () => {
  const deal = { id: 10, personName: 'Drew Example', group: 'ALPHA', currency: 'GBP', amount: 300, net: 300 };
  const out = reconcileMonths(
    { month: '2026-08', deals: [deal], rows: [{ id: 10, group_name: 'ALPHA' }] },
    { month: '2026-09', deals: [], rows: [], allRows: [{ id: 10, group_name: 'ALPHA', stopped_on: '2026-09-22' }] },
  );
  assert.equal(out.removed.length, 0);
  assert.match(out.ended[0].reason, /stopped on 2026-09-22, in the Archive/);
});

// A SAVED month keys its deals "workbook:<key>"; the live row carries that key
// as sync_key under a numeric id. Live 2026-09-30, MILKMAN to INDIGO.
test('A MOVE IS FOUND BY SYNC KEY when the saved month keyed the deal by workbook key', () => {
  const key = 'alpha|northstarcare|mid|1|casey';
  const deal = { id: `workbook:${key}`, personName: 'Casey Example', group: 'ALPHA', currency: 'GBP', amount: 700, net: 700 };
  const out = reconcileMonths(
    { month: '2026-08', deals: [deal], rows: [{ id: `workbook:${key}`, group_name: 'ALPHA', sync_key: key }] },
    { month: '2026-09', deals: [], rows: [], allRows: [{ id: 62, group_name: 'BETA', company: 'Northstar Care', sync_key: key }] },
    { matches: (d, row) => (row?.group_name ?? d?.group) === 'ALPHA' },
  );
  assert.equal(out.removed.length, 0);
  assert.match(out.notCounted[0].reason, /moved to BETA/);
});
