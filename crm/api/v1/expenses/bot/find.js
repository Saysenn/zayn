const pool = require('../../../configs/db');
const { fold } = require('../../masterSheet/dealKey');
const format = require('./format');
const { currentDay } = require('../../shared/presetMonth.helper');

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

/**
 * The group's expenses between two days, newest first. ON A GROUP'S NUMBER
 * (his call 2026-10-08) that is this month and anything still not refunded:
 * a settled month is closed to WhatsApp. Diane (every group) sees it all.
 */
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
          AND (spent_on >= $4 OR settle_status <> 'settled')
        ORDER BY spent_on DESC, id DESC LIMIT 2000`,
      [group, from, to, `${currentDay().slice(0, 8)}01`],
    );
  return rows;
}

/** Saved expenses as the bot shows them (camel case). */
const asItem = (r) => ({
  groupName: r.group_name, id: r.id, spentOn: iso(r.spent_on), description: r.description, payee: r.payee, rawAmount: Number(r.raw_amount), currency: r.currency, spentBy: r.spent_by, aed: r.aed_amount == null ? null : Number(r.aed_amount), category: r.category ?? null,
  // the saved rate, so a "✅ CHANGED" never shows it as missing (break test 2026-10-10)
  ...(r.currency && r.currency !== 'AED' && r.exchange_rate != null ? { exchangeRate: Number(r.exchange_rate) } : {}),
});

// Split FIRST, then fold each word: fold() drops spaces, so "Stationery Sara"
// folded whole was one word and "Sara" never matched (live 2026-10-07).
// One word, singular: "deliveries" is "delivery", "coffees" is "coffee".
const stem = (w) => w.replace(/ies$/, 'y').replace(/(?<=[a-z]{3})(?:es|s)$/, (m, i, all) => (/(?:ss|us|is)$/.test(all) ? m : ''));
const wordsOf = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).map((w) => stem(fold(w))).filter((w) => w.length >= 3 && !['the', 'and', 'for', 'one', 'expense', 'expenses', 'paid', 'yesterday', 'today',
  // said around a target, never part of one ("actually change the cleaner to 200 instead")
  'actually', 'instead', 'also', 'please', 'pls', 'just', 'that', 'this', 'those', 'these', 'too', 'again', 'wait', 'sorry', 'yes', 'okay', 'mate', 'cheers',
  // what any expense is, never which one ("the dewa bill" is DEWA's)
  'bill', 'invoice', 'receipt', 'payment', 'purchase', 'transaction', 'entry', 'item', 'thing',
  // around a date or a request, never a name ("the cleaner payment from 7 oct")
  'from', 'dated', 'with', 'about', 'regarding',
  // HOW THEY ASK FOR A LIST, never what is in it: "total expenses logged this
  // month so far" searched for "logged" and found nothing (two agent test
  // 2026-10-09). Stemmed forms, as the words are compared after stem().
  'logged', 'log', 'recorded', 'entered', 'saved', 'added', 'far', 'total', 'all', 'show', 'list', 'month', 'week', 'far', 'until', 'now', 'far', 'got', 'have', 'there', 'any', 'how', 'much', 'many', 'what', 'tell'].includes(w));

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
  // "THE LAST ONE" with nothing done this chat: the last one SAVED here
  // (his sweep 2026-10-07: it picked the oldest)
  if (target.last && !wordsOf(target.words).length) {
    const last = await lastSaved(group, 1);
    if (last.length) return last;
  }
  const want = wordsOf(target.words);
  const amount = Number(String(target.amount ?? '').replace(/[^\d.]/g, ''));
  const close = (w, h) => h === w || (Math.min(w.length, h.length) >= 4 && (h.startsWith(w) || w.startsWith(h)));
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
  const inGroup = (r) => !target.group || String(r.groupName ?? '').toUpperCase() === String(target.group).toUpperCase();
  const scored = rows.map((r) => {
    if (!inGroup(r)) return null;
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
  const whole = scored.filter((x) => x.hits === want.length).map((x) => x.r);
  if (whole.length || !want.length) return whole;
  /**
   * A TYPO ("grocries", his sweep 2026-10-07): one letter off on words of 5
   * or more, only when nothing matched exactly. Still shown for a yes.
   */
  const { oneTypo } = require('../../agent/tools/resolvePerson');
  const near = (w, h) => close(w, h) || (w.length >= 5 && h.length >= 5 && oneTypo(w, h));
  return rows.filter((r) => {
    if (!inGroup(r)) return false;
    if (target.date && r.spentOn !== target.date) return false;
    if (target.amount && Number.isFinite(amount) && amount > 0 && Math.abs(r.rawAmount - amount) > 0.005) return false;
    const have = wordsOf(`${r.description} ${r.payee}`);
    return want.every((w) => have.some((h) => near(w, h)));
  });
}

/**
 * SEVERAL EXPENSES NAMED IN ONE MESSAGE (his report 2026-10-07): "yes and
 * remove the taxi to DIFC on 5 Oct too", "remove the cleaner and the petrol",
 * or the list they copied back ("• Cleaner payment · AED 250.00 · 07 Oct ·
 * …"). Each part becomes a target: its words, and a day and an amount when
 * said. Pure; the words that only say "remove" are dropped.
 */
const MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})\\b\\.?`, 'i');
const MONTH_DAY = new RegExp(`\\b(${MON})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
const FILLER = /\b(?:yes|yeah|yep|ok(?:ay)?|sure|please|pls|and|also|too|as well|plus|remove|remo[a-z]{0,3}|delete|drop|take out|the|that|this|those|these|one|ones|lets|let's|on|of|it|them|both|all|expenses?|by \w+)\b/gi;

function targetsIn(text, year, today = null) {
  const { dayOf } = require('./extract');
  const parts = String(text ?? '').split(/\n+|\s*•\s*|\s*;\s*|\s*&\s*|,(?!\d)\s*(?!(?:\d|on\b|from\b))|\s+and\s+(?:also\s+)?(?:remove|delete)\s+|\s+(?:and\s+)?also\s+(?:remove\s+|delete\s+)?|\s+and\s+(?=the\b)/i);
  const out = [];
  for (const raw of parts) {
    let part = String(raw ?? '').trim();
    if (!part) continue;
    const t = {};
    // a line copied from a list: "Cleaner payment · AED 250.00 · 07 Oct · Ahmed · by Zayn"
    if (part.includes('·')) {
      const segs = part.split('·').map((x) => x.trim());
      t.words = segs[0].replace(FILLER, ' ');
      for (const seg of segs.slice(1)) {
        const money = /^(?:[A-Z]{3}|£|€|\$)?\s*([\d,]+(?:\.\d+)?)$/.exec(seg);
        if (money) t.amount = money[1].replace(/,/g, '');
        const d = dayOf(seg, year);
        if (d) t.date = d;
      }
    } else {
      if (today && /\byesterday'?s?\b/i.test(part)) { t.date = minus(today, 1); part = part.replace(/\byesterday'?s?\b/i, ' '); }
      if (today && /\btoday'?s?\b/i.test(part)) { t.date = today; part = part.replace(/\btoday'?s?\b/i, ' '); }
      // "on the 5th": this month's day
      const ord = today && /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b|\bon\s+(\d{1,2})(?:st|nd|rd|th)\b/i.exec(part);
      if (ord && !t.date) {
        const d = Number(ord[1] ?? ord[2]);
        if (d >= 1 && d <= 31) { t.date = `${today.slice(0, 8)}${String(d).padStart(2, '0')}`; part = part.replace(ord[0], ' '); }
      }
      const dm = DAY_MONTH.exec(part);
      const md = !dm && MONTH_DAY.exec(part);
      if (dm) { t.date = dayOf(`${dm[1]} ${dm[2]}`, year); part = part.replace(dm[0], ' '); }
      if (md) { t.date = dayOf(`${md[2]} ${md[1]}`, year); part = part.replace(md[0], ' '); }
      const money = /(?:\b(?:aed|gbp|eur|usd)|[£€$])\s*(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*(?:\.\d+)?)\s*(?:aed|gbp|dhs?)\b/i.exec(part);
      if (money) { t.amount = String(money[1] ?? money[2]).replace(/,/g, ''); part = part.replace(money[0], ' '); }
      t.words = part.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
    }
    // a word, a day or an amount is enough to point at one ("the 45 one")
    if (wordsOf(t.words).length || t.date || t.amount) out.push({ ...t, said: String(raw).trim() });
  }
  return out;
}

/** The last N SAVED in this group, newest first: "remove the last 3". */
async function lastSaved(group, n) {
  const { rows } = group === ALL
    ? await pool.query('SELECT * FROM tb_expenses WHERE archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT $1', [n])
    : await pool.query('SELECT * FROM tb_expenses WHERE archived_at IS NULL AND group_name = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [group, n]);
  return rows.map(asItem);
}

/** The latest few, when nothing matched, so they can point at one. */
async function latest(group, today, n = 5) {
  return (await between(group, minus(today, 62), today)).slice(0, n).map(asItem);
}

// ---- questions, answered by code ----

/** The rows as they will be once a waiting draft is saved: changed, removed, split. */
function withOverlay(rows, { items = [], removes = [] }) {
  const gone = new Set(removes.map((r) => r.id));
  const out = [];
  for (const r of rows) {
    if (gone.has(r.id)) continue;
    const x = items.find((i) => i.id === r.id);
    if (!x) { out.push(r); continue; }
    const f = x.fields;
    const scale = (v) => (r.aed == null || !(r.rawAmount > 0) ? null : Math.round((r.aed * Number(v)) / r.rawAmount * 100) / 100);
    const amount = f.rawAmount ?? r.rawAmount;
    out.push({ ...r, ...['description', 'payee', 'spentBy', 'category', 'spentOn'].reduce((o, k) => (k in f ? { ...o, [k]: f[k] } : o), {}), rawAmount: Number(amount), aed: scale(amount) });
    for (const p of x.splits ?? []) out.push({ ...r, id: null, rawAmount: Number(p.rawAmount), spentBy: p.spentBy, aed: scale(p.rawAmount) });
  }
  return out;
}

/** "sort by amount": a list in the order they asked, else newest first. */
function sortRows(rows, sort) {
  if (!sort) return rows;
  const [by, dir] = String(sort).split(':');
  const key = { amount: (r) => r.aed ?? r.rawAmount, date: (r) => r.spentOn, description: (r) => String(r.description ?? '').toLowerCase(), payee: (r) => String(r.payee ?? '').toLowerCase(), spentBy: (r) => String(r.spentBy ?? '').toLowerCase(), category: (r) => String(r.category ?? '') }[by];
  if (!key) return rows;
  const up = dir === 'asc';
  return [...rows].sort((a, b) => { const x = key(a); const y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (up ? 1 : -1); });
}

function firstOfMonth(day) { return `${day.slice(0, 8)}01`; }

/** "SPENT AED 1,245 ON 12 EXPENSES", worked out here. */
/**
 * @param {object} [opts.out] receives `table`: the same answer as a table
 *   spec for a picture (pictures/table.js), and `caption`, the short text
 *   that goes with it. Set only for a list or a breakdown.
 */
async function answer(scopeGroup, query, { today, out = null, overlay = null }) {
  // From the command center, "how much did MANBAT spend" narrows to it.
  const group = scopeGroup === ALL && query.group ? query.group : scopeGroup;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : firstOfMonth(today);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : today;
  let rows = (await between(group, from, to)).map(asItem);
  // AS IF THE WAITING CHANGES WERE SAVED (his list 2026-10-08): "gloria's total after this?"
  if (overlay) rows = withOverlay(rows, overlay);
  const want = wordsOf(query.words);
  // A CATEGORY WORD is the category ("how much on fuel"), not a search
  const CATEGORY_WORD = { fuel: 'fuel', petrol: 'fuel', travel: 'travel', transport: 'travel', food: 'food', meal: 'food', office: 'office', bill: 'bills', utility: 'bills', other: 'other' };
  const cats = want.map((w) => CATEGORY_WORD[w]).filter(Boolean);
  if (cats.length) rows = rows.filter((r) => cats.includes(r.category));
  const rest = want.filter((w) => !CATEGORY_WORD[w]);
  if (rest.length) rows = rows.filter((r) => rest.some((w) => wordsOf(`${r.description} ${r.payee} ${r.spentBy}`).some((h) => h === w || h.startsWith(w))));
  const span = from === to ? format.day(from) : `${format.day(from)} – ${format.day(to)}`;
  const scope = `${group === ALL ? 'all groups' : group}${want.length ? ` · "${query.words}"` : ''} · ${span}`;
  if (out) out.ids = rows.map((r) => r.id);
  if (!rows.length) return `No expenses found for ${scope}.`;
  const allGroups = group === ALL;

  const aedTotal = rows.reduce((n, r) => n + (r.aed ?? 0), 0);
  const noRate = rows.filter((r) => r.aed == null).length;
  const totalLine = `*${format.money('AED', Math.round(aedTotal * 100) / 100)}* (${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'})${noRate ? ` _· ${noRate} with no AED rate not counted_` : ''}`;

  if (query.groupBy) {
    const key = { group: (r) => r.groupName, payee: (r) => r.payee || 'no payee', spentBy: (r) => r.spentBy || 'nobody', day: (r) => format.day(r.spentOn), currency: (r) => r.currency, description: (r) => r.description, category: (r) => (r.category ? `${r.category.charAt(0).toUpperCase()}${r.category.slice(1)}` : 'Not set') }[query.groupBy];
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
    const by = { group: 'GROUP', payee: 'PAYEE', spentBy: 'PERSON', day: 'DAY', currency: 'CURRENCY', description: 'ITEM', category: 'CATEGORY' }[query.groupBy];
    const head = `📊 *SPENDING BY ${by}* · ${scope}`;
    if (out) {
      out.table = {
        title: `Spending by ${by.toLowerCase()}`, subtitle: `${scope} · ${rows.length} expenses`,
        columns: [{ label: { group: 'Group', payee: 'Paid to', spentBy: 'Person', day: 'Day', currency: 'Currency', description: 'Item', category: 'Category' }[query.groupBy], weight: 3 }, { label: 'Expenses', weight: 1, align: 'right' }, { label: 'AED', weight: 1.6, align: 'right' }],
        sections: [{ rows: sorted.map(([k, g]) => ({ cells: [k, String(g.n), format.money('AED', Math.round(g.aed * 100) / 100)] })) }],
        total: { value: format.money('AED', Math.round(aedTotal * 100) / 100), ...(noRate ? { sub: `${noRate} with no AED rate not counted` } : {}) },
      };
      out.caption = [head, `*TOTAL:* ${totalLine}`].join('\n');
    }
    return [head, format.SEP, ...lines, format.SEP, `*TOTAL:* ${totalLine}`].join('\n');
  }
  if (query.measure === 'count') return `📊 *${rows.length} ${rows.length === 1 ? 'EXPENSE' : 'EXPENSES'}* · ${scope}`;
  if (query.measure === 'total') return [`📊 *SPENDING* · ${scope}`, format.SEP, `*TOTAL:* ${totalLine}`].join('\n');
  const sorted = sortRows(query.measure === 'biggest' ? [...rows].sort((a, b) => (b.aed ?? 0) - (a.aed ?? 0)).slice(0, 5) : rows, query.sort);
  const list = sorted.slice(0, 15);
  // THE NUMBERS MEAN SOMETHING (his list 2026-10-08): "1-3 spent by gloria" after a list
  if (out) out.listIds = sorted.map((r) => r.id);
  // "THAT ONE'S WRONG" after "the biggest" is the biggest one (it picked the cleaner payment)
  if (out && query.measure === 'biggest' && sorted[0]) out.ids = [sorted[0].id];
  // "WHICH IS THE BIGGEST?" IS ANSWERED IN WORDS too, not only by the picture (break test 2026-10-10)
  const top = query.measure === 'biggest' && sorted[0] ? `\nBiggest: *${sorted[0].description}* · ${format.money(sorted[0].currency, sorted[0].rawAmount)} · ${format.day(sorted[0].spentOn)}${sorted[0].payee ? ` · ${sorted[0].payee}` : ''}` : '';
  const head = `📋 *${query.measure === 'biggest' ? 'BIGGEST EXPENSES' : 'EXPENSES'}* · ${scope}${top}`;
  if (out) {
    // THE PICTURE HOLDS EVERY ROW, not the first 15: that is what it is for.
    const shown = sorted;
    out.table = {
      title: query.measure === 'biggest' ? 'Biggest expenses' : 'Expenses', subtitle: `${scope} · ${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'}`,
      columns: [
        { label: 'No.', weight: 0.5 },
        { label: 'Date', weight: 1 },
        ...(allGroups ? [{ label: 'Group', weight: 1.4 }] : []),
        { label: 'What', weight: 2.6 }, { label: 'Paid to', weight: 1.7 }, { label: 'Spent by', weight: 1.3 }, { label: 'Amount', weight: 1.7, align: 'right' },
      ],
      sections: [{
        rows: shown.map((r, i) => ({
          cells: [String(i + 1), format.day(r.spentOn), ...(allGroups ? [r.groupName] : []), r.description, r.payee, r.spentBy, format.money(r.currency, r.rawAmount)],
          ...(r.currency !== 'AED' ? { sub: r.aed == null ? 'no AED rate' : `≈ ${format.money('AED', Math.round(r.aed * 100) / 100)}` } : {}),
        })),
      }],
      total: { value: format.money('AED', Math.round(aedTotal * 100) / 100), ...(noRate ? { sub: `${noRate} with no AED rate not counted` } : {}) },
    };
    out.caption = [head, `*TOTAL:* ${totalLine}`].join('\n');
  }
  return [
    head, format.SEP,
    ...list.map((r, i) => format.line({ ...r, n: i + 1 }, { number: true, group: allGroups })),
    ...(query.measure !== 'biggest' && rows.length > 15 ? [`_…and ${rows.length - 15} more · reply *show all* to list every one_`] : []),
    format.SEP, `*TOTAL:* ${totalLine}`,
  ].join('\n');
}

module.exports = {
  findTarget, latest, lastSaved, answer, between, asItem, iso, ALL, targetsIn, wordsOf, sortRows,
};
