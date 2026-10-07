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

const STYLES = ['sheet', 'notebook', 'receipt', 'ledger', 'chalkboard'];
const { renderTable } = require('../../pictures/table');

const reviewOf = (x) => ({
  date: (x.missing ?? []).includes('spentOn') || (x.doubts ?? []).some((d) => /date/.test(d)),
  payee: (x.missing ?? []).includes('payee') || (x.doubts ?? []).some((d) => /already saved|another .* on|same as/.test(d)),
  by: (x.missing ?? []).includes('spentBy'),
  what: (x.missing ?? []).includes('description'),
  amount: (x.missing ?? []).some((f) => f === 'rawAmount' || f === 'exchangeRate') || (x.doubts ?? []).some((d) => /amount|rate/.test(d)),
  group: (x.missing ?? []).includes('groupName'),
});
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

const PER_PAGE = 25;

/**
 * THE PREVIEW IN PAGES of 25, each readable on a phone, the total on the
 * last (his call 2026-10-07: 141 rows squeezed into one picture).
 * @param {object[]} items the expenses, as the preview holds them
 * @param {{ group: string, saved?: boolean, style?: string, today?: string }} opts
 * @returns {Buffer[]} PNGs; none for the plain-text style
 */
function renderCards(items, { group, saved = false, style = 'sheet', today = new Date().toISOString().slice(0, 10) } = {}) {
  if (style === 'text') return [];
  // EVERY STYLE IS THE SHARED TABLE (pictures/table.js): measured columns,
  // nothing cut, nothing overlapping (his call 2026-10-07), pages of 25.
  return renderTable({ ...asTable(items, { group, saved, today, style }), perPage: PER_PAGE });
}

/** The preview as a table for pictures/table.js. */
function asTable(items, { group, saved, today, style }) {
  const live = items.filter((x) => !x.skipped);
  const all = group === '*';
  const keys = ['n', ...(all ? ['group'] : []), 'what', 'payee', 'date', 'by', 'amount'];
  const tot = totals(live);
  return {
    style,
    title: `Expenses${all ? '' : ` · ${group}`}`,
    subtitle: `${format.dayFull(today)} · ${live.length} ${live.length === 1 ? 'item' : 'items'}`,
    status: saved ? { text: 'Saved', tone: 'ok' } : { text: 'Not saved yet', tone: 'pending' },
    columns: [
      { label: 'No.', weight: 0.5 }, ...(all ? [{ label: 'Group', weight: 1.1 }] : []),
      { label: 'What', weight: 2.6 }, { label: 'Paid to', weight: 1.6 }, { label: 'Date', weight: 1 }, { label: 'Spent by', weight: 1.2 }, { label: 'Amount', weight: 1.8, align: 'right' },
    ],
    sections: [{
      rows: live.map((x, i) => {
        const rv = saved ? {} : reviewOf(x);
        const v = {
          n: String(x.n ?? i + 1), group: x.groupName ?? '', what: x.description ?? '', payee: x.payee ?? '', date: x.spentOn ? format.day(x.spentOn) : '', by: x.spentBy ?? '', amount: x.rawAmount == null ? '' : format.money(x.currency, x.rawAmount),
        };
        return {
          cells: keys.map((k) => v[k] || (k === 'n' ? '' : 'missing')),
          tint: keys.map((k, c) => (rv[k] || !v[k] ? c : -1)).filter((c) => c > 0),
          ...(aedLine(x) ? { sub: aedLine(x) } : {}),
        };
      }),
    }],
    total: { value: tot.text, ...(tot.aed ? { sub: `≈ ${tot.aed}` } : {}) },
    ...(saved ? {} : { footer: 'Reply yes · modify · cancel' }),
  };
}

/** One picture, for a short preview and the Settings samples. */
function renderCard(items, opts = {}) {
  return renderCards(items, opts)[0] ?? null;
}

/** Sample expenses for the Settings preview of each style. */
const SAMPLE = [
  { n: 1, spentOn: '2026-10-06', description: 'Taxi to office', payee: 'Careem', rawAmount: 45, currency: 'AED', spentBy: 'Sara K', missing: [], doubts: [] },
  { n: 2, spentOn: null, description: 'Parking', payee: 'RTA', rawAmount: 20, currency: 'AED', spentBy: 'Sara K', missing: ['spentOn'], doubts: [] },
  { n: 3, spentOn: '2026-10-05', description: 'Train to Leeds', payee: 'Trainline', rawAmount: 86.4, currency: 'GBP', exchangeRate: 4.86, spentBy: 'Omar T', missing: [], doubts: [] },
  { n: 4, spentOn: '2026-10-07', description: 'Office chairs', payee: 'IKEA', rawAmount: 2400, currency: 'AED', spentBy: 'Omar T', missing: [], doubts: ['a large amount: is it right?'] },
];

module.exports = { renderCard, renderCards, STYLES, SAMPLE };
