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
const NO = /^(?:no|nope|cancel|stop|never ?mind|nevermind|forget it|don'?t|abort|❌)$/i;

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
  if (/^(?:fine|ok(?:ay)?|right|correct|good|real|not a duplicate|keep it)$/i.test(v)) return { ok: true };
  if (/^(?:today|yesterday)$/i.test(v)) return { field: 'spentOn', value: v.toLowerCase() };
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
function readReply(said, pending, { year = new Date().getUTCFullYear(), groups = [] } = {}) {
  const text = String(said ?? '').trim().replace(/\s+/g, ' ');
  if (!text || !pending) return null;
  const bare = text.toLowerCase().replace(/[!.]+$/, '').replace(/,? ?(?:please|pls|thanks|thank you)$/, '').trim();
  if (YES.test(bare)) return { kind: 'yes' };
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

module.exports = { readReply, onePart, bareValue };
