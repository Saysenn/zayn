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
//   - spent by is WHO SPENT IT, asked when nobody is named (his call
//     2026-10-07: it used to fall back to the admin, which was wrong every
//     time an admin saved for someone else). "me" is the admin.
// MISSING blocks saving (it is asked). A DOUBT is shown and does not block:
// they have seen it, and "yes" means yes.

const REQUIRED = ['spentOn', 'description', 'rawAmount', 'payee'];
const CURRENCY_WORDS = [
  [/^(?:aed|dhs?|dirhams?|د\.إ)$/i, 'AED'], [/^(?:£|gbp|pounds?|quid)$/i, 'GBP'], [/^(?:€|eur|euros?)$/i, 'EUR'],
  [/^(?:\$|usd|dollars?)$/i, 'USD'], [/^(?:sar|riyals?)$/i, 'SAR'], [/^(?:inr|rupees?|₹)$/i, 'INR'], [/^(?:php|pesos?|₱)$/i, 'PHP'],
];
const LARGE = 20000;

// REAL CURRENCY CODES ONLY. Any three letters used to pass, so "new" (the
// answer to "new, or a change?") became currency NEW and 40 rows were saved
// that way (test sweep 2026-10-07).
const CODES = new Set(['AED', 'GBP', 'EUR', 'USD', 'SAR', 'INR', 'PHP', 'QAR', 'KWD', 'BHD', 'OMR', 'JPY', 'CNY', 'CHF', 'CAD', 'AUD',
  'NZD', 'SGD', 'HKD', 'PKR', 'LKR', 'BDT', 'NPR', 'EGP', 'TRY', 'ZAR', 'NGN', 'KES', 'SEK', 'NOK', 'DKK', 'PLN', 'RUB', 'THB', 'MYR', 'IDR']);
function currencyOf(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  for (const [re, code] of CURRENCY_WORDS) if (re.test(v)) return code;
  return CODES.has(v.toUpperCase()) ? v.toUpperCase() : null;
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
/** A group they named, as the CRM spells it. Null when it is not one. */
function groupOf(value, groups = []) {
  const v = fold(String(value ?? ''));
  if (!v) return null;
  return groups.find((g) => fold(g) === v) ?? groups.find((g) => fold(g).startsWith(v) && v.length >= 3) ?? null;
}

/**
 * A NAME AS IT IS ALREADY WRITTEN. "sara" and "Sara K", "Amazon.ae" and
 * "Amazon" were saved side by side and split every total (test sweep
 * 2026-10-07). A name that is the start of exactly one known name, or that
 * one known name starts, is that name. Never a guess between two.
 */
function canonical(value, known = []) {
  const v = clean(value);
  if (!v) return v;
  const f = fold(v);
  const exact = known.find((k) => fold(k) === f);
  if (exact) return exact;
  const longer = known.filter((k) => f.length >= 3 && fold(k).startsWith(f));
  if (longer.length === 1) return longer[0];
  const shorter = known.filter((k) => fold(k).length >= 3 && f.startsWith(fold(k)));
  return shorter.length === 1 ? shorter[0] : v;
}

const ME = /^(?:me|myself|i|mine|my self|by me|i did|i paid|i spent it)$/i;
/** "me", "myself": the admin who sent it, if there is one. A sentence is no name. */
function spenderOf(value, admin, known) {
  const v = clean(value);
  if (!v) return null;
  if (ME.test(v)) return admin?.name ?? null;
  if (v.split(/\s+/).length > 4 || /[,;]/.test(v)) return null;
  return canonical(v, known);
}

/**
 * A CATEGORY BY ITS WORDS when the reading gave none (a sheet's rows, a
 * typed line): the payee and description against what each one covers.
 * Shown in the preview, so a wrong one is one reply away ("4 is travel").
 */
const CATEGORIES = ['fuel', 'travel', 'food', 'office', 'bills', 'other'];
const CATEGORY_WORDS = [
  ['fuel', /\b(?:fuel|petrol|diesel|gas station|enoc|adnoc|eppco|emarat)\b/i],
  ['travel', /\b(?:taxi|cab|careem|uber|rta|parking|salik|train|trainline|flight|airline|emirates|flydubai|hotel|metro|bus|toll|travel)\b/i],
  ['food', /\b(?:lunch|dinner|breakfast|coffee|tea|meal|food|restaurant|cafe|starbucks|shake shack|pret|groceries|grocery|carrefour|lulu|talabat|deliveroo|water bottles?)\b/i],
  ['bills', /\b(?:dewa|electricity|water bill|utility|internet|du|etisalat|phone|mobile|sim|rent|bill|subscription)\b/i],
  ['office', /\b(?:office|stationery|ink|paper|printer|amazon|ikea|laptop|computer|furniture|chairs?|desk|software|equipment|supplies|cleaner|cleaning)\b/i],
];
function categoryOf(raw) {
  const words = `${raw.description ?? ''} ${raw.payee ?? ''}`;
  return CATEGORY_WORDS.find(([, re]) => re.test(words))?.[0] ?? 'other';
}

function normalise(raw, { admin, group, groups = [], rates = {}, live = {}, known = {}, today = currentDay() }) {
  const said = currencyOf(raw.currency);
  // FROM THE COMMAND CENTER ('*'): no bot number says the group and no
  // admin is the spender, so both are read from their words or asked.
  const anyGroup = group === '*';
  const x = {
    n: raw.n,
    spentOn: iso(raw.spentOn),
    description: clean(raw.description),
    payee: canonical(raw.payee, known.payees ?? []),
    rawAmount: num(raw.rawAmount),
    currency: said ?? 'AED',
    groupName: anyGroup ? groupOf(raw.groupName, groups) : group,
    spentBy: spenderOf(raw.spentBy, admin, known.spentBy ?? []),
    // "ME": the admin themselves, linked by their own phone (spender.js).
    // Kept while the name is still theirs; another name ends it.
    spentMe: ME.test(clean(raw.spentBy) ?? '') || (Boolean(raw.spentMe) && Boolean(admin?.name) && fold(raw.spentBy ?? '') === fold(admin.name)),
    // the master sheet person it is linked to, worked out by brain.link()
    spentById: raw.spentById ?? null,
    spentByPhone: raw.spentByPhone ?? null,
    source: raw.source ?? null,
    category: CATEGORIES.includes(raw.category) ? raw.category : categoryOf(raw),
    // the receipt it came from, held until "yes" (receipts.js)
    receipt: raw.receipt ?? null,
    // the saved expense this one is the same receipt as, and whether to
    // REPLACE it on yes instead of saving a second copy
    repeatOf: raw.repeatOf ?? null,
    replaceId: raw.replaceId ?? null,
    skipped: Boolean(raw.skipped),
    ok: Boolean(raw.ok),
  };
  /**
   * THE RATE TO AED IS PART OF THE EXPENSE (his call 2026-10-07): the one
   * they gave, else today's market rate, else the last one used; with none,
   * it is asked ("1 GBP to AED is?"). It is saved on the expense.
   */
  const given = num(raw.rateGiven);
  x.rateGiven = given;
  if (x.currency === 'AED') { x.exchangeRate = 1; x.rateSource = null; } else if (given > 0) {
    x.exchangeRate = given; x.rateSource = 'your rate';
  } else if (live[x.currency]?.rate) {
    x.exchangeRate = live[x.currency].rate; x.rateSource = live[x.currency].source;
  } else if (rates[x.currency]?.rate) {
    x.exchangeRate = rates[x.currency].rate; x.rateSource = 'the last rate used';
  } else { x.exchangeRate = null; x.rateSource = null; }
  x.missing = [...(anyGroup ? ['groupName'] : []), ...REQUIRED, ...(x.spentBy ? [] : ['spentBy']), ...(x.currency !== 'AED' && !x.exchangeRate ? ['exchangeRate'] : [])]
    .filter((f) => x[f] === null || x[f] === undefined || x[f] === '');
  x.doubts = [];
  if (anyGroup && clean(raw.groupName) && !x.groupName) x.doubts.push(`"${raw.groupName}" is not a group`);
  if (raw.currency && !said) x.doubts.push(`currency "${raw.currency}" not recognised, read as AED`);
  if (x.rawAmount !== null && x.rawAmount <= 0) x.doubts.push('amount is not above 0');
  if (x.rawAmount !== null && x.rawAmount >= LARGE) x.doubts.push('a large amount: is it right?');
  if (x.spentOn && daysBetween(x.spentOn, today) > 1) x.doubts.push('the date is in the future');
  if (x.spentOn && daysBetween(today, x.spentOn) > 62) x.doubts.push('the date is over 2 months ago');
  // A NOTE, not a doubt: nothing to answer, and it does not stop a save.
  x.notes = x.replaceId ? ['will replace the one already saved'] : [];
  // A RATE THEY GAVE far from the market's is worth a second look.
  const market = live[x.currency]?.rate;
  if (given > 0 && market && Math.abs(given - market) / market > 0.1) x.doubts.push(`your rate ${given} is far from the market's ${market}`);
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
 * AN EXACT COPY: the same day, amount, currency, payee and description. A
 * file sent again while its preview is open adds nothing (his call
 * 2026-10-07: 6 files sent twice stacked a preview to 141).
 */
const exactCopy = (a, b) => Boolean(sameSpend(a, b)) && fold(a.payee ?? '') === fold(b.payee ?? '') && fold(a.description ?? '') === fold(b.description ?? '');

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
      // the saved one it looks like, so "replace" can update it
      x.lookalikeOf = twin.id;
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

module.exports = {
  normalise, duplicates, ready, currencyOf, groupOf, canonical, spenderOf, REQUIRED, num, iso, exactCopy, CATEGORIES, categoryOf, ME,
};
