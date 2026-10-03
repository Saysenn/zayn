/**
 * ***************************************************
 * * Did she state a rate, or deny one, that the tools contradict?
 * ***************************************************
 *
 * Asked what percentage was on Gloria Difference she said there was none,
 * then said 5% when pushed. Both answers came off the same row: the DEAL's
 * add on is 0 and the PERSON's is 5, and only one of them had reached her.
 *
 * `checkFigures` could not see either half. It ignores anything under 100
 * on purpose, so every percentage in the system is beneath it, and a denial
 * has no digits in it at all.
 *
 * Two shapes of wrong, so two checks:
 *
 *   she STATES a rate no tool produced      "Gloria is on 12%"
 *   she DENIES a rate a tool did produce    "she has no percentage"
 *
 * Like `checkFigures` it REPORTS and never rewrites. A rate is either right
 * or the turn is wrong.
 */

// A rate as it appears in a reply: 5% · 5 % · 5 percent · 5 per cent.
// The word boundary goes INSIDE the word alternatives. After `%` it can
// never match, `%` being a non word character, so "5%" read as no rate at
// all and the whole guard was blind to the commonest way she writes one.
const STATED = /(\d+(?:\.\d+)?)\s*(?:%|per\s?cents?\b)/gi;

// Which rate a sentence is about. `crypto` first: "no crypto rate" is about
// the crypto charge, not about add ons.
const KIND_WORD = /(crypto|add[\s-]?on|fee|percentage|percent|rate)s?/i;

/**
 * A denial: a negative within a few words of one of those nouns. Bounded to
 * one clause so "no rows this month, and 5% on the deal" is not a denial of
 * the 5%.
 */
const DENIAL = new RegExp(
  `\\b(?:no|not|none|without|nothing|doesn'?t have|does not have|has no|hasn'?t got|isn'?t on|is not on)\\b[^.;!?]{0,40}?\\b${KIND_WORD.source}`,
  'gi',
);

const KINDS = ['addon', 'fee', 'crypto'];

/** Which kind a key or a phrase names. `null` means "any of them". */
function kindOf(text) {
  const s = String(text ?? '').toLowerCase();
  if (s.includes('crypto')) return 'crypto';
  if (s.includes('addon') || s.includes('add_on') || s.includes('add on') || s.includes('add-on')) return 'addon';
  if (s.includes('fee')) return 'fee';
  return null;
}

const isPercentKey = (k) => /percent/i.test(k);

/** Every rate a reply states, as plain numbers. */
function percentsIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(STATED)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

/**
 * Every rate the tools produced this turn, and which kind each belongs to.
 *
 * EVERY PART OF THE ANSWER, because she may legitimately say any of them:
 * the person's own rate, the deal's own rate, and the two stacked. Handing
 * back only the stacked figure made "3% on the deal" look invented.
 */
function percentsFrom(result) {
  const all = new Set();
  const byKind = { addon: new Set(), fee: new Set(), crypto: new Set() };

  /**
   * TWO QUESTIONS, TWO BUCKETS. `all` is "is this number real", so she may
   * quote it. `byKind` is "does this rate APPLY", which is what makes a
   * denial wrong.
   *
   * They come apart on `result.cryptoPercent`: the system charge, returned
   * on every call whether or not a single row is paid in coin. Counting it
   * as applied flagged her for obeying the tool's own order to say the
   * crypto charge does not apply.
   */
  const take = (key, value, applies) => {
    const n = Number(value);
    if (!isPercentKey(key) || !Number.isFinite(n)) return;
    all.add(n);
    const kind = kindOf(key);
    if (kind && applies) byKind[kind].add(n);
  };

  const scan = (obj, applies) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) take(k, v, applies);
  };

  if (result && typeof result === 'object') {
    scan(result, false);
    scan(result.person, true);
    // `people`: what a profile write left each person on.
    for (const row of [...(result.deals ?? []), ...(result.rows ?? []), ...(result.people ?? [])]) {
      scan(row, true);
    }

    // `person.addon` and `person.fee` drop the word, so the key test misses
    // them. They are the PROFILE rate and she says it constantly.
    for (const kind of ['addon', 'fee']) {
      const n = Number(result.person?.[kind]);
      if (Number.isFinite(n)) { all.add(n); byKind[kind].add(n); }
    }

    // What a tool wrote into its own text is by definition a rate it
    // produced. Prose cannot say which kind, so it counts for all of them.
    for (const key of ['say', 'summary']) {
      for (const n of percentsIn(result[key])) all.add(n);
    }
  }

  return { all, byKind };
}

/**
 * @param {string} reply what she is about to say
 * @param {object[]} toolResults every tool result from this turn
 * @param {object} [opts]
 * @param {string} [opts.told] the admin's INSTRUCTION this turn, never a question:
 *   "give them 1%" may be said back before a tool has produced the 1.
 * @returns {{ ok: boolean, unsupported: number[], denied: string[], had: boolean }}
 *   `had` is whether any tool produced a rate at all. With none there is
 *   nothing to check against, so it stays silent rather than guessing.
 */
function checkPercents(reply, toolResults = [], { told = '' } = {}) {
  const all = new Set();
  const byKind = { addon: new Set(), fee: new Set(), crypto: new Set() };

  for (const r of toolResults) {
    const found = percentsFrom(r);
    for (const n of found.all) all.add(n);
    for (const kind of KINDS) for (const n of found.byKind[kind]) byKind[kind].add(n);
  }

  if (all.size === 0) return { ok: true, unsupported: [], denied: [], had: false };

  const said = percentsIn(reply);
  const theirs = percentsIn(told);
  const unsupported = [...said].filter((n) => !all.has(n) && !theirs.has(n));

  /**
   * A DENIAL BESIDE A REAL FIGURE IS A DISTINCTION, NOT A CONTRADICTION.
   * "The deal carries no percentage, but she is on 5%" is the correct
   * answer to the question that caused this guard, so a reply that states
   * a real non zero rate has already made the distinction.
   */
  const statedSomething = [...said].some((n) => n > 0 && all.has(n));
  const denied = [];

  if (!statedSomething) {
    for (const m of String(reply ?? '').matchAll(DENIAL)) {
      const kind = kindOf(m[0]);
      const against = kind ? byKind[kind] : all;
      if ([...against].some((n) => n > 0)) denied.push(m[0].trim());
    }
  }

  return {
    ok: unsupported.length === 0 && denied.length === 0,
    unsupported,
    denied,
    had: true,
  };
}

module.exports = { checkPercents, percentsIn, percentsFrom };
