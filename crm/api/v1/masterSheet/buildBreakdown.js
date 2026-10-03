const ExcelJS = require('exceljs');
const { scrubWorkbook } = require('../shared/scrubWorkbook.helper');

/**
 * What each person earns this month, from each company they handle.
 *
 * This is the question the whole system exists to answer, and it falls
 * straight out of the shape the data already has:
 *
 *     a company has one or many handlers
 *     a person handles one or many companies
 *     each of those pairings pays them a monthly amount
 *
 * So a person's earnings are the sum of their deals, and the breakdown is
 * simply those deals listed with their arithmetic shown. Nothing is
 * derived from anybody else's figure — 20 of the 28 multi-handler
 * companies in the real sheet pay their handlers different negotiated
 * amounts, so there is no share to split and no cascade to model.
 *
 * Different job from buildWorkbook.js, which produces a drop-in
 * replacement for the team's own master sheet (25 columns, their headers,
 * their order). This one is for reading: how much, from where, and how it
 * was worked out — plus how to actually pay them.
 *
 * TOTALS ARE PER CURRENCY AND NEVER BLENDED. The roster is paid in GBP,
 * AED and EURO; one summed number across the three would be meaningless,
 * and worse, would look authoritative.
 */

const TITLE_FONT = { bold: true, size: 13 };
const LABEL_FONT = { bold: true, size: 9, color: { argb: 'FF6B7484' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EFE8' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F2' } };
const REVIEW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCEEE0' } };
const RULE = { bottom: { style: 'thin', color: { argb: 'FFDCDFE5' } } };

const METHOD_LABELS = { bank: 'Bank Transfer', cash: 'Cash', crypto: 'Crypto' };

// The columns of a person's earnings table. The two middle ones exist so
// the payable amount is checkable by hand rather than taken on trust.
const COLUMNS = [
  { header: 'Company', width: 34 },
  { header: 'Group', width: 14 },
  { header: 'Role', width: 14 },
  { header: 'Monthly', width: 14 },
  { header: 'Days in month', width: 14 },
  { header: 'Payable days', width: 13 },
  { header: 'Earns this month', width: 17 },
  { header: 'Currency', width: 10 },
  { header: 'Method', width: 15 },
  { header: 'Status', width: 10 },
];

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function daysInPresetMonth(presetOn) {
  if (!presetOn) return '';
  const d = presetOn instanceof Date ? presetOn : new Date(presetOn);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// One value when every deal agrees, a joined list when they don't. A
// person's bank details legitimately differ between their deals in the
// real sheet, and picking the first would be a quiet lie on a document
// somebody pays from.
function distinct(rows, key) {
  const set = [...new Set(rows.map((r) => String(r[key] ?? '').trim()).filter(Boolean))];
  return set.length === 0 ? '—' : set.join(' · ');
}

function money(sheet, cell, currency) {
  // Currency codes in the sheet aren't always ISO (EURO, not EUR), so the
  // format string uses the code as a literal prefix rather than a locale.
  cell.numFmt = currency === 'GBP' ? '£#,##0.00' : `#,##0.00" ${currency}"`;
}

/** Writes one person's block, returns the next free row. */
function writePerson(sheet, rows, startRow) {
  const person = rows[0];
  let r = startRow;

  const title = sheet.getCell(r, 1);
  title.value = person.person_name;
  title.font = TITLE_FONT;
  r += 1;

  // HOW TO PAY THEM. The reason this document is worth printing rather
  // than just reading off a screen.
  const facts = [
    ['Phone', distinct(rows, 'phone')],
    ['Method', [...new Set(rows.map((x) => METHOD_LABELS[x.payment_method] ?? x.payment_method))].join(' · ')],
    ['Bank', distinct(rows, 'bank_details')],
    ['Account number', distinct(rows, 'account_number')],
    ['Sort code', distinct(rows, 'sort_code')],
  ];
  for (const [label, value] of facts) {
    sheet.getCell(r, 1).value = label;
    sheet.getCell(r, 1).font = LABEL_FONT;
    sheet.getCell(r, 2).value = value;
    r += 1;
  }
  r += 1;

  const head = sheet.getRow(r);
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER_FILL;
  });
  r += 1;

  for (const d of rows) {
    const row = sheet.getRow(r);
    row.getCell(1).value = d.company ?? '—';
    row.getCell(2).value = d.group_name;
    row.getCell(3).value = d.role_label;
    row.getCell(4).value = toNumber(d.monthly_amount);
    row.getCell(5).value = daysInPresetMonth(d.preset_on);
    row.getCell(6).value = d.payable_days;
    row.getCell(7).value = toNumber(d.payable_amount);
    row.getCell(8).value = d.currency;
    row.getCell(9).value = METHOD_LABELS[d.payment_method] ?? d.payment_method;
    row.getCell(10).value = d.status;
    money(sheet, row.getCell(4), d.currency);
    money(sheet, row.getCell(7), d.currency);
    row.border = RULE;
    // A deal the importer could not fully resolve is tinted rather than
    // dropped — an incomplete deal still has to show up, or someone gets
    // left off a payout sheet by a parsing problem.
    if (d.needs_review) row.fill = REVIEW_FILL;
    r += 1;
  }

  const byCurrency = new Map();
  for (const d of rows) {
    const c = d.currency || 'GBP';
    byCurrency.set(c, (byCurrency.get(c) ?? 0) + toNumber(d.payable_amount));
  }
  for (const [currency, total] of byCurrency) {
    const row = sheet.getRow(r);
    row.getCell(6).value = 'TOTAL';
    row.getCell(7).value = Math.round(total * 100) / 100;
    row.getCell(8).value = currency;
    money(sheet, row.getCell(7), currency);
    row.font = { bold: true };
    row.fill = TOTAL_FILL;
    r += 1;
  }

  return r + 2;
}

/**
 * @param {object[]} rows  deals, any number of people
 * @param {{ splitByPerson?: boolean }} opts
 *   splitByPerson gives each person their own worksheet tab — right for a
 *   handful, wrong for 67, so the caller decides.
 */
function buildBreakdownWorkbook(rows, { splitByPerson = false } = {}) {
  const wb = new ExcelJS.Workbook();

  // Grouped by person, and each person's companies kept together — that
  // is the whole point of this document.
  const byPerson = new Map();
  for (const d of rows) {
    if (!byPerson.has(d.person_id)) byPerson.set(d.person_id, []);
    byPerson.get(d.person_id).push(d);
  }
  const people = [...byPerson.entries()].sort((a, b) =>
    String(a[1][0].person_name).localeCompare(String(b[1][0].person_name)),
  );

  if (splitByPerson) {
    for (const [, deals] of people) {
      // Excel caps sheet names at 31 chars and rejects several characters
      // outright, so the name is sanitised rather than trusted.
      const name = String(deals[0].person_name).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
      const sheet = wb.addWorksheet(name || 'Person');
      COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });
      writePerson(sheet, deals, 1);
    }
    return scrubWorkbook(wb);
  }

  const sheet = wb.addWorksheet('Breakdown');
  COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width; });
  let r = 1;
  for (const [, deals] of people) r = writePerson(sheet, deals, r);

  return scrubWorkbook(wb);
}

module.exports = { buildBreakdownWorkbook, BREAKDOWN_COLUMNS: COLUMNS };
