/**
 * ***************************************************
 * * Did she answer for a month nothing was computed?
 * ***************************************************
 *
 * `checkFigures` was built for exactly this incident and could not catch
 * it, because the wrong answer contained no digits at all:
 *
 *   Diane: "Nicola is owed nothing for August 2026 ... Nicola is also owed
 *           nothing for September 2026. The same rows apply as for August."
 *
 * August was right: those rows are marked for September, so August owes
 * nothing. September was 2,900. She called the tool ONCE, for August, and
 * wrote the second sentence herself.
 *
 * `figuresIn` strips "August 2026" and "September 2026" as dates, and
 * "3 rows" is under `SMALLEST`. The set it checks comes back EMPTY, so the
 * guard passes a reply that states a money conclusion for a whole month.
 *
 * A ZERO IS A FIGURE CLAIM WEARING NO NUMBER. This is the guard for it:
 * every month she makes a money claim about has to be a month some tool
 * actually reported on.
 *
 * ---- why it is bound to "FOR <month>", not to the sentence ----
 *
 * Scoping it to a sentence with a money word in it was not enough:
 *
 *   "Her payment starts in November, so nothing is owed yet."
 *
 * is correct, contains "owed", and would have been flagged. The month
 * there belongs to STARTS, not to OWED.
 *
 * A month is only a claim when it is what the money is FOR, which is also
 * how her own tool phrases it: `totalReply` hands her "for August 2026"
 * and tells her to say it. Anything else ("in November", "to October",
 * "ends in April") is a date, and dates are not this guard's business.
 *
 * The bias is deliberate. checkFigures already carries the warning that a
 * check which cries wolf on prose is one people learn to widen, so this
 * would rather miss an odd phrasing than flag an honest sentence.
 */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const MONTH_NUMBER = new Map(MONTHS.map((month, index) => [month, String(index + 1).padStart(2, '0')]));

/**
 * The words that turn a month into a claim about money. `owed` and its
 * family, plus the shapes her own tool summaries use.
 *
 * PAYMENT STATE IS A CLAIM TOO, and a whole one. Live 2026-09-07: "whos not
 * paying yet" answered "No one is marked as not started or unpaid for
 * September 2026" with NO tool call, while nineteen deals were marked not
 * started. Not one of `owed`, `total`, `due` or `payable` appears in that
 * sentence, so the guard had nothing to hold on to.
 *
 * A WORD LIST LEAKS, and this one will: the next unlisted phrasing walks
 * past it. It is here because the month is still bound to "FOR <month>",
 * which is what keeps the precision. "Her payment STARTS in November" has
 * no "for", so it is untouched.
 */
const MONEY_CLAIM = /\b(owed?s?|owing|total(s|led|ling)?|due|payable|comes? to|adds? up|paid|unpaid|not started|not paying|payment period)\b/i;

// A sentence, roughly. Her replies are prose with full stops; a newline
// ends one too, because the tool sentences arrive as lines.
const SENTENCE = /[^.!?\n]+[.!?]?/g;

const monthPattern = new RegExp(`\\b(${MONTHS.join('|')})(?:\\s+(20\\d{2}))?\\b`, 'gi');

// The month the money is FOR. "for August", "for the month of August".
const forMonthPattern = new RegExp(
  `\\bfor\\s+(?:the\\s+)?(?:month\\s+of\\s+)?(${MONTHS.join('|')})(?:\\s+(20\\d{2}))?\\b`,
  'gi',
);

function monthKey(name, year) {
  const month = String(name).toLowerCase();
  return year ? `${year}-${MONTH_NUMBER.get(month)}` : month;
}

function monthName(key) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key)) return key;
  return MONTHS[Number(key.slice(5)) - 1];
}

/** Every month named in a piece of text, with its year when stated. */
function monthsIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(monthPattern)) out.add(monthKey(m[1], m[2]));
  return out;
}

/**
 * Months the tools actually reported on.
 *
 * Read out of the summary text rather than a field, because that is where
 * the month is: `totalReply` opens with "<who>, <when>" and every figure
 * block under it belongs to that month.
 */
function monthsFrom(result) {
  const out = new Set();
  if (!result || typeof result !== 'object') return out;
  // Detail cards deliberately show dates without computing money. An
  // explicit empty list means no monthly total was calculated, so those
  // appointment, start, preset and end dates are not evidence for a claim.
  if (Array.isArray(result.computedMonths)) {
    for (const month of result.computedMonths) {
      if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(month))) out.add(String(month));
    }
    return out;
  }
  for (const key of ['summary', 'say', 'reply']) {
    for (const m of monthsIn(result[key])) out.add(m);
  }
  return out;
}

/**
 * The months a piece of text says something is FOR.
 *
 * ONE DEFINITION of "the month this is about". The claim check below reads
 * it per sentence; the write guard in `tools/masterSheet` reads it over the
 * admin's whole request, to catch a change asked for one month and about to
 * land on another. A second copy of this pattern would be a second idea of
 * what "for October" means.
 */
function forMonthsIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(forMonthPattern)) out.add(monthKey(m[1], m[2]));
  return out;
}

/** 'october' or '2026-10' to 10. Null for anything that is not a month. */
function monthNumberOf(key) {
  const value = String(key ?? '').toLowerCase();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return Number(value.slice(5));
  const at = MONTHS.indexOf(value);
  return at === -1 ? null : at + 1;
}

/**
 * Months she makes a MONEY CLAIM about.
 *
 * Both conditions, and both are needed. The sentence has to be about money
 * ("owed", "total", "due") AND the month has to be what the money is FOR.
 * Either one alone flags "her payment starts in November, so nothing is
 * owed yet", which is a correct sentence.
 */
function claimedMonths(reply) {
  const out = new Set();
  for (const [sentence] of String(reply ?? '').matchAll(SENTENCE)) {
    if (!MONEY_CLAIM.test(sentence)) continue;
    for (const m of forMonthsIn(sentence)) out.add(m);
  }
  return out;
}

/**
 * @param {string} reply what she is about to say
 * @param {object[]} toolResults every tool result from this turn
 * @returns {{ ok: boolean, uncovered: string[], had: boolean }}
 *   `had` is whether any tool named a month at all. With none there is
 *   nothing to compare against, so the check stays silent rather than
 *   guessing: she may be answering from a card, which is legitimate.
 */
function checkMonths(reply, toolResults = []) {
  const covered = new Set();
  let declared = false;
  for (const r of toolResults) for (const m of monthsFrom(r)) covered.add(m);
  for (const result of toolResults) {
    if (Array.isArray(result?.computedMonths)) declared = true;
  }

  if (covered.size === 0 && !declared) {
    /**
     * ===============================
     * * NOTHING RAN IS NOT THE SAME AS A TOOL THAT NAMED NO MONTH
     * ===============================
     * The exemption below is for answering off a card: a tool DID run and
     * simply computed no month, so a month in the reply is not evidence of
     * anything. With NO tool call at all there is nothing to answer off,
     * and a money claim for a month is invented outright.
     *
     * Live 2026-09-07: "whats coming next month" and "and the month after"
     * both returned September's figures under October's and November's
     * names, with no tool call on either turn. This guard was the one
     * written for that fault and passed both, because an empty
     * `toolResults` looked the same to it as a card.
     */
    if (toolResults.length === 0) {
      const claimed = [...claimedMonths(reply)];
      return { ok: claimed.length === 0, uncovered: claimed, had: claimed.length > 0 };
    }
    return { ok: true, uncovered: [], had: false };
  }

  const coveredNames = new Set([...covered].map(monthName));
  const uncovered = [...claimedMonths(reply)].filter((month) => (
    /^20\d{2}-/.test(month) ? !covered.has(month) : !coveredNames.has(month)
  ));
  return { ok: uncovered.length === 0, uncovered, had: true };
}

module.exports = {
  checkMonths, claimedMonths, monthsFrom, forMonthsIn, monthNumberOf, MONTHS,
};
