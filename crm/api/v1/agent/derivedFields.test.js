const test = require('node:test');
const assert = require('node:assert/strict');

const { masterSheetTools } = require('./tools/masterSheet');

/**
 * ***************************************************
 * * The payment period is worked out, never typed
 * ***************************************************
 *
 * It used to be settable, and a stored value won over the formula on every
 * later read. Gloria carried four deals with identical dates and read Ended
 * on two of them, beside a green payment start cell, with her £500 still in
 * September's total. His call 2026-09-09: the period follows the dates.
 *
 * Step one is closing the two write paths. Diane's is here; the other was
 * the Person detail page's own cell.
 */

const tool = (name) => masterSheetTools.find((t) => t.name === name);
const props = (name) => tool(name).parameters.properties;

test('SHE CANNOT BE HANDED status ON A WRITE', () => {
  // update_master_sheet_row and fill_form both spread ROW_FIELDS, so
  // dropping it there closes all of them at once.
  for (const name of ['update_master_sheet_row', 'fill_form', 'add_deal']) {
    assert.equal(props(name).status, undefined, `${name} cannot set status`);
  }
  // The bulk tool carries its own `set` block, so it needed its own cut.
  assert.equal(
    tool('bulk_update_master_sheet').parameters.properties.set.properties.status,
    undefined,
  );
});

test('FILTERING BY IT IS STILL FINE. Reading was never the problem', () => {
  const filters = tool('bulk_update_master_sheet').parameters.properties;
  assert.ok(filters.status, 'still selectable as a filter');
  // An ARRAY since the bulk tool started sharing FILTER_PARAMS with the
  // lookup: every filter there takes several values in one call, so nobody
  // loops the tool once per value. The values themselves are unchanged.
  assert.deepEqual(filters.status.items.enum, ['active', 'ended', 'not_started']);
});

test('asking for it anyway is refused with the REAL reason', async () => {
  // Dropping it from the schema alone leaves her falling into "status is
  // not a column on a deal", which is false: it is a column, it is derived.
  // A wrong reason is worse than none, because she repeats it.
  const out = await tool('update_master_sheet_row').handler({ id: 1, status: 'ended' });
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /worked out from the payment start, the preset and the end date/);
  assert.doesNotMatch(out.summary, /not a column/);
});

test('the refusal comes BEFORE the write, so nothing is half done', async () => {
  // id 1 may not exist; the point is that it never gets far enough to care.
  const out = await tool('update_master_sheet_row').handler({ id: 999999, status: 'active' });
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.equal(out.card, undefined);
});

test('a real field is untouched by the guard', async () => {
  const out = await tool('update_master_sheet_row').handler({ location: 'Main City' });
  assert.doesNotMatch(out.summary ?? '', /worked out from the payment start/);
});
