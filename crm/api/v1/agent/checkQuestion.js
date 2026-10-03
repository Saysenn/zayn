/**
 * ***************************************************
 * * Did she answer the SHAPE of question they asked?
 * ***************************************************
 *
 * `checkFigures` and `checkMonths` ask whether a figure is real. This asks
 * something earlier: whether the answer is even the right KIND of answer.
 * Both faults are from one live conversation, 2026-09-07:
 *
 *   "did we earn more than last month"
 *     -> September's total, twice, and no comparison at all.
 *
 *   "who is on the most money"
 *     -> the whole sheet's total. She has no ranking tool, did not say so,
 *        and handed back a real figure for a different question.
 *
 * A REAL FIGURE FOR THE WRONG QUESTION IS THE WORST SHAPE. It cannot be
 * caught by checking the number, because the number is correct.
 *
 * ---- why this is an output check and not a router ----
 *
 * Which tool she picks cannot be fixed from inside a tool. It CAN be
 * checked afterwards: a comparison needs two months computed, a superlative
 * needs rows to rank. Both are facts about what the tools returned, not
 * guesses about what she meant.
 *
 * The bias is checkFigures': it would rather miss an odd phrasing than flag
 * an honest answer, because a guard that cries wolf is one people widen
 * until it means nothing.
 *
 * The question shapes live in `askShapes.js`, shared with the tunnel that
 * routes them. Two lists for one question is how a retry fires on a
 * question the tunnel never routed.
 */
const { asksComparison, asksSuperlative } = require('./askShapes');

// A reply that states money. Without one there is nothing to be wrong
// about: "I cannot rank people yet" must pass both checks.
const STATES_MONEY = /\b(?:owed?|owing|total|due|payable)\b/i;

// She said she cannot, which is the answer we want and must never be
// retried into an attempt.
const DECLINING = /\b(?:cannot|can't|cant|unable|no tool|do not have|don't have|there is no way|not able)\b/i;

/** Distinct months any tool reported on this turn. */
function monthsComputed(results = []) {
  const months = new Set();
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    if (Array.isArray(result.computedMonths)) {
      for (const month of result.computedMonths) months.add(String(month));
    }
  }
  return months;
}

/**
 * @param {string} reply what she is about to say
 * @param {string} said the admin's own sentence
 * @param {object[]} toolResults every tool result from this turn
 * @returns {{ ok: boolean, kind: string|null }}
 */
function checkQuestion(reply, said, toolResults = []) {
  const text = String(reply ?? '');
  const asked = String(said ?? '');
  if (!text || !asked) return { ok: true, kind: null };
  // Declining is the honest answer to a question she has no tool for.
  if (DECLINING.test(text)) return { ok: true, kind: null };
  if (!STATES_MONEY.test(text)) return { ok: true, kind: null };

  // A COMPARISON NEEDS TWO PERIODS. One month computed cannot answer
  // "more than last month", whatever figure is in the reply.
  if (asksComparison(asked) && monthsComputed(toolResults).size < 2) {
    return { ok: false, kind: 'comparison' };
  }

  // A SUPERLATIVE HAS NO ANSWER HERE. There is no ranking read and there
  // is not meant to be one, so this fires whether or not rows came back:
  // rows are deals, not an ordering, and ranking them by eye is the guess
  // this prevents.
  if (asksSuperlative(asked)) {
    return { ok: false, kind: 'ranking' };
  }

  return { ok: true, kind: null };
}

// What to tell her, per kind. Named here so the retry message and the
// reason it fired cannot drift apart.
const INSTEAD = {
  comparison: 'They asked you to COMPARE two periods and you answered with one. Call '
    + 'compare_months with BOTH months in the months array, in one call, and give them the '
    + 'change between them. Never call a totals tool once per month and compare the answers '
    + 'yourself.',
  // SHE DECLINES. There is no ranking capability and there is not going to
  // be one: "who earned the most this month" is not a question she answers.
  // The fault being prevented is handing back a real figure for a different
  // question, and the fix for that is "I cannot", never a better figure.
  ranking: 'They asked WHICH ONE is the most or the least, and you answered with a total. A '
    + 'single figure has no "most" in it, and you have NO tool that ranks people or groups. Say '
    + 'plainly, in one sentence, that you cannot rank them. Then offer what you CAN do: a total '
    + 'for any one of them by name. Do NOT hand back a total as if it answered, and do NOT try '
    + 'to rank them yourself from anything on screen.',
};

module.exports = { checkQuestion, INSTEAD, monthsComputed };
