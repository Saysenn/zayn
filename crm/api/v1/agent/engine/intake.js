const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { findTables } = require('../../calculator/readSheets');
const { fold } = require('../tools/resolvePerson');

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

/**
 * A BAND ROW folded into the header under it. A merged "Bank details" over
 * "Account" and "Sort code" reads as the same label in side by side cells;
 * left as it is, the table finder takes the band for the header and loses
 * every other column. Only a row of labels that each spread over two or more
 * columns, sitting over a wider row of labels, counts.
 */
function foldBands(grid) {
  const out = grid.map((row) => [...(row ?? [])]);
  const label = (v) => (!blank(v) && typeof v === 'string' && !/\d/.test(v) ? String(v).trim() : '');
  for (let r = 0; r < out.length - 1; r += 1) {
    const row = out[r];
    const next = out[r + 1];
    const cells = row.map((v, i) => [label(v), i]).filter(([v]) => v);
    if (cells.length < 2 || row.some((v) => !blank(v) && !label(v))) continue;
    const spread = cells.every(([v, i]) => label(row[i - 1]) === v || label(row[i + 1]) === v);
    const below = next.filter((v) => !blank(v));
    if (!spread || below.length <= cells.length || below.some((v) => !label(v))) continue;
    out[r + 1] = next.map((v, i) => (label(row[i]) && label(v) && fold(label(row[i])) !== fold(label(v)) ? `${label(row[i])} ${label(v)}` : v));
    out[r] = row.map(() => null);
  }
  return out;
}

/**
 * SUB-LABELS ON THE ROW BELOW ("Monthly" over "Amount" / "Currency"): a
 * first row with no figure in it that fills a blank header is the second
 * header row, not a deal. The headers with it folded in, or null.
 */
function subLabels(headers, below) {
  const text = (v) => (!blank(v) && typeof v === 'string' ? String(v).trim() : '');
  const fills = below.filter((v, i) => text(v) && !headers[i]).length;
  const labels = below.filter((v) => text(v)).length;
  if (!(fills >= 1 && labels >= 2 && below.every((v) => blank(v) || (typeof v === 'string' && !/\d/.test(v))))) return null;
  return headers.map((h, i) => (text(below[i]) ? (h && fold(h) !== fold(text(below[i])) ? `${h} ${text(below[i])}` : text(below[i])) : h));
}

/** The tables in one grid (rows of cells), each row with its line number. */
function tablesIn(rawGrid, sheet) {
  const grid = foldBands(rawGrid);
  return findTables(grid).map((t, k) => {
    // A HEADER OVER TWO ROWS ("Monthly" above "Amount", or a merged label
    // with blanks under it): a blank header takes the label above it.
    const above = (grid[t.headerRow - 1] ?? []).slice(t.firstCol, t.lastCol + 1);
    const text = (v) => (!blank(v) && typeof v === 'string' ? String(v).trim() : '');
    let headers = (grid[t.headerRow] ?? []).slice(t.firstCol, t.lastCol + 1)
      .map((h) => (blank(h) ? '' : String(h).trim()))
      .map((h, i) => h || text(above[i]));
    let first = t.headerRow + 1;
    const split = subLabels(headers, (grid[first] ?? []).slice(t.firstCol, t.lastCol + 1));
    if (split) { headers = split; first += 1; }
    const rows = [];
    for (let r = first; r <= t.lastRow; r += 1) {
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
 * A POWERPOINT'S TEXT, slide by slide. Live 2026-10-07: a .pptx was read
 * as plain text, which is a zip, and thousands of garbled characters broke
 * the read. Each slide's words, in slide order, a line per paragraph.
 */
async function pptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const out = [];
  for (const [i, n] of slides.entries()) {
    // eslint-disable-next-line no-await-in-loop
    const xml = await zip.file(n).async('string');
    const text = xml
      .replace(/<\/a:p>/g, '\n')
      .replace(/<a:tab\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    if (text) out.push(`Slide ${i + 1}:\n${text}`);
  }
  return out.join('\n\n');
}

/**
 * NOT A FILE ANY READER HERE UNDERSTANDS: a zip, an image, audio, video, a
 * binary. Said plainly, never read as text (garbage in breaks the read).
 */
const READS = /\.(xlsx|csv|tsv|txt|json|docx|pptx|md)$/i;
class UnreadableFile extends Error {}

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
    if (!READS.test(name) && (buffer.includes(0) || buffer.subarray(0, 2).toString('latin1') === 'PK')) {
      throw new UnreadableFile(`${filename || 'that file'} is not a kind of file I can read`);
    }
    if (/\.docx$/.test(name)) raw = await docxText(buffer);
    else if (/\.pptx$/.test(name)) raw = await pptxText(buffer);
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
      let headers = grid[at].map((h) => (blank(h) ? '' : String(h).trim()));
      // The same two-row header as in a spreadsheet (a CSV has them too).
      const split = subLabels(headers, grid[at + 1] ?? []);
      if (split) headers = split;
      const skip = split ? 1 : 0;
      const rows = grid.slice(at + 1 + skip).map((cells, i) => ({ line: at + i + 2 + skip, cells: headers.map((_, k) => (blank(cells[k]) ? null : cells[k])) }))
        .filter((r) => r.cells.some((c) => !blank(c)));
      if (rows.length && headers.filter(Boolean).length >= 2) tables = [{ id: 'text#1', sheet: null, headerLine: at + 1, headers, rows }];
    }
  }
  // What is not inside a table is left for the model: notes, chat, lists.
  const inTables = new Set(tables.flatMap((t) => [t.headerLine, ...t.rows.map((r) => r.line)]));
  const rest = raw.split(/\r?\n/).map((l, i) => (inTables.has(i + 1) ? '' : l)).join('\n');
  return { tables, text: rest.trim() ? rest : '', kind: tables.length ? 'table text' : 'text' };
}

module.exports = {
  intake, gridOfText, tablesIn, cellOf, UnreadableFile,
};
