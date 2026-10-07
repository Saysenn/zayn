const pool = require('../../../configs/db');
const { fold } = require('../../masterSheet/dealKey');
const format = require('./format');

// ***************************************************
// * THEIR GROUP'S SAVED EXPENSES: FIND ONE, OR ANSWER A QUESTION
// ***************************************************
//
// Always scoped to the bot's group: an admin on MANBAT's number never sees,
// changes or totals another group's spending. Every figure is added up here,
// never by the model.

const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const minus = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

/** The group's expenses between two days, newest first. */
async function between(group, from, to) {
  const { rows } = await pool.query(
    `SELECT * FROM tb_expenses
      WHERE lower(group_name) = lower($1) AND spent_on >= $2 AND spent_on <= $3
      ORDER BY spent_on DESC, id DESC LIMIT 2000`,
    [group, from, to],
  );
  return rows;
}

/** Saved expenses as the bot shows them (camel case). */
const asItem = (r) => ({
  id: r.id, spentOn: iso(r.spent_on), description: r.description, payee: r.payee, rawAmount: Number(r.raw_amount), currency: r.currency, spentBy: r.spent_by, aed: r.aed_amount == null ? null : Number(r.aed_amount),
});

// Split FIRST, then fold each word: fold() drops spaces, so "Stationery Sara"
// folded whole was one word and "Sara" never matched (live 2026-10-07).
const wordsOf = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).map((w) => fold(w)).filter((w) => w.length >= 3 && !['the', 'and', 'for', 'one', 'expense', 'expenses', 'paid', 'yesterday', 'today'].includes(w));

/**
 * The saved expenses their words point at, in the last two months.
 * @param {{ words, amount, date, last, all }} target from the router
 * @param {number[]} lastIds what this admin saved last, for "the last one"
 */
async function findTarget(group, target, { today, lastIds = [] } = {}) {
  const rows = (await between(group, minus(today, 62), today)).map(asItem);
  if (target.last && lastIds.length) {
    const hit = rows.filter((r) => lastIds.includes(r.id));
    if (hit.length) return hit;
  }
  const want = wordsOf(target.words);
  const amount = Number(String(target.amount ?? '').replace(/[^\d.]/g, ''));
  const close = (w, h) => h === w || (Math.min(w.length, h.length) >= 4 && (h.startsWith(w) || w.startsWith(h)));
  const scored = rows.map((r) => {
    if (target.date && r.spentOn !== target.date) return null;
    if (target.amount && Number.isFinite(amount) && amount > 0 && Math.abs(r.rawAmount - amount) > 0.005) return null;
    if (!want.length) return target.date || target.amount ? { r, hits: 0 } : null;
    const have = wordsOf(`${r.description} ${r.payee}`);
    const hits = want.filter((w) => have.some((h) => close(w, h))).length;
    return hits >= Math.ceil(want.length / 2) ? { r, hits } : null;
  }).filter(Boolean);
  // THE BEST MATCHES ONLY: "team dinner" is the Team dinner, not every
  // expense with "team" in it.
  const best = Math.max(0, ...scored.map((x) => x.hits));
  return scored.filter((x) => x.hits === best).map((x) => x.r);
}

/** The latest few, when nothing matched, so they can point at one. */
async function latest(group, today, n = 5) {
  return (await between(group, minus(today, 62), today)).slice(0, n).map(asItem);
}

// ---- questions, answered by code ----

function firstOfMonth(day) { return `${day.slice(0, 8)}01`; }

/** "SPENT AED 1,245 ON 12 EXPENSES", worked out here. */
async function answer(group, query, { today }) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : firstOfMonth(today);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : today;
  let rows = (await between(group, from, to)).map(asItem);
  const want = wordsOf(query.words);
  if (want.length) rows = rows.filter((r) => want.some((w) => wordsOf(`${r.description} ${r.payee} ${r.spentBy}`).some((h) => h === w || h.startsWith(w))));
  const span = from === to ? format.day(from) : `${format.day(from)} – ${format.day(to)}`;
  const scope = `${group}${want.length ? ` · "${query.words}"` : ''} · ${span}`;
  if (!rows.length) return `No expenses found for ${scope}.`;

  const aedTotal = rows.reduce((n, r) => n + (r.aed ?? 0), 0);
  const noRate = rows.filter((r) => r.aed == null).length;
  const totalLine = `*${format.money('AED', Math.round(aedTotal * 100) / 100)}* across ${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'}${noRate ? ` _(${noRate} with no AED rate not counted)_` : ''}`;

  if (query.groupBy) {
    const key = { payee: (r) => r.payee || 'no payee', spentBy: (r) => r.spentBy || 'nobody', day: (r) => format.day(r.spentOn), currency: (r) => r.currency, description: (r) => r.description }[query.groupBy];
    const groups = new Map();
    for (const r of rows) {
      const k = key(r);
      const g = groups.get(k) ?? { aed: 0, n: 0 };
      g.aed += r.aed ?? 0;
      g.n += 1;
      groups.set(k, g);
    }
    const lines = [...groups].sort((a, b) => b[1].aed - a[1].aed).slice(0, 20)
      .map(([k, g]) => `• ${k}: *${format.money('AED', Math.round(g.aed * 100) / 100)}* (${g.n})`);
    return [`*Expenses by ${{ payee: 'payee', spentBy: 'person', day: 'day', currency: 'currency', description: 'item' }[query.groupBy]}* · ${scope}`, '', ...lines, '', `Total ${totalLine}`].join('\n');
  }
  if (query.measure === 'count') return `*${rows.length}* ${rows.length === 1 ? 'expense' : 'expenses'} · ${scope}`;
  if (query.measure === 'total') return `Spent ${totalLine}\n_${scope}_`;
  const list = query.measure === 'biggest' ? [...rows].sort((a, b) => (b.aed ?? 0) - (a.aed ?? 0)).slice(0, 5) : rows.slice(0, 15);
  return [
    `*${query.measure === 'biggest' ? 'Biggest expenses' : 'Expenses'}* · ${scope}`, '',
    ...list.map((r) => format.line({ ...r, n: null }, { number: false })),
    ...(query.measure !== 'biggest' && rows.length > 15 ? [`_…and ${rows.length - 15} more on the Expenses page._`] : []),
    '', `Total ${totalLine}`,
  ].join('\n');
}

module.exports = { findTarget, latest, answer, between, asItem, iso };
