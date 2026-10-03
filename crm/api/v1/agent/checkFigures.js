/**
 * ***************************************************
 * * Did she say a figure no tool ever produced?
 * ***************************************************
 *
 * The prompt already forbids adding amounts up, quoting a remembered one,
 * or contradicting the tool, and names the exact incident it came from. It
 * still happened: asked Nicola's August total she answered "owed nothing,
 * all her deals are marked for another month" off the cards she had shown a
 * moment earlier, while `total_master_sheet` computes 2,900.
 *
 * PROMPTING IS NOT A GUARD. This is the same belt-and-braces as
 * stripMarkdown and noDashes: asked-for behaviour is mostly obeyed, and
 * "mostly" is not good enough when the subject is money.
 *
 * IT DOES NOT REWRITE HER REPLY. A figure is either right or the turn is
 * wrong, and silently editing money would be worse than either. It reports,
 * so the caller can retry once and the Logs page has the evidence.
 */

// Money as it appears in a reply: 2,900 · 80.65 · 80 GBP · GBP 70.
// Bare integers under this are ordinarily counts, days or row ids. A
// decimal or a currency marker makes the number a figure at any size.
const SMALLEST = 100;
const PERCENT = /\d[\d,]*(?:\.\d+)?\s*(?:%|per\s?cents?\b)/gi;
const CURRENCY_BEFORE = /(?:[£€$\u00a5]|[A-Z]{3})\s*$/;
const CURRENCY_AFTER = /^\s*(?:[£€$\u00a5]|[A-Z]{3}\b)/;

/** Every number a reply states, as plain numbers. */
/**
 * NOT EVERY NUMBER IS A FIGURE.
 *
 * It flagged the YEAR in "September 2026" and a PHONE NUMBER she had just
 * been asked to set, each costing a retry on a reply that was correct. A
 * check that cries wolf on prose is a check people learn to widen.
 *
 * Three things are stripped before the scan, and all three are recognised
 * by their SHAPE rather than their value, so a real amount that happens to
 * look like one is still caught:
 *
 *   a date      2026-09-01, 01/09/2026
 *   a year      four digits directly after a month name, or "in 2026"
 *   a long run  ten or more digits with no separators is an account or a
 *               phone, never money anyone is owed
 */
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const NOT_A_FIGURE = [
  /\b\d{4}-\d{2}(-\d{2})?\b/gi, // 2026-09, 2026-09-01
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, // 01/09/2026
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{4}\\b`, 'gi'), // September 2026
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b`, 'gi'), // 31st of December
  /\bin\s+\d{4}\b/gi, // "in 2026"
  /\b\d{10,}\b/g, // an account or phone number, never an amount
];

function figuresIn(text) {
  // Percentages have their own value guard. Removing the whole expression
  // first stops a decimal rate such as 2.5% being claimed by both guards.
  let prose = String(text ?? '').replace(PERCENT, ' ');
  for (const re of NOT_A_FIGURE) prose = prose.replace(re, ' ');

  const out = new Set();
  for (const m of prose.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    const at = m.index ?? 0;
    const decimal = m[0].includes('.');
    const marked = CURRENCY_BEFORE.test(prose.slice(Math.max(0, at - 8), at))
      || CURRENCY_AFTER.test(prose.slice(at + m[0].length, at + m[0].length + 8));
    if (Number.isFinite(n) && (n >= SMALLEST || decimal || marked)) out.add(round(n));
  }
  return out;
}

// Money said as owed or with a currency: the claim a refused total cannot back.
const MONEY_CLAIM = /\bowed?\b|\b(?:GBP|AED|EURO?|USD)\b|[£€$]/i;

// Pence, so 1400 and 1400.00 are one figure and float noise is not a
// mismatch.
function round(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Every figure the tools produced this turn: the totals themselves and the
 * per-row amounts behind them.
 *
 * THE ROWS COUNT TOO. "700 from Acqua and 800 from Leadstone" is a correct
 * sentence built from real values, and only the grand total is in `total`.
 */
function figuresFrom(result) {
  const out = new Set();
  if (!result || typeof result !== 'object') return out;

  // EVERY PART OF THE ANSWER, because she may legitimately say any of
  // them: what is owed, each rate applied to it, and the resolved figure.
  // `totalWithFee` was renamed `totalWithRates` when add ons and the crypto
  // charge arrived, and this list was not updated: those figures passed
  // only because the tool also writes them into its own summary.
  for (const key of ['total', 'addon', 'crypto', 'fee', 'totalWithRates']) {
    for (const v of Object.values(result[key] ?? {})) {
      if (Number.isFinite(Number(v))) out.add(round(v));
    }
  }
  // The converted figure and the rate behind it. The rate is usually below
  // SMALLEST and ignored anyway; the total is the one that matters.
  if (result.converted) {
    for (const v of [result.converted.usd, result.converted.rate]) {
      if (Number.isFinite(Number(v))) out.add(round(v));
    }
  }
  for (const row of result.rows ?? []) {
    for (const key of ['payable_amount', 'monthly_amount', 'payableAmount', 'monthlyAmount']) {
      const n = Number(row?.[key]);
      if (Number.isFinite(n)) out.add(round(n));
    }
  }
  // Anything the tool wrote into its own text is by definition a figure it
  // produced, which covers the summaries that format their own lines.
  for (const key of ['say', 'summary']) {
    for (const n of figuresIn(result[key])) out.add(n);
  }
  return out;
}

/**
 * @param {string} reply what she is about to say
 * @param {object[]} toolResults every tool result from this turn
 * @returns {{ ok: boolean, unsupported: number[], had: boolean }}
 *   `had` is whether any tool produced a figure at all. With none, there is
 *   nothing to check against and a number in the reply is not evidence of
 *   anything, so the check stays silent rather than guessing.
 */
function checkFigures(reply, toolResults = []) {
  const known = new Set();
  for (const r of toolResults) for (const n of figuresFrom(r)) known.add(n);

  /**
   * ===============================
   * * NOTHING RAN IS NOT THE SAME AS A TOOL THAT COMPUTED NO FIGURE
   * ===============================
   * An empty `known` normally means there is nothing to compare against, so
   * silence is right: she may be reading a card back, or answering prose.
   * With NO TOOL CALL AT ALL there is nothing to read back from, and every
   * figure in the reply came from somewhere she cannot show.
   *
   * Live 2026-09-08, after `checkMonths` closed the same hole: "Looking
   * ahead to November 2026, the sheet projects AED 54,342.50 and EURO
   * 3,510.00", no tool called. `checkMonths` could not see it either,
   * because its month is bound to "FOR <month>" and this said "to", which
   * is the precision that keeps THAT guard from crying wolf.
   *
   * So the figures are the net here, not the month.
   */
  // AND A TOOL THAT RAN AND REFUSED is nothing to read back either: two
  // refused totals, then "owed 6,000" where the sum was 4,650. 2026-09-25.
  // Only a MONEY claim: "around 5,000 last year I think" is conversation.
  const readable = toolResults.some((r) => r?.cards?.length || r?.rows?.length
    || r?.list?.rows?.length || r?.card);
  const moneyClaim = MONEY_CLAIM.test(String(reply ?? ''));
  if (known.size === 0 && (toolResults.length === 0 || (!readable && moneyClaim))) {
    const unsupported = [...figuresIn(reply)];
    return { ok: unsupported.length === 0, unsupported, had: unsupported.length > 0 };
  }
  if (known.size === 0) return { ok: true, unsupported: [], had: false };

  const unsupported = [...figuresIn(reply)].filter((n) => !known.has(n));
  return { ok: unsupported.length === 0, unsupported, had: true };
}

module.exports = { checkFigures, figuresIn, figuresFrom, round, SMALLEST };
