const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { findTables } = require('../../calculator/readSheets');

/**
 * ***************************************************
 * * ANY FILE, INTO TABLES AND TEXT
 * ***************************************************
 *
 * The admin's call 2026-10-06: "whatever kind of structure, whatever file,
 * whatever data we attach, she should read." So nothing here knows what a
 * master sheet looks like. A file becomes the tables in it (every tab,
 * every block with a header row, side tables kept apart) and whatever text
 * is not a table. What the columns MEAN is decided after, in layout.js.
 *
 * Every row keeps where it came from (tab and row number), so anything said
 * about it later can be pointed back to the file.
 */

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/** One cell as a plain value: dates as YYYY-MM-DD, formulas as their result. */
function cellOf(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.result !== undefined) return cellOf(v.result);
    if (v.text !== undefined) return String(v.text);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.hyperlink) return String(v.text ?? v.hyperlink);
    return null;
  }
  return typeof v === 'string' ? v.trim() : v;
}

/** The tables in one grid (rows of cells), each row with its line number. */
function tablesIn(grid, sheet) {
  return findTables(grid).map((t, k) => {
    const headers = (grid[t.headerRow] ?? []).slice(t.firstCol, t.lastCol + 1).map((h) => (blank(h) ? '' : String(h).trim()));
    const rows = [];
    for (let r = t.headerRow + 1; r <= t.lastRow; r += 1) {
      const raw = (grid[r] ?? []).slice(t.firstCol, t.lastCol + 1);
      if (raw.every(blank)) continue;
      rows.push({ line: r + 1, cells: raw.map((c) => (blank(c) ? null : c)) });
    }
    return { id: `${sheet ?? 'text'}#${k + 1}`, sheet, headerLine: t.headerRow + 1, headers, rows };
  }).filter((t) => t.rows.length > 0 && t.headers.filter(Boolean).length >= 2);
}

/** Split text into a grid when it has a separator; null when it has none. */
function gridOfText(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const sample = lines.filter((l) => l.trim()).slice(0, 20);
  const sep = [['\t', /\t/], ['|', /\|/], [',', /,/], [';', /;/]]
    .find(([, re]) => sample.filter((l) => re.test(l)).length >= Math.max(2, sample.length * 0.6));
  if (!sep) return null;
  const splitCsv = (line) => {
    if (sep[0] !== ',') return line.split(sep[0]);
    const out = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  return lines.map((l) => (l.trim() ? splitCsv(l).map((c) => c.trim()).map((c) => (c === '' ? null : c)) : []));
}

/** Word's own text, tables kept as tab separated lines. */
async function docxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return '';
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\t\n/g, '\n');
}

/**
 * @param {{ buffer?: Buffer, filename?: string, text?: string }} input
 * @returns {Promise<{ tables: object[], text: string, kind: string }>}
 *   `text` is what is NOT in a table, for the model to read.
 */
async function intake({ buffer = null, filename = '', text = null }) {
  const name = String(filename ?? '').toLowerCase();
  if (buffer && /\.xlsx$/.test(name)) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const tables = [];
    book.eachSheet((ws) => {
      const grid = [];
      for (let r = 1; r <= ws.rowCount; r += 1) {
        const row = ws.getRow(r);
        const cells = [];
        for (let c = 1; c <= Math.max(row.cellCount, ws.columnCount); c += 1) cells.push(cellOf(row.getCell(c).value));
        grid.push(cells);
      }
      tables.push(...tablesIn(grid, ws.name));
    });
    return { tables, text: '', kind: 'spreadsheet' };
  }
  let raw = text;
  if (raw == null && buffer) {
    if (/\.docx$/.test(name)) raw = await docxText(buffer);
    else if (/\.json$/.test(name)) raw = buffer.toString('utf8');
    else raw = buffer.toString('utf8');
  }
  raw = String(raw ?? '');
  // JSON: an array of records is a table as it stands.
  if (/^\s*[[{]/.test(raw)) {
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) ?? [];
      if (list.length && typeof list[0] === 'object') {
        const headers = [...new Set(list.flatMap((o) => Object.keys(o ?? {})))];
        return {
          tables: [{ id: 'json#1', sheet: null, headerLine: 1, headers, rows: list.map((o, i) => ({ line: i + 2, cells: headers.map((h) => (blank(o?.[h]) ? null : o[h])) })) }],
          text: '',
          kind: 'json',
        };
      }
    } catch { /* not JSON after all: read as text */ }
  }
  const grid = gridOfText(raw);
  // IN TEXT EVERY CELL IS TEXT, so "a row of words" cannot find the header
  // the way it does in a spreadsheet: the first row with two or more cells
  // is the header, as in every CSV.
  let tables = [];
  if (grid) {
    const at = grid.findIndex((r) => r.filter((c) => !blank(c)).length >= 2);
    if (at >= 0) {
      const headers = grid[at].map((h) => (blank(h) ? '' : String(h).trim()));
      const rows = grid.slice(at + 1).map((cells, i) => ({ line: at + i + 2, cells: headers.map((_, k) => (blank(cells[k]) ? null : cells[k])) }))
        .filter((r) => r.cells.some((c) => !blank(c)));
      if (rows.length && headers.filter(Boolean).length >= 2) tables = [{ id: 'text#1', sheet: null, headerLine: at + 1, headers, rows }];
    }
  }
  // What is not inside a table is left for the model: notes, chat, lists.
  const inTables = new Set(tables.flatMap((t) => [t.headerLine, ...t.rows.map((r) => r.line)]));
  const rest = raw.split(/\r?\n/).map((l, i) => (inTables.has(i + 1) ? '' : l)).join('\n');
  return { tables, text: rest.trim() ? rest : '', kind: tables.length ? 'table text' : 'text' };
}

module.exports = { intake, gridOfText, tablesIn, cellOf };
