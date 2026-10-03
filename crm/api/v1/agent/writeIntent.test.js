const test = require('node:test');
const assert = require('node:assert/strict');
const { isWriteRequest, shouldRouteWriteToBulk } = require('./writeIntent');

test('bulk preset wording is a write request, not a totals question', () => {
  assert.equal(isWriteRequest('update all deals preset dates to august 1 2026'), true);
  assert.equal(shouldRouteWriteToBulk('total_master_sheet', [
    { role: 'user', content: 'update all deals preset dates to august 1 2026' },
  ]), true);
});

test('a confirmation keeps the original write intent', () => {
  assert.equal(shouldRouteWriteToBulk('total_master_sheet', [
    { role: 'user', content: 'update all deals preset dates to august 1 2026' },
    { role: 'user', content: 'yes' },
  ]), true);
});

test('revert to an explicit preset date is a write, not an undo or a total', () => {
  const said = 'revert back all deal preset dates to september 1 2026';
  assert.equal(isWriteRequest(said), true);
  for (const wrongTool of ['total_master_sheet', 'undo_master_sheet_change']) {
    assert.equal(shouldRouteWriteToBulk(wrongTool, [
      { role: 'user', content: said },
    ]), true);
  }
});

test('ordinary totals remain totals', () => {
  assert.equal(shouldRouteWriteToBulk('total_master_sheet', [
    { role: 'user', content: 'what is the total for all deals?' },
  ]), false);
});

test('other tools are not redirected by this guard', () => {
  assert.equal(shouldRouteWriteToBulk('bulk_update_master_sheet', [
    { role: 'user', content: 'update all deals preset dates to august 1 2026' },
  ]), false);
});
