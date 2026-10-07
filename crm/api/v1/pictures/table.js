const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

// ***************************************************
// * A LONG RESULT AS A PICTURE: ONE TABLE, ANY CONTEXT
// ***************************************************
//
// His calls 2026-10-07: long results (4+ rows) go as a picture in the
// conversation, in the style picked in Settings → Whatbot (the master sheet
// export's Blue white sheet, or a handwritten notebook). Only the cell that
// needs attention is tinted; questions go in the caption, never the picture.
// No bank account numbers in a picture, ever: callers never pass them.
//
// Drawn by code from the data the reply was written from, so the two always
// agree. Long tables are split into pages ("1/3"), one PNG each.

const FONT_FILE = path.join(__dirname, '../../assets/fonts/Caveat.ttf');
const WIDTH = 1000;
const MIN_ROWS = 4;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s, n) => { const v = String(s ?? ''); return n > 1 && v.length > n ? `${v.slice(0, n - 1)}…` : v; };

/**
 * @typedef {{ label: string, weight?: number, align?: 'left'|'right' }} Column
 * @typedef {{ cells: string[], tint?: number[], strike?: number[], sub?: string }} Row
 * @typedef {{ label?: string, rows: Row[] }} Section
 * @typedef {{
 *   title: string, subtitle?: string,
 *   status?: { text: string, tone?: 'pending'|'ok'|'neutral' },
 *   columns: Column[], sections: Section[],
 *   total?: { label?: string, value: string, sub?: string },
 *   footer?: string, style?: 'sheet'|'notebook'|'text', perPage?: number,
 * }} TableSpec
 */

/**
 * A long cell over up to `most` lines, by words, the last cut with "…": a
 * sheet check's problem is the part worth reading, so it wraps, never cuts.
 */
function wrap(text, max, most = 3) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if (`${line} ${w}`.length <= max) line = `${line} ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > most) {
    const kept = lines.slice(0, most);
    kept[most - 1] = cut(`${kept[most - 1]} ${lines.slice(most).join(' ')}`, max);
    return kept;
  }
  return lines.map((l) => cut(l, max));
}

/** Rows a spec holds, across its sections. */
const rowCount = (spec) => spec.sections.reduce((n, s) => n + s.rows.length, 0);

/** Long enough to be worth a picture (his rule: 4 or more rows). */
const worthAPicture = (spec) => spec.style !== 'text' && rowCount(spec) >= MIN_ROWS;

// Split into pages, a section header counting as a row; a section that runs
// over carries its header onto the next page.
function pages(spec, perPage) {
  const out = [];
  let page = [];
  let used = 0;
  for (const s of spec.sections) {
    let i = 0;
    while (i < s.rows.length) {
      const head = s.label ? 1 : 0;
      if (used + head + 1 > perPage && page.length) { out.push(page); page = []; used = 0; }
      const room = perPage - used - head;
      const take = s.rows.slice(i, i + Math.max(1, room));
      page.push({ label: s.label ? `${s.label}${i > 0 ? ' (continued)' : ''}` : null, rows: take });
      used += head + take.length;
      i += take.length;
    }
  }
  if (page.length) out.push(page);
  return out.length ? out : [[]];
}

function columnsX(columns, L, R) {
  const sum = columns.reduce((n, c) => n + (c.weight ?? 1), 0);
  const xs = [L];
  for (const c of columns) xs.push(xs.at(-1) + ((R - L) * (c.weight ?? 1)) / sum);
  return xs.map(Math.round);
}

// ---------------------------------------------------------------- the sheet
function sheet(spec, page, { n, of, last }) {
  const W = spec.width ?? WIDTH;
  const C = {
    ink: '#1f2328', soft: '#5f6368', grid: '#c8d3df', head: '#DDEBF7', zebra: '#F2F8FD', tint: '#FFF2CC', pending: '#9a6700', ok: '#1e7e34', section: '#eaf2fb',
  };
  const F = "font-family=\"Helvetica, Arial, 'Segoe UI', sans-serif\"";
  const t = (x, y, s, { size = 16, weight = 400, fill = C.ink, anchor = 'start', style = 'normal', deco = '' } = {}) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" font-style="${style}" fill="${fill}" text-anchor="${anchor}"${deco ? ` text-decoration="${deco}"` : ''}>${esc(s)}</text>`;
  const L = 32; const R = W - 32;
  const xs = columnsX(spec.columns, L, R);
  const maxOf = (i, v) => Math.floor((xs[i + 1] - xs[i] - 18) / (/[A-Z]{4}/.test(v ?? '') ? 10.5 : 8.6));
  const linesOf = (r) => spec.columns.map((c, i) => (c.align === 'right' ? [cut(r.cells[i], maxOf(i, r.cells[i]))] : wrap(r.cells[i], maxOf(i, r.cells[i]))));
  const rowH = (r) => 18 + Math.max(1, ...linesOf(r).map((l) => l.length)) * 20 + (r.sub ? 14 : 0);
  const top = spec.subtitle ? 104 : 84;
  const bodyH = page.reduce((h, s) => h + (s.label ? 34 : 0) + s.rows.reduce((m, r) => m + rowH(r), 0), 0);
  const H = top + 36 + bodyH + (last && spec.total ? 42 + (spec.total.sub ? 20 : 0) : 0) + (spec.footer && last ? 60 : 30);
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  o.push(t(L, 50, `${spec.title}${of > 1 ? `  (${n}/${of})` : ''}`, { size: 28, weight: 700 }));
  if (spec.subtitle) o.push(t(L, 78, spec.subtitle, { size: 15, fill: C.soft }));
  if (spec.status) o.push(t(R, 50, spec.status.text, { size: 16, weight: 700, fill: { pending: C.pending, ok: C.ok }[spec.status.tone] ?? C.soft, anchor: 'end' }));
  let y = top;
  o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="36" fill="${C.head}"/>`);
  spec.columns.forEach((c, i) => o.push(t(c.align === 'right' ? xs[i + 1] - 10 : xs[i] + 10, y + 24, c.label, { size: 14, weight: 700, anchor: c.align === 'right' ? 'end' : 'start' })));
  y += 36;
  const lines = [y];
  const runs = []; // the stretches of plain rows, where the column lines go
  let runTop = y;
  let z = 0;
  for (const s of page) {
    if (s.label) {
      if (y > runTop) runs.push([runTop, y]);
      o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="34" fill="${C.section}"/>`, t(L + 10, y + 23, s.label, { size: 15, weight: 700 }));
      y += 34; lines.push(y); z = 0;
      runTop = y;
    }
    for (const r of s.rows) {
      const h = rowH(r);
      o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="${h}" fill="${z % 2 ? C.zebra : '#ffffff'}"/>`);
      (r.tint ?? []).forEach((c) => o.push(`<rect x="${xs[c]}" y="${y}" width="${xs[c + 1] - xs[c]}" height="${h}" fill="${C.tint}"/>`));
      const cellLines = linesOf(r);
      spec.columns.forEach((c, i) => {
        const right = c.align === 'right';
        const struck = (r.strike ?? []).includes(i);
        const ls = cellLines[i].filter(Boolean);
        (ls.length ? ls : ['—']).forEach((line, k) => o.push(t(right ? xs[i + 1] - 10 : xs[i] + 10, y + 25 + k * 20, line, {
          weight: right || i === 0 ? 600 : 400, fill: ls.length ? (struck ? C.soft : C.ink) : C.soft, anchor: right ? 'end' : 'start', deco: struck ? 'line-through' : '',
        })));
      });
      if (r.sub) o.push(t(R - 10, y + h - 9, cut(r.sub, 110), { size: 12, fill: C.soft, anchor: 'end' }));
      y += h; lines.push(y); z += 1;
    }
  }
  if (y > runTop) runs.push([runTop, y]);
  const tableTop = top;
  o.push(`<rect x="${L}" y="${tableTop}" width="${R - L}" height="${y - tableTop}" fill="none" stroke="${C.grid}" stroke-width="1"/>`);
  // column lines through the header and the plain rows, never a group heading
  for (const [a, b] of [[tableTop, tableTop + 36], ...runs]) {
    xs.slice(1, -1).forEach((gx) => o.push(`<line x1="${gx}" y1="${a}" x2="${gx}" y2="${b}" stroke="${C.grid}" stroke-width="1"/>`));
  }
  lines.forEach((ly) => o.push(`<line x1="${L}" y1="${ly}" x2="${R}" y2="${ly}" stroke="${C.grid}" stroke-width="1"/>`));
  if (last && spec.total) {
    const th = 42 + (spec.total.sub ? 20 : 0);
    o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="${th}" fill="${C.head}"/>`,
      `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="#7f8c99" stroke-width="1.2"/>`,
      t(L + 10, y + 27, spec.total.label ?? 'Total', { size: 16, weight: 700 }),
      t(R - 10, y + 27, spec.total.value, { size: 17, weight: 700, anchor: 'end' }));
    if (spec.total.sub) o.push(t(R - 10, y + 50, spec.total.sub, { size: 13, fill: C.soft, anchor: 'end' }));
    y += th;
  }
  if (spec.footer && last) o.push(t(L, H - 22, spec.footer, { size: 14, fill: C.soft }));
  else if (!last) o.push(t(R, H - 10, 'continued on the next picture', { size: 12, fill: C.soft, anchor: 'end', style: 'italic' }));
  o.push('</svg>');
  return o.join('');
}

// ------------------------------------------------------------- the notebook
function notebook(spec, page, { n, of, last }) {
  const W = spec.width ?? WIDTH;
  const C = {
    paper: '#fbf7ec', rule: '#c9d8ea', margin: '#e6a1a1', pen: '#1d3a8a', red: '#c0392b', soft: '#6b6b6b', marker: '#fff27a', ok: '#2e7d32',
  };
  const F = 'font-family="Caveat"';
  // The handwriting has no arrow: "→" in it fell back to a typed font for
  // the whole cell, so the pen writes "->".
  const pen = (v) => String(v ?? '').replace(/\s*→\s*/g, ' -> ');
  const t = (x, y, s, { size = 28, weight = 400, fill = C.pen, anchor = 'start', deco = '' } = {}) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${deco ? ` text-decoration="${deco}"` : ''}>${esc(pen(s))}</text>`;
  const LINE = 42;
  const M = 96;
  const xs = columnsX(spec.columns, M, W - 44);
  const maxOf = (i) => Math.floor((xs[i + 1] - xs[i] - 12) / 11.5);
  const linesOf = (r) => spec.columns.map((c, i) => (c.align === 'right' ? [cut(pen(r.cells[i]), maxOf(i))] : wrap(pen(r.cells[i]), maxOf(i))));
  const rowLines = (r) => Math.max(1, ...linesOf(r).map((l) => l.length));
  const lineCount = page.reduce((n2, s) => n2 + (s.label ? 1 : 0) + s.rows.reduce((m, r) => m + rowLines(r) + (r.sub ? 1 : 0), 0), 0);
  const H = 130 + (lineCount + 1) * LINE + (last && spec.total ? 3 * LINE : 0) + (spec.footer && last ? LINE : 0) + 30;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`, `<rect width="${W}" height="${H}" fill="${C.paper}"/>`];
  for (let ly = 130; ly < H - 6; ly += LINE) o.push(`<line x1="0" y1="${ly}" x2="${W}" y2="${ly}" stroke="${C.rule}" stroke-width="1.2"/>`);
  o.push(`<line x1="${M - 16}" y1="0" x2="${M - 16}" y2="${H}" stroke="${C.margin}" stroke-width="2"/>`);
  const title = `${spec.title}${of > 1 ? ` (${n}/${of})` : ''}`;
  o.push(t(M, 70, title, { size: 44, weight: 700 }));
  o.push(`<path d="M ${M} 82 q ${title.length * 8} 6 ${title.length * 17} 0" stroke="${C.pen}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  if (spec.subtitle) o.push(t(M, 116, spec.subtitle, { size: 24, fill: C.soft }));
  if (spec.status) o.push(t(W - 40, 64, spec.status.text.toLowerCase(), { size: 28, fill: spec.status.tone === 'ok' ? C.ok : spec.status.tone === 'pending' ? C.red : C.soft, anchor: 'end' }));
  let y = 130 + LINE - 10;
  // the column heads, small, like a ruled ledger
  spec.columns.forEach((c, i) => o.push(t(c.align === 'right' ? xs[i + 1] - 4 : xs[i], y, c.label.toLowerCase(), { size: 22, fill: C.soft, anchor: c.align === 'right' ? 'end' : 'start' })));
  y += LINE;
  for (const s of page) {
    if (s.label) { o.push(t(M, y, s.label, { size: 30, weight: 700, deco: 'underline' })); y += LINE; }
    for (const r of s.rows) {
      const cellLines = linesOf(r);
      spec.columns.forEach((c, i) => {
        const right = c.align === 'right';
        const x = right ? xs[i + 1] - 4 : xs[i];
        const struck = (r.strike ?? []).includes(i);
        const ls = cellLines[i].filter(Boolean);
        (ls.length ? ls : ['???']).forEach((v, k) => {
          const w = v.length * 11.2;
          if ((r.tint ?? []).includes(i)) o.push(`<rect x="${(right ? x - w : x) - 4}" y="${y + k * LINE - 26}" width="${w + 8}" height="32" rx="6" fill="${C.marker}" opacity="0.75"/>`);
          o.push(t(x, y + k * LINE, v, { fill: v === '???' ? C.red : struck ? C.soft : C.pen, anchor: right ? 'end' : 'start', weight: right ? 700 : 400, deco: struck ? 'line-through' : '' }));
        });
      });
      // a "?" in the margin where something needs checking; a plan's tint is
      // just the change, so it has none
      if ((r.tint ?? []).length && spec.marks !== false) o.push(t(M - 50, y, '?', { size: 32, fill: C.red }));
      y += LINE * rowLines(r);
      if (r.sub) { o.push(t(W - 44, y - 6, cut(r.sub, 80), { size: 22, fill: C.soft, anchor: 'end' })); y += LINE; }
    }
  }
  if (last && spec.total) {
    y += LINE / 2;
    o.push(`<line x1="${W - 440}" y1="${y - 30}" x2="${W - 44}" y2="${y - 30}" stroke="${C.pen}" stroke-width="2"/>`);
    o.push(t(W - 440, y, spec.total.label ?? 'Total', { size: 32, weight: 700 }), t(W - 44, y, spec.total.value, { size: 32, weight: 700, anchor: 'end' }));
    o.push(`<line x1="${W - 300}" y1="${y + 8}" x2="${W - 44}" y2="${y + 8}" stroke="${C.pen}" stroke-width="2"/><line x1="${W - 300}" y1="${y + 13}" x2="${W - 44}" y2="${y + 13}" stroke="${C.pen}" stroke-width="2"/>`);
    y += LINE;
    if (spec.total.sub) { o.push(t(W - 44, y - 4, spec.total.sub, { size: 24, fill: C.soft, anchor: 'end' })); y += LINE; }
  }
  if (spec.footer && last) o.push(t(M, H - 20, spec.footer.toLowerCase(), { size: 24, fill: C.soft }));
  else if (!last) o.push(t(W - 44, H - 14, 'continued on the next page…', { size: 22, fill: C.soft, anchor: 'end' }));
  o.push('</svg>');
  return o.join('');
}

/**
 * @param {TableSpec} spec
 * @returns {Buffer[]} one PNG per page; none for the text style
 */
function renderTable(spec) {
  const style = spec.style ?? 'sheet';
  if (style === 'text') return [];
  const perPage = spec.perPage ?? (style === 'notebook' ? 20 : 25);
  const all = pages(spec, perPage);
  return all.map((page, i) => {
    const at = { n: i + 1, of: all.length, last: i === all.length - 1 };
    const svg = style === 'notebook' ? notebook(spec, page, at) : sheet(spec, page, at);
    return new Resvg(svg, {
      font: { loadSystemFonts: true, fontFiles: [FONT_FILE], defaultFontFamily: style === 'notebook' ? 'Caveat' : 'Helvetica' },
      fitTo: { mode: 'width', value: spec.width ?? WIDTH },
    }).render().asPng();
  });
}

module.exports = { renderTable, worthAPicture, rowCount, MIN_ROWS };
