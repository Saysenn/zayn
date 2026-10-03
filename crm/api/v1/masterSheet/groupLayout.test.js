const test = require('node:test');
const assert = require('node:assert/strict');
const { presetNow } = require('../testing/months');

const { buildMasterSheetWorkbook } = require('./buildWorkbook');

/**
 * How a group tab is laid out: one company at a time, and a breakdown whose
 * shape depends on whether the group is paid in more than one currency.
 * Both are the boss's own reading of his sheet, so both are pinned.
 */

const deal = (over) => ({
  group_name: 'MILKMAN', company: 'Whitestone Swan', person_name: 'Neo',
  role: 'mid', seat: 1, role_label: 'Mid 1',
  currency: 'GBP', payment_method: 'cash', payable_amount: 1000,
  monthly_amount: 1000, preset_on: presetNow(), payable_days: 31,
  location: 'South East', status: 'active', ...over,
});

/**
 * HEADERS ON ROW 1, so the first deal is row 2.
 *
 * It was row 3, under a group title and a blank line. The blank was what
 * stopped the title being read as the header row on re-upload; with the
 * title gone it had nothing left to protect the file from. The group comes
 * from the TAB NAME, which is why removing both is safe.
 *
 * Named rather than written as a 2 in the reader below: the whole reason
 * this needed changing in four places at once is that the number was
 * repeated.
 */
const HEADER_ROW = 1;
const FIRST_DEAL_ROW = HEADER_ROW + 1;

test('the deal headers are on row 1, with no title and no blank above them', () => {
  const wb = buildMasterSheetWorkbook([deal()], { breakdown: false });
  const ws = wb.getWorksheet('MILKMAN');
  assert.equal(ws.getCell(HEADER_ROW, 1).value, 'Role');
  assert.equal(ws.getCell(HEADER_ROW, 2).value, 'Name of individual');
  // And the first deal sits immediately under them.
  assert.equal(ws.getCell(FIRST_DEAL_ROW, 2).value, 'Neo');
});

/** The tab's rows as [label in A, figure in B], from the first deal down. */
function readTab(wb, name, { from = FIRST_DEAL_ROW } = {}) {
  const ws = wb.getWorksheet(name);
  const out = [];
  for (let r = from; r <= ws.rowCount; r++) {
    out.push([ws.getCell(r, 1).value, ws.getCell(r, 2).value, ws.getCell(r, 3).value]);
  }
  return out;
}

test('a company keeps its rows together, Director then Mid then KP', () => {
  // Arriving interleaved, the way `ORDER BY group_name, person_name` hands
  // them over: Monument's Director sorts eleven rows from its Mid.
  const wb = buildMasterSheetWorkbook([
    deal({ company: 'Monument Marketing', person_name: 'Drew', role: 'mid', seat: 1, role_label: 'Mid 1' }),
    deal({ company: 'Whitestone Swan', person_name: 'Fahim', role: 'mid', seat: 2, role_label: 'Mid 2' }),
    deal({ company: 'Monument Marketing', person_name: 'James King', role: 'director', seat: null, role_label: 'Director' }),
    deal({ company: 'Whitestone Swan', person_name: 'Shayne', role: 'director', seat: null, role_label: 'Director' }),
    deal({ company: 'Monument Marketing', person_name: 'TLL', role: 'kp', seat: 1, role_label: 'KP 1' }),
    deal({ company: 'Whitestone Swan', person_name: 'Neo', role: 'mid', seat: 1, role_label: 'Mid 1' }),
  ], { breakdown: false });

  assert.deepEqual(
    readTab(wb, 'MILKMAN').filter((r) => r[1]).map((r) => [r[2], r[0]]),
    [
      ['Monument Marketing', 'Director'],
      ['Monument Marketing', 'Mid 1'],
      ['Monument Marketing', 'KP 1'],
      ['Whitestone Swan', 'Director'],
      ['Whitestone Swan', 'Mid 1'],
      ['Whitestone Swan', 'Mid 2'],
    ],
  );
});

test('one company written two ways is one block, not two', () => {
  // Both spellings are in the live sheet.
  const wb = buildMasterSheetWorkbook([
    deal({ company: 'Relia PA', person_name: 'Craig', role: 'director', role_label: 'Director' }),
    deal({ company: 'Anteep Sourcing', person_name: 'Louis', role: 'director', role_label: 'Director' }),
    deal({ company: 'Relia Pa', person_name: 'Ryan', role: 'mid', seat: 2, role_label: 'Mid 2' }),
  ], { breakdown: false });

  assert.deepEqual(
    readTab(wb, 'MILKMAN').filter((r) => r[1]).map((r) => r[2]),
    ['Anteep Sourcing', 'Relia PA', 'Relia Pa'],
  );
});

// NAMED, not left to the default. These pin the STANDARD layout, and the
// default design is the converted one: a test that relies on whichever is
// default is really testing the default, and it broke the day that changed.
test('a group in ONE currency puts the figure on the location, with no currency row', () => {
  // His own shape, 2026-09-13. The GBP row under every location repeated a
  // code the whole block already carries and pushed each figure an indent
  // away from the place the cash is going.
  const wb = buildMasterSheetWorkbook([
    deal({ payment_method: 'cash', location: 'South East', payable_amount: 1000 }),
    deal({ payment_method: 'cash', location: 'Abu Dhabi', payable_amount: 250, person_name: 'Fahim' }),
    deal({ payment_method: 'bank', location: 'Main City', payable_amount: 500, person_name: 'Ruth' }),
  ], { breakdownDesign: 'standard' });
  const rows = readTab(wb, 'MILKMAN');
  const at = rows.findIndex((r) => r[0] === 'Row Labels');
  const block = rows.slice(at).filter((r) => r[0] != null).map((r) => [r[0], r[1]]);

  assert.deepEqual(block, [
    ['Row Labels', 'Sum of Payable amount:'],
    ['Bank', null],
    ['Main City', 500],
    ['Bank Total', 500],
    ['Cash', null],
    ['Abu Dhabi', 250],
    ['South East', 1000],
    ['Cash Total', 1250],
    ['Grand Total', 1750],
  ]);
});

test('STANDARD keeps method, location and currency with several currencies', () => {
  /**
   * HIS OWN SHAPE IS `nexus august.xlsx`, which is GBP only, so a multi
   * currency group in this layout has no precedent of his. Decided
   * 2026-09-12: the block is unchanged and only the TOTALS gather, one
   * line for one currency and a heading with currency rows for several.
   *
   * The currency-first summary he DOES write for such groups is stage 1
   * now; see breakdowns/simple.js.
   */
  const wb = buildMasterSheetWorkbook([
    deal({ currency: 'GBP', payment_method: 'cash', location: 'South east', payable_amount: 1000 }),
    deal({ currency: 'GBP', payment_method: 'bank', location: 'Main City', payable_amount: 500, person_name: 'Ruth' }),
    deal({ currency: 'AED', payment_method: 'cash', location: 'Abu Dhabi', payable_amount: 3675, person_name: 'Zayn' }),
  ], { breakdownDesign: 'standard' });
  const rows = readTab(wb, 'MILKMAN');
  const at = rows.findIndex((r) => r[0] === 'Row Labels');
  const block = rows.slice(at).filter((r) => r[0] != null).map((r) => [r[0], r[1]]);

  assert.deepEqual(block, [
    ['Row Labels', 'Sum of Payable amount:'],
    ['Bank', null],
    ['Main City', null],
    ['GBP', 500],
    ['Bank Total', 500],
    ['Cash', null],
    ['Abu Dhabi', null],
    ['AED', 3675],
    ['South east', null],
    ['GBP', 1000],
    ['Cash Total', null],
    ['AED', 3675],
    ['GBP', 1000],
    ['Grand Total', null],
    ['AED', 3675],
    ['GBP', 1500],
  ]);

  // Location survives, which is the point of stage 2.
  assert.ok(block.some(([l]) => l === 'South east'));
  // And one currency in a block still reads on one line.
  assert.deepEqual(block.find(([l]) => l === 'Bank Total'), ['Bank Total', 500]);
});/**
 * THE PRESET IS THE BOSS'S. It comes in as the sheet writes it, it goes out
 * as he left it, and only rows marked for the run's month are in its total.
 */
const { rollToMonth } = require('./rollToMonth');

const forMonth = (preset, over) => ({
  group_name: 'MILKMAN', person_name: 'Nathan', company: 'Acme', role: 'mid',
  role_label: 'Mid 1', currency: 'GBP', payment_method: 'cash', status: 'active',
  payment_period: 'active', preset_on: preset, payable_days: 31,
  payable_amount: 1000, monthly_amount: 1000, ...over,
});

test('an export never rewrites the preset, nor the figures under it', () => {
  const rows = [forMonth('2026-09-01'), forMonth('2024-09-01', { person_name: 'Louis' })];
  for (const month of ['2026-08', '2026-12']) {
    const out = rollToMonth(rows, month).rows;
    assert.deepEqual(out.map((r) => r.preset_on), ['2026-09-01', '2024-09-01'], month);
    assert.deepEqual(out.map((r) => r.payable_amount), [1000, 1000], month);
  }
});

test('only rows whose own preset is the run month are in the total', () => {
  const rows = [
    forMonth('2026-08-01', { person_name: 'August' }),
    forMonth('2026-09-01', { person_name: 'September' }),
    forMonth('2024-09-01', { person_name: 'Ancient' }),
    // No preset: the standing roster, owed every month.
    forMonth(null, { person_name: 'Roster' }),
  ];
  const { rows: out, stats } = rollToMonth(rows, '2026-08');
  assert.deepEqual(out.map((r) => r.for_this_month), [true, false, false, true]);
  assert.equal(stats.otherMonth, 2);

  const wb = buildMasterSheetWorkbook(out, { groupTotals: true });
  const labels = readTab(wb, 'MILKMAN').filter((r) => r[0] != null);
  // 1000 + 1000. September and 2024 are on the sheet and out of the figure.
  assert.ok(labels.some(([l, v]) => l === 'GBP' && v === 2000), JSON.stringify(labels));
});

test('ended is decided against the month generated, not against today', () => {
  // Every end date in the live data is 2026-09-30. Measured against today
  // a December run called them active and paid the whole roster a full
  // month, so the test is on the MONTH.
  const row = forMonth('2026-12-01', { end_on: '2026-09-30' });
  const ended = (month) => rollToMonth([row], month, { useEndDate: true }).rows[0].period_ended;

  assert.equal(ended('2026-09'), false, 'payable for all of the month it ends in');
  assert.equal(ended('2026-10'), true);
  assert.equal(ended('2026-12'), true);
});

test('AN END DATE ALONE NEVER DROPS A ROW: the toggle decides', () => {
  // The same row, the same months, the setting off. It read `end_on`
  // directly and unconditionally, which is the rule that cut ten MILKMAN
  // deals and 6,500 the boss's own August sheet pays, and which took
  // A J Rayson off NEXUS's Active company list.
  const row = forMonth('2026-12-01', { end_on: '2026-09-30' });
  for (const month of ['2026-09', '2026-10', '2026-12']) {
    assert.equal(rollToMonth([row], month).rows[0].period_ended, false, month);
  }
});

test('a payment start AFTER the month is NOT ended, it has not begun', () => {
  // The two are one red cell and two different facts. Reading "not owed"
  // as "ended" took Umbrella UK Holdings and Churchill Knight, whose deals
  // start in November and October, off INDIGO's Active company list on the
  // August sheet, which is why his list had 17 rows and ours 12.
  const row = forMonth('2026-08-01', { payment_start_on: '2026-11-01', end_on: null });
  for (const useEndDate of [false, true]) {
    assert.equal(
      rollToMonth([row], '2026-08', { useEndDate }).rows[0].period_ended,
      false, String(useEndDate),
    );
  }
});

test('A HAND-SET STATUS IS IGNORED HERE TOO, or the file disagrees with itself', () => {
  // rollToMonth stamps `period_ended`, which the export warnings read to
  // decide what to skip, while the tint and the totals read
  // countsTowardTotal. The override was in one and not the other, so a row
  // was skipped from the panel with its money still in the total.
  // Removed 2026-09-09.
  const row = forMonth('2026-08-01', {
    payment_start_on: '2025-01-01', end_on: null,
    status: 'ended', manually_overridden_fields: ['status'],
  });
  assert.equal(rollToMonth([row], '2026-08').rows[0].period_ended, false);
});
