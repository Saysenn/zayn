// ***************************************************
// * One amount, in dollars
// ***************************************************
//
// Lifted out of breakdowns/withUsd.js, where it was private to one design.
// Diane needs the same arithmetic to answer "what is that in USD", and a
// second copy is how her figure and the exported file start disagreeing.

/**
 * WHAT THE SHEET CALLS A CURRENCY, AND WHAT ISO CALLS IT.
 *
 * The sheet writes `EURO` on 6 rows. There is no such code, so every rate
 * source returns nothing for it and those rows converted to blank.
 */
const CURRENCY_ALIASES = { EURO: 'EUR', EUROS: 'EUR', POUNDS: 'GBP', DOLLARS: 'USD' };

// A PEG, not a rate. Fixed at 3.6725 since 1997, so it does not depend on
// the fetch succeeding.
const AED_PER_USD = 3.6725;

function codeFor(currency) {
  const c = String(currency ?? '').trim().toUpperCase();
  return CURRENCY_ALIASES[c] ?? c;
}

/**
 * ===============================
 * * A RATE MAP IS KEYED THE WAY THE LOOKUP SPEAKS
 * ===============================
 * Both SIDES go through the aliases, not just the amount's currency. August
 * 2026's snapshot froze a euro rate under the sheet's own `EURO`; every
 * lookup normalized to `EUR` and missed it, so the month reported "no
 * exchange rate is available" while holding the rate all along.
 *
 * An exact ISO key wins over an aliased one, so a map carrying both is
 * resolved the same way every time.
 */
function normalizeRates(perUsd = {}) {
  const out = {};
  for (const [code, rate] of Object.entries(perUsd)) {
    const iso = codeFor(code);
    if (out[iso] === undefined || code === iso) out[iso] = rate;
  }
  return out;
}

/**
 * An amount in USD, or NULL when there is no rate for it.
 *
 * NULL, NEVER ZERO, and never a silent 1:1. A currency nobody has a rate
 * for, converted at par, is how a payout document becomes wrong without
 * looking wrong. Every caller counts the nulls and says so out loud.
 */
function toUsd(amount, currency, usdPerGbp, perUsd = {}) {
  const c = codeFor(currency);
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;

  if (c === 'USD') return n;
  // GBP first: a rate typed into an export is about THAT run and beats the
  // table.
  if (c === 'GBP') return n * usdPerGbp;

  const per = Number(normalizeRates(perUsd)[c]);
  if (Number.isFinite(per) && per > 0) return n / per;

  // ===============================
  // * THE PEG IS THE LAST RESORT, NOT THE FIRST
  // ===============================
  // This returned the peg BEFORE looking at the table, so an AED rate an
  // admin set in Settings was computed, stored, shown back to them, and
  // then ignored by every conversion. A peg is a decision somebody made
  // and can unmake; the constant is what we use when nobody has.
  if (c === 'AED') return n / AED_PER_USD;

  return null;
}

/**
 * A whole `{ currency: amount }` map converted, with what could not be.
 *
 * @returns {{ usd, converted, unconvertible }} `unconvertible` is the
 *   currencies with no rate. A caller that ignores it is quoting a total
 *   that silently omits money.
 */
function totalInUsd(byCurrency, usdPerGbp, perUsd = {}) {
  let usd = 0;
  const converted = [];
  const unconvertible = [];
  // Once for the whole map, not once per currency inside the loop.
  const rates = normalizeRates(perUsd);

  for (const [currency, amount] of byCurrency) {
    const value = toUsd(amount, currency, usdPerGbp, rates);
    if (value === null) {
      unconvertible.push({ currency, amount });
      continue;
    }
    usd += value;
    converted.push({ currency, amount, usd: Math.round(value * 100) / 100 });
  }

  return { usd: Math.round(usd * 100) / 100, converted, unconvertible };
}

module.exports = {
  toUsd, totalInUsd, codeFor, normalizeRates, CURRENCY_ALIASES, AED_PER_USD,
};
