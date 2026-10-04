const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sortRows, setupView, buildDriverWorkbook, DEFAULT_DRIVER_SHEET,
} = require('./driverSheet');

/**
 * The Drivers sheet's rules, one test each (2026-10-04). The month is set
 * on every row so nothing depends on today's date.
 */
const SETUP = DEFAULT_DRIVER_SHEET;
const row = (over) => ({
  id: Math.random(),
  person_id: over.person_name,
  group_name: 'INDIGO',
  payment_method: 'cash',
  currency: 'GBP',
  monthly_amount: 1000,
  payable_amount: 1000,
  payable_days: 31,
  for_this_month: true,
  payment_period: 'active',
  ...over,
});

test('A UK RUN TAKES CASH ONLY; OUTSIDE UK TAKES ANY METHOD', () => {
  const out = sortRows([
    row({ person_name: 'Cash Birmingham', location: 'Chip county' }),
    row({ person_name: 'Bank Birmingham', location: 'Chip county', payment_method: 'bank' }),
    row({ person_name: 'Bank Abroad', location: 'Abu Dhabi', payment_method: 'bank', currency: 'AED' }),
  ], SETUP);
  assert.deepEqual(out.uk.map((r) => r.person_name), ['Cash Birmingham']);
  assert.deepEqual(out.abroad.map((r) => r.person_name), ['Bank Abroad']);
});

test('A LOCATION NOBODY PLACED IS UNASSIGNED, NEVER GUESSED, AND HOLDS THE EXPORT', () => {
  const rows = [row({ person_name: 'New Place', location: 'Black country' })];
  const out = sortRows(rows, SETUP);
  assert.equal(out.unassigned.length, 1);
  const { checks } = setupView(rows, SETUP);
  assert.ok(checks.find((c) => c.kind === 'unassigned' && c.blocking));
});

test('SPELLING AND CAPITALS ARE ONE PLACE', () => {
  const out = sortRows([row({ person_name: 'A', location: '  south EAST ' })], SETUP);
  assert.equal(out.uk[0]?.run, 'south');
});

test('NOTHING OWED THIS MONTH IS LEFT OFF', () => {
  const out = sortRows([
    row({ person_name: 'Zero', location: 'Main City', payable_amount: 0 }),
    row({ person_name: 'Not paid', location: 'Main City', override_should_be_paid: false }),
  ], SETUP);
  assert.equal(out.uk.length, 0);
});

test('NO LOCATION BUT A NEARBY POSTCODE JOINS THAT PLACE; FAR AWAY IS LISTED', () => {
  const out = sortRows([
    row({ person_name: 'Known', location: 'Geordie', postcode: 'NE12 8HY' }),
    row({ person_name: 'Near', location: '', postcode: 'NE1 1AA' }),
    row({ person_name: 'Far', location: '', postcode: 'TR1 1AA' }),
  ], SETUP);
  assert.equal(out.uk.find((r) => r.person_name === 'Near')?.place, 'geordie');
  assert.deepEqual(out.noLocation.map((r) => r.person_name), ['Far']);
});

test('THE FILE HAS THE FOUR TABS, AREA SPLIT FIRST, AND NEVER ADDS TWO CURRENCIES', async () => {
  const wb = buildDriverWorkbook([
    row({ person_name: 'Pounds', location: 'Main City' }),
    row({ person_name: 'Dirhams', location: 'South East', currency: 'AED', payable_amount: 5000 }),
  ], { driverSheet: SETUP, perUsd: { AED: 3.67, GBP: 0.75 } });
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Area split', 'UK cash', 'Outside UK', 'Mid split']);
  const totals = [];
  wb.getWorksheet('UK cash').eachRow((r) => { if (/^Total /.test(String(r.getCell(1).value))) totals.push(r.getCell(1).value); });
  assert.deepEqual(totals.sort(), ['Total AED', 'Total GBP']);
});
