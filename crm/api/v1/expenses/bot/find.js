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

/** Every group: Diane's command center, which is no one group's number. */
const ALL = '*';

/** The group's expenses between two days, newest first. */
async function between(group, from, to) {
  const { rows } = group === ALL
    ? await pool.query(
      `SELECT * FROM tb_expenses WHERE spent_on >= $1 AND spent_on <= $2
        ORDER BY spent_on DESC, id DESC LIMIT 2000`,
      [from, to],
    )
    : await pool.query(
      `SELECT * FROM tb_expenses
        WHERE lower(group_name) = lower($1) AND spent_on >= $2 AND spent_on <= $3
        ORDER BY spent_on DESC, id DESC LIMIT 2000`,
      [group, from, to],
    );
  return rows;
}

/** Saved expenses as the bot shows them (camel case). */
const asItem = (r) => ({
  groupName: r.group_name, id: r.id, spentOn: iso(r.spent_on), description: r.description, payee: r.payee, rawAmount: Number(r.raw_amount), currency: r.currency, spentBy: r.spent_by, aed: r.aed_amount == null ? null : Number(r.aed_amount),
});

// Split FIRST, then fold each word: fold() drops spaces, so "Stationery Sara"
// folded whole was one word and "Sara" never matched (live 2026-10-07).
// One word, singular: "deliveries" is "delivery", "coffees" is "coffee".
const stem = (w) => w.replace(/ies$/, 'y').replace(/(?<=[a-z]{3})(?:es|s)$/, (m, i, all) => (/(?:ss|us|is)$/.test(all) ? m : ''));
const wordsOf = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).map((w) => stem(fold(w))).filter((w) => w.length >= 3 && !['the', 'and', 'for', 'one', 'expense', 'expenses', 'paid', 'yesterday', 'today'].includes(w));

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
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
  const scored = rows.map((r) => {
    if (target.date && r.spentOn !== target.date) return null;
    // A RANGE THEY SAID ("this week", "in october") is kept to: "remove the
    // coffees from this week" reached back to August (test sweep 2026-10-07).
    if (isDay(target.from) && r.spentOn < target.from) return null;
    if (isDay(target.to) && r.spentOn > target.to) return null;
    if (target.amount && Number.isFinite(amount) && amount > 0 && Math.abs(r.rawAmount - amount) > 0.005) return null;
    if (!want.length) return target.date || target.amount || isDay(target.from) || isDay(target.to) ? { r, hits: 0 } : null;
    const have = wordsOf(`${r.description} ${r.payee}`);
    const hits = want.filter((w) => have.some((h) => close(w, h))).length;
    return hits > 0 ? { r, hits } : null;
  }).filter(Boolean);
  /**
   * EVERY WORD: "water deliveries" is the water deliveries, not DEWA's
   * "Electricity & water" bills that share one word.
   */
  // No partial fallback: "team dinner" reached every "Team lunch", and with
  // "remove all" that is the wrong things gone. Nothing whole is "not found",
  // which shows the latest so they can say which.
  return scored.filter((x) => x.hits === want.length).map((x) => x.r);
}

/** The latest few, when nothing matched, so they can point at one. */
async function latest(group, today, n = 5) {
  return (await between(group, minus(today, 62), today)).slice(0, n).map(asItem);
}

// ---- questions, answered by code ----

function firstOfMonth(day) { return `${day.slice(0, 8)}01`; }

/** "SPENT AED 1,245 ON 12 EXPENSES", worked out here. */
/**
 * @param {object} [opts.out] receives `table`: the same answer as a table
 *   spec for a picture (pictures/table.js), and `caption`, the short text
 *   that goes with it. Set only for a list or a breakdown.
 */
async function answer(scopeGroup, query, { today, out = null }) {
  // From the command center, "how much did MANBAT spend" narrows to it.
  const group = scopeGroup === ALL && query.group ? query.group : scopeGroup;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : firstOfMonth(today);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : today;
  let rows = (await between(group, from, to)).map(asItem);
  const want = wordsOf(query.words);
  if (want.length) rows = rows.filter((r) => want.some((w) => wordsOf(`${r.description} ${r.payee} ${r.spentBy}`).some((h) => h === w || h.startsWith(w))));
  const span = from === to ? format.day(from) : `${format.day(from)} – ${format.day(to)}`;
  const scope = `${group === ALL ? 'all groups' : group}${want.length ? ` · "${query.words}"` : ''} · ${span}`;
  if (!rows.length) return `No expenses found for ${scope}.`;
  const allGroups = group === ALL;

  const aedTotal = rows.reduce((n, r) => n + (r.aed ?? 0), 0);
  const noRate = rows.filter((r) => r.aed == null).length;
  const totalLine = `*${format.money('AED', Math.round(aedTotal * 100) / 100)}* (${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'})${noRate ? ` _· ${noRate} with no AED rate not counted_` : ''}`;

  if (query.groupBy) {
    const key = { group: (r) => r.groupName, payee: (r) => r.payee || 'no payee', spentBy: (r) => r.spentBy || 'nobody', day: (r) => format.day(r.spentOn), currency: (r) => r.currency, description: (r) => r.description }[query.groupBy];
    const groups = new Map();
    for (const r of rows) {
      const k = key(r);
      const g = groups.get(k) ?? { aed: 0, n: 0 };
      g.aed += r.aed ?? 0;
      g.n += 1;
      groups.set(k, g);
    }
    const sorted = [...groups].sort((a, b) => b[1].aed - a[1].aed);
    const lines = sorted.slice(0, 20)
      .map(([k, g]) => `• ${k}: *${format.money('AED', Math.round(g.aed * 100) / 100)}* (${g.n})`);
    const by = { group: 'GROUP', payee: 'PAYEE', spentBy: 'PERSON', day: 'DAY', currency: 'CURRENCY', description: 'ITEM' }[query.groupBy];
    const head = `📊 *SPENDING BY ${by}* · ${scope}`;
    if (out) {
      out.table = {
        title: `Spending by ${by.toLowerCase()}`, subtitle: `${scope} · ${rows.length} expenses`,
        columns: [{ label: { group: 'Group', payee: 'Paid to', spentBy: 'Person', day: 'Day', currency: 'Currency', description: 'Item' }[query.groupBy], weight: 3 }, { label: 'Expenses', weight: 1, align: 'right' }, { label: 'AED', weight: 1.6, align: 'right' }],
        sections: [{ rows: sorted.map(([k, g]) => ({ cells: [k, String(g.n), format.money('AED', Math.round(g.aed * 100) / 100)] })) }],
        total: { value: format.money('AED', Math.round(aedTotal * 100) / 100), ...(noRate ? { sub: `${noRate} with no AED rate not counted` } : {}) },
      };
      out.caption = [head, `*TOTAL:* ${totalLine}`].join('\n');
    }
    return [head, format.SEP, ...lines, format.SEP, `*TOTAL:* ${totalLine}`].join('\n');
  }
  if (query.measure === 'count') return `📊 *${rows.length} ${rows.length === 1 ? 'EXPENSE' : 'EXPENSES'}* · ${scope}`;
  if (query.measure === 'total') return [`📊 *SPENDING* · ${scope}`, format.SEP, `*TOTAL:* ${totalLine}`].join('\n');
  const list = query.measure === 'biggest' ? [...rows].sort((a, b) => (b.aed ?? 0) - (a.aed ?? 0)).slice(0, 5) : rows.slice(0, 15);
  const head = `📋 *${query.measure === 'biggest' ? 'BIGGEST EXPENSES' : 'EXPENSES'}* · ${scope}`;
  if (out) {
    // THE PICTURE HOLDS EVERY ROW, not the first 15: that is what it is for.
    const shown = query.measure === 'biggest' ? list : rows;
    out.table = {
      title: query.measure === 'biggest' ? 'Biggest expenses' : 'Expenses', subtitle: `${scope} · ${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'}`,
      columns: [
        { label: 'Date', weight: 1 },
        ...(allGroups ? [{ label: 'Group', weight: 1.4 }] : []),
        { label: 'What', weight: 2.6 }, { label: 'Paid to', weight: 1.7 }, { label: 'Spent by', weight: 1.3 }, { label: 'Amount', weight: 1.7, align: 'right' },
      ],
      sections: [{
        rows: shown.map((r) => ({
          cells: [format.day(r.spentOn), ...(allGroups ? [r.groupName] : []), r.description, r.payee, r.spentBy, format.money(r.currency, r.rawAmount)],
          ...(r.currency !== 'AED' ? { sub: r.aed == null ? 'no AED rate' : `≈ ${format.money('AED', Math.round(r.aed * 100) / 100)}` } : {}),
        })),
      }],
      total: { value: format.money('AED', Math.round(aedTotal * 100) / 100), ...(noRate ? { sub: `${noRate} with no AED rate not counted` } : {}) },
    };
    out.caption = [head, `*TOTAL:* ${totalLine}`].join('\n');
  }
  return [
    head, format.SEP,
    ...list.map((r) => format.line({ ...r, n: null }, { number: false, group: allGroups })),
    ...(query.measure !== 'biggest' && rows.length > 15 ? [`_…and ${rows.length - 15} more on the Expenses page._`] : []),
    format.SEP, `*TOTAL:* ${totalLine}`,
  ].join('\n');
}

module.exports = {
  findTarget, latest, answer, between, asItem, iso, ALL,
};
