const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { parseMasterSheetImport } = require('./parseImport');
const { groupFromFilename } = require('./groupFromFilename');
const { statusFor } = require('./identity');
const { mappedFields } = require('../calculator/mapSheetRow');
const { paymentPeriodSql } = require('../shared/paymentPeriod.helper');

/**
 * The upload's two hardest-won rules, pinned.
 *
 *   a missing COLUMN is not an empty CELL   a sheet that never mentions
 *       end dates must not overwrite the ones the CRM holds. This went
 *       wrong silently and nothing recorded it, so it is worth a test that
 *       fails loudly instead.
 *
 *   no end date means ONGOING               a blank end date is not an
 *       ended deal. It is one nobody has put a finish on yet, and every
 *       layer has to agree about that or a person stops being paid.
 *
 * No database and no test framework: node's own runner, and the sheets are
 * built in memory with the ExcelJS already here. `npm test` in crm/api.
 */

const HEADERS = [
  'Group', 'Role:', 'Name of individual', 'Company in question',
  'Payment start date', 'Preset date', 'Monthly amount', 'Currency',
  'Method of payment', 'Provisional payment end date',
];

const ROW = [
  'INDIGO', 'Tech', 'Zayn', 'Workforce',
  new Date(Date.UTC(2026, 6, 1)), new Date(Date.UTC(2026, 6, 1)), 3675, 'AED',
  'cash', new Date(Date.UTC(2027, 5, 30)),
];

/**
 * A one-row sheet, optionally with some columns left out entirely.
 *
 * The tab name matters as much as the headers: a tab called INDIGO IS a
 * group, so dropping the Group column from one proves nothing. `tab`
 * defaults to a real group name because that is the ordinary case; the
 * ungrouped test passes 'Sheet1', which the parser treats as naming the
 * document rather than a group.
 */
async function sheetBuffer({ omit = [], tab = 'INDIGO' } = {}) {
  const keep = HEADERS.map((h, i) => i).filter((i) => !omit.includes(HEADERS[i]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(tab);
  ws.addRow(keep.map((i) => HEADERS[i]));
  ws.addRow(keep.map((i) => ROW[i]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * The parse result carries FIVE things, and the preview route uses all of
 * them. It destructured three and referred to the other two fifty lines
 * later, so every upload died on "hasCompanyTable is not defined" and the
 * whole diff was lost for the sake of an optional fifth tab.
 */
test('the parse hands back everything the preview reads', async () => {
  const parsed = await parseMasterSheetImport(await sheetBuffer());
  for (const key of ['rows', 'columns', 'stats', 'companies', 'hasCompanyTable']) {
    assert.ok(key in parsed, `parse must return ${key}`);
  }
});

test('preview warns about a repeated unrecognised sentinel shaped value', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INDIGO');
  ws.addRow([...HEADERS, 'Account number']);
  ws.addRow([...ROW, 'Paid outside payroll']);
  ws.addRow([...ROW.map((value, index) => (index === 2 ? 'Blake' : value)), 'Paid outside payroll']);

  const parsed = await parseMasterSheetImport(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.deepEqual(parsed.stats.sentinelWarnings, [{
    field: 'accountNumber',
    value: 'Paid outside payroll',
    rows: 2,
  }]);
});

test('known sentinels, numeric values and one off prose do not warn', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INDIGO');
  ws.addRow([...HEADERS, 'Account number']);
  ws.addRow([...ROW, 'Will never be bank']);
  ws.addRow([...ROW.map((value, index) => (index === 2 ? 'Blake' : value)), 'Will never be bank']);
  ws.addRow([...ROW.map((value, index) => (index === 2 ? 'Casey' : value)), '12345678']);
  ws.addRow([...ROW.map((value, index) => (index === 2 ? 'Jordan' : value)), 'One off note']);

  const parsed = await parseMasterSheetImport(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.deepEqual(parsed.stats.sentinelWarnings, []);
});

test('a file with no company block reports none rather than throwing', async () => {
  // The multi-group master is this case: 96 rows, no Active company list.
  const { hasCompanyTable, companies } = await parseMasterSheetImport(await sheetBuffer());
  assert.equal(hasCompanyTable, false);
  assert.deepEqual(companies, []);
});

test('an Active company list beside the deals is read, and its Status is our tier', async () => {
  // Merged into the deal table, which is how it arrives on two of his three
  // files: readSheets only splits side by side tables on a blank column.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INDIGO');
  ws.addRow([...HEADERS, 'Active company list', 'Director', 'Mid', 'Status']);
  ws.addRow([...ROW, 'Workforce', 'Zayn', 'Ann', 'Top Co']);
  ws.addRow([...ROW.map(() => null), 'Relia PA', 'Drew', '', 'T2']);

  const { hasCompanyTable, companies } = await parseMasterSheetImport(
    Buffer.from(await wb.xlsx.writeBuffer()),
  );
  assert.equal(hasCompanyTable, true);
  assert.deepEqual(
    companies.map((c) => [c.company, c.tier]),
    [['Workforce', 'Top Co'], ['Relia PA', 'T2']],
  );
});

test('a sheet WITH the end date column may write it', async () => {
  const { rows, columns } = await parseMasterSheetImport(await sheetBuffer());
  assert.equal(rows.length, 1);
  assert.ok(columns.includes('end_on'), 'end_on should be writable');
  assert.equal(rows[0].endOn, '2027-06-30');
});

test('a sheet WITHOUT the end date column may not write it', async () => {
  const { rows, columns, stats } = await parseMasterSheetImport(
    await sheetBuffer({ omit: ['Provisional payment end date'] }),
  );
  assert.equal(rows.length, 1);
  // The whole point: absent from the file, so absent from the SET list, so
  // whatever the CRM already holds survives.
  assert.ok(!columns.includes('end_on'), 'end_on must not be writable');
  // status is seeded FROM the end date, so it goes with it.
  assert.ok(!columns.includes('status'), 'status must not be writable either');
  assert.ok(stats.untouchedColumns.includes('end_on'), 'and it should be reported');
});

test('an absent column does not flag every row for review', async () => {
  const { rows } = await parseMasterSheetImport(
    await sheetBuffer({ omit: ['Company in question', 'Currency'] }),
  );
  // A sheet with no Company column is not 96 rows each missing a company.
  assert.equal(rows[0].needsReview, false, rows[0].reviewReason);
});

test('a column that IS present with an empty cell still counts', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INDIGO');
  ws.addRow(HEADERS);
  ws.addRow(ROW.map((v, i) => (HEADERS[i] === 'Provisional payment end date' ? null : v)));
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const { rows, columns } = await parseMasterSheetImport(buffer);
  assert.ok(columns.includes('end_on'), 'the file mentions end dates, so it may write them');
  assert.equal(rows[0].endOn, null, 'and this row says there is none');
});

test('the end date column is recognised under its other spellings', () => {
  for (const header of [
    'End date', 'Provisional payment end date', 'Payment end date',
    'Payment end', 'Provisional end date', 'End', 'Final payment date',
  ]) {
    assert.ok(mappedFields([header]).has('endOn'), `${header} should map to endOn`);
  }
});

test('a group with no column comes from the file name', () => {
  const groups = ['ALL GROUPS', 'INDIGO', 'MANBAT', 'MILKMAN', 'NEXUS'];

  // The real file that caused this: six Nexus deals, no Group column, a tab
  // called Sheet1, and the word sitting in the filename the whole time.
  assert.equal(groupFromFilename('August send for nexus Unpaid.xlsx', groups).group, 'NEXUS');

  // Only a group the CRM already has. A filename never invents one.
  assert.equal(groupFromFilename('August send for atlas.xlsx', groups).group, null);

  // Whole words. "MID" must not match "midlands", and a two-word group
  // needs both words in order.
  assert.equal(groupFromFilename('nexuses and midlands.xlsx', groups).group, null);
  assert.equal(groupFromFilename('all groups august.xlsx', groups).group, 'ALL GROUPS');

  // Two matches is a question for a human, not a coin toss.
  assert.equal(groupFromFilename('indigo and milkman.xlsx', groups).group, null);
  assert.match(groupFromFilename('indigo and milkman.xlsx', groups).reason, /2 groups/);
});

test('a row that ends up with no group is always flagged', async () => {
  const { rows, stats } = await parseMasterSheetImport(
    await sheetBuffer({ omit: ['Group'], tab: 'Sheet1' }),
    { filename: 'nothing in here.xlsx', knownGroups: ['NEXUS'] },
  );
  assert.equal(rows[0].groupName, 'UNKNOWN');
  assert.equal(stats.ungrouped, 1);
  // Unlike every other absent column: an absent group changes the row's
  // IDENTITY, so it silently duplicates the deal already stored properly.
  assert.equal(rows[0].needsReview, true);
  assert.match(rows[0].reviewReason, /no group/);
});

test('no end date means ongoing, at every layer', () => {
  assert.equal(statusFor(null), 'active');
  assert.equal(statusFor(undefined), 'active');
  // The "TBC" cells: a Date object holding no valid time.
  assert.equal(statusFor(new Date('nonsense')), 'active');
  // And the SQL that every page reads agrees, though it gets there another
  // way now: the period follows the PRESET FORMULA, so an end date only
  // ends anything when the Settings toggle lets it, and `end_on IS NOT
  // NULL` is the guard. A row with no end date can never take that branch.
  assert.match(paymentPeriodSql('d'), /end_on IS NOT NULL AND d\.end_on </);
  assert.match(paymentPeriodSql('d'), /color_uses_end_date/);
});

test('a default fills a column the file does not carry', async () => {
  const buffer = await sheetBuffer({ omit: ['Group', 'Currency'], tab: 'Sheet1' });

  const bare = await parseMasterSheetImport(buffer, { filename: 'x.xlsx' });
  assert.equal(bare.rows[0].groupName, 'UNKNOWN');
  assert.ok(!bare.columns.includes('currency'), 'absent, so not writable');

  const filled = await parseMasterSheetImport(buffer, {
    filename: 'x.xlsx',
    defaults: { group_name: 'NEXUS', currency: 'AED' },
  });
  assert.equal(filled.rows[0].groupName, 'NEXUS');
  assert.equal(filled.rows[0].currency, 'AED');
  // Told by a person is still being told, so the column becomes writable.
  assert.ok(filled.columns.includes('currency'), 'a filled column is writable');
  assert.ok(filled.rows[0].syncKey.startsWith('nexus|'), 'and it changes the identity');
});

test('a default never overwrites a value the row already has', async () => {
  const { rows } = await parseMasterSheetImport(await sheetBuffer(), {
    filename: 'x.xlsx',
    defaults: { currency: 'AED', group_name: 'MILKMAN' },
  });
  // The file says AED and INDIGO on this row. The file is the record.
  assert.equal(rows[0].currency, 'AED');
  assert.equal(rows[0].groupName, 'INDIGO');
});

test('a default that feeds the arithmetic recomputes it', async () => {
  // No preset date column at all, so the pro-rata has no month to divide by.
  const buffer = await sheetBuffer({ omit: ['Preset date'] });
  const bare = await parseMasterSheetImport(buffer, { filename: 'x.xlsx' });

  const filled = await parseMasterSheetImport(buffer, {
    filename: 'x.xlsx',
    // February: 28 days, so the same monthly amount over a shorter month.
    defaults: { preset_on: '2027-02-01' },
  });
  assert.equal(filled.rows[0].presetOn, '2027-02-01');
  // Payable DAYS is the evidence, not the amount: this deal started long
  // before that month, so the full monthly amount is owed either way. With
  // no preset month there is nothing to count days against and it is 0;
  // with February it is that month's 28. If the default only reached the
  // column and not computePayable, this would still be 0.
  assert.equal(bare.rows[0].payableDays, 0);
  assert.equal(filled.rows[0].payableDays, 28);
});

test('a row override beats the column default', async () => {
  const buffer = await sheetBuffer({ omit: ['Group'], tab: 'Sheet1' });
  const { rows } = await parseMasterSheetImport(buffer, {
    filename: 'x.xlsx',
    defaults: { group_name: 'NEXUS' },
    // Keyed by position in the file, not by sync_key: the key is built FROM
    // the group, so it changes the moment this is applied.
    overrides: { 0: { group_name: 'MILKMAN' } },
  });
  assert.equal(rows[0].groupName, 'MILKMAN');
  assert.equal(rows[0].uploadIndex, 0);
});

test('a file with no Notes column cannot clear a note', async () => {
  // The export writes no Notes column but does write Payment start date.
  // `notes` used to name paymentStartOn as a source, and writability is
  // decided per FILE, so any sheet with a payment start counted as having
  // an opinion on notes: re-uploading a generated sheet cleared the note
  // on 18 of 96 live rows.
  const { columns, stats } = await parseMasterSheetImport(
    await sheetBuffer({ omit: ['Provisional payment end date'] }),
  );
  assert.ok(!columns.includes('notes'), 'notes must not be writable');
  assert.ok(stats.untouchedColumns.includes('notes'));
});

test('a chosen column set narrows the file and keeps the four it needs', async () => {
  const { listExportColumns } = require('./buildWorkbook');
  const meta = listExportColumns();

  // The boss's own send layout: the twelve his file carries.
  const send = meta.filter((c) => c.inSend).map((c) => c.header);
  assert.deepEqual(send, [
    'Group', 'Role', 'Name of individual', 'Company in question',
    'Appointment date', 'Payment start date', 'Preset date',
    'Payable days this month', 'Method of payment', 'Monthly amount',
    'Payable amount', 'Currency', 'Location',
  ]);

  // Four are never offered: a file without them cannot be uploaded back.
  assert.deepEqual(
    meta.filter((c) => c.required).map((c) => c.key),
    ['group_name', 'role_label', 'person_name', 'company'],
  );
});
