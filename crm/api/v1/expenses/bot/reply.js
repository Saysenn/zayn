const { dayOf } = require('./extract');
const { fold } = require('../../masterSheet/dealKey');
const {
  currencyOf, num, groupOf, ME,
} = require('./check');

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

const YES = /^(?:sorted|all sorted|done|all done|all good|crack on|go on|good to go|that'?s it|thats it|spot on|bang on|y|ye|yes+|yeah|yep|yup|ok(?:ay)?|k|sure(?: thing)?|confirm(?:ed)?|go(?: ahead)?|ok go|save(?: (?:it|them|all))?|do it|correct|approved?|👍|✅|yes(?: please| pls| save(?: it| them)?)?|fine|proceed|send it|that'?s? (?:is )?(?:correct|right|fine)|all (?:correct|right)|sige|oo|tama|tamam|yalla|haan|theek hai|go for it|👌|👌🏻|👍🏻|👍🏼|👍🏽|🆗|✔️|☑️|🙏)$/iu;
// "HOLD ON": nothing changes, it waits
const HOLD = /^(?:hold on|wait|one sec(?:ond)?|1 sec|a sec|hang on|brb|give me a (?:sec|minute|moment)|let me check|one moment)[.!\s]*$/i;
// "NO, CANCEL THAT" is a cancel. It went to the router as "undo" and offered
// to take back the last save (test sweep 2026-10-07).
const NO = /^(?:(?:wait|hold on|oh|hmm+|actually|oops)[,.!\s]+)?(?:(?:no+|nope|nah)[,.!\s]*)?(?:no+|nope|nah|cancel|stop|never ?mind|nevermind|forget (?:it|that|about it)|don'?t(?: save)?|do not save|abort|discard|not now|leave (?:it|that|those|them|it alone)|scrap (?:it|that)|❌)(?:\s+(?:that|this|it|those|them|all|please|pls|thanks))*$/i;

const nums = (s) => (String(s).match(/\d+/g) ?? []).map(Number);

const CHOICE_DOUBT = /^same receipt as one saved|^looks already saved|^same as \d+/;
const VERB = { skip: 'skip', no: 'skip', drop: 'skip', save: 'keep', keep: 'keep', yes: 'keep', new: 'keep', replace: 'replace', overwrite: 'replace', update: 'replace' };
const span = (a, b) => (b ? Array.from({ length: Math.max(0, Number(b) - Number(a) + 1) }, (_, i) => Number(a) + i) : [Number(a)]);

/** "skip all" / "1 skip 2 replace 3 save": the choices, or null. */
function readChoices(bare, pending) {
  const items = pending.items ?? [];
  const listed = items.filter((x) => !x.skipped && (x.doubts ?? []).some((d) => CHOICE_DOUBT.test(d))).map((x) => x.n);
  const all = /^(skip|replace|overwrite|keep|drop)\s+(?:them\s+)?(?:all|all of them|everything|both|them)$/i.exec(bare);
  if (all && listed.length) {
    const v = VERB[all[1].toLowerCase()];
    return { kind: 'choices', skip: v === 'skip' ? listed : [], keep: v === 'keep' ? listed : [], replace: v === 'replace' ? listed : [] };
  }
  const ONE = /(?:(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*[.):]?\s*(skip|save|keep|replace|overwrite|yes|no|new|drop)(?:\s+(?:it|again|them|that one))?|(skip|save|keep|replace|drop)\s+(?:no\.?\s*|#)?(\d+)(?:\s*(?:-|–|to)\s*(\d+))?(?:\s+again)?)(?=\s|$)/gi;
  const flat = bare.replace(/[,;]|\band\b|\bthen\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const found = [...flat.matchAll(ONE)];
  if (!found.length || flat.replace(ONE, '').trim()) return null;
  // ONE number-first part with a plain yes or no is not a choice ("1 yes")
  const out = { kind: 'choices', skip: [], keep: [], replace: [] };
  for (const m of found) {
    const verb = VERB[(m[3] ?? m[4]).toLowerCase()];
    const ns = m[1] ? span(m[1], m[2]) : span(m[5], m[6]);
    out[verb].push(...ns);
  }
  const every = [...out.skip, ...out.keep, ...out.replace];
  if (!every.every((n) => n >= 1 && n <= items.length)) return null;
  // a single "skip 3" / "keep 3" keeps its old reading (skip / unskip)
  if (found.length === 1 && !found[0][1]) return null;
  return out;
}

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

/**
 * WHO SPENT IT, as a bare answer to "who spent it?" (his call 2026-10-07):
 * "me", or a name when every one of these is waiting on its spender. A
 * name anywhere else is not read as one.
 */
function spenderAnswer(rest, which, items) {
  if (ME.test(rest)) return { which, fixes: [{ field: 'spentBy', value: 'me' }] };
  const waiting = which.every((n) => {
    const x = items.find((i) => i.n === n);
    return x && ((x.missing ?? []).includes('spentBy') || (x.doubts ?? []).some((d) => /^which |^did you mean /.test(d)));
  });
  if (waiting && /^[a-z][a-z .'-]{1,40}$/i.test(rest) && rest.split(/\s+/).length <= 4) return { which, fixes: [{ field: 'spentBy', value: rest }] };
  return null;
}

/** One "2 is 150" / "all paid to Careem" / "1-3 Ahmed" part, or null. */
function onePart(part, count, year, groups = [], items = []) {
  const p = part.trim();
  // "1-3 Ahmed": a run of numbers, only when both ends are expenses
  const run = /^(?:#|no\.?\s*)?(\d+)\s*(?:-|–|to)\s*(\d+)\s+(.+)$/i.exec(p);
  const m = run && Number(run[2]) <= count && Number(run[2]) > Number(run[1])
    ? [p, `${run[1]}-${run[2]}`, run[3]]
    : /^(?:#|no\.?\s*|number\s+)?(\d+|all|every(?:one| one)?|both)\s*(?:is|=|:|-|was|should be)?\s*(.+)$/i.exec(p);
  if (!m) return null;
  const which = /^\d+-\d+$/.test(m[1]) ? Array.from({ length: Number(m[1].split('-')[1]) - Number(m[1].split('-')[0]) + 1 }, (_, i) => Number(m[1].split('-')[0]) + i)
    : /^\d+$/.test(m[1]) ? [Number(m[1])] : Array.from({ length: count }, (_, i) => i + 1);
  if (which.some((n) => n < 1 || n > count)) return null;
  const rest = m[2].trim();
  const who = spenderAnswer(rest, which, items);
  if (who) return who;
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

function answersForAll(bare, pending, year) {
  const live = pending.items.filter((x) => !x.skipped);
  const tokens = bare.split(/\s*(?:,|;|\band\b|&|\+)\s*/i).map((t) => t.replace(/^(?:both|all|everything|for all|all of them|they(?:'re| are)|its?|it'?s)\s+/i, '').replace(/\s+(?:for all|for both|for everything|for all of them|on all|on both)$/i, '').trim()).filter(Boolean);
  if (tokens.length < 2 && !/^(?:both|all)\b/i.test(bare)) return null;
  const fixes = [];
  for (const t of tokens) {
    if (ME.test(t)) { fixes.push({ field: 'spentBy', value: 'me' }); continue; }
    if (/^(?:today|yesterday)$/i.test(t)) { fixes.push({ field: 'spentOn', value: t.toLowerCase() }); continue; }
    const d = dayOf(t.replace(/^on\s+/i, ''), year);
    if (d && /[a-z]|\//i.test(t)) { fixes.push({ field: 'spentOn', value: d }); continue; }
    const paid = /^(?:paid to|payee|at|to)\s+(.{2,40})$/i.exec(t);
    if (paid) { fixes.push({ field: 'payee', value: paid[1] }); continue; }
    const by = /^(?:spent by|by)\s+(.{2,40})$/i.exec(t);
    if (by) { fixes.push({ field: 'spentBy', value: by[1] }); continue; }
    return null;
  }
  if (!fixes.length) return null;
  const parts = fixes.map((f) => {
    const missing = live.filter((x) => (x.missing ?? []).includes(f.field));
    return { which: (missing.length ? missing : live).map((x) => x.n), fixes: [f] };
  });
  return { kind: 'fix', parts, ok: [] };
}

function readReply(said, pending, { year = new Date().getUTCFullYear(), groups = [] } = {}) {
  const text = String(said ?? '').trim().replace(/\s+/g, ' ');
  if (!text || !pending) return null;
  const bare = text.toLowerCase().replace(/[!.]+$/, '').replace(/,? ?(?:please|pls|thanks|thank you)$/, '').trim();
  if (YES.test(bare)) return { kind: 'yes' };
  if (HOLD.test(bare)) return { kind: 'hold' };
  // "EDIT 2" / "change 3" / "fix the date of 3": what should change is asked
  if (/^(?:edit|change|fix|modify|correct|update)\s+(?:the\s+\w+\s+(?:of|on|for)\s+)?(?:no\.?\s*|number\s*|#)?\d+$/i.test(bare)) return { kind: 'modify' };
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
    if (n && n >= 1 && n <= pending.choices.length) return { kind: 'pick', n };
    // SEVERAL: "1 and 2", "1, 3", "1-3", "both", "all of them"
    const count = pending.choices.length;
    if (/^(?:(?:remove|delete)\s+)?(?:both|all|all of them|every one|them all|both of them)$/i.test(bare)) {
      return { kind: 'pickMany', ns: Array.from({ length: count }, (_, i) => i + 1) };
    }
    const run = /^(\d+)\s*(?:-|–|to)\s*(\d+)$/.exec(bare);
    const ns = run ? Array.from({ length: Math.max(0, Number(run[2]) - Number(run[1]) + 1) }, (_, i) => Number(run[1]) + i)
      : /^[\d\s,&]+(?:and\s+\d+)?$/i.test(bare) || /^\d+(?:\s*(?:,|&|and)\s*\d+)+$/i.test(bare) ? nums(bare) : [];
    if (ns.length > 1 && ns.every((x) => x >= 1 && x <= count)) return { kind: 'pickMany', ns: [...new Set(ns)] };
    return null;
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
  /**
   * SKIP, SAVE OR REPLACE (his call 2026-10-07, "Please check"): for all of
   * them ("skip all", "replace all"), or one by one in any layout ("1 skip,
   * 2 replace, 3 save", one per line, "1. yes / 2. no", "skip 1-5, keep 6").
   * "All" is the ones listed to check, never every expense.
   */
  const choice = readChoices(bare, pending);
  if (choice) return choice;
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
  // "ACTUALLY IT WAS 50" with one expense in the preview: that one
  const live1 = pending.items.filter((x) => !x.skipped);
  // read from what they typed, capitals kept ("it was Ali", not "ali")
  const typed = text.replace(/[!.]+$/, '').trim();
  const itIs = /^(?:(?:actually|no|sorry|oops|wait|hmm)[,!.\s]+)*(?:it was|it'?s|it is|make it|should be|it should be|change it to)\s+(.+)$/i.exec(typed);
  if (itIs && live1.length === 1) {
    const one = onePart(`${live1[0].n} is ${itIs[1]}`, count, year, groups, pending.items);
    if (one) return { kind: 'fix', parts: [one], ok: [] };
  }
  // "THE FIRST ONE WAS YESTERDAY", "the second one is 50"
  const ORD0 = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const nthWas = /^(?:the\s+)?(first|second|third|fourth|fifth|last)(?:\s+one)?\s+(?:was|is|were|should be)\s+(.+)$/i.exec(typed);
  if (nthWas) {
    const n = /^last$/i.test(nthWas[1]) ? count : ORD0[nthWas[1].toLowerCase()];
    const one = n && n <= count ? onePart(`${n} is ${nthWas[2]}`, count, year, groups, pending.items) : null;
    if (one) return { kind: 'fix', parts: [one], ok: [] };
  }
  // BY POSITION: "remove the second one", "skip the last", "only the first two"
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const nth = (w) => (/^last$/i.test(w) ? count : ORD[w.toLowerCase()] ?? Number(String(w).replace(/(?:st|nd|rd|th)$/i, '')));
  const posOut = /^(?:remove|delete|skip|drop|leave out|take out|not|without)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))(?:\s+one)?$/i.exec(bare);
  if (posOut && nth(posOut[1]) >= 1 && nth(posOut[1]) <= count) return { kind: 'skip', which: [nth(posOut[1])] };
  const posOnly = /^(?:only|just|save only|keep only)\s+(?:the\s+)?(?:first|top)\s+(two|three|four|five|\d+)(?:\s+ones?)?$/i.exec(bare);
  if (posOnly) {
    const k = { two: 2, three: 3, four: 4, five: 5 }[posOnly[1].toLowerCase()] ?? Number(posOnly[1]);
    if (k >= 1 && k <= count) return { kind: 'only', which: Array.from({ length: k }, (_, i) => i + 1) };
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
  /**
   * SEVERAL ANSWERS IN ONE GO ("today, me", "both today and both me",
   * "yesterday + paid to careem", his harness 2026-10-07): each one goes to
   * every expense still missing that field.
   */
  const many = answersForAll(text.replace(/[!.]+$/, '').trim(), pending, year);
  if (many) return many;
  /**
   * THE ONE THING MISSING, ANSWERED BARE: "interflora" when only who it was
   * paid to is asked, for every one missing it (his harness 2026-10-07).
   */
  const asked = [...new Set(pending.items.filter((x) => !x.skipped).flatMap((x) => x.missing ?? []))];
  if (asked.length === 1 && ['payee', 'description'].includes(asked[0]) && /^[\p{L}][\p{L}\d .&'()-]{1,40}$/u.test(bare)
    && bare.split(/\s+/).length <= 4 && !YES.test(bare) && !NO.test(bare) && !/^(?:modify|change|edit|help|hi|hello|show|undo|wait)\b/i.test(bare)) {
    const which = pending.items.filter((x) => !x.skipped && (x.missing ?? []).includes(asked[0])).map((x) => x.n);
    return { kind: 'fix', parts: [{ which, fixes: [{ field: asked[0], value: String(said).trim() }] }] };
  }
  // "ME": every one still waiting on who spent it was the admin
  const noSpender = pending.items.filter((x) => !x.skipped && x.missing?.includes('spentBy'));
  if (ME.test(bare) && noSpender.length) {
    return { kind: 'fix', parts: [{ which: noSpender.map((x) => x.n), fixes: [{ field: 'spentBy', value: 'me' }] }] };
  }
  // "today": the one missing date. Anything wider needs a number.
  const missingDates = pending.items.filter((x) => !x.skipped && x.missing?.includes('spentOn'));
  if (/^(?:today|yesterday)$/i.test(bare) && missingDates.length >= 1) {
    return { kind: 'fix', parts: [{ which: missingDates.map((x) => x.n), fixes: [{ field: 'spentOn', value: bare }] }] };
  }

  // FIXES, one or several: "2 is 150, 3 paid to Careem", one per line too.
  // one answer per LINE too: the lines are split before spaces are folded
  const parts = String(said).trim().split(/\s*\n\s*/).map((l) => l.replace(/\s+/g, ' ').replace(/^(\d+)\.\s+/, '$1 '))
    .flatMap((l) => l.split(/\s*(?:;|,\s*(?=(?:#|no\.?\s*)?\d+\b|all\b)|\band\s+(?=(?:#|no\.?\s*)?\d+\s))\s*/i)).filter(Boolean);
  const read = parts.map((p) => onePart(p, count, year, groups, pending.items));
  if (read.length && read.every(Boolean)) {
    const oks = read.filter((r) => r.ok);
    return { kind: 'fix', parts: read.filter((r) => !r.ok), ok: oks.flatMap((r) => r.which) };
  }
  return null;
}

module.exports = {
  readReply, onePart, bareValue, readRates,
};
