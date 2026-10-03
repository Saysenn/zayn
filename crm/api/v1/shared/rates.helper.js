// ***************************************************
// * Add ons and fees: one definition, both directions
// ***************************************************
//
// addon  ADDED    what the person earns on top of the payable amount
// fee    DEDUCTED what comes off after that
//
// TWO LEVELS, AND THEY STACK. A rate on the PERSON is their standing
// arrangement; a rate on the DEAL is this piece of work. 5% on the person
// plus 3% on the row is 8% on that row, which is why the UI warns on both
// cells: typing 3 and getting 8 is the failure to prevent.
//
// ORDER MATTERS: add on first, fee off the result. 500 at 8% add on and
// 2% fee is 540 then 529.20, not 530.

// ===============================
// * THE TWO DIRECTIONS, IN WORDS, FOR ANYTHING THAT EXPLAINS THEM
// ===============================
// `fee_percent` kept its name and inverted its meaning at migration 047,
// and Diane's prompt was still teaching the old one: "THE FEE IS ADDED,
// NEVER DEDUCTED", beside a tool that deducts it. Found 2026-09-24.
//
// Said once here so a reader and a writer cannot disagree about the sign.
const RATE_DIRECTIONS = 'An ADD ON is income on top: 5% on 2,900 owed means 3,045 to find. '
  + 'A FEE is taken off after it: 5% on 2,900 means 2,755 to hand over. Never swap them.';

// A THIRD RATE, and it belongs to the RAIL, not the person. We pay the gas
// on a crypto payment, so it is added like an add on but kept apart from
// one: the sheet prints them in two blocks because they answer two
// questions, what people cost and what the rail costs.
const CRYPTO = /crypto/i;

// THE CAP, one definition. It was typed into people.js and the agent tool
// separately, so a rate the route accepted the agent could refuse.
// Mirrored web-side in configs/sheetValues.js: a contract, not a share.
const MAX_PERCENT = 100;

/** person_id -> { addon, fee }, or a bare number for the older fee map. */
function ratesFor(row, byPerson = null, { cryptoPercent = 0 } = {}) {
  const held = byPerson?.get(row.person_id);
  const person = typeof held === 'number' ? { addon: held, fee: 0 } : (held ?? {});
  const paidInCrypto = CRYPTO.test(String(row.payment_method ?? ''));
  return {
    addon: (Number(person.addon) || 0) + (Number(row.addon_percent) || 0),
    crypto: paidInCrypto ? (Number(cryptoPercent) || 0) : 0,
    fee: (Number(person.fee) || 0) + (Number(row.fee_percent) || 0),
  };
}

/**
 * The same two rates for a row that ALREADY CARRIES BOTH LEVELS.
 *
 * `ratesFor` takes the person's half from a map because an export loads
 * every person once for a month. A master sheet row has `person_addon_%`
 * and `person_fee_%` on it, and adding the two levels up in the caller is
 * how the fourth disagreeing copy of the sum starts.
 */
function stackedRates(row, opts = {}) {
  return ratesFor(row, new Map([[row.person_id, {
    addon: Number(row.person_addon_percent) || 0,
    fee: Number(row.person_fee_percent) || 0,
  }]]), opts);
}

/**
 * What one deal is worth once every rate is applied.
 *
 * @returns {{ amount, addon, crypto, fee, net }} every part named and
 *   SEPARATE, because the export prints them in their own blocks and must
 *   not re-derive them. `crypto` is not folded into `addon` for that
 *   reason alone: the arithmetic is identical, the question is not.
 */
function amountWithRates(row, byPerson = null, opts = {}) {
  const amount = Number(row.payable_amount) || 0;
  const { addon: addonPct, crypto: cryptoPct, fee: feePct } = ratesFor(row, byPerson, opts);

  const addon = amount * (addonPct / 100);
  const crypto = amount * (cryptoPct / 100);
  // Off the amount PLUS what was added, not off the amount. "Fee
  // deductions are for the total of that person".
  const fee = (amount + addon + crypto) * (feePct / 100);

  return { amount, addon, crypto, fee, net: amount + addon + crypto - fee };
}

/**
 * How an adjustment reads on an exported row: "Gloria: 5% add on".
 *
 * ONE SPELLING, used by every breakdown design, or the same person's rate
 * would be written three ways in three templates.
 *
 * A COLON SINCE 2026-09-14, his call, and it was a dash before. Workbooks
 * already written still say "Gloria - 5%", so `RATE_LINE` in
 * masterSheet/workbookSnapshot.js reads BOTH and must keep doing it: an old
 * file recovered under a colon-only reader loses every rate silently.
 */
const KIND_WORD = { fee: 'fee', crypto: 'crypto', addon: 'add on' };

function adjustmentLabel({ name, kind, percent }, { withKind = true } = {}) {
  const rate = `${Number(percent) || 0}%`;
  return withKind ? `${name}: ${rate} ${KIND_WORD[kind] ?? KIND_WORD.addon}` : `${name}: ${rate}`;
}

/**
 * ===============================
 * * AND READING ONE BACK, BESIDE THE THING THAT WRITES IT
 * ===============================
 * The line is a CONTRACT with our own exported files, so the speller and
 * the reader belong in one place. They were two: this regex lived in
 * `masterSheet/workbookSnapshot.js` while `adjustmentLabel` above wrote
 * the string, and the day the dash became a colon only one of them knew.
 *
 * BOTH SPELLINGS, FOREVER. It wrote "Gloria - 5%" until 2026-09-14 and
 * writes "Gloria: 5%" now. Files already on disk and in his email keep the
 * dash and are never rewritten, so a colon-only reader would silently lose
 * every rate in a recovered month.
 *
 * The KIND is optional because the export prints it once as a column
 * heading and then omits it per line. A caller that has the heading passes
 * it in; one that does not gets null and must decide.
 */
const RATE_LINE = /^(.*?)\s*(?:-|:)\s*(\d+(?:\.\d+)?)%\s*(add on|fee|crypto)?$/i;

const KIND_FOR = { 'add on': 'addon', fee: 'fee', crypto: 'crypto' };

/**
 * "Gloria: 5% add on" -> { name: 'Gloria', percent: 5, kind: 'addon' }.
 *
 * @returns {{name, percent, kind}|null} null for anything that is not one,
 *   which is most cells in a workbook.
 */
function parseAdjustmentLabel(text) {
  const hit = RATE_LINE.exec(String(text ?? '').trim());
  if (!hit) return null;
  const percent = Number(hit[2]);
  if (!Number.isFinite(percent)) return null;
  return {
    name: hit[1].trim(),
    percent,
    kind: KIND_FOR[String(hit[3] ?? '').trim().toLowerCase()] ?? null,
  };
}

/**
 * ===============================
 * * THE RATE GOES ON THE MONTHLY AMOUNT, AND IT IS APPLIED ONCE
 * ===============================
 * His own sheet does the sum and writes the answer: Maid's wage is 4,700
 * and the cell reads 4,935. Ours stored 4,700 and added the 5% at the foot
 * of the export, so the row and the total disagreed and a block underneath
 * existed to explain the gap.
 *
 * This is the one place that closes it. A row goes through here ONCE, as
 * early as possible, and every reader after it adds the numbers in front of
 * it: the sheet writer, the breakdown, the totals, Diane.
 *
 * THE RAW IS NEVER OVERWRITTEN. `monthly_amount` in the database stays
 * 4,700 and the 5% stays a 5%, because the two stack ADDITIVELY: 5% on the
 * person plus 3% on the deal is 8% of 4,700, and baking the first in would
 * make the second compound to 8.15%. Storing it would also make removing a
 * rate unwindable.
 *
 * THE ORDER COMMUTES, which is why no figure moves. Pro-rating is a
 * multiplication and so is a rate, so 4,700 rated then pro-rated equals
 * 4,700 pro-rated then rated, to the penny, in a part month too.
 *
 * Mirrored in web/src/helpers/rates.js so the browser can paint the new
 * figure before the server answers. Two codebases, never a shared import.
 */
function round(n) {
  return Math.round(n * 100) / 100;
}

/** The three parts a rate set produces off one base, and the net. */
function partsOf(base, pct) {
  const addon = base * (pct.addon / 100);
  const crypto = base * (pct.crypto / 100);
  // Off the base PLUS what was added, never off the base alone.
  const fee = (base + addon + crypto) * (pct.fee / 100);
  return {
    addon: round(addon), crypto: round(crypto), fee: round(fee), net: round(base + addon + crypto - fee),
  };
}

/** Does this deal carry any rate at all? The info icon's condition. */
function hasRates(row, byPerson = null, opts = {}) {
  const { addon, crypto, fee } = ratesFor(row, byPerson, opts);
  return addon > 0 || crypto > 0 || fee > 0;
}

/**
 * The row as everything downstream should see it.
 *
 * UNTOUCHED WHEN NO RATE APPLIES. Returning a rebuilt row for the 90 deals
 * that carry nothing would round figures that were never rated and put
 * `rate_parts` on rows with nothing to explain.
 */
function withRates(row, byPerson = null, opts = {}) {
  const percent = ratesFor(row, byPerson, opts);
  if (!(percent.addon > 0 || percent.crypto > 0 || percent.fee > 0)) return row;

  const monthlyRaw = Number(row.monthly_amount) || 0;
  const payableRaw = Number(row.payable_amount) || 0;
  const monthly = partsOf(monthlyRaw, percent);
  const payable = partsOf(payableRaw, percent);

  return {
    ...row,
    monthly_amount: monthly.net,
    payable_amount: payable.net,
    // Kept so the popup can show the sum and the import can reverse it.
    monthly_amount_raw: monthlyRaw,
    payable_amount_raw: payableRaw,
    // Named parts, for the transparency block. It EXPLAINS the figures
    // above it and adds nothing to them.
    rate_parts: { percent, monthly, payable },
  };
}

/**
 * Any base figure off a row that carries BOTH levels, rated. The page totals
 * summed the raw wage while every other surface rated it. 2026-09-24.
 */
function ratedAmount(base, row, opts = {}) {
  return partsOf(Number(base) || 0, stackedRates(row, opts)).net;
}

/** { currency: [row, ...] } -> { currency: rated monthly sum }. The list pages. */
function ratedMonthlyTotals(byCurrency, opts = {}) {
  const out = {};
  for (const [currency, rows] of Object.entries(byCurrency ?? {})) {
    const sum = (rows ?? []).reduce((n, row) => n + ratedAmount(row.monthly_amount, row, opts), 0);
    out[currency] = round(sum);
  }
  return out;
}

module.exports = {
  ratesFor, stackedRates, amountWithRates, adjustmentLabel, parseAdjustmentLabel, RATE_LINE, MAX_PERCENT,
  withRates, hasRates, partsOf, RATE_DIRECTIONS, ratedAmount, ratedMonthlyTotals,
};
