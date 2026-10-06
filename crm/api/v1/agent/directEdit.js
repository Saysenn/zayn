const { fold, within } = require('./tools/resolvePerson');

/**
 * ***************************************************
 * * THE EVERYDAY EDIT, READ IN CODE
 * ***************************************************
 *
 * The admin's call 2026-10-06, after a day of "fixed one, broke another":
 * "add 5 days to zayn" became payable days SET to 5, "both" applied it
 * twice, "deduct 500" landed on the payable. Every one was the model
 * choosing the arguments of an edit it is asked for dozens of times a day.
 *
 * So the plain ones are read HERE, the same way every time, and handed to
 * the same tools she would have called, with every guard, preview and auto
 * mode rule they carry. She is not asked to guess them at all.
 *
 * ---- what is read ----
 *
 *   add / deduct N [days]  to|from|on|off  <person> [group] [field] [all deals]
 *   set|make|change <person> [group] <field> to N
 *   <person> [group] <field> N
 *
 * ---- it reads ALL of it or NONE of it ----
 *
 * A word left over that is not the person, a group, the field, the figure
 * or filler means the message says something this does not understand
 * ("and how much is he owed", "from next month", "2%"), so it returns null
 * and she reads it as before. A wrong parse is worse than no parse.
 */

const ADD_VERBS = new Set(['add', 'plus', 'increase', 'raise', 'bump', 'up']);
const SUB_VERBS = new Set(['deduct', 'minus', 'subtract', 'reduce', 'lower', 'cut', 'remove', 'take']);
const SET_VERBS = new Set(['set', 'make', 'change', 'update', 'put']);
const LINKS = new Set(['to', 'from', 'on', 'for', 'off', 'of', 'in', 'at']);
const FILLER = new Set(['pls', 'please', 'plz', 'thanks', 'thx', 'the', 'his', 'her', 'their', 'deal', 'deals',
  's', 'aed', 'gbp', 'usd', 'eur', 'euro', 'euros', 'amount', 'just', 'kindly', 'can', 'you', 'a', 'an']);
const ALL_WORDS = new Set(['all', 'both', 'every', 'each', 'everywhere']);
const ALL_PHRASE = /\b(?:all|both|every|each)\b(?:\s+(?:of\s+)?(?:his|her|their|the)?)?(?:\s+\w+['’]?s?)?\s+deals?\b|\beverywhere\b|\b(?:\w+['’]s|his|her|their)\s+deals\b/i;

/** "1,500", "1.5k", "500" → 1500, 1500, 500. Null when it is not a figure. */
function figure(token) {
  const m = /^(\d+(?:\.\d+)?)(k)?$/i.exec(String(token).replace(/,/g, ''));
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
}

/** The field the words name, and the words that named it. */
function fieldIn(words) {
  const at = (w) => words.indexOf(w);
  if (at('days') >= 0 || at('day') >= 0) {
    // "add 5 days to zayn payable days" says it twice: both are the field.
    const used = words.map((w, i) => (/^(?:days?|payable)$/.test(w) ? i : -1)).filter((i) => i >= 0);
    return { field: 'payableDays', used };
  }
  if (at('monthly') >= 0) return { field: 'monthlyAmount', used: [at('monthly')] };
  if (at('payable') >= 0) return { field: 'payableAmount', used: [at('payable')] };
  return { field: null, used: [] };
}

/**
 * The one person and at most one group the words name, and the indexes
 * they took. One slip allowed on a word of four letters or more.
 */
function whoIn(words, { people = [], groups = [] }) {
  const near = (a, b) => a === b || (b.length >= 4 && within(a, b, 1));
  const takeName = (name) => {
    const parts = String(name).split(/\s+/).map(fold).filter(Boolean);
    if (parts.length === 0) return null;
    const used = [];
    for (const part of parts) {
      const i = words.findIndex((w, j) => !used.includes(j) && near(w.replace(/['’]s$/, ''), part));
      if (i < 0) return null;
      used.push(i);
    }
    return used;
  };
  const found = people
    .map((name) => ({ name, used: takeName(name) }))
    .filter((p) => p.used);
  // The longest match wins a tie ("zayn" inside "zayn malik"), and two
  // different people is not an everyday edit.
  const best = found.sort((a, b) => b.used.length - a.used.length);
  if (best.length === 0) return null;
  const top = best.filter((p) => p.used.length === best[0].used.length);
  if (new Set(top.map((p) => fold(p.name))).size > 1) return null;

  const groupHits = groups
    .map((g) => ({ group: g, used: takeName(g) }))
    .filter((g) => g.used && !g.used.some((i) => top[0].used.includes(i)));
  if (groupHits.length > 1) return null;
  return {
    person: top[0].name,
    group: groupHits[0]?.group ?? null,
    used: [...top[0].used, ...(groupHits[0]?.used ?? [])],
  };
}

/**
 * @param {string} said their message
 * @param {{ people: string[], groups: string[] }} roster names on the sheet
 * @returns {null | { person, group, allDeals, field, op: 'add'|'set', value }}
 */
function parseEdit(said, roster) {
  const text = String(said ?? '').toLowerCase().replace(/[!?.;]+\s*$/g, '')
    // "cool. deduct 100 to all deals of zayn": the opener is not the edit.
    .replace(/^(?:(?:ok(?:ay)?|cool|yes|yeah|yup|alright|now|so|pls|please|and)\b[,.!]*\s+)+/, '')
    .trim();
  if (!text || /[%\n]|\band\b|\bthen\b|\bnext\b|\bmonth\b|\bfrom next\b/.test(text)) return null;
  // DEALS, PLURAL, IS ALL OF THEIRS: "add 100 to zayns deals". 2026-10-06.
  const allDeals = ALL_PHRASE.test(text) || /\bdeals\b/.test(text);
  const words = text.replace(/[^\w\s.,'’-]/g, ' ').split(/\s+/).map((w) => w.replace(/^[,.]+|[,.]+$/g, '')).filter(Boolean);
  if (words.length === 0 || words.length > 14) return null;

  let op = null;
  let value = null;
  const used = new Set();
  const first = words[0];
  const takeOff = first === 'take' && words.includes('off');

  if (ADD_VERBS.has(first) || SUB_VERBS.has(first)) {
    // add N ... / deduct N ...
    const n = figure(words[1]);
    if (n == null) return null;
    op = 'add';
    value = SUB_VERBS.has(first) ? -n : n;
    if (first === 'take' && !takeOff) return null;
    used.add(0).add(1);
  } else if (SET_VERBS.has(first)) {
    // set ... to N
    const to = words.lastIndexOf('to');
    const n = figure(words[to + 1]);
    if (to < 0 || n == null || to + 2 !== words.length) return null;
    op = 'set';
    value = n;
    used.add(0).add(to).add(to + 1);
  } else {
    // <person> [group] <field> N
    const n = figure(words[words.length - 1]);
    if (n == null) return null;
    op = 'set';
    value = n;
    used.add(words.length - 1);
  }

  const { field: named, used: fieldUsed } = fieldIn(words);
  fieldUsed.forEach((i) => used.add(i));
  // An amount added with no field named is the MONTHLY (2026-10-06); a SET
  // with no field is a figure for nothing in particular, so it is not read.
  const field = named ?? (op === 'add' ? 'monthlyAmount' : null);
  if (!field) return null;
  if (field === 'payableDays' && (value < 0 && op === 'set')) return null;

  const who = whoIn(words, roster);
  if (!who) return null;
  who.used.forEach((i) => used.add(i));

  const leftOver = words.filter((w, i) => !used.has(i)
    && !FILLER.has(w) && !LINKS.has(w) && !ALL_WORDS.has(w) && w !== 'off' && w !== 'more' && w !== 'extra'
    && !/^(?:of|his|her|their)$/.test(w));
  if (leftOver.length > 0) return null;

  return { person: who.person, group: who.group, allDeals, field, op, value };
}

/**
 * THE CALL IT STANDS FOR, the same arguments she would send.
 * Every deal of the person is the bulk door; one deal or "which?" is the
 * one deal door, which asks for the group itself.
 */
function callFor(edit) {
  const change = edit.op === 'add' ? { add: { [edit.field]: edit.value } } : { [edit.field]: edit.value };
  if (edit.allDeals && !edit.group) {
    const entry = edit.op === 'add'
      ? { person: edit.person, allDeals: true, add: change.add }
      : { person: edit.person, allDeals: true, set: change };
    return { name: 'bulk_update_master_sheet', args: { perPerson: [entry] } };
  }
  return {
    name: 'update_master_sheet_row',
    args: { targetPerson: edit.person, ...(edit.group ? { targetGroup: edit.group } : {}), ...change },
  };
}

/**
 * "BOTH" OR A GROUP, to her "which group should get it, or both?", is the
 * edit they asked for a moment ago, narrowed. Null for anything else.
 */
function followUp(said, previous, lastAnswer, roster) {
  if (!/\bhas \d+ deals\. Which \w+ should get\b/.test(String(lastAnswer ?? ''))) return null;
  const before = parseEdit(previous, roster);
  if (!before) return null;
  const text = String(said ?? '').toLowerCase().replace(/[!?.]+\s*$/, '').trim();
  if (/^(?:both|all|both of them|all of them|both deals|all (?:of )?(?:his|her|their) deals|everywhere)$/.test(text)) {
    return { ...before, allDeals: true, group: null };
  }
  const words = text.replace(/^(?:the|in|on)\s+/, '').replace(/\s+(?:one|deal|group)$/, '').trim();
  const group = (roster.groups ?? []).find((g) => fold(g) === fold(words)
    || (fold(words).length >= 4 && within(fold(words), fold(g), 1)));
  return group ? { ...before, allDeals: false, group } : null;
}

module.exports = { parseEdit, callFor, followUp };
