const test = require('node:test');
const assert = require('node:assert');

const { buildMasterSheetWorkbook } = require('./buildWorkbook');
const { parseMasterSheetImport } = require('./parseImport');
const { exportWarnings } = require('./exportWarnings');
const { sheetNameFor } = require('./sheetName');
const { suggestDates } = require('../shared/suggestDates.helper');
const { recomputePayable } = require('../shared/recomputePayable.helper');

/**
 * ***************************************************
 * * A GROUP THE CRM HAS NEVER SEEN
 * ***************************************************
 *
 * Nothing enumerates groups. They are `SELECT DISTINCT group_name` and they
 * arrive by being written in a sheet, so a new one has to work everywhere
 * on the day it appears with no code change. These pin that.
 *
 * `GROUP_ORDER` in buildWorkbook is the one place group names are typed,
 * and it decides TAB ORDER only: an unknown group sorts alphabetically
 * after the known ones rather than being dropped.
 *
 * The illegal character cases are a real fault found 2026-09-08. Excel
 * refuses seven characters in a sheet name and exceljs THROWS on them, so a
 * group called `TAKEOFF / OLD` did not make an odd tab, it took the whole
 * export down with a 500 and nothing said which group did it.
 */

const NEW_GROUPS = ['RECLAIMS', 'ALL BOOKS', 'JARVIS'];

const deal = (group, over = {}) => ({
  id: 1,
  group_name: group,
  person_name: 'Rae Example',
  role_label: 'Director',
  company: 'Monument',
  assigned_on: '2026-01-20',
  payment_start_on: '2026-04-20',
  end_on: '2027-01-20',
  preset_on: '2026-07-01',
  monthly_amount: 1000,
  payable_days: 31,
  payable_amount: 1000,
  currency: 'GBP',
  payment_method: 'cash',
  payment_period: 'active',
  status: 'active',
  ...over,
});

test('a brand new group gets its own tab, named after it', async () => {
  const wb = await buildMasterSheetWorkbook(NEW_GROUPS.map((g) => deal(g)));
  const tabs = wb.worksheets.map((w) => w.name).sort();
  assert.deepEqual(tabs, ['ALL BOOKS', 'JARVIS', 'RECLAIMS']);
});

test('an unknown group sorts after the known ones rather than vanishing', async () => {
  const wb = await buildMasterSheetWorkbook([deal('JARVIS'), deal('NEXUS'), deal('RECLAIMS')]);
  const tabs = wb.worksheets.map((w) => w.name);
  assert.equal(tabs[0], 'NEXUS', 'GROUP_ORDER still leads');
  assert.deepEqual(tabs.slice(1), ['JARVIS', 'RECLAIMS'], 'then alphabetical');
});

test('the warnings panel groups a new group like any other', () => {
  const rows = NEW_GROUPS.map((g) => deal(g, { end_on: null }));
  const found = exportWarnings(rows, { month: '2026-07' })
    .filter((w) => w.kind === 'derivable-dates')
    .map((w) => w.group)
    .sort();
  assert.deepEqual(found, ['ALL BOOKS', 'JARVIS', 'RECLAIMS']);
});

test('suggestions and the cascade do not care what a group is called', () => {
  for (const g of NEW_GROUPS) {
    const row = deal(g, { end_on: null });
    assert.deepEqual(suggestDates(row).fields, { endOn: '2027-01-20' });

    const fields = { assignedOn: '2026-04-15' };
    recomputePayable(row, fields);
    assert.equal(fields.endOn, '2027-04-15');
    assert.equal(fields.payableAmount, 580.65);
  }
});

/**
 * ===============================
 * * ILLEGAL CHARACTERS TOOK THE WHOLE EXPORT DOWN
 * ===============================
 */

const ILLEGAL_NAMES = ['RECLAIMS / OLD', 'BOOKS [2026]', 'TAKE*OFF', 'WHAT?', 'A:B', 'X\\Y'];

test('a group name Excel refuses no longer throws', async () => {
  for (const g of ILLEGAL_NAMES) {
    // Would have rejected with "cannot include any of the following
    // characters", killing the download rather than one tab.
    const wb = await buildMasterSheetWorkbook([deal(g)]);
    assert.equal(wb.worksheets.length, 1, `${g} produced no tab`);
  }
});

test('a name longer than Excel allows is cut to 31', () => {
  const { name } = sheetNameFor('A'.repeat(40), new Set());
  assert.equal(name.length, 31);
});

test('TWO groups that clean to the same tab do not collide', () => {
  // exceljs throws on a duplicate tab exactly as it does on an illegal
  // character, so this was the same crash by another route. Numbered
  // rather than dropped: a missing tab is a missing payout.
  const taken = new Set();
  assert.equal(sheetNameFor('BOOKS / A', taken).name, 'BOOKS A');
  assert.equal(sheetNameFor('BOOKS ? A', taken).name, 'BOOKS A 2');
});

test('a name that is nothing but punctuation still gets a tab', () => {
  assert.equal(sheetNameFor('///', new Set()).name, 'GROUP');
});

/**
 * ===============================
 * * THE ROUND TRIP IS THE POINT
 * ===============================
 * On a per group tab the tab IS the group: there is no Group column and
 * parseImport reads the worksheet name. So a RENAMED tab would re-import
 * its rows under a different group, and the group is part of a deal's
 * identity, which means every row would come back as a duplicate.
 *
 * When the name has to change, the Group column goes back on that tab, and
 * a Group column beats the worksheet name on the way in.
 */

test('a renamed tab carries the Group column so the group survives', async () => {
  const wb = await buildMasterSheetWorkbook([deal('RECLAIMS / OLD')]);
  const headers = wb.worksheets[0].getRow(1).values.filter(Boolean);
  assert.equal(headers[0], 'Group');
});

test('and a tab that kept its name does NOT gain the column', async () => {
  // The tab is the group by design; repeating it down every row is noise.
  const wb = await buildMasterSheetWorkbook([deal('RECLAIMS')]);
  const headers = wb.worksheets[0].getRow(1).values.filter(Boolean);
  assert.notEqual(headers[0], 'Group');
});

test('EVERY new group re-uploads into the group it came from', async () => {
  for (const g of [...NEW_GROUPS, ...ILLEGAL_NAMES]) {
    const wb = await buildMasterSheetWorkbook([deal(g)]);
    const { rows } = await parseMasterSheetImport(Buffer.from(await wb.xlsx.writeBuffer()));
    assert.equal(rows.length, 1, `${g} lost its row`);
    assert.equal(
      rows[0].groupName, g.toUpperCase(),
      `${g} came back as ${rows[0].groupName}, which is a different deal`,
    );
  }
});
