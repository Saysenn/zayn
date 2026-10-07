const { Resvg } = require('@resvg/resvg-js');
const format = require('./format');

// ***************************************************
// * THE PREVIEW AS A PICTURE, FOR WHATSAPP
// ***************************************************
//
// His call 2026-10-07: "always", a clean note that opens full screen when
// tapped. Drawn by code from this template (no model), as an SVG turned
// into a PNG: a header band, a table, the total, what needs an answer. The
// caption beside it carries the reply line, so it can still be answered
// and searched. No emoji in the picture: not every system font has them.

const W = 1000;
const PAD = 36;
const C = {
  band: '#0f5f58', bandText: '#ffffff', ink: '#16302d', soft: '#5b6f6c', line: '#dfe7e5', zebra: '#f5f8f7',
  pending: '#b45309', pendingBg: '#fef3c7', done: '#15803d', doneBg: '#dcfce7', flag: '#d97706', missing: '#b91c1c', paper: '#ffffff',
};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s, n) => { const v = String(s ?? ''); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
const FONT = "font-family=\"Helvetica, Arial, 'Segoe UI', sans-serif\"";
const text = (x, y, s, { size = 20, weight = 400, fill = C.ink, anchor = 'start' } = {}) => `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

const COLS = [
  { key: 'n', x: PAD + 4, w: 40 },
  { key: 'what', x: PAD + 50, w: 300 },
  { key: 'payee', x: PAD + 360, w: 170 },
  { key: 'date', x: PAD + 540, w: 110 },
  { key: 'by', x: PAD + 655, w: 120 },
  { key: 'amount', x: W - PAD - 6, w: 150, right: true },
];
const ASK = {
  groupName: 'which group?', spentOn: 'what date?', description: 'what for?', rawAmount: 'how much?', payee: 'paid to whom?', spentBy: 'spent by whom?',
};

/**
 * @param {object[]} items the expenses, as the preview holds them
 * @param {{ group: string, saved?: boolean }} opts
 * @returns {Buffer} a PNG
 */
function renderCard(items, { group, saved = false } = {}) {
  const live = items.filter((x) => !x.skipped);
  const all = group === '*';
  const rowH = (x) => ((x.currency && x.currency !== 'AED') || x.missing?.length || x.doubts?.length || all ? 62 : 46);
  const askRows = saved ? [] : live.filter((x) => x.missing?.length || x.doubts?.length);
  const bodyH = live.reduce((n, x) => n + rowH(x), 0);
  const H = 130 + 44 + bodyH + 90 + (askRows.length ? 46 + askRows.length * 30 + 16 : 0) + (saved ? 30 : 60);

  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${C.paper}"/>`,
    `<rect width="${W}" height="96" fill="${C.band}"/>`,
    text(PAD, 52, `${live.length} ${live.length === 1 ? 'EXPENSE' : 'EXPENSES'}${all ? '' : `  ·  ${group}`}`, { size: 32, weight: 700, fill: C.bandText }),
    text(PAD, 80, all ? 'All groups' : 'Expenses', { size: 17, fill: '#cfe5e2' })];
  // the status pill
  const pill = saved ? { t: 'SAVED', fg: C.done, bg: C.doneBg } : { t: 'NOT SAVED YET', fg: C.pending, bg: C.pendingBg };
  const pw = pill.t.length * 12 + 36;
  out.push(`<rect x="${W - PAD - pw}" y="30" width="${pw}" height="36" rx="18" fill="${pill.bg}"/>`,
    text(W - PAD - pw / 2, 54, pill.t, { size: 17, weight: 700, fill: pill.fg, anchor: 'middle' }));

  // table head
  let y = 130;
  out.push(`<rect x="${PAD}" y="${y - 28}" width="${W - 2 * PAD}" height="40" rx="6" fill="#eef3f2"/>`);
  for (const [c, label] of COLS.map((c) => [c, { n: 'No.', what: 'What', payee: 'Paid to', date: 'Date', by: 'Spent by', amount: 'Amount' }[c.key]])) {
    out.push(text(c.x, y - 2, label.toUpperCase(), { size: 14, weight: 700, fill: C.soft, anchor: c.right ? 'end' : 'start' }));
  }
  y += 24;

  // rows
  live.forEach((x, i) => {
    const h = rowH(x);
    const top = y;
    if (i % 2 === 1) out.push(`<rect x="${PAD}" y="${top}" width="${W - 2 * PAD}" height="${h}" fill="${C.zebra}"/>`);
    if (!saved && (x.missing?.length || x.doubts?.length)) out.push(`<rect x="${PAD}" y="${top}" width="5" height="${h}" fill="${C.flag}"/>`);
    const base = top + 30;
    const miss = (f) => (x.missing ?? []).includes(f);
    out.push(text(COLS[0].x + 4, base, String(x.n ?? i + 1), { size: 19, weight: 700, fill: C.soft }));
    out.push(text(COLS[1].x, base, cut(x.description || '—', 28), { size: 20, weight: 600 }));
    out.push(text(COLS[2].x, base, miss('payee') ? 'missing' : cut(x.payee, 16), { size: 19, fill: miss('payee') ? C.missing : C.ink }));
    out.push(text(COLS[3].x, base, miss('spentOn') ? 'missing' : format.day(x.spentOn), { size: 19, fill: miss('spentOn') ? C.missing : C.ink }));
    out.push(text(COLS[4].x, base, miss('spentBy') ? 'missing' : cut(x.spentBy, 12), { size: 19, fill: miss('spentBy') ? C.missing : C.ink }));
    out.push(text(COLS[5].x, base, x.rawAmount == null ? '?' : format.money(x.currency, x.rawAmount), { size: 20, weight: 700, anchor: 'end' }));
    // the second line: group, the AED it comes to, or what is wrong
    const second = [];
    if (all) second.push(x.groupName ? x.groupName : 'group missing');
    if (x.currency && x.currency !== 'AED') {
      second.push(x.exchangeRate ? `≈ ${format.money('AED', Math.round(x.rawAmount * x.exchangeRate * 100) / 100)} at ${x.exchangeRate}` : 'rate to AED missing');
    }
    if (!saved && x.doubts?.length) second.push(cut(x.doubts.join('; '), 60));
    if (second.length) out.push(text(COLS[1].x, base + 22, cut(second.join('  ·  '), 90), { size: 15, fill: (!saved && x.doubts?.length) ? C.flag : C.soft }));
    out.push(`<line x1="${PAD}" y1="${top + h}" x2="${W - PAD}" y2="${top + h}" stroke="${C.line}" stroke-width="1"/>`);
    y += h;
  });

  // total
  y += 44;
  const by = new Map();
  for (const x of live) if (x.currency && Number.isFinite(Number(x.rawAmount))) by.set(x.currency, (by.get(x.currency) ?? 0) + Number(x.rawAmount));
  const totalText = [...by].map(([c, n]) => format.money(c, Math.round(n * 100) / 100)).join('  +  ') || '?';
  out.push(text(PAD, y, 'TOTAL', { size: 18, weight: 700, fill: C.soft }), text(W - PAD - 6, y, totalText, { size: 26, weight: 800, anchor: 'end' }));
  const mixed = [...by.keys()].some((c) => c !== 'AED');
  const rated = live.every((x) => x.currency === 'AED' || x.exchangeRate);
  if (mixed && rated) {
    const aed = live.reduce((n, x) => n + (Number(x.rawAmount) || 0) * (x.currency === 'AED' ? 1 : Number(x.exchangeRate) || 0), 0);
    out.push(text(W - PAD - 6, y + 28, `≈ ${format.money('AED', Math.round(aed * 100) / 100)}`, { size: 18, fill: C.soft, anchor: 'end' }));
  }
  y += 46;

  // what needs an answer
  if (askRows.length) {
    const boxH = 46 + askRows.length * 30;
    out.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="${boxH}" rx="10" fill="${C.pendingBg}"/>`,
      text(PAD + 20, y + 32, 'NEEDS AN ANSWER', { size: 16, weight: 800, fill: C.pending }));
    askRows.forEach((x, i) => {
      const what = [...(x.missing ?? []).map((f) => (f === 'exchangeRate' ? `1 ${x.currency} to AED?` : ASK[f] ?? f)), ...(x.doubts ?? [])].join('  ·  ');
      out.push(text(PAD + 20, y + 62 + i * 30, cut(`No. ${x.n}:  ${what}`, 88), { size: 18, fill: C.ink }));
    });
    y += boxH + 16;
  }
  if (!saved) out.push(text(W / 2, H - 26, 'Reply  yes  ·  modify  ·  cancel', { size: 18, weight: 600, fill: C.soft, anchor: 'middle' }));
  out.push('</svg>');
  return new Resvg(out.join(''), { font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' }, fitTo: { mode: 'width', value: W } }).render().asPng();
}

module.exports = { renderCard };
