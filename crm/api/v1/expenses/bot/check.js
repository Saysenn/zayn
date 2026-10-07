const { fold } = require('../../masterSheet/dealKey');
const { currentDay } = require('../../shared/presetMonth.helper');

// ***************************************************
// * EVERY EXPENSE CHECKED BY CODE BEFORE IT IS SHOWN
// ***************************************************
//
// The model reads; this decides. His rules, 2026-10-07:
//   - every field is required: date, description, amount, currency, group,
//     spent by, paid to;
//   - a currency nobody said is AED;
//   - the group is the bot's number, never read from the message;
//   - spent by is the admin who sent it, unless the message says another.
// MISSING blocks saving (it is asked). A DOUBT is shown and does not block:
// they have seen it, and "yes" means yes.

const REQUIRED = ['spentOn', 'description', 'rawAmount', 'payee'];
const CURRENCY_WORDS = [
  [/^(?:aed|dhs?|dirhams?|د\.إ)$/i, 'AED'], [/^(?:£|gbp|pounds?|quid)$/i, 'GBP'], [/^(?:€|eur|euros?)$/i, 'EUR'],
  [/^(?:\$|usd|dollars?)$/i, 'USD'], [/^(?:sar|riyals?)$/i, 'SAR'], [/^(?:inr|rupees?|₹)$/i, 'INR'], [/^(?:php|pesos?|₱)$/i, 'PHP'],
];
const LARGE = 20000;

function currencyOf(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  for (const [re, code] of CURRENCY_WORDS) if (re.test(v)) return code;
  return /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null;
}

const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? String(v) : null);
const daysBetween = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s && !/^(?:n\/?a|none|null|unknown|-)$/i.test(s) ? s : null;
};
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/**
 * Their read expense, made whole and checked.
 * @param {object} raw what the model or the file gave
 * @param {{ admin: object, group: string, rates?: object, today?: string }} ctx
 */
function normalise(raw, { admin, group, rates = {}, today = currentDay() }) {
  const said = currencyOf(raw.currency);
  const x = {
    n: raw.n,
    spentOn: iso(raw.spentOn),
    description: clean(raw.description),
    payee: clean(raw.payee),
    rawAmount: num(raw.rawAmount),
    currency: said ?? 'AED',
    groupName: group,
    spentBy: clean(raw.spentBy) ?? admin.name,
    source: raw.source ?? null,
    skipped: Boolean(raw.skipped),
    ok: Boolean(raw.ok),
  };
  x.exchangeRate = x.currency === 'AED' ? 1 : rates[x.currency]?.rate ?? null;
  x.missing = REQUIRED.filter((f) => x[f] === null || x[f] === undefined || x[f] === '');
  x.doubts = [];
  if (raw.currency && !said) x.doubts.push(`currency "${raw.currency}" not recognised, read as AED`);
  if (x.rawAmount !== null && x.rawAmount <= 0) x.doubts.push('amount is not above 0');
  if (x.rawAmount !== null && x.rawAmount >= LARGE) x.doubts.push('a large amount: is it right?');
  if (x.spentOn && daysBetween(x.spentOn, today) > 1) x.doubts.push('the date is in the future');
  if (x.spentOn && daysBetween(today, x.spentOn) > 62) x.doubts.push('the date is over 2 months ago');
  // A NOTE, not a doubt: nothing to answer, and it does not stop a save.
  x.notes = [];
  if (x.currency !== 'AED' && x.exchangeRate === null) x.notes.push(`no ${x.currency} to AED rate yet, set it on the Expenses page`);
  else if (x.currency !== 'AED') x.notes.push(`at ${x.exchangeRate} AED per ${x.currency}, the last rate used`);
  if (raw.doubt) x.doubts.push(String(raw.doubt));
  // "3 is fine": a doubt they have looked at stays out of the way.
  if (x.ok) x.doubts = [];
  x.flag = x.missing.length > 0 || x.doubts.length > 0;
  return x;
}

const sameSpend = (a, b) => a.spentOn && b.spentOn && String(a.spentOn).slice(0, 10) === String(b.spentOn).slice(0, 10)
  && Math.abs(Number(a.rawAmount) - Number(b.rawAmount)) < 0.005
  && String(a.currency).toUpperCase() === String(b.currency).toUpperCase();

/**
 * LOOKS ALREADY SAVED, or twice in this batch. A candidate, never a verdict:
 * two taxis of 45 on one day can both be real, so it is a doubt they see.
 * @param {object[]} items normalised
 * @param {object[]} saved this group's saved expenses near those dates (snake case)
 */
function duplicates(items, saved = []) {
  for (const x of items) {
    if (x.ok || x.skipped) continue;
    const twin = saved.find((s) => sameSpend(x, { spentOn: s.spent_on instanceof Date ? s.spent_on.toISOString() : s.spent_on, rawAmount: s.raw_amount, currency: s.currency }));
    if (twin) {
      x.doubts.push(`looks already saved: ${twin.description} on ${require('./format').day(String(twin.spent_on instanceof Date ? twin.spent_on.toISOString() : twin.spent_on).slice(0, 10))}`);
    }
    // SAME PAYEE, SAME DAY, ANOTHER AMOUNT: maybe new, maybe a change to the
    // saved one. They say which ("2 is fine", or change that one instead).
    const near = !twin && saved.find((s) => x.payee && s.payee && fold(s.payee) === fold(x.payee)
      && String(s.spent_on instanceof Date ? s.spent_on.toISOString() : s.spent_on).slice(0, 10) === String(x.spentOn ?? '').slice(0, 10));
    if (near) x.doubts.push(`another ${near.payee} on ${require('./format').day(String(near.spent_on instanceof Date ? near.spent_on.toISOString() : near.spent_on).slice(0, 10))} (${near.currency} ${Number(near.raw_amount)}): new, or a change to that one?`);
    const earlier = items.find((y) => y !== x && y.n < x.n && !y.skipped && sameSpend(x, y) && fold(x.description ?? '') === fold(y.description ?? ''));
    if (earlier) x.doubts.push(`same as ${earlier.n}`);
    x.flag = x.missing.length > 0 || x.doubts.length > 0;
  }
  return items;
}

/** What may be saved now: nothing missing. Doubts were shown; a yes accepts them. */
const ready = (items) => items.filter((x) => !x.skipped).every((x) => x.missing.length === 0);

module.exports = { normalise, duplicates, ready, currencyOf, REQUIRED, num, iso };
