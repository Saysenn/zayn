const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ExcelJS = require('exceljs');

const { activeCompanies } = require('./groupTables');
const { parseMasterSheetImport } = require('./parseImport');
const { fold } = require('./dealKey');
const fs = require('node:fs');

/**
 * ***************************************************
 * * Workforce is staff, never a client company
 * ***************************************************
 *
 * Pinned against his real file: the Active company list he writes by hand
 * is the contract, and it never carries a Workforce in any spelling.
 */

const REAL = path.join(__dirname, '..', '..', '..', '..', 'docs', 'boss', 'references');

const deal = (over) => ({
  group_name: 'NEXUS', company: 'A J Rayson', person_name: 'Juan Estrada',
  role: 'director', seat: null, role_label: 'Director',
  preset_on: '2026-08-01', end_on: null, payment_start_on: '2025-06-04',
  status: 'active', ...over,
});

const names = (rows) => activeCompanies(rows).map((c) => c.company);

test('a bare Workforce is not a company', () => {
  assert.deepEqual(names([deal(), deal({ company: 'Workforce', person_name: 'Zayn' })]), ['A J Rayson']);
});

test("NEXUS's `Name - Workforce` is not a company either", () => {
  const rows = [
    deal(),
    deal({ company: 'Pino - Workforce', person_name: 'Pino', role: 'admin', role_label: 'Admin' }),
    deal({ company: 'Gloria - Workforce', person_name: 'Gloria', role: 'closure', role_label: 'Closure' }),
  ];
  assert.deepEqual(names(rows), ['A J Rayson']);
});

test('a real company keeps the word when it is not the whole tail', () => {
  // Anchored on purpose. Dropping a client because its name ends in a word
  // is a worse failure than listing one that should not be there.
  const keep = ['Workforce Solutions', 'Reliapay Workforce Ltd', 'Workforce UK'];
  for (const company of keep) {
    assert.deepEqual(names([deal({ company })]), [company], company);
  }
});

test('an internal row still counts, it is only off THIS table', () => {
  // The exclusion must never reach money. Same rows, one table drops two.
  const rows = [
    deal(),
    deal({ company: 'Pino - Workforce', person_name: 'Pino', role: 'admin' }),
  ];
  assert.equal(names(rows).length, 1);
  assert.equal(rows.length, 2, 'the caller still holds both deals');
});

test('an ended internal row changes nothing', () => {
  assert.deepEqual(names([deal({ company: 'Workforce', status: 'ended', preset_on: '2020-01-01' })]), []);
});

test('neither list carries a Workforce, in any of his files', async () => {
  // THE CONTRACT, through the REAL parser: his own hand-written Active
  // company list is the authority, and ours must agree about Workforce.
  // Only about Workforce: his two columns spell some names differently
  // ("Red Horizon" against "Red Horizon Resourcing"), which is his data.
  for (const file of ['nexus august.xlsx', 'milkman august.xlsx', 'indigo 1 august.xlsx']) {
    const parsed = await parseMasterSheetImport(fs.readFileSync(path.join(REAL, file)), { filename: file });
    const rows = parsed.rows.map((r) => deal({
      company: r.company, person_name: r.personName, role: r.role,
      preset_on: r.presetOn, payment_start_on: r.paymentStartOn,
      end_on: r.endOn, status: r.status,
    }));

    assert.ok(parsed.companies.length > 0, `${file} carries an Active company list`);
    for (const c of parsed.companies) {
      assert.ok(!/workforce/i.test(c.company), `${file}: HIS list has ${c.company}`);
    }
    for (const name of names(rows)) {
      assert.ok(!/workforce/i.test(name), `${file}: OUR table has ${name}`);
    }
  }
});

test('NEXUS now matches his list exactly, which is the case this fixed', async () => {
  const file = 'nexus august.xlsx';
  const parsed = await parseMasterSheetImport(fs.readFileSync(path.join(REAL, file)), { filename: file });
  const rows = parsed.rows.map((r) => deal({
    company: r.company, person_name: r.personName, role: r.role,
    preset_on: r.presetOn, payment_start_on: r.paymentStartOn,
    end_on: r.endOn, status: r.status,
  }));
  assert.deepEqual(names(rows).map(fold).sort(), parsed.companies.map((c) => fold(c.company)).sort());
  assert.equal(names(rows).length, 2);
});

test('it lands on HIS list: 14 companies, against his real INDIGO file', async () => {
  // His 17 rows are 16 distinct, and those 16 are the same 14 companies
  // once CKU + CKAssociates + Umbrella Co UK fold into the one
  // `SG, CKA, CKU, Umbrella co` his own deal rows name. The two that used
  // to be missing start in October and November, and a company whose deals
  // begin later is still an active company.
  const { rollToMonth } = require('./rollToMonth');
  const parsed = await parseMasterSheetImport(
    fs.readFileSync(path.join(REAL, 'indigo 1 august.xlsx')),
    { filename: 'indigo 1 august.xlsx' },
  );
  const rows = parsed.rows.map((r) => deal({
    company: r.company, person_name: r.personName, role: r.role,
    preset_on: r.presetOn, payment_start_on: r.paymentStartOn,
    end_on: r.endOn, status: r.status,
  }));
  const names = activeCompanies(rollToMonth(rows, '2026-08').rows).map((c) => c.company);

  assert.equal(names.length, 14, names.join(' | '));
  for (const carried of ['Umbrella UK Holdings', 'Churchill Knight employment']) {
    assert.ok(names.includes(carried), `${carried} is on his list and must be on ours`);
  }
  assert.ok(!names.some((n) => /workforce/i.test(n)), 'Workforce is staff, never a client');
});
