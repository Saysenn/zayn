const { dayOf } = require('./extract');
const { fold } = require('../../masterSheet/dealKey');
const { currencyOf, num, groupOf } = require('./check');

// ***************************************************
// * THEIR ANSWER TO A PREVIEW, READ IN CODE
// ***************************************************
//
// The everyday answers cost nothing and are read the same way every time:
// "yes", "cancel", "skip 2", "only 1 and 3", "2 is 150", "3 is 5 Oct",
// "2 paid to Careem", "all today", "4 is fine". Like Diane's directEdit, it
// reads ALL of the message or NONE of it: one part it does not understand
// and the whole message goes to the model instead. A wrong read is worse
// than no read.

const YES = /^(?:y|ye|yes+|yeah|yep|yup|ok(?:ay)?|k|sure|confirm(?:ed)?|go(?: ahead)?|save(?: (?:it|them|all))?|do it|correct|approved?|👍|✅|yes(?: please| pls| save(?: it| them)?)?)$/i;
// "NO, CANCEL THAT" is a cancel. It went to the router as "undo" and offered
// to take back the last save (test sweep 2026-10-07).
const NO = /^(?:(?:no+|nope|nah)[,.!\s]*)?(?:no+|nope|nah|cancel|stop|never ?mind|nevermind|forget (?:it|that|about it)|don'?t|abort|leave (?:it|that|those|them|it alone)|scrap (?:it|that)|❌)(?:\s+(?:that|this|it|those|them|all|please|pls|thanks))*$/i;

const nums = (s) => (String(s).match(/\d+/g) ?? []).map(Number);

/** A value for a field, worked out from what it looks like. */
function valueFor(field, raw, year) {
  const v = String(raw ?? '').trim().replace(/[.!]+$/, '');
  if (!v) return null;
  switch (field) {
    case 'rawAmount': { const n = num(v); return n === null || !/\d/.test(v) || /[a-z]{4,}/i.test(v.replace(/aed|gbp|eur|usd|dhs?/ig, '')) ? null : n; }
    case 'spentOn': return /^today$/i.test(v) ? 'today' : /^yesterday$/i.test(v) ? 'yesterday' : dayOf(v, year);
    case 'currency': return currencyOf(v);
    default: return v;
  }
}

const FIELD_WORDS = [
  [/^(?:group)\s*(?:is|=|:)?\s+(.+)$/i, 'groupName'],
  [/^(?:amount|cost|price|total)\s*(?:is|=|:)?\s+(.+)$/i, 'rawAmount'],
  [/^(?:date|day|on)\s*(?:is|=|:)?\s+(.+)$/i, 'spentOn'],
  [/^(?:paid to|payee|to|at|from|vendor|shop)\s*(?:is|=|:)?\s+(.+)$/i, 'payee'],
  [/^(?:currency)\s*(?:is|=|:)?\s+(.+)$/i, 'currency'],
  [/^(?:spent by|by|paid by)\s*(?:is|=|:)?\s+(.+)$/i, 'spentBy'],
  [/^(?:description|for|desc)\s*(?:is|=|:)?\s+(.+)$/i, 'description'],
];

/**
 * "150", "5 Oct", "GBP", "fine": a bare value after "2 is". What it looks
 * like decides the field; something that could be two things is not read.
 */
function bareValue(rest, year, groups = []) {
  const v = rest.trim();
  const g = groupOf(v, groups);
  if (g && fold(v) === fold(g)) return { field: 'groupName', value: g };
  // "NEW" answers "new, or a change to that one?": it is a separate expense.
  if (/^(?:fine|ok(?:ay)?|right|correct|good|real|new|a new one|new one|separate|different|not a duplicate|not the same|keep it|it'?s right)$/i.test(v)) return { ok: true };
  if (/^(?:today|yesterday)$/i.test(v)) return { field: 'spentOn', value: v.toLowerCase() };
  // "4 is travel": a category, by its own word
  const cat = /^(?:a |an |the )?(fuel|petrol|travel|transport|food|meals?|office|bills?|utilities|other)(?: category| expense)?$/i.exec(v);
  if (cat) {
    const word = cat[1].toLowerCase();
    return { field: 'category', value: { petrol: 'fuel', transport: 'travel', meal: 'food', meals: 'food', bill: 'bills', utilities: 'bills' }[word] ?? word };
  }
  const d = dayOf(v, year);
  if (d && /[a-z]|\/|-/i.test(v)) return { field: 'spentOn', value: d };
  const c = currencyOf(v);
  if (c && /^[a-z£€$]{1,8}$/i.test(v)) return { field: 'currency', value: c };
  const money = /^(?:(aed|gbp|eur|usd|dhs?|£|€|\$)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(aed|gbp|eur|usd|dhs?|dirhams?)?$/i.exec(v);
  if (money) {
    const cur = currencyOf(money[1] ?? money[3] ?? '');
    return { fixes: [{ field: 'rawAmount', value: num(money[2]) }, ...(cur ? [{ field: 'currency', value: cur }] : [])] };
  }
  return null;
}

/** One "2 is 150" / "all paid to Careem" part, or null. */
function onePart(part, count, year, groups = []) {
  const m = /^(?:#|no\.?\s*|number\s+)?(\d+|all|every(?:one| one)?|both)\s*(?:is|=|:|-|was|should be)?\s*(.+)$/i.exec(part.trim());
  if (!m) return null;
  const which = /^\d+$/.test(m[1]) ? [Number(m[1])] : Array.from({ length: count }, (_, i) => i + 1);
  if (which.some((n) => n < 1 || n > count)) return null;
  const rest = m[2].trim();
  for (const [re, field] of FIELD_WORDS) {
    const f = re.exec(rest);
    if (f) {
      const value = valueFor(field, f[1], year);
      return value === null ? null : { which, fixes: [{ field, value }] };
    }
  }
  const bare = bareValue(rest, year, groups);
  if (!bare) return null;
  if (bare.ok) return { which, ok: true };
  return { which, fixes: bare.fixes ?? [{ field: bare.field, value: bare.value }] };
}

/**
 * @param {string} said
 * @param {object} pending the preview waiting on them
 * @returns {null | { kind: 'yes'|'no'|'skip'|'only'|'fix'|'pick', ... }}
 */
// A CURRENCY, as people write it in a rate.
const CUR = '(gbp|eur|euros?|usd|dollars?|pounds?|sterling|aed|dirhams?|sar|inr|php|qar|£|€|\\$)';
const CUR_CODE = (w) => currencyOf(w) ?? ({ sterling: 'GBP' })[String(w).toLowerCase()] ?? null;

/**
 * THEIR OWN RATE TO AED, in the ways people say it: "1 gbp to aed is 4.85",
 * "gbp 4.9", "£1 = 4.9 aed", "4.85 for pounds", "gbp 4.85 and euro 4.2",
 * "same as last time". Null when the message is not about a rate.
 * @returns {null | { rates: object } | { lastUsed: true } | { only: number }}
 */
function readRates(text) {
  const t = String(text ?? '').toLowerCase().replace(/,/g, ' ');
  if (/\b(?:same (?:rate )?as (?:last time|before)|last (?:time'?s? )?rate|use the last rate)\b/.test(t)) return { lastUsed: true };
  const looksLikeRate = /\bto\s*aed\b|\baed\s*(?:for|per)\b|\brates?\b|=|\bexchange\b|\bper\s+(?:1\s+)?(?:gbp|eur|euro|usd|pound|dollar)/.test(t)
    || new RegExp(`^\\s*${CUR}\\s*\\d`).test(t)
    || new RegExp(`\\d\\s*(?:aed\\s*)?(?:for|per)\\s*(?:1\\s*|the\\s*)?${CUR}`).test(t);
  if (!looksLikeRate) return null;
  const rates = {};
  const a = new RegExp(`(?:1\\s*)?${CUR}\\s*(?:1\\s*)?(?:to\\s*aed)?\\s*(?:is|=|:|at|@)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:aed)?`, 'g');
  for (const m of t.matchAll(a)) { const c = CUR_CODE(m[1]); if (c && c !== 'AED') rates[c] = Number(m[2]); }
  const b = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:aed\\s*)?(?:for|per)\\s*(?:1\\s*)?${CUR}`, 'g');
  for (const m of t.matchAll(b)) { const c = CUR_CODE(m[2]); if (c && c !== 'AED') rates[c] = Number(m[1]); }
  if (Object.keys(rates).length) return { rates };
  const only = /\brate\s*(?:is|=|:|of)?\s*(\d+(?:\.\d+)?)/.exec(t);
  return only ? { only: Number(only[1]) } : null;
}

function readReply(said, pending, { year = new Date().getUTCFullYear(), groups = [] } = {}) {
  const text = String(said ?? '').trim().replace(/\s+/g, ' ');
  if (!text || !pending) return null;
  const bare = text.toLowerCase().replace(/[!.]+$/, '').replace(/,? ?(?:please|pls|thanks|thank you)$/, '').trim();
  if (YES.test(bare)) return { kind: 'yes' };
  /**
   * "SAVE THE REST": the ready ones now, the ones still missing something
   * kept waiting (his report 2026-10-07: 141 ready and 4 missing a payee,
   * and nothing could be saved).
   */
  if (/^(?:(?:ok(?:ay)?|yes|so)[,\s]+)?(?:just\s+)?save\s+(?:the\s+)?(?:rest|ready(?: ones)?|ones? (?:that are |)ready|what'?s ready|the others|everything else|all the (?:rest|ready ones|others))(?:\s+(?:now|first|please|pls))*[.!]*$/i.test(bare)) return { kind: 'saveReady' };
  /**
   * A YES IN THEIR OWN WORDS: "I like them, save them", "looks good, go
   * ahead", "all good, confirm". It went to the reader as a change, with all
   * 145 expenses in the request, and came back as the same six pictures
   * (live 2026-10-07). A save word, no figures, nothing to change.
   */
  if (/\b(?:save|confirm|go ahead|looks? (?:good|great|right|fine)|all (?:good|correct|fine)|approve|that'?s (?:right|correct|fine)|perfect|good to go)\b/i.test(bare)
    && !/\d|\b(?:don'?t|do not|not|never|except|but|change|wrong|skip|cancel|without|instead|only|remove|leave out)\b/i.test(bare)) return { kind: 'yes' };
  if (NO.test(bare)) return { kind: 'no' };
  // "MODIFY" on its own: they want to change something, and say what next.
  if (/^(?:modify|change|change (?:it|something|that)|edit|amend|fix(?: it)?|correct(?: it)?)$/i.test(bare)) return { kind: 'modify' };

  if (pending.kind === 'pick') {
    const m = /^(?:#|no\.?\s*|number\s+|the\s+)?(\d+)(?:st|nd|rd|th)?(?: one)?$/.exec(bare);
    const n = m ? Number(m[1]) : null;
    return n && n >= 1 && n <= pending.choices.length ? { kind: 'pick', n } : null;
  }
  if (pending.kind !== 'add') return null;

  const count = pending.items.length;
  // THEIR RATE: before the fixes, so "1 gbp to aed is 4.85" is never "item 1".
  const rate = readRates(text);
  if (rate) return { kind: 'rate', ...rate };
  // "KEEP 2 AFTER ALL": a skipped one comes back (test sweep 2026-10-07:
  // "There is no expense 2").
  const back = /^(?:(?:oh\s+)?(?:wait|actually)[,\s]+)?(?:keep|bring back|unskip|put back|restore|add back|include)\s+(?:#|no\.?\s*|number\s+)?([\d\s,&and]+?)(?:\s+(?:after all|back|again|too))?$/i.exec(bare);
  if (back) {
    const which = nums(back[1]);
    return which.length && which.every((n) => n >= 1 && n <= count) ? { kind: 'unskip', which } : null;
  }
  // "SKIP COPIES" / "SKIP SAVED": every copy of an earlier one, or every one
  // that looks already saved, in one go (his call 2026-10-07).
  const bulk = /^(?:skip|drop|remove|leave out)\s+(?:all\s+)?(?:the\s+)?(copies|copy|duplicates?|dupes?|repeats?|(?:already\s+)?saved(?:\s+ones)?|ones? already saved)$/i.exec(bare);
  if (bulk) {
    const saved = /saved/i.test(bulk[1]);
    const which = pending.items.filter((x) => !x.skipped && (x.doubts ?? []).some((d) => (saved ? /^looks already saved|^same receipt as one saved/ : /^same as \d+/).test(d))).map((x) => x.n);
    return { kind: 'skip', which, bulk: saved ? 'saved' : 'copies' };
  }
  // "skip 3 to 6" / "skip 3-6": a range is every number in it.
  const span = /^(?:skip|drop|remove|delete|without|leave out|not)\s+(?:#|no\.?\s*|numbers?\s+)?(\d+)\s*(?:to|-|–|through|thru|till)\s*(\d+)$/i.exec(bare);
  if (span && Number(span[2]) >= Number(span[1])) {
    const which = Array.from({ length: Number(span[2]) - Number(span[1]) + 1 }, (_, i) => Number(span[1]) + i);
    return which.every((n) => n >= 1 && n <= count) ? { kind: 'skip', which } : null;
  }
  const skip = /^(?:skip|drop|remove|delete|without|leave out|not)\s+(?:#|no\.?\s*|number\s+)?([\d\s,&and]+)$/i.exec(bare);
  if (skip) {
    const which = nums(skip[1]);
    return which.length && which.every((n) => n >= 1 && n <= count) ? { kind: 'skip', which } : null;
  }
  const only = /^(?:only|just|save only|keep only)\s+(?:#|no\.?\s*|number\s+)?([\d\s,&and]+)$/i.exec(bare);
  if (only) {
    const which = nums(only[1]);
    return which.length && which.every((n) => n >= 1 && n <= count) ? { kind: 'only', which } : null;
  }

  // "ALL NEW", "they're all new ones", "all fine": every doubt looked at.
  if (/^(?:(?:they(?:'?re| are)|these are|it'?s|all are)\s+)?(?:all\s+)?(?:new|new ones?|fine|correct|ok(?:ay)?|right|separate|different)(?:\s+ones?)?$/i.test(bare)
    && /\b(?:all|they|these)\b/i.test(bare)) {
    return { kind: 'fix', parts: [], ok: pending.items.map((x) => x.n) };
  }
  // "today": the one missing date. Anything wider needs a number.
  const missingDates = pending.items.filter((x) => !x.skipped && x.missing?.includes('spentOn'));
  if (/^(?:today|yesterday)$/i.test(bare) && missingDates.length >= 1) {
    return { kind: 'fix', parts: [{ which: missingDates.map((x) => x.n), fixes: [{ field: 'spentOn', value: bare }] }] };
  }

  // FIXES, one or several: "2 is 150, 3 paid to Careem", one per line too.
  const parts = text.split(/\s*(?:[;\n]|,\s*(?=(?:#|no\.?\s*)?\d+\b|all\b)|\band\s+(?=(?:#|no\.?\s*)?\d+\s))\s*/i).filter(Boolean);
  const read = parts.map((p) => onePart(p, count, year, groups));
  if (read.length && read.every(Boolean)) {
    const oks = read.filter((r) => r.ok);
    return { kind: 'fix', parts: read.filter((r) => !r.ok), ok: oks.flatMap((r) => r.which) };
  }
  return null;
}

module.exports = {
  readReply, onePart, bareValue, readRates,
};
