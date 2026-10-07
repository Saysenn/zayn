/**
 * A COPY of crm/api/v1/pictures/table.js, kept here on purpose (his call
 * 2026-10-07): WhatBot draws its own pictures, so it still works when moved
 * out of this repo. Change both together.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { measure, wrapTo, fitColumns } from './measure.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

// every bundled face (open licences, beside them): the notebook's Caveat,
// the receipt's IBM Plex Mono, the ledger's Libre Baskerville, the
// chalkboard's Patrick Hand. Bundled so the PC draws what this Mac draws.
const FONT_DIR = path.join(HERE, '../../assets/fonts');
const FONT_FILES = fs.readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf')).map((f) => path.join(FONT_DIR, f));
const STYLES = ['sheet', 'notebook', 'receipt', 'ledger', 'chalkboard'];
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
 *   notes?: { title: string, lines: { label: string, text: string }[] },
 *   footer?: string, style?: 'sheet'|'notebook'|'receipt'|'ledger'|'chalkboard', perPage?: number,
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


// --------------------------------------------- the sheet, ledger, chalkboard
// One table layout, three looks (his calls 2026-10-07): the export's Blue
// white sheet; an old accounts LEDGER on textured cream paper in a serif,
// red and green ruling; a CHALKBOARD of textured slate in chalk handwriting.
// A texture is SVG noise, drawn faint, never under the words' contrast.
const noise = (id, freq, opacity, tone) => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 ${tone} 0 0 0 0 ${tone} 0 0 0 0 ${tone} 0 0 0 ${opacity} 0"/></filter>`;

const THEMES = {
  sheet: {
    font: "Inter, Helvetica, Arial, sans-serif", face: 'sans', size: 16, line: 20,
    ink: '#1f2328', soft: '#5f6368', pending: '#9a6700', ok: '#1e7e34',
    paper: (W, H) => `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    head: { fill: '#DDEBF7', text: '#1f2328' }, zebra: '#F2F8FD', plain: '#ffffff', section: { fill: '#eaf2fb', text: '#1f2328' },
    grid: { color: '#c8d3df', dash: '' }, total: { fill: '#DDEBF7', rule: '#7f8c99' },
    tint: (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFF2CC"/>`,
    note: { fill: '#F2F8FD', edge: '#DDEBF7', title: '#1f5f99' },
  },
  ledger: {
    font: "'Libre Baskerville', Georgia, serif", face: 'serif', size: 15, line: 21,
    ink: '#2b2118', soft: '#6e6153', pending: '#9b2c1f', ok: '#2f6b3a',
    paper: (W, H) => `<defs>${noise('grain', 0.9, 0.10, 0.35)}</defs><rect width="${W}" height="${H}" fill="#f5edd8"/><rect width="${W}" height="${H}" filter="url(#grain)"/>`
      + `<rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="#e4d8bc" stroke-width="0.8"/>`,
    head: { fill: 'none', text: '#2f6b3a', rule: '#e3bdb5', ruleWidth: 1 }, zebra: 'none', plain: 'none', section: { fill: '#efe6cd', text: '#2b2118' },
    grid: { color: '#dbe6dc', dash: '' }, rows: { color: '#e2e8ee' }, total: { fill: 'none', rule: '#e3bdb5', double: true, width: 0.8 },
    tint: (x, y, w, h) => `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="#f3d36b" opacity="0.45"/>`,
    // the serif has no "≈": it fell back to another face mid line
    words: (v) => String(v).replace(/≈\s*/g, 'about '),
    note: { fill: '#efe6cd', edge: '#e4d8bc', title: '#2f6b3a' },
  },
  chalkboard: {
    font: "'Patrick Hand', 'Comic Sans MS', cursive", face: 'chalk', size: 19, line: 23,
    ink: '#f4f1e8', soft: '#bcc8c1', pending: '#f7c873', ok: '#a8e6a1',
    paper: (W, H) => `<defs>${noise('chalk', 0.75, 0.22, 1)}</defs><rect width="${W}" height="${H}" fill="#1f302a"/>`
      + `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="6" fill="#263a33"/><rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="6" filter="url(#chalk)"/>`,
    head: { fill: 'none', text: '#f7e48c', rule: 'rgba(244,241,232,0.28)', ruleWidth: 1 }, zebra: 'none', plain: 'none', section: { fill: 'rgba(255,255,255,0.05)', text: '#f7e48c' },
    grid: { color: 'rgba(244,241,232,0.14)', dash: '6 6' }, total: { fill: 'none', rule: 'rgba(244,241,232,0.3)', double: true, width: 0.8 },
    tint: (x, y, w, h) => `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="8" fill="rgba(247,228,140,0.12)" stroke="rgba(247,228,140,0.45)" stroke-width="1" stroke-dasharray="5 5"/>`,
    inset: 28,
    note: { fill: 'rgba(255,255,255,0.06)', edge: 'rgba(244,241,232,0.2)', title: '#f7e48c' },
  },
};

function sheet(spec, page, { n, of, last }, theme = THEMES.sheet) {
  const C = theme;
  const F = `font-family="${theme.font}"`;
  const t = (x, y, s, { size = theme.size, weight = 400, fill = C.ink, anchor = 'start', style = 'normal', deco = '' } = {}) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" font-style="${style}" fill="${fill}" text-anchor="${anchor}"${deco ? ` text-decoration="${deco}"` : ''}>${esc(theme.words ? theme.words(s) : s)}</text>`;
  const pad = theme.inset ?? 0;
  const headSize = theme.size - (theme.head.fill === 'none' ? 4 : 2);
  const headText = (c) => (theme.head.fill === 'none' ? c.label.toUpperCase() : c.label);
  // COLUMNS FROM WHAT IS IN THEM, over every page so the pages line up; the
  // picture grows wider rather than cut a word (pictures/measure.js)
  const everyRow = spec.sections.flatMap((s) => s.rows);
  const fit = fitColumns(spec.columns.map((c) => ({ ...c, label: headText(c) })), everyRow, {
    face: theme.face, size: theme.size, headSize, avail: (spec.width ?? WIDTH) - 64 - 2 * pad,
  });
  const W = Math.round(fit.total + 64 + 2 * pad);
  const L = 32 + pad; const R = W - 32 - pad;
  const xs = [L];
  for (const w of fit.widths) xs.push(xs.at(-1) + w);
  const inner = (i) => xs[i + 1] - xs[i] - 18;
  const linesOf = (r) => spec.columns.map((c, i) => wrapTo(r.cells[i], inner(i), theme.face, theme.size, c.align === 'right' || i === 0));
  const rowH = (r) => 18 + Math.max(1, ...linesOf(r).map((l) => l.length)) * theme.line + (r.sub ? 14 : 0);
  const headLines = spec.columns.map((c, i) => wrapTo(headText(c), inner(i), theme.face, headSize, true));
  const headH = Math.max(36, 16 + Math.max(...headLines.map((l) => l.length)) * (headSize + 4));
  // the status beside the title, or under it when the two would meet
  const title = `${spec.title}${of > 1 ? `  (${n}/${of})` : ''}`;
  const statusBelow = spec.status && measure(title, theme.face, theme.size + 12, true) + measure(spec.status.text, theme.face, theme.size, true) + 40 > R - L;
  const top = (spec.subtitle ? 104 : 84) + pad + (statusBelow ? 26 : 0);
  const bodyH = page.reduce((h, s) => h + (s.label ? 34 : 0) + s.rows.reduce((m, r) => m + rowH(r), 0), 0);
  const totalTwoLines = spec.total && measure(spec.total.label ?? 'Total', theme.face, theme.size, true) + measure(spec.total.value, theme.face, theme.size + 1, true) + 40 > R - L;
  const th = spec.total ? 46 + (totalTwoLines ? 26 : 0) + (spec.total.sub ? 20 : 0) : 0;
  // THE NOTES under the total (his call 2026-10-07: where the rest of
  // their pay is, as a tidy box): a title and one line per note
  const notes = last && spec.notes?.lines?.length ? spec.notes : null;
  const noteH = notes ? 26 + 30 + notes.lines.length * (theme.size + 12) + 14 : 0;
  const H = top + headH + bodyH + (last ? th : 0) + (notes ? noteH + 22 : 0) + (spec.footer && last ? 60 : 30) + pad;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`, theme.paper(W, H)];
  o.push(t(L, 50 + pad, title, { size: theme.size + 12, weight: 700 }));
  if (spec.subtitle) o.push(t(L, 78 + pad, spec.subtitle, { size: theme.size - 1, fill: C.soft }));
  if (spec.status) {
    const tone = { pending: C.pending, ok: C.ok }[spec.status.tone] ?? C.soft;
    o.push(statusBelow ? t(L, top - 14, spec.status.text, { size: theme.size - 1, weight: 700, fill: tone }) : t(R, 50 + pad, spec.status.text, { size: theme.size, weight: 700, fill: tone, anchor: 'end' }));
  }
  let y = top;
  if (theme.head.fill !== 'none') o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="${headH}" fill="${theme.head.fill}"/>`);
  spec.columns.forEach((c, i) => headLines[i].forEach((line, k) => o.push(t(c.align === 'right' ? xs[i + 1] - 10 : xs[i] + 10, y + 24 + k * (headSize + 4), line, {
    size: headSize, weight: 700, fill: theme.head.text, anchor: c.align === 'right' ? 'end' : 'start',
  }))));
  y += headH;
  const lines = [y];
  const runs = [];
  let runTop = y;
  let z = 0;
  for (const s of page) {
    if (s.label) {
      if (y > runTop) runs.push([runTop, y]);
      o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="34" fill="${theme.section.fill}"/>`, t(L + 10, y + 23, s.label, { size: theme.size - 1, weight: 700, fill: theme.section.text }));
      y += 34; lines.push(y); z = 0;
      runTop = y;
    }
    for (const r of s.rows) {
      const h = rowH(r);
      const fill = z % 2 ? theme.zebra : theme.plain;
      if (fill !== 'none') o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="${h}" fill="${fill}"/>`);
      (r.tint ?? []).forEach((c) => o.push(theme.tint(xs[c], y, xs[c + 1] - xs[c], h)));
      const cellLines = linesOf(r);
      spec.columns.forEach((c, i) => {
        const right = c.align === 'right';
        const struck = (r.strike ?? []).includes(i);
        const ls = cellLines[i].filter(Boolean);
        (ls.length ? ls : ['—']).forEach((line, k) => o.push(t(right ? xs[i + 1] - 10 : xs[i] + 10, y + 25 + k * theme.line, line, {
          weight: right || i === 0 ? 600 : 400, fill: ls.length ? (struck ? C.soft : C.ink) : C.soft, anchor: right ? 'end' : 'start', deco: struck ? 'line-through' : '',
        })));
      });
      if (r.sub) o.push(t(R - 10, y + h - 9, r.sub, { size: theme.size - 4, fill: C.soft, anchor: 'end' }));
      y += h; lines.push(y); z += 1;
    }
  }
  if (y > runTop) runs.push([runTop, y]);
  const dash = theme.grid.dash ? ` stroke-dasharray="${theme.grid.dash}"` : '';
  if (theme === THEMES.sheet) o.push(`<rect x="${L}" y="${top}" width="${R - L}" height="${y - top}" fill="none" stroke="${theme.grid.color}" stroke-width="1"/>`);
  // column lines through the header and the plain rows, never a group heading
  for (const [a, b] of [[top, top + headH], ...runs]) {
    xs.slice(1, -1).forEach((gx) => o.push(`<line x1="${gx}" y1="${a}" x2="${gx}" y2="${b}" stroke="${theme.grid.color}" stroke-width="1"${dash}/>`));
  }
  lines.forEach((ly, i) => o.push(`<line x1="${L}" y1="${ly}" x2="${R}" y2="${ly}" stroke="${i === 0 && theme.head.rule ? theme.head.rule : theme.rows?.color ?? theme.grid.color}" stroke-width="${i === 0 && theme.head.rule ? theme.head.ruleWidth ?? 2 : 1}"${i === 0 ? '' : dash}/>`));
  if (theme.head.rule) o.push(`<line x1="${L}" y1="${top + headH + 4}" x2="${R}" y2="${top + headH + 4}" stroke="${theme.head.rule}" stroke-width="${theme.head.ruleWidth ?? 1}"/>`);
  if (last && spec.total) {
    if (theme.total.fill !== 'none') o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="${th}" fill="${theme.total.fill}"/>`);
    const vy = y + 29 + (totalTwoLines ? 26 : 0);
    o.push(`<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="${theme.total.rule}" stroke-width="${theme.total.width ?? 1.4}"/>`,
      t(L + 10, y + 29, spec.total.label ?? 'Total', { size: theme.size, weight: 700 }),
      t(R - 10, vy, spec.total.value, { size: theme.size + 1, weight: 700, anchor: 'end' }));
    const vw = Math.min(R - L - 20, measure(spec.total.value, theme.face, theme.size + 1, true) + 20);
    if (theme.total.double) o.push(`<line x1="${R - vw}" y1="${vy + 9}" x2="${R}" y2="${vy + 9}" stroke="${theme.total.rule}" stroke-width="${theme.total.width ?? 1.2}"/><line x1="${R - vw}" y1="${vy + 13}" x2="${R}" y2="${vy + 13}" stroke="${theme.total.rule}" stroke-width="${theme.total.width ?? 1.2}"/>`);
    if (spec.total.sub) o.push(t(R - 10, vy + 31, spec.total.sub, { size: theme.size - 3, fill: C.soft, anchor: 'end' }));
    y += th;
  }
  if (notes) {
    const ny = y + 22;
    o.push(`<rect x="${L}" y="${ny}" width="${R - L}" height="${noteH}" rx="8" fill="${theme.note.fill}" stroke="${theme.note.edge}" stroke-width="1"/>`,
      t(L + 18, ny + 34, notes.title, { size: theme.size - 1, weight: 700, fill: theme.note.title }));
    notes.lines.forEach((n, i) => {
      const ly = ny + 34 + 30 + i * (theme.size + 12);
      const lw = measure(n.label, theme.face, theme.size, true);
      o.push(t(L + 18, ly, n.label, { weight: 700 }), t(L + 18 + lw + 12, ly, n.text, { fill: C.soft }));
    });
  }
  if (spec.footer && last) o.push(t(L, H - 22 - pad, spec.footer, { size: theme.size - 2, fill: C.soft }));
  else if (!last) o.push(t(R, H - 10 - pad, 'continued on the next picture', { size: theme.size - 4, fill: C.soft, anchor: 'end', style: 'italic' }));
  o.push('</svg>');
  return o.join('');
}

// -------------------------------------------------------------- the receipt
// Like a till receipt (his reference: docs/test/receipt-07-amazon.png): one
// monospace face, no boxes, no symbols. Each row is its words on the left
// and its amount on the right; lines are drawn, never typed.
function receipt(spec, page, { n, of, last }) {
  const W = Math.min(spec.width ?? WIDTH, 1000);
  const CW = 10.2; // one character at 17px
  const LH = 28;
  const ink = '#1d1d1d'; const soft = '#6b6b6b';
  const F = "font-family=\"'IBM Plex Mono', Menlo, monospace\"";
  const t = (x, y, s, { size = 17, weight = 400, fill = ink, anchor = 'start' } = {}) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" xml:space="preserve">${esc(s)}</text>`;
  const L = 48; const R = W - 48;
  const rightAll = spec.columns.map((c, i) => (c.align === 'right' ? i : -1)).filter((i) => i >= 0);
  // THE AMOUNT ON THE RIGHT, its currency in front of it: a wide sheet's
  // other right hand numbers ("31" payable days) get a label instead.
  const amountCol = rightAll.at(-1);
  const currencyCol = spec.columns.findIndex((c) => /^currency$/i.test(c.label));
  const wide = spec.columns.length > 6;
  const plainCols = spec.columns.map((c, i) => i).filter((i) => i !== amountCol && i !== currencyCol && (!wide || spec.columns[i].align !== 'right'));
  const firstCols = wide ? plainCols.slice(0, 3) : plainCols;
  const labelled = wide ? spec.columns.map((c, i) => i).filter((i) => i !== amountCol && i !== currencyCol && !firstCols.includes(i)) : [];
  // a row: its first words, then "Label value" pairs that wrap, the same
  // value said once for every field that holds it
  const layout = (r) => {
    const amount = amountCol === undefined ? '' : r.cells[amountCol] ?? '';
    const right = currencyCol >= 0 && r.cells[currencyCol] && amount ? `${r.cells[currencyCol]} ${amount}` : amount;
    const room = Math.floor((R - L) / CW);
    const tokens = firstCols.map((i) => ({ i, text: String(r.cells[i] ?? '').trim() })).filter((x) => x.text);
    const byValue = new Map();
    for (const i of labelled) {
      const v = String(r.cells[i] ?? '').trim();
      if (!v) continue;
      byValue.set(v, [...(byValue.get(v) ?? []), i]);
    }
    for (const [v, is] of byValue) {
      const label = is.map((i) => spec.columns[i].label).join(', ');
      tokens.push({ i: is[0], label: `${label}:`, text: v, all: is });
    }
    const placed = [];
    let line = 0; let col = 0;
    for (const x of tokens) {
      const full = x.label ? `${x.label} ${x.text}` : x.text;
      const limit = line === 0 ? room - right.length - 3 : room;
      const width = Math.min(full.length, room);
      if (col > 0 && col + 3 + width > limit) { line += 1; col = 0; }
      const at = col === 0 ? 0 : col + 3;
      placed.push({ ...x, text: cut(x.text, room - (x.label ? x.label.length + 1 : 0)), line, col: at });
      col = at + width;
    }
    return { right, placed, lines: line + 1 + (r.sub ? 1 : 0) };
  };
  const count = page.reduce((m, s) => m + (s.label ? 2 : 0) + s.rows.reduce((k, r) => k + layout(r).lines, 0) + s.rows.length * 0.35, 0);
  const notes = last && spec.notes?.lines?.length ? spec.notes : null;
  const H = Math.round(150 + (spec.subtitle ? 30 : 0) + count * LH + (last && spec.total ? 110 : 30) + (notes ? 60 + notes.lines.length * LH : 0) + (spec.footer && last ? 50 : 20));
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  let y = 62;
  o.push(t(W / 2, y, `${spec.title}${of > 1 ? ` (${n}/${of})` : ''}`.toUpperCase(), { size: 22, weight: 600, anchor: 'middle' }));
  if (spec.subtitle) { y += 32; o.push(t(W / 2, y, spec.subtitle, { size: 15, fill: soft, anchor: 'middle' })); }
  if (spec.status) { y += 30; o.push(t(W / 2, y, spec.status.text, { size: 15, weight: 600, fill: spec.status.tone === 'pending' ? '#9a3b00' : spec.status.tone === 'ok' ? '#1e6b34' : soft, anchor: 'middle' })); }
  // rules barely there (his call 2026-10-07: no strong borders)
  const rule = (yy, dashed = true) => `<line x1="${L}" y1="${yy}" x2="${R}" y2="${yy}" stroke="#d6d6d6" stroke-width="0.8"${dashed ? ' stroke-dasharray="5 6"' : ''}/>`;
  y += 26; o.push(rule(y)); y += 14;
  for (const s of page) {
    if (s.label) { y += LH; o.push(t(L, y, s.label, { weight: 600 })); y += LH * 0.6; }
    for (const r of s.rows) {
      const { right, placed } = layout(r);
      y += LH;
      const rows = Math.max(...placed.map((p) => p.line), 0);
      for (const p of placed) {
        let x = L + p.col * CW;
        const yy = y + p.line * LH;
        if (p.label) { o.push(t(x, yy, p.label, { size: 15, fill: soft })); x += (p.label.length + 1) * CW; }
        if ((p.all ?? [p.i]).some((i) => (r.tint ?? []).includes(i))) o.push(`<rect x="${x - 3}" y="${yy - 19}" width="${p.text.length * CW + 6}" height="26" fill="#ffe98a"/>`);
        o.push(t(x, yy, p.text, { fill: (r.strike ?? []).includes(p.i) ? soft : ink }));
      }
      if (right) {
        const tinted = [amountCol, currencyCol].some((i) => (r.tint ?? []).includes(i));
        if (tinted) o.push(`<rect x="${R - right.length * CW - 3}" y="${y - 19}" width="${right.length * CW + 6}" height="26" fill="#ffe98a"/>`);
        o.push(t(R, y, right, { weight: 600, anchor: 'end' }));
      }
      y += rows * LH;
      if (r.sub) { y += LH; o.push(t(R, y, r.sub, { size: 15, fill: soft, anchor: 'end' })); }
      y += LH * 0.35;
    }
  }
  if (last && spec.total) {
    y += 24; o.push(rule(y, false)); y += 36;
    o.push(t(L, y, (spec.total.label ?? 'Total').toUpperCase(), { size: 19, weight: 600 }), t(R, y, spec.total.value, { size: 19, weight: 600, anchor: 'end' }));
    if (spec.total.sub) { y += 28; o.push(t(R, y, spec.total.sub, { size: 15, fill: soft, anchor: 'end' })); }
  }
  if (notes) {
    y += 40; o.push(rule(y)); y += 34;
    o.push(t(L, y, notes.title.toUpperCase(), { size: 15, weight: 600 }));
    notes.lines.forEach((n) => { y += LH; o.push(t(L, y, n.label, { weight: 600 }), t(L + (n.label.length + 2) * CW, y, n.text, { fill: soft })); });
  }
  if (spec.footer && last) o.push(t(W / 2, H - 28, spec.footer, { size: 15, fill: soft, anchor: 'middle' }));
  else if (!last) o.push(t(W / 2, H - 20, 'continued on the next picture', { size: 14, fill: soft, anchor: 'middle' }));
  o.push('</svg>');
  return o.join('');
}

// ------------------------------------------------------------- the notebook
function notebook(spec, page, { n, of, last }) {
  const C = {
    paper: '#fbf7ec', rule: '#c9d8ea', margin: '#e6a1a1', pen: '#1d3a8a', red: '#c0392b', soft: '#6b6b6b', marker: '#fff27a', ok: '#2e7d32',
  };
  const F = 'font-family="Caveat"';
  // The handwriting has no arrow: "→" in it fell back to a typed font for
  // the whole cell, so the pen writes "->".
  const pen = (v) => String(v ?? '').replace(/\s*→\s*/g, ' -> ');
  const t = (x, y, s, { size = 28, weight = 400, fill = C.pen, anchor = 'start', deco = '' } = {}) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${deco ? ` text-decoration="${deco}"` : ''}>${esc(pen(s))}</text>`;
  const LINE = 42;
  const SIZE = 28;
  const HEAD = 22;
  const M = 96;
  const everyRow = spec.sections.flatMap((s) => s.rows.map((r) => ({ ...r, cells: r.cells.map(pen) })));
  const fit = fitColumns(spec.columns.map((c) => ({ ...c, label: c.label.toLowerCase() })), everyRow, {
    face: 'hand', size: SIZE, headSize: HEAD, pad: 20, avail: (spec.width ?? WIDTH) - M - 44,
  });
  const W = Math.round(fit.total + M + 44);
  const R = W - 44;
  const xs = [M];
  for (const w of fit.widths) xs.push(xs.at(-1) + w);
  const inner = (i) => xs[i + 1] - xs[i] - 14;
  const linesOf = (r) => spec.columns.map((c, i) => wrapTo(pen(r.cells[i]), inner(i), 'hand', SIZE, c.align === 'right'));
  const rowLines = (r) => Math.max(1, ...linesOf(r).map((l) => l.length));
  const headLines = spec.columns.map((c, i) => wrapTo(c.label.toLowerCase(), inner(i), 'hand', HEAD));
  const headRows = Math.max(1, ...headLines.map((l) => l.length));
  const title = `${spec.title}${of > 1 ? ` (${n}/${of})` : ''}`;
  const titleW = measure(title, 'hand', 44, true);
  const statusBelow = spec.status && titleW + measure(spec.status.text, 'hand', 28) + 60 > R - M;
  const totalW = spec.total ? measure(spec.total.value, 'hand', 32, true) : 0;
  const labelW = spec.total ? measure(spec.total.label ?? 'Total', 'hand', 32, true) : 0;
  const totalTwoLines = spec.total && labelW + totalW + 40 > R - M;
  const lineCount = page.reduce((n2, s) => n2 + (s.label ? 1 : 0) + s.rows.reduce((m, r) => m + rowLines(r) + (r.sub ? 1 : 0), 0), 0) + headRows - 1;
  const notes = last && spec.notes?.lines?.length ? spec.notes : null;
  const H = 130 + (lineCount + 1) * LINE + (last && spec.total ? (totalTwoLines ? 4 : 3) * LINE : 0) + (notes ? (notes.lines.length + 2) * LINE : 0) + (spec.footer && last ? LINE : 0) + 30;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`, `<rect width="${W}" height="${H}" fill="${C.paper}"/>`];
  for (let ly = 130; ly < H - 6; ly += LINE) o.push(`<line x1="0" y1="${ly}" x2="${W}" y2="${ly}" stroke="${C.rule}" stroke-width="1.2"/>`);
  o.push(`<line x1="${M - 16}" y1="0" x2="${M - 16}" y2="${H}" stroke="${C.margin}" stroke-width="2"/>`);
  o.push(t(M, 70, title, { size: 44, weight: 700 }));
  o.push(`<path d="M ${M} 82 q ${titleW / 2} 6 ${titleW} 0" stroke="${C.pen}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  if (spec.subtitle) o.push(t(M, 116, spec.subtitle, { size: 24, fill: C.soft }));
  if (spec.status) {
    const tone = spec.status.tone === 'ok' ? C.ok : spec.status.tone === 'pending' ? C.red : C.soft;
    o.push(statusBelow ? t(R, 116, spec.status.text.toLowerCase(), { size: 26, fill: tone, anchor: 'end' }) : t(R + 4, 64, spec.status.text.toLowerCase(), { size: 28, fill: tone, anchor: 'end' }));
  }
  let y = 130 + LINE - 10;
  // the column heads, small, like a ruled ledger
  spec.columns.forEach((c, i) => headLines[i].forEach((line, k) => o.push(t(c.align === 'right' ? xs[i + 1] - 4 : xs[i], y + k * LINE, line, { size: HEAD, fill: C.soft, anchor: c.align === 'right' ? 'end' : 'start' }))));
  y += LINE * headRows;
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
          const w = measure(v, 'hand', SIZE, right);
          if ((r.tint ?? []).includes(i)) o.push(`<rect x="${(right ? x - w : x) - 4}" y="${y + k * LINE - 26}" width="${w + 8}" height="32" rx="6" fill="${C.marker}" opacity="0.75"/>`);
          o.push(t(x, y + k * LINE, v, { fill: v === '???' ? C.red : struck ? C.soft : C.pen, anchor: right ? 'end' : 'start', weight: right ? 700 : 400, deco: struck ? 'line-through' : '' }));
        });
      });
      // a "?" in the margin where something needs checking; a plan's tint is
      // just the change, so it has none
      if ((r.tint ?? []).length && spec.marks !== false) o.push(t(M - 50, y, '?', { size: 32, fill: C.red }));
      y += LINE * rowLines(r);
      if (r.sub) { o.push(t(R, y - 6, r.sub, { size: 22, fill: C.soft, anchor: 'end' })); y += LINE; }
    }
  }
  if (last && spec.total) {
    y += LINE / 2;
    // the label never under its value: placed by their measured widths
    const lineFrom = Math.max(M, R - Math.max(totalW, totalTwoLines ? labelW : labelW + totalW + 30) - 10);
    o.push(`<line x1="${lineFrom}" y1="${y - 30}" x2="${R}" y2="${y - 30}" stroke="${C.pen}" stroke-width="2"/>`);
    o.push(t(lineFrom, y, spec.total.label ?? 'Total', { size: 32, weight: 700 }));
    if (totalTwoLines) y += LINE;
    o.push(t(R, y, spec.total.value, { size: 32, weight: 700, anchor: 'end' }));
    o.push(`<line x1="${R - totalW - 6}" y1="${y + 8}" x2="${R}" y2="${y + 8}" stroke="${C.pen}" stroke-width="2"/><line x1="${R - totalW - 6}" y1="${y + 13}" x2="${R}" y2="${y + 13}" stroke="${C.pen}" stroke-width="2"/>`);
    y += LINE;
    if (spec.total.sub) { o.push(t(R, y - 4, spec.total.sub, { size: 24, fill: C.soft, anchor: 'end' })); y += LINE; }
  }
  if (notes) {
    y += LINE;
    o.push(t(M, y, notes.title, { size: 30, weight: 700, deco: 'underline' }));
    notes.lines.forEach((n) => { y += LINE; const lw = measure(n.label, 'hand', 28, true); o.push(t(M + 10, y, n.label, { weight: 700 }), t(M + 10 + lw + 14, y, n.text, { fill: C.soft })); });
  }
  if (spec.footer && last) o.push(t(M, H - 20, spec.footer.toLowerCase(), { size: 24, fill: C.soft }));
  else if (!last) o.push(t(R, H - 14, 'continued on the next page…', { size: 22, fill: C.soft, anchor: 'end' }));
  o.push('</svg>');
  return o.join('');
}

/**
 * @param {TableSpec} spec
 * @returns {Buffer[]} one PNG per page; none for the text style
 */
function renderTable(spec) {
  const style = STYLES.includes(spec.style) ? spec.style : 'sheet';
  if (spec.style === 'text') return [];
  const perPage = spec.perPage ?? (style === 'notebook' || style === 'receipt' ? 20 : 25);
  const all = pages(spec, perPage);
  return all.map((page, i) => {
    const at = { n: i + 1, of: all.length, last: i === all.length - 1 };
    const svg = style === 'notebook' ? notebook(spec, page, at)
      : style === 'receipt' ? receipt(spec, page, at)
        : sheet(spec, page, at, THEMES[style]);
    return new Resvg(svg, {
      font: { loadSystemFonts: true, fontFiles: FONT_FILES, defaultFontFamily: 'Helvetica' },
    }).render().asPng();
  });
}

export { renderTable, worthAPicture, rowCount, MIN_ROWS, STYLES, FONT_FILES };
