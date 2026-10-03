/**
 * ***************************************************
 * * Did she say a COUNT no tool ever produced?
 * ***************************************************
 *
 * `checkFigures` guards money and deliberately ignores anything under 100,
 * because "4 deals" is a count and flagging every honest sentence would be
 * worse than the fault. That left a hole, and she walked into it:
 *
 *   tool:  3 rows (Zayn has two, Paddy has one)
 *   Diane: "two rows for Zayn and TWO for Paddy ... all FOUR rows"
 *
 * Paddy has one row. The count was invented, and nothing caught it because
 * it was spelled as a WORD. Every guard in this codebase counts digits.
 *
 * A COUNT IS A CLAIM ABOUT THE SHEET, exactly like an amount. "Four rows"
 * is a promise about what is about to be written; on forecasting it becomes
 * "three groups" and "four months", which nobody can check by eye.
 *
 * SCOPED TO A COUNTED NOUN, deliberately. "Two things", "one moment" and
 * "a couple" are prose and must never be flagged. Only a number sitting
 * directly in front of something the CRM counts is a claim.
 *
 * IT DOES NOT REWRITE HER REPLY, same as checkFigures: it reports so the
 * caller can retry once and the Logs page has the evidence.
 */

// The nouns the CRM actually counts. A number in front of anything else is
// prose, and this must stay a short list for exactly that reason.
const NOUNS = {
  row: 'row', rows: 'row',
  deal: 'row', deals: 'row',
  person: 'person', people: 'person', persons: 'person',
  group: 'group', groups: 'group',
  company: 'company', companies: 'company',
  change: 'change', changes: 'change',
  month: 'month', months: 'month',
  file: 'file', files: 'file',
  column: 'column', columns: 'column',
};

// Spelled out, because that is how she said the one that got through.
// Stops at twenty: past that a reply says the digits.
const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

const NOUN_LIST = Object.keys(NOUNS).join('|');
const WORD_LIST = Object.keys(WORDS).join('|');

// "3 rows", "twenty one people", "ninety-six deals". The hyphen and the
// space are both real: she writes both.
const CLAIM = new RegExp(
  `\\b(\\d[\\d,]*|(?:${WORD_LIST})(?:[\\s-](?:${WORD_LIST}))?)\\s+(${NOUN_LIST})\\b`,
  'gi',
);

function valueOf(said) {
  const text = String(said).toLowerCase().trim();
  if (/^\d/.test(text)) return Number(text.replace(/,/g, ''));

  // "twenty one" is 21; "twenty" alone is 20.
  const parts = text.split(/[\s-]+/).map((w) => WORDS[w]);
  if (parts.some((n) => n === undefined)) return null;
  return parts.reduce((a, b) => a + b, 0);
}

/**
 * Every count a piece of text claims, as noun -> set of numbers.
 *
 * Used on BOTH sides: the tools' own summaries state their counts in the
 * same shape ("21 rows", "18 people"), so the known set is extracted rather
 * than listed, and a tool that starts reporting a new count is covered the
 * day it does.
 */
function countsIn(text) {
  const out = new Map();
  for (const m of String(text ?? '').matchAll(CLAIM)) {
    const n = valueOf(m[1]);
    if (n === null) continue;
    const noun = NOUNS[m[2].toLowerCase()];
    if (!out.has(noun)) out.set(noun, new Set());
    out.get(noun).add(n);
  }
  return out;
}

/**
 * BOTH CASES, because the row shapes disagree and this guard read one.
 *
 * `summarizeRow` hands back camelCase (`personName`) and this looked only
 * for `person_id`/`person_name`, so the people set came back EMPTY on every
 * list and the person count was never checked at all. She said "36 people
 * in INDIGO are paid in GBP" over 36 ROWS held by 28 people, and nothing
 * flagged it: a guard that reads the wrong field name is not a guard.
 */
const personOf = (x) => String(
  x?.person_id ?? x?.personId ?? x?.person_name ?? x?.personName ?? '',
).trim().toLowerCase();

/** Every count the tools produced this turn, from their text and their rows. */
function countsFrom(results = []) {
  const known = new Map();
  const add = (noun, n) => {
    if (!Number.isFinite(n)) return;
    if (!known.has(noun)) known.set(noun, new Set());
    known.get(noun).add(n);
  };

  for (const r of results) {
    if (!r || typeof r !== 'object') continue;

    for (const key of ['say', 'summary']) {
      for (const [noun, set] of countsIn(r[key])) for (const n of set) add(noun, n);
    }

    // The rows themselves, so "she has four deals" is supported by the
    // four rows that came back even if no sentence counted them.
    if (Array.isArray(r.rows)) {
      add('row', r.rows.length);
      const people = new Set(r.rows.map(personOf).filter(Boolean));
      if (people.size > 0) add('person', people.size);
      const groups = new Set(r.rows.map((x) => x?.group_name ?? x?.groupName).filter(Boolean));
      if (groups.size > 0) add('group', groups.size);
    }
    if (r.list?.rows) add('row', r.list.rows.length);
    if (Array.isArray(r.cards)) add('row', r.cards.length);
  }
  return known;
}

/**
 * @param {string} reply what she is about to say
 * @param {object[]} toolResults every tool result from this turn
 * @returns {{ ok, wrong: Array<{noun, said, known}>, had }}
 *   `had` is whether the tools counted that noun at all. They must have, or
 *   there is nothing to check against and silence is the honest answer.
 */
function checkCounts(reply, toolResults = []) {
  const known = countsFrom(toolResults);
  if (known.size === 0) return { ok: true, wrong: [], had: false };

  const wrong = [];
  for (const [noun, said] of countsIn(reply)) {
    const allowed = known.get(noun);
    // A noun the tools never counted is not evidence of anything.
    if (!allowed) continue;
    for (const n of said) {
      if (!allowed.has(n)) wrong.push({ noun, said: n, known: [...allowed].sort((a, b) => a - b) });
    }
  }

  return { ok: wrong.length === 0, wrong, had: true };
}

/**
 * ***************************************************
 * * A COUNT BORROWED FROM ANOTHER GROUP
 * ***************************************************
 *
 * Live 2026-09-24, three turns and three different answers:
 *
 *   "Past a year (5)"  Reliapay 2, KP 1, Kryptonia 2
 *   "There are 2 deals in MILKMAN and 2 deals in MANBAT"
 *   "3 deals in MANBAT"                        <- after the admin corrected her
 *
 * The middle one is the fault. She had queried MILKMAN, got 2, and used
 * the same 2 for MANBAT, which holds 3. `checkCounts` could not see it:
 * the number 2 WAS produced by a tool, so as a bare figure it checks out.
 * What is wrong is which group it is attached to.
 *
 * SO THE COUNT IS CHECKED AGAINST THE GROUP BESIDE IT. The group names
 * come off the rows the tools returned, never a list typed here.
 *
 * SILENT WHEN THE GROUP WAS NEVER QUERIED. A turn that returned no rows
 * for MANBAT has nothing to say about how many MANBAT holds, and guessing
 * that she is wrong is the same fault pointing the other way.
 */
const SCOPED = /\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(deals?|rows?|people|persons?|handlers?)\s+(?:in|for|on|from|at)\s+([A-Za-z][A-Za-z0-9 ]{1,30}?)(?=[.,;:!?]|\s+(?:and|with|that|which|who|has|have|are|is)\b|$)/gi;

/** rows a turn returned, per group, folded for comparison. */
function rowsByGroup(results = []) {
  const byGroup = new Map();
  for (const r of results ?? []) {
    const rows = Array.isArray(r?.rows) ? r.rows : (r?.list?.rows ?? []);
    for (const row of rows) {
      const group = String(row?.group_name ?? row?.groupName ?? '').trim();
      if (!group) continue;
      const key = group.toLowerCase();
      if (!byGroup.has(key)) byGroup.set(key, { name: group, rows: new Set() });
      // BY ROW ID, so the same row arriving from two calls counts once.
      byGroup.get(key).rows.add(row?.id ?? row);
    }
  }
  return byGroup;
}

/**
 * @returns {{ ok: boolean, wrong: Array<{group, said, known}> }}
 */
function checkCountsByGroup(reply, toolResults = []) {
  const byGroup = rowsByGroup(toolResults);
  if (byGroup.size === 0) return { ok: true, wrong: [] };

  const wrong = [];
  for (const m of String(reply ?? '').matchAll(SCOPED)) {
    const n = valueOf(m[1]);
    if (n === null) continue;
    const held = byGroup.get(String(m[3]).trim().toLowerCase());
    // NOT A GROUP THIS TURN LOOKED AT, so there is nothing to check.
    if (!held) continue;
    if (held.rows.size !== n) {
      wrong.push({ group: held.name, said: n, known: held.rows.size });
    }
  }
  return { ok: wrong.length === 0, wrong };
}

module.exports = {
  checkCounts, countsIn, countsFrom, checkCountsByGroup, rowsByGroup,
};
