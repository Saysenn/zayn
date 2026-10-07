const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const format = require('./format');

// ***************************************************
// * THE PREVIEW AS A PICTURE: WHATSAPP AND DIANE'S CHAT
// ***************************************************
//
// His calls 2026-10-07: a picture, "always"; then "not thick borders, it's
// very AI": professional, in the master sheet export's 5th colour (Blue
// white: a #DDEBF7 header with black type, #F2F8FD rows), and a notebook
// style "like a real handwritten note". Chosen in Settings → Whatbot.
// A field that needs review is tinted ON ITS OWN CELL, never the whole row.
// Drawn by code from these templates (no model), SVG to PNG.

const STYLES = ['sheet', 'notebook', 'text'];
const FONT_FILE = path.join(__dirname, '../../../assets/fonts/Caveat.ttf');
const W = 1000;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s, n) => { const v = String(s ?? ''); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
const ASK = {
  groupName: 'which group?', spentOn: 'what date?', description: 'what was it for?', rawAmount: 'how much?', payee: 'paid to whom?', spentBy: 'spent by whom?',
};

const reviewOf = (x) => ({
  date: (x.missing ?? []).includes('spentOn') || (x.doubts ?? []).some((d) => /date/.test(d)),
  payee: (x.missing ?? []).includes('payee') || (x.doubts ?? []).some((d) => /already saved|another .* on|same as/.test(d)),
  by: (x.missing ?? []).includes('spentBy'),
  what: (x.missing ?? []).includes('description'),
  amount: (x.missing ?? []).some((f) => f === 'rawAmount' || f === 'exchangeRate') || (x.doubts ?? []).some((d) => /amount|rate/.test(d)),
  group: (x.missing ?? []).includes('groupName'),
});
const asks = (x) => [...(x.missing ?? []).map((f) => (f === 'exchangeRate' ? `1 ${x.currency} to AED?` : ASK[f] ?? f)), ...(x.doubts ?? [])];
const totals = (live) => {
  const by = new Map();
  for (const x of live) if (x.currency && Number.isFinite(Number(x.rawAmount))) by.set(x.currency, (by.get(x.currency) ?? 0) + Number(x.rawAmount));
  const text = [...by].map(([c, n]) => format.money(c, Math.round(n * 100) / 100)).join('  +  ') || '?';
  const mixed = [...by.keys()].some((c) => c !== 'AED');
  const rated = live.every((x) => x.currency === 'AED' || x.exchangeRate);
  const aed = live.reduce((n, x) => n + (Number(x.rawAmount) || 0) * (x.currency === 'AED' ? 1 : Number(x.exchangeRate) || 0), 0);
  return { text, aed: mixed && rated ? format.money('AED', Math.round(aed * 100) / 100) : null };
};
const aedLine = (x) => (x.currency && x.currency !== 'AED'
  ? (x.exchangeRate ? `≈ ${format.money('AED', Math.round(x.rawAmount * x.exchangeRate * 100) / 100)} at ${x.exchangeRate}` : 'rate to AED needed')
  : '');

// ---------------------------------------------------------------- the sheet
// Like the master sheet export: a thin grid, the Blue white header.
function sheet(items, { group, saved, today }) {
  const live = items.filter((x) => !x.skipped);
  const all = group === '*';
  const C = {
    ink: '#1f2328', soft: '#5f6368', grid: '#c8d3df', head: '#DDEBF7', zebra: '#F2F8FD', review: '#FFF2CC', reviewInk: '#9a6700', missing: '#9aa0a6', ok: '#1e7e34',
  };
  const F = "font-family=\"Helvetica, Arial, 'Segoe UI', sans-serif\"";
  const t = (x, y, s, { size = 17, weight = 400, fill = C.ink, anchor = 'start', style = 'normal' } = {}) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" font-style="${style}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
  const L = 32; const R = W - 32;
  const cols = all
    ? [['No.', 46], ['Group', 104], ['What', 230], ['Paid to', 150], ['Date', 92], ['Spent by', 116], ['Amount', 198]]
    : [['No.', 46], ['What', 300], ['Paid to', 170], ['Date', 100], ['Spent by', 124], ['Amount', 196]];
  const xs = [L];
  for (const [, w] of cols) xs.push(xs.at(-1) + w);
  const rowH = (x) => (aedLine(x) ? 52 : 38);
  const ask = saved ? [] : live.filter((x) => asks(x).length);
  const tableH = 36 + live.reduce((n, x) => n + rowH(x), 0) + 42;
  const H = 104 + tableH + (ask.length ? 40 + ask.length * 26 : 0) + 64;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  o.push(t(L, 50, `Expenses${all ? '' : ` · ${group}`}`, { size: 28, weight: 700 }));
  o.push(t(L, 78, `${format.dayFull(today)}  ·  ${live.length} ${live.length === 1 ? 'item' : 'items'}`, { size: 15, fill: C.soft }));
  o.push(t(R, 50, saved ? 'Saved' : 'Not saved yet', { size: 16, weight: 700, fill: saved ? C.ok : C.reviewInk, anchor: 'end' }));
  let y = 104;
  // header
  o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="36" fill="${C.head}"/>`);
  cols.forEach(([label], i) => o.push(t(i === cols.length - 1 ? xs[i + 1] - 10 : xs[i] + 10, y + 24, label, { size: 14, weight: 700, anchor: i === cols.length - 1 ? 'end' : 'start' })));
  y += 36;
  live.forEach((x, i) => {
    const h = rowH(x);
    const rv = saved ? {} : reviewOf(x);
    const cells = all
      ? [String(x.n ?? i + 1), x.groupName ?? '', x.description ?? '', x.payee ?? '', format.day(x.spentOn), x.spentBy ?? '', x.rawAmount == null ? '' : format.money(x.currency, x.rawAmount)]
      : [String(x.n ?? i + 1), x.description ?? '', x.payee ?? '', format.day(x.spentOn), x.spentBy ?? '', x.rawAmount == null ? '' : format.money(x.currency, x.rawAmount)];
    const keys = all ? ['n', 'group', 'what', 'payee', 'date', 'by', 'amount'] : ['n', 'what', 'payee', 'date', 'by', 'amount'];
    o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="${h}" fill="${i % 2 ? C.zebra : '#ffffff'}"/>`);
    keys.forEach((k, c) => { if (rv[k]) o.push(`<rect x="${xs[c]}" y="${y}" width="${xs[c + 1] - xs[c]}" height="${h}" fill="${C.review}"/>`); });
    const maxChars = (c) => Math.floor((xs[c + 1] - xs[c] - 18) / 8.6);
    keys.forEach((k, c) => {
      const right = c === keys.length - 1;
      const val = cells[c];
      o.push(t(right ? xs[c + 1] - 10 : xs[c] + 10, y + 25, val ? cut(val, maxChars(c)) : 'missing', {
        size: k === 'amount' ? 17 : 16, weight: k === 'amount' || k === 'n' ? 700 : 400, fill: val ? C.ink : C.missing, anchor: right ? 'end' : 'start', style: val ? 'normal' : 'italic',
      }));
    });
    const extra = aedLine(x);
    if (extra) o.push(t(xs.at(-1) - 10, y + 44, extra, { size: 12, fill: C.soft, anchor: 'end' }));
    y += h;
  });
  // the grid: thin, light, once, over everything
  const top = 104;
  o.push(`<rect x="${L}" y="${top}" width="${R - L}" height="${y - top}" fill="none" stroke="${C.grid}" stroke-width="1"/>`);
  xs.slice(1, -1).forEach((gx) => o.push(`<line x1="${gx}" y1="${top}" x2="${gx}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`));
  let ry = top + 36;
  o.push(`<line x1="${L}" y1="${ry}" x2="${R}" y2="${ry}" stroke="${C.grid}" stroke-width="1"/>`);
  live.forEach((x) => { ry += rowH(x); o.push(`<line x1="${L}" y1="${ry}" x2="${R}" y2="${ry}" stroke="${C.grid}" stroke-width="1"/>`); });
  // total row
  const tot = totals(live);
  o.push(`<rect x="${L}" y="${y}" width="${R - L}" height="42" fill="${C.head}"/>`,
    `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="#7f8c99" stroke-width="1.2"/>`,
    t(L + 10, y + 27, 'Total', { size: 16, weight: 700 }),
    t(R - 10, y + 27, `${tot.text}${tot.aed ? `   (≈ ${tot.aed})` : ''}`, { size: 17, weight: 700, anchor: 'end' }));
  y += 42 + 30;
  if (ask.length) {
    o.push(t(L, y, 'Needs an answer', { size: 15, weight: 700, fill: C.reviewInk }));
    ask.forEach((x, i) => o.push(t(L, y + 26 * (i + 1), cut(`No. ${x.n}  —  ${asks(x).join(';  ')}`, 100), { size: 15, fill: C.ink })));
    y += 26 * (ask.length + 1);
  }
  if (!saved) o.push(t(L, H - 22, 'Reply yes · modify · cancel', { size: 14, fill: C.soft }));
  o.push('</svg>');
  return o.join('');
}

// ------------------------------------------------------------- the notebook
// A real note: ruled cream paper, a red margin, a blue pen, a highlighter on
// just the part that needs checking.
function notebook(items, { group, saved, today }) {
  const live = items.filter((x) => !x.skipped);
  const all = group === '*';
  const C = {
    paper: '#fbf7ec', rule: '#c9d8ea', margin: '#e6a1a1', pen: '#1d3a8a', red: '#c0392b', soft: '#6b6b6b', marker: '#fff27a', ok: '#2e7d32',
  };
  const F = 'font-family="Caveat"';
  const t = (x, y, s, { size = 30, weight = 400, fill = C.pen, anchor = 'start' } = {}) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
  const LINE = 44;
  const M = 96;
  const ask = saved ? [] : live.filter((x) => asks(x).length);
  const rows = live.length + (live.some((x) => aedLine(x)) ? live.filter((x) => aedLine(x)).length : 0);
  const H = 140 + (rows + 3) * LINE + (ask.length ? (ask.length + 1) * LINE : 0) + 50;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`, `<rect width="${W}" height="${H}" fill="${C.paper}"/>`];
  for (let y = 120; y < H - 10; y += LINE) o.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${C.rule}" stroke-width="1.2"/>`);
  o.push(`<line x1="${M - 16}" y1="0" x2="${M - 16}" y2="${H}" stroke="${C.margin}" stroke-width="2"/>`);
  const title = `${all ? 'Expenses' : `${group} expenses`} — ${format.dayFull(today)}`;
  o.push(t(M, 78, title, { size: 46, weight: 700 }));
  o.push(`<path d="M ${M} 90 q ${title.length * 9} 6 ${title.length * 18} 0" stroke="${C.pen}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
  o.push(t(W - 40, 70, saved ? 'saved ✓' : 'not saved yet', { size: 30, fill: saved ? C.ok : C.red, anchor: 'end' }));
  let y = 120 + LINE - 10;
  const mark = (x0, w) => `<rect x="${x0 - 4}" y="${y - 28}" width="${w + 8}" height="34" rx="6" fill="${C.marker}" opacity="0.75"/>`;
  live.forEach((x, i) => {
    const rv = saved ? {} : reviewOf(x);
    const n = `${x.n ?? i + 1}.`;
    const what = cut(x.description || '???', all ? 20 : 24);
    const payee = x.payee ? cut(x.payee, 16) : '???';
    const date = x.spentOn ? format.day(x.spentOn) : '???';
    const by = x.spentBy ? cut(x.spentBy, 11) : '???';
    const amt = x.rawAmount == null ? '???' : format.money(x.currency, x.rawAmount);
    const grp = all ? `${x.groupName ?? '???'} · ` : '';
    // fixed columns, like a neat list: what, paid to, date, who
    const wOf = (v) => String(v).length * 11.2;
    const at = all ? { group: M, what: M + 120, payee: M + 380, date: M + 540, by: M + 640 } : { what: M, payee: M + 290, date: M + 470, by: M + 580 };
    const put = (v, key) => { if (rv[key]) o.push(mark(at[key], wOf(v))); o.push(t(at[key], y, v, { fill: v === '???' ? C.red : C.pen })); };
    o.push(t(M - 58, y, n, { size: 30, fill: C.soft }));
    if (all) put(grp.replace(' · ', ''), 'group');
    put(what, 'what');
    put(payee, 'payee');
    put(date, 'date');
    put(by, 'by');
    if (rv.amount) o.push(mark(W - 48 - wOf(amt), wOf(amt)));
    o.push(t(W - 48, y, amt, { anchor: 'end', weight: 700 }));
    if (!saved && asks(x).length) o.push(t(M - 82, y, '?', { size: 34, fill: C.red }));
    y += LINE;
    const extra = aedLine(x);
    if (extra) { o.push(t(W - 48, y - 6, extra, { size: 24, fill: C.soft, anchor: 'end' })); y += LINE; }
  });
  const tot = totals(live);
  y += LINE / 2;
  o.push(`<line x1="${W - 420}" y1="${y - 30}" x2="${W - 48}" y2="${y - 30}" stroke="${C.pen}" stroke-width="2"/>`);
  o.push(t(W - 420, y, 'Total', { size: 32, weight: 700 }), t(W - 48, y, tot.text, { size: 32, weight: 700, anchor: 'end' }));
  o.push(`<line x1="${W - 300}" y1="${y + 8}" x2="${W - 48}" y2="${y + 8}" stroke="${C.pen}" stroke-width="2"/><line x1="${W - 300}" y1="${y + 13}" x2="${W - 48}" y2="${y + 13}" stroke="${C.pen}" stroke-width="2"/>`);
  y += LINE;
  if (tot.aed) { o.push(t(W - 48, y - 4, `≈ ${tot.aed}`, { size: 26, fill: C.soft, anchor: 'end' })); y += LINE; }
  if (ask.length) {
    o.push(t(M, y, 'To check:', { size: 32, weight: 700, fill: C.red }));
    ask.forEach((x, i) => o.push(t(M + 20, y + LINE * (i + 1), cut(`No. ${x.n} — ${asks(x).join('; ')}`, 70), { size: 28, fill: C.red })));
    y += LINE * (ask.length + 1);
  }
  if (!saved) o.push(t(M, H - 20, 'reply: yes · modify · cancel', { size: 26, fill: C.soft }));
  o.push('</svg>');
  return o.join('');
}

/**
 * @param {object[]} items the expenses, as the preview holds them
 * @param {{ group: string, saved?: boolean, style?: string, today?: string }} opts
 * @returns {Buffer|null} a PNG, or null for the plain-text style
 */
function renderCard(items, { group, saved = false, style = 'sheet', today = new Date().toISOString().slice(0, 10) } = {}) {
  if (style === 'text') return null;
  const svg = style === 'notebook' ? notebook(items, { group, saved, today }) : sheet(items, { group, saved, today });
  return new Resvg(svg, {
    font: { loadSystemFonts: true, fontFiles: [FONT_FILE], defaultFontFamily: style === 'notebook' ? 'Caveat' : 'Helvetica' },
    fitTo: { mode: 'width', value: W },
  }).render().asPng();
}

/** Sample expenses for the Settings preview of each style. */
const SAMPLE = [
  { n: 1, spentOn: '2026-10-06', description: 'Taxi to office', payee: 'Careem', rawAmount: 45, currency: 'AED', spentBy: 'Sara K', missing: [], doubts: [] },
  { n: 2, spentOn: null, description: 'Parking', payee: 'RTA', rawAmount: 20, currency: 'AED', spentBy: 'Sara K', missing: ['spentOn'], doubts: [] },
  { n: 3, spentOn: '2026-10-05', description: 'Train to Leeds', payee: 'Trainline', rawAmount: 86.4, currency: 'GBP', exchangeRate: 4.86, spentBy: 'Omar T', missing: [], doubts: [] },
  { n: 4, spentOn: '2026-10-07', description: 'Office chairs', payee: 'IKEA', rawAmount: 2400, currency: 'AED', spentBy: 'Omar T', missing: [], doubts: ['a large amount: is it right?'] },
];

module.exports = { renderCard, STYLES, SAMPLE };
