const path = require('path');
const fs = require('fs/promises');
const ExcelJS = require('exceljs');

/**
 * Finds every table on a sheet, wherever it sits — stacked, side by side,
 * starting on row 40, doesn't matter. No column vocabulary yet (the real
 * sheet hasn't been seen), so this is the structural half only: locating
 * table-shaped regions. Mapping specific columns to specific meanings is a
 * second, later pass once real headers are known — same split whatbot's
 * own sheet/parseSheet.js makes between findTables() (structural) and
 * COLUMN_MAP (semantic).
 */

// Same two-blank-column convention whatbot's parseSheet.js already uses
// (see whatbot/docs/sheet-format.md): one blank column is a spacer inside
// a table, two or more means "a different table starts here".
const GAP = 2;

function isBlank(cell) {
  return cell === null || cell === undefined || String(cell).trim() === '';
}

// Runs of non-blank cells in a row, split on GAP-or-more blank columns —
// how side-by-side tables get told apart from one wide one.
function segments(cells) {
  const runs = [];
  let from = -1;
  let blanks = 0;

  for (let c = 0; c < cells.length; c++) {
    if (!isBlank(cells[c])) {
      if (from === -1) from = c;
      blanks = 0;
    } else if (from !== -1) {
      blanks++;
      if (blanks >= GAP) {
        runs.push([from, c - blanks]);
        from = -1;
        blanks = 0;
      }
    }
  }
  if (from !== -1) runs.push([from, cells.length - 1 - blanks]);
  return runs;
}

// Purely structural — no known-column list to check against yet, so a
// header candidate is "enough cells, and every one of them plain text".
// That second half matters: a data row can easily have 2+ text cells too
// (a name, a category), but it will almost always also have a number or a
// date somewhere — an amount, a day count — and a real header never does.
// Checked against the RAW cell (before stringifying), so a numeric 1300 or
// a Date stays recognisable as "not text" here.
function looksLikeHeader(rawCells, minLabels = 2) {
  const nonEmpty = rawCells.filter((c) => !isBlank(c));
  if (nonEmpty.length < minLabels) return false;
  return nonEmpty.every((c) => typeof c === 'string');
}

const overlap = (a, b) => a.firstCol <= b.lastCol && b.firstCol <= a.lastCol;

// Is every cell blank in this row, restricted to one column range? Used to
// tell "a real second table starts here" from "this text-only row is just
// another data row that happens to have no numbers in it" — see below.
function rowBlankInRange(grid, r, firstCol, lastCol) {
  const row = (grid[r] ?? []).slice(firstCol, lastCol + 1);
  return row.every(isBlank);
}

/**
 * Scans every row (not just the first few), splits each into column runs,
 * and keeps any run that looks like a header — same algorithm as whatbot's
 * findTables(). One addition whatbot's version doesn't need: without a
 * known-column check, an all-text data row (two companies and a status,
 * say) can look exactly like a header. So a header-like row occurring
 * where an earlier table (sharing its columns) is still open only counts
 * as a genuinely new table if there's an actual blank row between them —
 * otherwise it's folded in as data of the table already found, the same
 * way whatbot treats a lone blank row as a spacer, not a break.
 */
function findTables(grid) {
  const candidates = [];
  for (let r = 0; r < grid.length; r++) {
    const raw = grid[r] ?? [];
    const cells = raw.map((c) => (isBlank(c) ? '' : String(c)));
    for (const [firstCol, lastCol] of segments(cells)) {
      if (looksLikeHeader(raw.slice(firstCol, lastCol + 1))) {
        candidates.push({ headerRow: r, firstCol, lastCol });
      }
    }
  }

  const accepted = [];
  for (const cand of candidates) {
    const openTable = accepted
      .filter((t) => overlap(t, cand))
      .sort((a, b) => b.headerRow - a.headerRow)[0];

    if (openTable) {
      const from = Math.min(openTable.firstCol, cand.firstCol);
      const to = Math.max(openTable.lastCol, cand.lastCol);
      let hasBlankGap = false;
      for (let r = openTable.headerRow + 1; r < cand.headerRow; r++) {
        if (rowBlankInRange(grid, r, from, to)) {
          hasBlankGap = true;
          break;
        }
      }
      if (!hasBlankGap) continue; // no real break — this is data, not a new table
    }

    accepted.push({ headerRow: cand.headerRow, firstCol: cand.firstCol, lastCol: cand.lastCol, lastRow: grid.length - 1 });
  }

  for (const t of accepted) {
    const next = accepted
      .filter((o) => o.headerRow > t.headerRow && overlap(o, t))
      .map((o) => o.headerRow)
      .sort((a, b) => a - b)[0];
    if (next !== undefined) t.lastRow = next - 1;
  }

  return accepted;
}

// exceljs cell.value is sometimes a rich object (formulas, hyperlinks, rich
// text), not a plain value — unwrap to what a human would actually read.
//
// Formula cells need the Cell object's own `.result` getter, not
// `cell.value.result`: exceljs only inlines `result` on the *master* cell of
// a shared formula (e.g. `{formula, result, ref, shareType}`). Every
// dependent cell sharing that formula carries just `{sharedFormula: 'L9'}` —
// no result inline — even though `cell.result` still resolves it correctly.
// Reading `v.result` instead of `cell.result` was silently returning null
// for most shared-formula cells (which is most of the Payable-amount /
// Payable-days-this-month cells in the real sheet).
/**
 * `(7000*1.05)/2` -> 3675. Anything else -> null.
 *
 * The regex is the whole safety story: digits, spaces, brackets, decimal
 * points and the four operators. No letters means no cell references, no
 * function calls, no identifiers of any kind, so there is nothing for the
 * evaluation to reach.
 */
const ARITHMETIC_ONLY = /^[-+*/(). \d]+$/;

function evaluateArithmetic(formula) {
  const src = String(formula ?? '').trim();
  if (!src || !ARITHMETIC_ONLY.test(src)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const out = Function(`"use strict"; return (${src});`)();
    return Number.isFinite(out) ? out : null;
  } catch {
    return null;
  }
}

function cellToValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.error !== undefined) return null; // #VALUE! etc.
    if (cell.result !== undefined && cell.result !== null) {
      // A formula result can itself be an error object ({error: '#VALUE!'}).
      return typeof cell.result === 'object' && cell.result.error !== undefined ? null : cell.result;
    }
    // A FORMULA EXCEL NEVER CACHED. Three monthly-amount cells in the live
    // file are like this — Zayn's `(7000*1.05)/2` and Gary's `(75000/12)` —
    // and with no result they imported as nothing, so two real people
    // showed as earning zero on a payout sheet.
    //
    // Only PURE ARITHMETIC is evaluated: the guard admits digits, spaces,
    // brackets and + - * / and nothing else, so a formula referencing
    // another cell (or anything with a letter in it) still returns null
    // rather than being half-guessed. That keeps this a calculator, not an
    // Excel engine.
    const arithmetic = evaluateArithmetic(v.formula);
    if (arithmetic !== null) return arithmetic;
    if (v.text !== undefined) return v.text;
    return null;
  }
  return v;
}

function worksheetToGrid(worksheet) {
  const grid = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells = [];
    for (let c = 1; c <= worksheet.columnCount; c++) {
      cells.push(cellToValue(row.getCell(c)));
    }
    grid.push(cells);
  }
  return grid;
}

// Header row + every non-blank row under it, turned into one object per
// row keyed by whatever that table's own headers say — blank/spacer rows
// skipped, same as whatbot does.
function extractTables(grid) {
  return findTables(grid).map((t) => {
    const headers = grid[t.headerRow]
      .slice(t.firstCol, t.lastCol + 1)
      .map((h) => (isBlank(h) ? '' : String(h).trim()));

    const rows = [];
    for (let r = t.headerRow + 1; r <= t.lastRow; r++) {
      const rawRow = (grid[r] ?? []).slice(t.firstCol, t.lastCol + 1);
      if (rawRow.every(isBlank)) continue;
      const record = {};
      headers.forEach((h, i) => {
        if (h) record[h] = rawRow[i] ?? null;
      });
      rows.push(record);
    }

    return { headerRow: t.headerRow, firstCol: t.firstCol, lastCol: t.lastCol, headers, rows };
  });
}

// Same as scanFile, from an in-memory buffer instead of a path — the CRM's
// own master sheet upload (masterSheet/parseImport.js) holds the file in
// memory (multer memoryStorage) and never writes it to disk, so there's no
// path to hand scanFile.
async function scanBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets = [];
  workbook.eachSheet((worksheet) => {
    const grid = worksheetToGrid(worksheet);
    sheets.push({ sheet: worksheet.name, tables: extractTables(grid) });
  });
  return sheets;
}

async function scanFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = [];
  workbook.eachSheet((worksheet) => {
    const grid = worksheetToGrid(worksheet);
    sheets.push({ sheet: worksheet.name, tables: extractTables(grid) });
  });
  return sheets;
}

const PREVIEW_MAX_ROWS = 500; // a defensive cap, not a real limit anyone's expected to hit — the largest real sheet seen so far is ~90 rows

// Raw grid per sheet, no table-detection — a preview shows what's actually
// in the file, the same way opening it in Excel would, rather than trying
// to re-interpret it as data. Used for both source sheets (the boss's own,
// potentially messy) and our own generated output (always one clean table).
async function previewFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = [];
  workbook.eachSheet((worksheet) => {
    const grid = worksheetToGrid(worksheet).slice(0, PREVIEW_MAX_ROWS);
    sheets.push({ name: worksheet.name, rows: grid, truncated: worksheet.rowCount > PREVIEW_MAX_ROWS });
  });
  return sheets;
}

async function listXlsxFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.xlsx$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

// The entry point — every .xlsx in a folder, every sheet, every table.
async function scanFolder(dir) {
  const files = await listXlsxFiles(dir);
  const results = [];
  for (const file of files) {
    results.push({ file: path.basename(file), sheets: await scanFile(file) });
  }
  return results;
}

module.exports = { scanFolder, scanFile, scanBuffer, previewFile, findTables, segments, looksLikeHeader };
