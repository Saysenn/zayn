const ExcelJS = require('exceljs');
const { COLUMNS, DERIVED, columnsFrom, paletteFor } = require('./expenseColumns');

// ***************************************************
// * The expenses month, as a sheet
// ***************************************************
//
// A FLAT LIST, not the master sheet's workbook: no tab per group, no
// rollToMonth, no breakdown blocks. A ledger is a list, and building it
// through the workbook builder would tie two exports that answer different
// questions together.
//
// Re-importable: the headers are `expenseColumns.js`, which the parser
// reads back.

const MONEY_FMT = '#,##0.00';
// Eight, because a weak currency's rate is 0.06443000 and rounding it in
// the file would come back as a different rate on the next import.
const RATE_FMT = '0.00000000';

const SHEET_NAME = 'Expenses';

function valueFor(row, column) {
  const raw = row[column.field];
  if (raw === null || raw === undefined || raw === '') return null;
  if (column.type === 'date') return new Date(raw);
  if (column.type === 'money' || column.type === 'rate') return Number(raw);
  return String(raw);
}

/**
 * @param {object[]} rows snake_case rows straight off the repo.
 * @param {{month?: string, columns?: string[], palette?: string, title?: string}} opts
 */
function buildExpenseSheet(rows, {
  month, columns, palette, title,
} = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title ?? (month ? `${SHEET_NAME} ${month}` : SHEET_NAME));

  // Untickable columns only; the date and the description always survive,
  // or the file is a list of amounts belonging to nothing.
  const all = columnsFrom(columns);
  const skin = paletteFor(palette);
  sheet.columns = all.map((c) => ({ header: c.header, key: c.field, width: c.width }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: skin.ink } };
  if (skin.fill) {
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: skin.fill } };
  }

  // camelCase in the sheet's own terms, read off the snake_case row.
  const asField = (row) => ({
    spentOn: row.spent_on,
    description: row.description,
    payee: row.payee,
    groupName: row.group_name,
    spentBy: row.spent_by,
    currency: row.currency,
    rawAmount: row.raw_amount,
    exchangeRate: row.exchange_rate,
    aedAmount: row.aed_amount,
  });

  for (const row of rows) {
    const source = asField(row);
    sheet.addRow(all.map((c) => valueFor(source, c)));
  }

  for (const column of all) {
    if (column.type === 'money' || column.type === 'rate') {
      sheet.getColumn(column.field).numFmt = column.type === 'rate' ? RATE_FMT : MONEY_FMT;
    }
    if (column.type === 'date') sheet.getColumn(column.field).numFmt = 'dd/mm/yyyy';
  }

  // A total the reader can check against the page, on the AED column only:
  // raw amounts in four currencies do not add up to anything. Only when
  // that column was actually picked.
  const aedIndex = all.findIndex((c) => c.field === 'aedAmount');
  if (rows.length > 0 && aedIndex > 0) {
    const letter = sheet.getColumn('aedAmount').letter;
    const total = sheet.addRow([]);
    total.getCell(aedIndex).value = 'Total';
    total.getCell(aedIndex + 1).value = { formula: `SUM(${letter}2:${letter}${rows.length + 1})` };
    total.font = { bold: true, color: { argb: skin.ink } };
    total.getCell(aedIndex + 1).numFmt = MONEY_FMT;
  }

  return workbook;
}

module.exports = { buildExpenseSheet, SHEET_NAME };
