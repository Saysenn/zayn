const ExcelJS = require('exceljs');
const { FIELD_FOR, fold } = require('./expenseColumns');
const { expenseKey } = require('./expenseIdentity');

// ***************************************************
// * An xlsx of expenses, into rows
// ***************************************************
//
// IN MEMORY, NEVER TO DISK, like the master sheet's own parse. Its only
// job is to be compared and then committed.
//
// PARSE DEFENSIVELY. Excel hands over Date objects with no valid time, and
// a money cell can arrive as a formula result, as text with a currency
// symbol, or as a number. None of those may become NaN in a total.

// How far down we look for the header row. A sheet with a title above the
// table is ordinary; a sheet with twenty is not a sheet of expenses.
const HEADER_SEARCH_ROWS = 10;

// The two fields without which a row is not an expense.
const REQUIRED = ['spentOn', 'rawAmount'];

/** A cell that may be a Date, a serial, or text. Never an Invalid Date. */
function safeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A cell that may carry a symbol, a comma, or a formula result. */
function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'object' && value !== null && 'result' in value
    ? value.result
    : value;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function safeText(value) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'object' && value !== null && 'result' in value
    ? value.result
    : value;
  // A rich text cell is an object with runs; its `text` is what was typed.
  const text = typeof raw === 'object' && raw !== null && 'text' in raw ? raw.text : raw;
  const trimmed = String(text ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** `YYYY-MM-DD`, because the column is a date and time is not part of it. */
const dayOf = (date) => (date ? date.toISOString().slice(0, 10) : null);

/**
 * The first row that names at least two columns we know.
 *
 * ONE is not enough: a title cell reading "Description of the month" would
 * pass and every row under it would parse as blank.
 */
function findHeader(sheet) {
  const limit = Math.min(HEADER_SEARCH_ROWS, sheet.rowCount);
  for (let number = 1; number <= limit; number += 1) {
    const row = sheet.getRow(number);
    const map = new Map();
    row.eachCell((cell, column) => {
      const field = FIELD_FOR.get(fold(cell.text));
      if (field && !map.has(field)) map.set(field, column);
    });
    if (map.size >= 2) return { number, map };
  }
  return null;
}

async function parseExpenses(buffer, { filename } = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const rows = [];
  const columnsSeen = new Set();
  let sheetsRead = 0;

  for (const sheet of workbook.worksheets) {
    const header = findHeader(sheet);
    if (!header) continue;
    sheetsRead += 1;
    for (const field of header.map.keys()) columnsSeen.add(field);

    for (let number = header.number + 1; number <= sheet.rowCount; number += 1) {
      const line = sheet.getRow(number);
      const read = (field) => {
        const column = header.map.get(field);
        return column ? line.getCell(column).value : null;
      };

      const parsed = {
        spentOn: dayOf(safeDate(read('spentOn'))),
        description: safeText(read('description')),
        payee: safeText(read('payee')),
        groupName: safeText(read('groupName')),
        spentBy: safeText(read('spentBy')),
        // Uppercased here as well as in the repo: the diff compares on it.
        currency: safeText(read('currency'))?.toUpperCase() ?? null,
        rawAmount: safeNumber(read('rawAmount')),
        exchangeRate: safeNumber(read('exchangeRate')),
      };

      // A DATE AND AN AMOUNT, OR IT IS NOT AN EXPENSE. This is also what
      // drops our own export's Total row, which carries neither.
      if (REQUIRED.some((field) => parsed[field] === null)) continue;

      parsed.sheet = sheet.name;
      parsed.row = number;
      parsed.syncKey = expenseKey(parsed);
      rows.push(parsed);
    }
  }

  return {
    rows,
    filename: filename ?? null,
    sheetsRead,
    // Which columns the FILE carried, so a column it never mentioned is
    // not read as a cleared cell.
    columns: [...columnsSeen],
  };
}

module.exports = { parseExpenses, safeDate, safeNumber, safeText };
