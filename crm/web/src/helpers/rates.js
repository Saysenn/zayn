/**
 * ***************************************************
 * * Add ons, crypto charges and fees, on the Monthly amount
 * ***************************************************
 *
 * A DELIBERATE MIRROR of `api/v1/shared/rates.helper.js`. The two codebases
 * share no file, so the rule is written twice and each side pins its own
 * half. Changing the arithmetic means changing both, and the tests fail on
 * both until you do.
 *
 * IT EXISTS SO THE BROWSER CAN PAINT FIRST. Set 5% on Gloria and every one
 * of her rows has to show its new figure before the server answers, or an
 * optimistic write is just a slower one. Without the maths here there is
 * nothing to paint.
 *
 * THE RULES, all three of them:
 *
 *   addon   ADDED, off the raw
 *   crypto  ADDED, off the raw, and it belongs to the RAIL not the person
 *   fee     DEDUCTED, off the raw PLUS what was added to it
 *
 * TWO LEVELS, AND THEY STACK ADDITIVELY. 5% on the person plus 3% on the
 * deal is 8% of the raw, never 5% compounded by 3%.
 */

// A deal paid in crypto carries the rail's charge. Matched on the method,
// the same test the server makes.
const CRYPTO = /crypto/i;

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The three percentages in force on one deal.
 *
 * @param {object} row a master sheet row, snake_case as the cache holds it
 * @param {object} [opts] `cryptoPercent`, the rail's charge from Settings
 */
export function ratesFor(row, { cryptoPercent = 0 } = {}) {
  // The row carries the PERSON's rates already: the repo selects them
  // alongside the deal's own so a cell can warn that the two stack.
  const paidInCrypto = CRYPTO.test(String(row?.payment_method ?? ''));
  return {
    addon: (Number(row?.person_addon_percent) || 0) + (Number(row?.addon_percent) || 0),
    crypto: paidInCrypto ? (Number(cryptoPercent) || 0) : 0,
    fee: (Number(row?.person_fee_percent) || 0) + (Number(row?.fee_percent) || 0),
  };
}

/** The parts one rate set produces off a base, and what it nets to. */
export function partsOf(base, pct) {
  const amount = Number(base) || 0;
  const addon = amount * (pct.addon / 100);
  const crypto = amount * (pct.crypto / 100);
  // Off the base PLUS what was added, never off the base alone.
  const fee = (amount + addon + crypto) * (pct.fee / 100);
  return {
    addon: round(addon),
    crypto: round(crypto),
    fee: round(fee),
    net: round(amount + addon + crypto - fee),
  };
}

/** Does this deal carry any rate? The info icon's one condition. */
export function hasRates(row, opts = {}) {
  const { addon, crypto, fee } = ratesFor(row, opts);
  return addon > 0 || crypto > 0 || fee > 0;
}

/**
 * The row as the table should draw it.
 *
 * UNTOUCHED WHEN NO RATE APPLIES, and the SAME OBJECT back. Ninety rows
 * carry nothing, and rebuilding them would round figures nobody rated and
 * break the reference equality a memoised table row relies on.
 */
export function withRates(row, opts = {}) {
  const percent = ratesFor(row, opts);
  if (!(percent.addon > 0 || percent.crypto > 0 || percent.fee > 0)) return row;

  const monthlyRaw = Number(row.monthly_amount) || 0;
  const payableRaw = Number(row.payable_amount) || 0;
  const monthly = partsOf(monthlyRaw, percent);
  const payable = partsOf(payableRaw, percent);

  return {
    ...row,
    monthly_amount: monthly.net,
    payable_amount: payable.net,
    // Kept so the cell can be EDITED as the raw wage while it DISPLAYS the
    // rated figure, and so the popup can show the sum.
    monthly_amount_raw: monthlyRaw,
    payable_amount_raw: payableRaw,
    rate_parts: { percent, monthly, payable },
  };
}
