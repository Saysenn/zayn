// ***************************************************
// * An amount, written the way she says it
// ***************************************************
//
// Two decimals ALWAYS, because these are amounts somebody is paid: "529.2"
// reads as a typo and "529" loses the pennies that the order of the rates
// exists to get right.
//
// ONE DEFINITION. It was written out three times, in closure.js,
// companies.js and again beside the rates, and a fourth copy was about to
// be added. They agreed today; the money one is always the copy that
// drifts.
//
// NOT the breakdown's formatter, which is deliberately different:
// `historicalBreakdown.js` prints a maximum of two and no minimum, so a
// round figure reads as "500" in a table of them.

const money = (value) => Number(value ?? 0).toLocaleString('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// PER CURRENCY, NEVER ONE NUMBER: GBP and AED added together wear one symbol and mean nothing.
/** rows -> { GBP: sum, AED: sum } of `field`. */
function sumByCurrency(rows, field) {
  const out = {};
  for (const row of rows ?? []) {
    const code = String(row.currency || 'GBP').trim().toUpperCase();
    out[code] = (out[code] ?? 0) + (Number(row[field]) || 0);
  }
  return out;
}

/** { GBP: 1000, AED: 50 } -> "GBP 1,000.00 and AED 50.00" */
const moneyPerCurrency = (byCurrency) => Object.entries(byCurrency ?? {})
  .map(([code, n]) => `${code} ${money(n)}`).join(' and ');

module.exports = { money, sumByCurrency, moneyPerCurrency };
