const test = require('node:test');
const assert = require('node:assert');
const {
  readTable, compare, toPlan, looksLikeSheet, numberIn, dateIn,
} = require('./sheetCheck');

const deal = (id, person, group, company, monthly, extra = {}) => ({
  id, person_name: person, group_name: group, company, monthly_amount: String(monthly), payable_amount: String(monthly),
  payable_days: 31, currency: 'AED', payment_method: 'cash', role_label: 'Tech', stopped_on: null, ...extra,
});
const DEALS = [
  deal(1, 'Zayn', 'INDIGO', 'Workforce', 4000),
  deal(2, 'Zayn', 'MILKMAN', 'Workforce', 4000),
  deal(3, 'Paddy', 'ALL GROUPS', 'Workforce', 13500),
  deal(4, 'Gary', 'MANBAT', 'KP', 6250),
  deal(5, 'Hypz', 'MANBAT', 'Kryptonia', 1000),
  deal(6, 'Juno', 'MANBAT', 'Workforce', 900),
];
const GROUPS = ['INDIGO', 'MILKMAN', 'ALL GROUPS', 'MANBAT'];

test('A TABLE IS READ BY CODE, every line accounted for', () => {
  const text = 'Name\tGroup\tCompany\tMonthly\tDays\nZayn\tINDIGO\tWorkforce\tAED 4,100\t31\nPaddy\tALL GROUPS\tWorkforce\t13,500\t31\nTotal\t\t\t17,600\t';
  const read = readTable(text);
  assert.equal(read.rows.length, 2);
  assert.deepEqual(read.rows[0], { line: 2, text: read.rows[0].text, sheet: null, person: 'Zayn', group: 'INDIGO', company: 'Workforce', monthlyAmount: 4100, currency: 'AED', payableDays: 31 });
  assert.equal(read.unread.length, 0, 'the total row is understood, not unread');
  assert.equal(readTable('hi diane\nadd 100 to zayn'), null, 'no header row: not a table');
});

test('THEIR ROWS AGAINST OURS: different, new, missing, and only in the groups they sent', () => {
  const read = readTable('Name,Group,Company,Monthly\nZayn,INDIGO,Workforce,4100\nZayn,MILKMAN,Workforce,4000\nNew Person,INDIGO,Workforce,500\nGary,MANBAT,KP,6250\nHypz,MANBAT,Kryptonia,1000');
  const found = compare(read, DEALS, GROUPS);
  assert.deepEqual(found.mismatched.map((m) => [m.deal.id, m.diffs.map((d) => `${d.field} ${d.ours}->${d.theirs}`)]), [[1, ['monthlyAmount 4000->4100']]]);
  assert.deepEqual(found.notOnSheet.map((r) => r.person), ['New Person']);
  assert.deepEqual(found.missing.map((d) => d.person_name), ['Juno'], 'Juno is in MANBAT, which they sent');
  assert.ok(!found.missing.some((d) => d.person_name === 'Paddy'), 'ALL GROUPS was not in their sheet, so Paddy is not missing');
  assert.deepEqual(found.notInTheirs, ['ALL GROUPS']);
});

test('A RENAMED GROUP is one rename, not every deal new', () => {
  const read = readTable('Name\tGroup\tCompany\tMonthly\nGary\tBATMAN\tKP\t6250\nHypz\tBATMAN\tKryptonia\t1000\nJuno\tBATMAN\tWorkforce\t900');
  const found = compare(read, DEALS, GROUPS);
  assert.deepEqual(found.renamed.map((r) => [r.from, r.to, r.deals.length]), [['MANBAT', 'BATMAN', 3]]);
  assert.equal(found.notOnSheet.length, 0);
  assert.equal(found.missing.length, 0);
  const plan = toPlan(found, 'sync');
  assert.equal(plan.steps.length, 1);
  assert.deepEqual(plan.steps[0].changes, [{ field: 'groupName', mode: 'set', value: 'BATMAN' }]);
  assert.deepEqual(plan.steps[0].ids, [4, 5, 6]);
});

test('A PERSON WITH TWO DEALS AND NO GROUP is shown as unclear, never guessed', () => {
  const found = compare(readTable('Name\tMonthly\nZayn\t4500'), DEALS, GROUPS);
  assert.equal(found.unmatched.length, 1);
  assert.equal(found.mismatched.length, 0);
});

test('THE PLAN: each fix a step, missing deals a stop, a new deal asks what it lacks', () => {
  const read = readTable('Name,Group,Company,Monthly\nZayn,INDIGO,Workforce,4100\nNew Person,INDIGO,,500\nGary,MANBAT,KP,6250\nHypz,MANBAT,Kryptonia,1000');
  const plan = toPlan(compare(read, DEALS, GROUPS), 'check');
  assert.deepEqual(plan.steps.map((s) => s.action), ['update', 'add_deal', 'stop']);
  assert.equal(plan.status, 'asking', 'the new deal has no company or role');
  assert.match(plan.steps[1].question, /company, roleLabel/);
});

test('NUMBERS, DATES AND PASTES are read the way they are written', () => {
  assert.equal(numberIn('AED 4,500.50'), 4500.5);
  assert.equal(numberIn('4.5k'), 4500);
  assert.equal(dateIn('01/10/2026'), '2026-10-01');
  assert.equal(dateIn('2026-10-01'), '2026-10-01');
  assert.equal(looksLikeSheet('add 100 to zayn'), false);
  assert.equal(looksLikeSheet('zayn indigo 4100\npaddy 13500\ngary manbat 6250'), true);
});

test('A FEW LINES ABOUT A GROUP never offer to stop the rest of it', () => {
  const found = compare(readTable('Name\tGroup\tCompany\tMonthly\nGary\tMANBAT\tKP\t6300'), DEALS, GROUPS);
  assert.equal(found.missing.length, 0, '1 of 3 MANBAT deals is not their MANBAT list');
  assert.deepEqual(found.partial, [{ group: 'MANBAT', matched: 1, total: 3 }]);
});

test('A COMPANY READ AS A ROLE is put back as the company', () => {
  const read = { rows: [{ line: 1, person: 'gary', group: 'MANBAT', roleLabel: 'kp', monthlyAmount: 6300 }], unread: [] };
  const found = compare(read, DEALS, GROUPS);
  assert.deepEqual(found.mismatched.map((m) => m.deal.id), [4]);
  assert.equal(found.notOnSheet.length, 0);
});

/**
 * THE PROOF, kept. 2026-10-06: his real master sheet went to the model for
 * 72 seconds and came back with 85 "changes". A sheet built by the CRM's own
 * download, read back by the CRM's own import, must compare as NOTHING
 * different; and five known edits to it must come back as exactly five.
 */
const { buildMasterSheetWorkbook } = require('../../masterSheet/buildWorkbook');
const { parseMasterSheetImport } = require('../../masterSheet/parseImport');
const { fromImportRows } = require('./sheetCheck');
const ExcelJS = require('exceljs');

const full = (id, person, group, company, role, monthly, extra = {}) => ({
  id, sync_key: `${group}|${company}|${role}|-|${person}`.toLowerCase(), source: 'synced', person_id: person.toLowerCase(),
  person_name: person, phone: '', role: role.toLowerCase(), seat: null, role_label: role, group_name: group, company,
  assigned_on: '2025-01-01', payment_start_on: '2025-04-01', preset_on: '2026-10-01', end_on: null, stopped_on: null,
  special_case_deal: false, payable_days: 31, monthly_amount: String(monthly), payable_amount: String(monthly), currency: 'GBP',
  payment_method: 'cash', location: 'South East', door_number: '', postcode: '', label: '', should_be_paid: '', paid: '', notes: '',
  bank_details: '', account_number: '', sort_code: '', accepting_postals: '', status: 'active', needs_review: false, review_reason: '',
  addon_percent: '0.00', fee_percent: '0.00', end_note: null, review_monthly: false, ...extra,
});
const SHEET = [
  full(1, 'Gary', 'MANBAT', 'KP', 'KP', 6250),
  full(2, 'James Heath', 'MANBAT', 'Kryptonia', 'Director', 1500),
  full(3, 'Smurf', 'MANBAT', 'Workforce', 'Admin', 500),
  full(4, 'Gloria', 'MANBAT', 'Workforce', 'Closer', 500),
  full(5, 'Klaud', 'MANBAT', 'Workforce', 'Visa', 1000),
  full(6, 'Paddy', 'INDIGO', 'Workforce', 'Tech', 13500),
  full(7, 'Leanne Wong', 'INDIGO', 'Ackerman', 'Director', 1100),
];
const SHEET_GROUPS = ['MANBAT', 'INDIGO'];
const readBack = async (buf) => {
  const parsed = await parseMasterSheetImport(buf, { filename: 'x.xlsx', knownGroups: SHEET_GROUPS });
  return compare(fromImportRows(parsed.rows, parsed.columns), SHEET, SHEET_GROUPS);
};

test('THE CRM\'S OWN SHEET, read back, is NOTHING different', async () => {
  const buf = Buffer.from(await buildMasterSheetWorkbook(SHEET).xlsx.writeBuffer());
  const found = await readBack(buf);
  assert.equal(found.read, SHEET.length);
  assert.deepEqual([found.mismatched.length, found.notOnSheet.length, found.missing.length, found.unmatched.length, found.renamed.length], [0, 0, 0, 0, 0]);
});

test('FIVE KNOWN EDITS come back as exactly those five', async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await buildMasterSheetWorkbook(SHEET).xlsx.writeBuffer()));
  for (const ws of book.worksheets) {
    const head = ws.getRow(1).values.map((v) => String(v ?? '').toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const NAME = col(/name of individual/);
    if (NAME < 0) continue;
    let gloria = null;
    let smurf = null;
    ws.eachRow((row, n) => {
      const name = String(row.getCell(NAME).value ?? '');
      if (name === 'Paddy') row.getCell(col(/^monthly amount/)).value = 14000;
      if (name === 'Klaud') row.getCell(col(/^preset date/)).value = new Date('2026-09-01T00:00:00Z');
      if (name === 'Gloria') gloria = { values: row.values.slice(1), at: n };
      if (name === 'Smurf') smurf = n;
    });
    if (gloria) {
      ws.spliceRows(gloria.at + 1, 0, gloria.values);
      ws.getRow(gloria.at + 1).getCell(NAME).value = 'Proof Newperson';
    }
    if (smurf) ws.spliceRows(smurf, 1);
    if (ws.name === 'MANBAT') ws.name = 'BATMAN';
  }
  const found = await readBack(Buffer.from(await book.xlsx.writeBuffer()));
  assert.deepEqual(found.mismatched.map((m) => `${m.deal.person_name} ${m.diffs.map((d) => d.field).join(',')}`).sort(), ['Klaud presetOn', 'Paddy monthlyAmount']);
  assert.deepEqual(found.notOnSheet.map((r) => `${r.person} ${r.group}`), ['Proof Newperson BATMAN'], 'a new deal in a renamed group lands under the NEW name');
  assert.deepEqual(found.missing.map((d) => d.person_name), ['Smurf']);
  assert.deepEqual(found.renamed.map((r) => `${r.from}>${r.to}`), ['MANBAT>BATMAN']);
  const plan = toPlan(found, 'check');
  assert.equal(plan.steps.find((s) => s.action === 'stop').deals[0].group, 'BATMAN', 'the stop finds Smurf under the group as renamed');
});

test('A EURO IS A EURO whichever way it is written: EUR, EURO, € and Euro are the same', () => {
  const euroDeal = [deal(9, 'Euro Boss', 'MANBAT', 'Gab', 1000, { currency: 'EURO' })];
  for (const written of ['EUR', 'EURO', '€', 'Euro']) {
    const found = compare({ rows: [{ line: 2, person: 'Euro Boss', group: 'MANBAT', company: 'Gab', currency: written }], unread: [] }, euroDeal, GROUPS);
    assert.equal(found.mismatched.length, 0, written);
  }
  const found = compare({ rows: [{ line: 2, person: 'Euro Boss', group: 'MANBAT', company: 'Gab', currency: 'GBP' }], unread: [] }, euroDeal, GROUPS);
  assert.equal(found.mismatched.length, 1, 'a real change of currency is still found');
});
