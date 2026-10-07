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
  remove: ['get rid of', 'take out', 'take off', 'cross off', 'strike off', 'remove', 'delete', 'del', 'drop', 'erase', 'scrap', 'wipe', 'discard', 'clear',
    'void', 'bin', 'chuck'],
  change: ['change', 'update', 'edit', 'modify', 'fix', 'correct', 'amend', 'adjust', 'revise', 'alter', 'rectify', 'tweak'],
  show: ['pull up', 'bring up', 'show', 'list', 'view', 'display'],
};
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const VERB_AT_START = Object.fromEntries(Object.entries(VERBS).map(([k, list]) => [k, new RegExp(`^(?:(?:ok(?:ay)?|pls|please|so|right|hey|hi|can you|could you|can u|could u|would you|will you|i need you to|i want to|i'?d like to)[,\\s]+)*(?:${list.map(escape).join('|')})\\b`, 'i')]));
const VERB_AT_END = Object.fromEntries(Object.entries(VERBS).map(([k, list]) => [k, new RegExp(`\\s+(?:${list.map(escape).join('|')})(?:\\s+(?:please|pls|it|them|mate))*[.!?]*$`, 'i')]));
// words around a request that are never what it is about
const SAY_FILLER = /\b(?:please|pls|mate|cheers)\b/gi;

/** "bin the cleaner" → "remove the cleaner"; "the taxi, remove it" → "remove the taxi". */
function canonicalVerbs(text) {
  // WHY they want it is not what it is: "the internet bill is a duplicate, remove it"
  const t = String(text ?? '').trim().replace(/\s*,?\s*\b(?:is|was|looks like|it'?s)\s+(?:a\s+)?(?:duplicate|double|dupe|mistake|wrong one|not ours|repeat(?:ed)?|copy)\b\s*,?/gi, ' ').replace(/\s+/g, ' ').trim();
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

const NOT_A_TARGET = /\b(?:all|every|everything|each|and|both|it|that|this|them|those|last)\b/i;

// the groups' names, never part of what an expense is ("the MANBAT groceries")
let GROUP_NAMES = [];

/** "the cleaner on 7 Oct", "the 45 taxi", "the 120.43 one": one target, or null. */
function targetOf(text, today) {
  // a group named narrows the search to it (Diane's command center)
  const named = GROUP_NAMES.find((g) => new RegExp(`\\b${g.replace(/[^a-z0-9 ]/gi, '')}\\b`, 'i').test(String(text)));
  const t = GROUP_NAMES.reduce((x, g) => x.replace(new RegExp(`\\b${g.replace(/[^a-z0-9 ]/gi, '')}(?:'s)?\\b`, 'gi'), ' '), String(text)).replace(/\s+/g, ' ').trim().replace(/\b(\d+(?:\.\d+)?)\s*(?:aed|dhs?)?\s+one\b/i, 'aed $1').replace(/^(?:the\s+)?(\d+\.\d{2})$/, 'aed $1');
  if (!t || NOT_A_TARGET.test(t.replace(/\b(?:the|this month'?s?)\b/gi, ''))) return null;
  const list = find.targetsIn(t, Number(today.slice(0, 4)), today);
  if (list.length !== 1) return null;
  const x = list[0];
  if (!find.wordsOf(x.words).length && !x.date && !x.amount) return null;
  return { ...blank, words: String(x.words ?? '').trim(), amount: x.amount ?? '', date: x.date ?? '', ...(named ? { group: named } : {}) };
}

/** The new value in "to 50", "to 5 Oct", "to Careem": one field, or null. */
const CATEGORY_OF = {
  fuel: 'fuel', petrol: 'fuel', diesel: 'fuel', travel: 'travel', transport: 'travel', taxi: 'travel', food: 'food', meal: 'food', meals: 'food',
  office: 'office', supplies: 'office', bills: 'bills', bill: 'bills', utilities: 'bills', utility: 'bills', other: 'other',
};

function changeOf(value, today, field = null) {
  const v = String(value).trim().replace(/[.!]+$/, '').replace(/\s+(?:instead|please|pls)$/i, '');
  // A CATEGORY, only when they said it is the category
  if (field === 'category') {
    const c = CATEGORY_OF[v.toLowerCase().replace(/^(?:a|an|the)\s+/, '').replace(/\s+(?:category|expense)$/, '')];
    return c ? [{ field: 'category', value: c }] : null;
  }
  // "the 6th", "on the 6th": this month's day
  const ord = /^(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)$/i.exec(v);
  if (ord && (!field || field === 'spentOn') && Number(ord[1]) >= 1 && Number(ord[1]) <= 31) {
    return [{ field: 'spentOn', value: `${today.slice(0, 8)}${String(ord[1]).padStart(2, '0')}` }];
  }
  const money = /^(?:(aed|gbp|eur|usd|dhs?|£|€|\$)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(aed|gbp|eur|usd|dhs?|dirhams?|pounds?|quid|sterling|euros?|dollars?)?(?:\s+not\s+\S+)?$/i.exec(v);
  if (money && (!field || field === 'rawAmount')) {
    const cur = currencyOf(money[1] ?? money[3] ?? '');
    return [{ field: 'rawAmount', value: String(num(money[2])) }, ...(cur ? [{ field: 'currency', value: cur }] : [])];
  }
  const dv = v.replace(/^on\s+/i, '');
  const day = /^today$/i.test(dv) ? today : /^yesterday$/i.test(dv) ? minus(today, 1) : dayOf(dv, Number(today.slice(0, 4)));
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
  category: 'category', type: 'category', kind: 'category',
  amount: 'rawAmount', price: 'rawAmount', cost: 'rawAmount', total: 'rawAmount',
  date: 'spentOn', day: 'spentOn', payee: 'payee', shop: 'payee', vendor: 'payee',
  spender: 'spentBy', 'spent by': 'spentBy', description: 'description', name: 'description',
};

/**
 * The router's shape for a message code is sure of, or null.
 * @returns {null | { kind, sure, target, changes, query, quick: true }}
 */
function quickRoute(said, { today, groups = [], group = null } = {}) {
  GROUP_NAMES = [...groups, ...(group && group !== '*' ? [group] : [])].filter(Boolean);
  const t = canonicalVerbs(String(said ?? '').trim().replace(/\s+/g, ' '));
  if (!t || t.length > 140 || /\n/.test(said)) return null;
  const route = (kind, extra) => ({ kind, sure: true, target: { ...blank }, changes: [], query: { from: '', to: '', group: '', groupBy: '', measure: 'list', words: '' }, quick: true, ...extra });

  // REMOVE: "remove the cleaner", "delete the taxi on 5 Oct", "remove the 45 one"
  const rm = /^(?:(?:ok(?:ay)?|pls|please)[,\s]+)?(?:remove|delete|take out|get rid of)\s+(.+?)(?:\s+(?:please|pls))?[.!]*$/i.exec(t);
  if (rm) {
    if (/^(?:it|that|that one|the last one|this one)$/i.test(rm[1])) return route('remove', { target: { ...blank, last: true } });
    const target = targetOf(rm[1].replace(/\b(\d+(?:\.\d+)?)\s+one\b/i, 'aed $1').replace(/^(?:everything|all)\s+(?:from\s+)?/i, ''), today);
    // "REMOVE YESTERDAY": every one that day, shown for a yes
    if (target && target.date && !find.wordsOf(target.words).length && !target.amount) target.all = true;
    // "REMOVE ALL THE TAXIS": every one of them, shown for a yes
    if (target && /^(?:all|every|each|everything)\b/i.test(rm[1])) target.all = true;
    return target ? route('remove', { target }) : null;
  }

  // CHANGE: "change the taxi on 5 Oct to 50", "make the lunch 120", "change the date of the taxi to 5 Oct"
  const FIELDS_SAID = 'amount|price|cost|total|date|day|payee|shop|vendor|spender|spent by|description|name|category|type';
  // "IT": "make it 250", "actually 250 not 300", "it was on the 3rd" — the one in hand
  const it = /^(?:(?:actually|no|sorry|oops|wait|hmm|ah)[,!.\s]+)*(?:(?:make|change|set)\s+it\s+(?:to\s+)?|it'?s\s+|it\s+(?:is|was)\s+|should be\s+|it\s+should be\s+)?(.+?)(?:\s+not\s+[^\s]+)?(?:\s+instead)?[.!]*$/i.exec(t);
  if (it && /^(?:(?:actually|no|sorry|oops|wait|hmm|ah)\b|make it|change it|set it|it'?s|it (?:is|was)|should be|\d)/i.test(t) && !/\b(?:paid|spent|at|from)\b/i.test(t)) {
    const changes = changeOf(it[1], today);
    if (changes) return route('edit', { target: { ...blank, last: true }, changes, it: true });
  }
  // A FIELD ALONE: "and the date to 3 Oct", "the payee to Uber" — the one in hand
  const alone = new RegExp(`^(?:and\\s+)?(?:change\\s+|make\\s+|set\\s+)?(?:the\\s+)?(${FIELDS_SAID})\\s+(?:to|=|is|should be)\\s+(.+)$`, 'i').exec(t);
  if (alone) {
    const changes = changeOf(alone[2], today, FIELD_WORD[alone[1].toLowerCase()]);
    if (changes) return route('edit', { target: { ...blank, last: true }, changes, it: true });
  }
  // "THE GROCERIES CATEGORY TO OFFICE", "the taxi payee to Uber"
  const after = new RegExp(`^(?:change|update|set|correct|edit)\\s+(?:the\\s+)?(.+?)(?:'s)?\\s+(${FIELDS_SAID})\\s+(?:to|=|at|as)?\\s*(.+)$`, 'i').exec(t);
  if (after) {
    const target = targetOf(after[1], today);
    const changes = changeOf(after[3], today, FIELD_WORD[after[2].toLowerCase()]);
    if (target && changes) return route('edit', { target, changes });
  }
  // "TAXI 45 -> 50", "the taxi from 45 to 50", "groceries 139.91 => 300"
  const arrow = /^(?:change\s+)?(?:the\s+)?([a-z][\w\s'&.-]{1,40}?)\s+(?:from\s+)?(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:->|=>|→|➜|to)\s*(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:aed)?[.!]*$/i.exec(t);
  if (arrow) {
    const target = targetOf(`${arrow[1]} aed ${arrow[2]}`, today);
    if (target) return route('edit', { target, changes: [{ field: 'rawAmount', value: String(num(arrow[3])) }] });
  }
  // "UPDATE THE LAST EXPENSE TO 99", "change the last one to 99"
  const lastOne = /^(?:change|update|set|make|correct|edit|fix)\s+(?:the\s+)?last\s+(?:one|expense|entry|item)\s+(?:to|=)?\s*(.+)$/i.exec(t);
  if (lastOne) {
    const changes = changeOf(lastOne[1], today);
    if (changes) return route('edit', { target: { ...blank, last: true }, changes });
  }
  // "PUT THE GROCERIES UNDER OFFICE", "move the taxi to travel"
  const under = /^(?:put|move|file|class|categori[sz]e)\s+(?:the\s+)?(.+?)\s+(?:under|in|into|as|to)\s+(?:the\s+)?([a-z]+)(?:\s+category)?$/i.exec(t);
  if (under && CATEGORY_OF[under[2].toLowerCase()]) {
    const target = targetOf(under[1], today);
    if (target) return route('edit', { target, changes: [{ field: 'category', value: CATEGORY_OF[under[2].toLowerCase()] }] });
  }
  // "FIX THE DATE ON THE INTERNET BILL, IT WAS 30 SEPT", "correct the internet bill, it's 480",
  // "update the taxi amount, it should have been 55 aed"
  const itWas = new RegExp(`^(?:change|update|set|correct|edit|fix)\\s+(?:the\\s+)?(?:(${FIELDS_SAID})\\s+(?:on|of|for)\\s+(?:the\\s+)?)?(.+?)(?:\\s+(${FIELDS_SAID}))?\\s*[,;:-]\\s*(?:it|that|this)?\\s*(?:'s|is|was|were|should be|should have been|needs to be)\\s+(.+)$`, 'i').exec(t);
  if (itWas) {
    const field = (itWas[1] || itWas[3]) ? FIELD_WORD[(itWas[1] || itWas[3]).toLowerCase()] : null;
    const target = targetOf(itWas[2], today);
    const changes = changeOf(itWas[4], today, field);
    if (target && changes) return route('edit', { target, changes });
  }
  // "50 FOR THE TAXI NOT 45", "300 for the groceries"
  const forThe = /^(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:aed|dhs?)?\s+(?:for|on)\s+(?:the\s+)?(.+?)(?:\s+not\s+\S+)?[.!]*$/i.exec(t);
  if (forThe && !/\b(?:paid|spent|at)\b/i.test(t) && /\bnot\b|^\d/.test(t)) {
    const target = targetOf(forThe[2], today);
    if (target && /\bnot\b/i.test(t)) return route('edit', { target, changes: [{ field: 'rawAmount', value: String(num(forThe[1])) }] });
  }
  // "CHANGE CLEANER 200" (no "to"), as a part of several
  const bareChange = /^(?:change|update|set)\s+(?:the\s+)?([a-z][\w\s'&.-]{1,40}?)\s+(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:aed)?$/i.exec(t);
  if (bareChange && !/\s(?:to|into|=|is|was)$/i.test(bareChange[1])) {
    const target = targetOf(bareChange[1], today);
    if (target) return route('edit', { target, changes: [{ field: 'rawAmount', value: String(num(bareChange[2])) }] });
  }
  // "THE TAXI WAS 55", "the cleaner was on the 6th", "the petrol should be 130 not 120.43"
  const was = /^(?:the\s+)?([a-z][\w\s'&.-]{1,50}?)\s+(?:was|were|is|are|should be|should have been|=)\s+(?:actually\s+)?(.+?)(?:\s+not\s+[^\s]+)?[.!]*$/i.exec(t);
  if (was && !/^(?:it|that|this|there|what|how|which|who|change|update|set|make|correct|edit|fix)\b/i.test(was[1])) {
    const target = targetOf(was[1], today);
    const changes = changeOf(was[2], today);
    if (target && changes) return route('edit', { target, changes });
  }
  const ch = /^(?:(?:ok(?:ay)?|pls|please|actually)[,\s]+)?(?:change|make|update|set|correct|edit)\s+(?:the\s+)?(?:(amount|price|cost|total|date|day|payee|shop|vendor|spender|spent by|description|name|category|type)\s+(?:of|on|for)\s+(?:the\s+)?)?(.+?)\s+(?:to|=|into)\s+(.+)$/i.exec(t)
    ?? /^(?:make)\s+(?:the\s+)?()(.+?)\s+(\d[\d,]*(?:\.\d+)?(?:\s*(?:aed|gbp|eur|usd|dhs?))?)$/i.exec(t);
  if (ch) {
    const field = ch[1] ? FIELD_WORD[ch[1].toLowerCase()] : null;
    const target = targetOf(ch[2], today);
    const changes = changeOf(ch[3], today, field);
    return target && changes ? route('edit', { target, changes }) : null;
  }

  /**
   * QUESTIONS, in code (his harness 2026-10-07): totals, lists, counts, the
   * biggest, split by category / payee / person / day / group, for a period
   * and a payee or a category. Follow-ups ("and august?") stay the router's.
   */
  const SPLIT = { category: 'category', categories: 'category', type: 'category', payee: 'payee', payees: 'payee', shop: 'payee', vendor: 'payee', person: 'spentBy', people: 'spentBy', spender: 'spentBy', who: 'spentBy', day: 'day', days: 'day', date: 'day', group: 'group', groups: 'group' };
  const asking = /^(?:so\s+)?(?:how much|how many|what(?:'s| is| was| did we spend| have we spent| did i spend)|total|list|show(?: me)?|give me|biggest|largest|top|expenses?|spending)\b/i.test(t)
    || /^(?:today|yesterday|this week|this month|last month)'?s?\s+expenses?\??$/i.test(t);
  if (asking && !/\b(?:what about|and in|and for|and on|how about)\b/i.test(t) && !/^(?:show|give)(?: me)? (?:the )?(?:receipt|preview|image|picture)/i.test(t)) {
    const split = /\b(?:by|per|each|split by|broken down by|break ?down by)\s+(category|categories|type|payee|payees|shop|vendor|person|people|spender|who|day|days|date|group|groups)\b/i.exec(t);
    const measure = /\b(?:biggest|largest|top|most expensive|highest)\b/i.test(t) ? 'biggest'
      : /^how many\b|\bcount\b|\bnumber of\b/i.test(t) ? 'count'
        : (/^(?:list|show|give me|expenses?)\b|\bexpenses?\s*\??$/i.test(t) || /^(?:today|yesterday|this week|this month|last month)/i.test(t)) && !/\b(?:how much|total)\b/i.test(t) ? 'list' : 'total';
    const period = periodOf(t, today);
    let words = t.replace(/['’]s\b/gi, '')
      .replace(/^(?:so\s+)?(?:how much|how many|what(?:'s| is| was| did we spend| have we spent| did i spend)?|total|list|show(?: me)?|give me)\b/i, ' ')
      .replace(split ? split[0] : /$^/, ' ')
      .replace(/\b(?:did|do|have|has|we|i|you|they|spend|spent|spending|so far|in total|altogether|this month|today'?s?|yesterday'?s?|this week|last month|month to date|on|for|at|in|from|the|our|my|all|expenses?|expense|was|were|is|are|biggest|largest|top|most expensive|highest|count|number of|cost|costs|total|overall|whole)\b/gi, ' ')
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
        from: period?.from ?? '', to: period?.to ?? '', group: g ?? '', groupBy: split ? SPLIT[split[1].toLowerCase()] : '', measure: split ? 'total' : measure, words,
      },
    });
  }
  return null;
}

module.exports = { quickRoute, periodOf, canonicalVerbs, VERBS };
