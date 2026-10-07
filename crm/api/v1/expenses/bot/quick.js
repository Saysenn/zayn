const { dayOf } = require('./extract');
const { currencyOf, num, groupOf } = require('./check');
const find = require('./find');

// ***************************************************
// * THE COMMON ASKS, READ IN CODE: NO ROUTER, NO COST
// ***************************************************
//
// His call 2026-10-07: expenses as efficient as Diane is on deals. The
// everyday wordings ("remove the cleaner", "change the taxi on 5 Oct to 50",
// "how much this month?") are read here into the router's own shape, so the
// rest of the brain cannot tell the difference. Anything this is not sure
// of returns null and the router reads it, as before.

/**
 * THE WAYS PEOPLE SAY "REMOVE", "CHANGE" AND "SHOW" (his calls 2026-10-07:
 * every wording, in UK English only). Turned into the one verb code reads,
 * at the start or the end of the message, and a one-letter typo of a
 * longer verb counts ("delte", "upadte").
 */
const VERBS = {
  remove: ['get rid of', 'take out', 'take off', 'cross off', 'strike off', 'remove', 'delete', 'del', 'drop', 'erase', 'scrap', 'wipe', 'discard',
    'void', 'bin', 'chuck'],
  change: ['change', 'update', 'edit', 'modify', 'fix', 'correct', 'amend', 'adjust', 'revise', 'alter', 'rectify', 'tweak'],
  show: ['pull up', 'bring up', 'show', 'list', 'view', 'display'],
};
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const VERB_AT_START = Object.fromEntries(Object.entries(VERBS).map(([k, list]) => [k, new RegExp(`^(?:(?:ok(?:ay)?|pls|please|so|right|can you|could you)[,\\s]+)?(?:${list.map(escape).join('|')})\\b`, 'i')]));
const VERB_AT_END = Object.fromEntries(Object.entries(VERBS).map(([k, list]) => [k, new RegExp(`\\s+(?:${list.map(escape).join('|')})(?:\\s+(?:please|pls|it|them|mate))*[.!?]*$`, 'i')]));
// words around a request that are never what it is about
const SAY_FILLER = /\b(?:please|pls|mate|cheers)\b/gi;

/** "bin the cleaner" → "remove the cleaner"; "the taxi, remove it" → "remove the taxi". */
function canonicalVerbs(text) {
  const t = String(text ?? '').trim();
  // A NEW EXPENSE is never a request ("drop off fee 30 paid to Ali")
  if (/\bpaid\b|\bspent\b/i.test(t) && /\d/.test(t) && !/\b(?:to|into)\s+\d/i.test(t)) return t;
  const { oneTypo } = require('../../agent/tools/resolvePerson');
  for (const [verb, re] of Object.entries(VERB_AT_START)) {
    const m = re.exec(t);
    if (m) return `${verb} ${t.slice(m[0].length).replace(SAY_FILLER, ' ').replace(/\s+/g, ' ').trim()}`.trim();
  }
  for (const [verb, re] of Object.entries(VERB_AT_END)) {
    const m = re.exec(t);
    if (m && m.index > 0) return `${verb} ${t.slice(0, m.index).replace(SAY_FILLER, ' ').replace(/[\s,;:-]+$/, '').replace(/\s+/g, ' ').trim()}`;
  }
  // a typo of a longer verb, as the first word: "delte the taxi", "upadte it"
  const first = /^(\S+)(.*)$/.exec(t);
  if (first && first[1].length >= 5) {
    for (const [verb, list] of Object.entries(VERBS)) {
      if (list.some((w) => !w.includes(' ') && w.length >= 5 && oneTypo(first[1].toLowerCase(), w))) return `${verb}${first[2]}`;
    }
  }
  return t;
}

const blank = { words: '', amount: '', date: '', from: '', to: '', last: false, all: false };
const minus = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

/** "today", "this week", "in october", "last month": a from/to, or null. */
function periodOf(text, today) {
  const t = String(text).toLowerCase();
  const first = `${today.slice(0, 8)}01`;
  if (/\btoday\b/.test(t)) return { from: today, to: today, said: 'today' };
  if (/\byesterday\b/.test(t)) return { from: minus(today, 1), to: minus(today, 1), said: 'yesterday' };
  if (/\bthis week\b/.test(t)) {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return { from: minus(today, dow), to: today, said: 'this week' };
  }
  if (/\blast month\b/.test(t)) {
    const end = minus(first, 1);
    return { from: `${end.slice(0, 8)}01`, to: end, said: 'last month' };
  }
  if (/\b(?:this month|so far|month to date)\b/.test(t)) return { from: first, to: today, said: 'this month' };
  return null;
}

const NOT_A_TARGET = /\b(?:all|every|everything|each|and|also|both|it|that|this|them|those|last)\b/i;

/** "the cleaner on 7 Oct", "the 45 taxi": one target, or null. */
function targetOf(text, today) {
  const t = String(text).trim();
  if (!t || NOT_A_TARGET.test(t.replace(/\b(?:the|this month'?s?)\b/gi, ''))) return null;
  const list = find.targetsIn(t, Number(today.slice(0, 4)), today);
  if (list.length !== 1) return null;
  const x = list[0];
  if (!find.wordsOf(x.words).length && !x.date && !x.amount) return null;
  return { ...blank, words: String(x.words ?? '').trim(), amount: x.amount ?? '', date: x.date ?? '' };
}

/** The new value in "to 50", "to 5 Oct", "to Careem": one field, or null. */
function changeOf(value, today, field = null) {
  const v = String(value).trim().replace(/[.!]+$/, '');
  const money = /^(?:(aed|gbp|eur|usd|dhs?|£|€|\$)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(aed|gbp|eur|usd|dhs?|dirhams?)?$/i.exec(v);
  if (money && (!field || field === 'rawAmount')) {
    const cur = currencyOf(money[1] ?? money[3] ?? '');
    return [{ field: 'rawAmount', value: String(num(money[2])) }, ...(cur ? [{ field: 'currency', value: cur }] : [])];
  }
  const day = /^today$/i.test(v) ? today : /^yesterday$/i.test(v) ? minus(today, 1) : dayOf(v, Number(today.slice(0, 4)));
  if (day && (!field || field === 'spentOn') && /[a-z]|\/|-/i.test(v)) return [{ field: 'spentOn', value: day }];
  const by = /^(?:spent by|by)\s+(.{2,40})$/i.exec(v);
  if (by && (!field || field === 'spentBy')) return [{ field: 'spentBy', value: by[1] }];
  const paid = /^(?:paid to|payee)\s+(.{2,40})$/i.exec(v);
  if (paid && (!field || field === 'payee')) return [{ field: 'payee', value: paid[1] }];
  // a named field takes plain words: "the payee of the taxi to Careem"
  if (field && ['payee', 'spentBy', 'description'].includes(field) && /^[\p{L}][\p{L}\d .&'()-]{1,60}$/u.test(v)) return [{ field, value: v }];
  return null;
}

const FIELD_WORD = {
  amount: 'rawAmount', price: 'rawAmount', cost: 'rawAmount', total: 'rawAmount',
  date: 'spentOn', day: 'spentOn', payee: 'payee', shop: 'payee', vendor: 'payee',
  spender: 'spentBy', 'spent by': 'spentBy', description: 'description', name: 'description',
};

/**
 * The router's shape for a message code is sure of, or null.
 * @returns {null | { kind, sure, target, changes, query, quick: true }}
 */
function quickRoute(said, { today, groups = [], group = null } = {}) {
  const t = canonicalVerbs(String(said ?? '').trim().replace(/\s+/g, ' '));
  if (!t || t.length > 140 || /\n/.test(said)) return null;
  const route = (kind, extra) => ({ kind, sure: true, target: { ...blank }, changes: [], query: { from: '', to: '', group: '', groupBy: '', measure: 'list', words: '' }, quick: true, ...extra });

  // REMOVE: "remove the cleaner", "delete the taxi on 5 Oct", "remove the 45 one"
  const rm = /^(?:(?:ok(?:ay)?|pls|please)[,\s]+)?(?:remove|delete|take out|get rid of)\s+(.+?)(?:\s+(?:please|pls))?[.!]*$/i.exec(t);
  if (rm) {
    if (/^(?:it|that|that one|the last one|this one)$/i.test(rm[1])) return route('remove', { target: { ...blank, last: true } });
    const target = targetOf(rm[1].replace(/\b(\d+(?:\.\d+)?)\s+one\b/i, 'aed $1'), today);
    return target ? route('remove', { target }) : null;
  }

  // CHANGE: "change the taxi on 5 Oct to 50", "make the lunch 120", "change the date of the taxi to 5 Oct"
  const ch = /^(?:(?:ok(?:ay)?|pls|please|actually)[,\s]+)?(?:change|make|update|set|correct|edit)\s+(?:the\s+)?(?:(amount|price|cost|total|date|day|payee|shop|vendor|spender|spent by|description|name)\s+(?:of|on|for)\s+(?:the\s+)?)?(.+?)\s+(?:to|=|into)\s+(.+)$/i.exec(t)
    ?? /^(?:make)\s+(?:the\s+)?()(.+?)\s+(\d[\d,]*(?:\.\d+)?(?:\s*(?:aed|gbp|eur|usd|dhs?))?)$/i.exec(t);
  if (ch) {
    const field = ch[1] ? FIELD_WORD[ch[1].toLowerCase()] : null;
    const target = targetOf(ch[2], today);
    const changes = changeOf(ch[3], today, field);
    return target && changes ? route('edit', { target, changes }) : null;
  }

  // HOW MUCH / LIST: "how much this month?", "how much on fuel this week", "list today's expenses"
  const total = /^(?:so\s+)?(?:how much|what(?:'s| is| did we spend| have we spent)(?: the)? total|total(?: spent| spending)?)\b(.*)$/i.exec(t);
  const list = !total && /^(?:list|show(?: me)?)\s+(?:all\s+)?(?:the\s+)?(.*?)(?:'s)?\s*expenses?\b(.*)$/i.exec(t);
  if (total || list) {
    const rest = total ? total[1] : `${list[1]} ${list[2]}`;
    // a split, a follow-up or a name is the router's to read
    if (/\b(?:by|per|each|split|break ?down|and|what about|biggest|largest|most)\b/i.test(rest)) return null;
    const period = periodOf(rest, today);
    let words = rest
      .replace(/\b(?:did|do|have|has|we|i|you|they|spend|spent|spending|so far|in total|altogether|this month|today|yesterday|this week|last month|month to date|on|for|at|the|our|expenses?|was|were|is|are)\b/gi, ' ')
      .replace(/[?.!,'’]/g, ' ').replace(/\s+/g, ' ').trim();
    // a group named (Diane's command center): the group, not a word to search
    const g = groups.find((x) => new RegExp(`\\b${x.replace(/[^a-z0-9 ]/gi, '')}\\b`, 'i').test(words));
    if (g) words = words.replace(new RegExp(`\\b${g.replace(/[^a-z0-9 ]/gi, '')}\\b`, 'i'), ' ').trim();
    // this number's own group named ("how much did MILKMAN spend"): not a search word
    if (group && group !== '*') words = words.replace(new RegExp(`\\b${String(group).replace(/[^a-z0-9 ]/gi, '')}\\b`, 'i'), ' ').trim();
    if (words && (find.wordsOf(words).length > 2 || /\d/.test(words))) return null;
    if (/^(?:spent by|by)\b/i.test(words)) return null;
    return route('question', {
      query: {
        from: period?.from ?? '', to: period?.to ?? '', group: g ?? groupOf('', groups) ?? '', groupBy: '', measure: total ? 'total' : 'list', words,
      },
    });
  }
  return null;
}

module.exports = { quickRoute, periodOf, canonicalVerbs, VERBS };
