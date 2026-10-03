/**
 * ***************************************************
 * * The SHAPES a question comes in, in ONE place
 * ***************************************************
 *
 * Seven of these grew separately: the tunnel's comparison test, the span
 * total's, `checkQuestion`'s two, the "together" note, the breakdown's own
 * vocabulary and the rate tool's convert test. Each was a private regex in
 * the file that needed it.
 *
 * THEY WILL NEVER BE COMPLETE. Natural language is infinite and every one
 * of these leaks: the next phrasing nobody wrote down walks past. That is
 * not fixable by writing more words, so it is not what this file claims to
 * do.
 *
 * What it fixes is the COST of a leak. One definition means:
 *
 *   - a phrasing added once is added everywhere that asks the same
 *     question, instead of in whichever file somebody remembered
 *   - the leak is testable, and `askShapes.test.js` pins the phrasings we
 *     have actually seen in a live transcript
 *   - "does this sentence ask for a comparison" has ONE answer, so the
 *     tunnel and the guard that checks the tunnel's work cannot disagree
 *
 * That last one matters most. `COMPARES_PERIODS` opened the tunnel and
 * `ASKS_COMPARISON` decided whether the answer was wrong; two lists for one
 * question is how a retry fires on a question the tunnel never routed.
 *
 * ---- the rule for adding one ----
 *
 * Only a phrasing SEEN IN A REAL TRANSCRIPT goes in. Inventing likely
 * wordings is how a list grows until it matches ordinary prose and the
 * guard has to be widened away. Each entry earns its place by having been
 * said.
 */

// One period against another. "vs" is deliberately out: it appears in her
// own output ("Sept 2026 vs Aug 2026") far more than in a question.
const COMPARISON = /\b(?:more than|less than|higher than|lower than|better than|worse than|compared to|compared with|against last|than last (?:month|year)|gain or los[es]|did we (?:gain|lose)|up or down|month on month)\b/i;

// Which ONE, out of several. There is no ranking tool and there is not
// going to be one, so this exists to make her decline.
const SUPERLATIVE = /\b(?:most|biggest|largest|highest|smallest|lowest|top|best|worst|richest)\b/i;
const WHICH_ONE = /\b(?:who|which|whose)\b/i;

// Several subjects as ONE figure. Currencies are still never added; this
// only decides whether the answer has to SAY so.
const COMBINED = /\b(?:together|combined|combine|add(?:ed)? up|altogether|in total|between them|sum of)\b/i;

// A question about the combined figure over a SPAN of months, which is the
// only case where months are added at all.
const EARNINGS = /\b(?:earn(?:ed|ings)?|in total|altogether|combined|all together|overall|sum|gain(?:ed)?|lost|loss|how much did we (?:make|get))\b/i;

// What the payment breakdown report is actually called. A sentence with
// none of these did not ask for one, whatever the model decided.
const BREAKDOWN = /\b(?:breakdowns?|break (?:it|that|this|them) down|banks?|cash|crypto|uk|local|away|methods?|splits?|send|payouts?)\b/i;

// An instruction to CONVERT, which needs a target currency to be one. Without
// it, "what did you convert august at" is a question about the RATE.
const CONVERT_REQUEST = /\bconvert(?:s|ed|ing)?\b[^.?!]*\b(usd|dollars?|gbp|aed|euros?)\b/i;
const ABOUT_THE_RATE = /\brates?\b/i;

// A short continuation of the question before it. The scope and the period
// both carry across one of these; neither carries across a fresh subject,
// which is why it stays this narrow.
const FOLLOW_UP = /\b(?:what about|and|also|same for|how about|those|them|only)\b/i;

const said = (value) => String(value ?? '');

/** One period measured against another. */
// ===============================
// * A RULE, NOT A FIGURE
// ===============================
// Live 2026-09-24. "Explain why there's a special case" ran the TOTALS
// tool and answered "Mayah is owed GBP 1,000". "What's the rule for these
// special cases" restated one row's status. Neither is a rule, and a
// total answers neither question.
const RULE_QUESTION = /\b(?:what(?:'s| is| are)? the rules?|how (?:does|do) (?:it|that|they|this) work|explain(?:\s+\w+){0,3}\s+(?:why|how|what)|why (?:is|are|does|do|would)|what does (?:that|it|this)(?:\s+\w+){0,2}\s+(?:do|mean)|how is .* (?:worked out|decided|calculated))\b/i;

/**
 * Does this ask for a RULE rather than a number?
 *
 * The distinction is what the answer is MADE OF. "How much is Mayah owed"
 * wants a figure; "why is Mayah a special case" wants the condition that
 * put her there, and a figure is not a smaller version of it.
 */
const asksForRule = (text) => RULE_QUESTION.test(said(text));

const asksComparison = (text) => COMPARISON.test(said(text));

/** Which one is the most or the least. She has no answer to this. */
const asksSuperlative = (text) => SUPERLATIVE.test(said(text)) && WHICH_ONE.test(said(text));

/** Several subjects as one figure. */
const asksCombined = (text) => COMBINED.test(said(text));

/** What a span of months adds up to. */
const asksEarnings = (text) => EARNINGS.test(said(text));

/** The payment breakdown report, by name. */
const asksBreakdown = (text) => BREAKDOWN.test(said(text));

/** Convert THIS figure, as opposed to asking what the rate is. */
const asksToConvert = (text) => CONVERT_REQUEST.test(said(text)) && !ABOUT_THE_RATE.test(said(text));

/** A short continuation, carrying the scope and period of the line before. */
const isFollowUp = (text) => FOLLOW_UP.test(said(text));

/**
 * "Is Dov on a 5% fee?": a yes or no about ONE figure. Returns the figure and
 * the kind (null when no kind was named), or null for any other question.
 * "What is Dov on" has no figure to check and is not this.
 */
const RATE_CHECK = /^\s*(?:(?:so|and|ok|okay|hey)\b[,\s]*)?(?:is|are|does|do|has|have)\b[^?.!]*?\b(\d+(?:\.\d+)?)\s*(?:%|percent)(?:\s+(add[\s-]?ons?|fees?))?/i;

function asksRateCheck(text) {
  const hit = RATE_CHECK.exec(said(text));
  if (!hit) return null;
  // After the figure, or anywhere when only one kind is named: "is dov's fee 5%".
  const lower = said(text).toLowerCase();
  const fee = /\bfees?\b/.test(lower);
  const addon = /\badd[\s-]?ons?\b/.test(lower);
  const word = String(hit[2] ?? '').toLowerCase();
  const kind = word.startsWith('add') || (!word && addon && !fee) ? 'addon'
    : word.startsWith('fee') || (!word && fee && !addon) ? 'fee' : null;
  return { percent: Number(hit[1]), kind };
}

module.exports = {
  asksRateCheck,
  asksForRule,
  asksComparison,
  asksSuperlative,
  asksCombined,
  asksEarnings,
  asksBreakdown,
  asksToConvert,
  isFollowUp,
};
