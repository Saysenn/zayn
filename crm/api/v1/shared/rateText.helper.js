// ***************************************************
// * What was applied to this row, in his own words
// ***************************************************
//
// His call 2026-09-23: a column on the exported master sheet saying what
// went on top of the figure beside it, as TEXT. "added 5%", "1% fx fee".
//
// WHY TEXT AND NOT A NUMBER. A "5" in a percent column answers nothing on
// its own: added or taken off, whose rate, the person's or the deal's, and
// the exchange's cut reads identically to a fee that comes off the wage.
// The three rates run in two directions and the column exists to make that
// legible, so the DIRECTION is in the words.
//
// ONE DEFINITION. `adjustmentLabel` in rates.helper spells a breakdown line
// ("Gloria: 5% add on"); this spells a CELL. Same three parts, different
// document, and neither may be built by hand at a call site.

// The stacked percentages, already summed across person and deal by
// `ratesFor`, so a 5% on the person and 3% on the row read as one 8%. That
// is what the figure beside it carries, and two lines saying 5% and 3%
// would invite somebody to add them a second time.
const WORDS = [
  ['addon', (pct) => `added ${pct}%`],
  // HIS WORD FOR THE EXCHANGE'S CUT. `crypto` in the code, because it
  // belongs to the rail rather than the person, and "fx fee" on the sheet,
  // because that is what he calls it.
  ['crypto', (pct) => `${pct}% fx fee`],
  ['fee', (pct) => `${pct}% fee off`],
];

// The separator in a cell, matching the breakdown's own. A comma reads as
// a thousands separator next to a column of money.
const JOIN = ' · ';

// Trailing zeros are noise on a rate: 5, not 5.00, and 2.5 kept.
const trim = (n) => String(Math.round(Number(n) * 100) / 100);

/**
 * @param {object} row a row that has been through `withRates`
 * @returns {string} '' when nothing applied, which is most rows. An empty
 *   cell is the right answer there: a "0%" on 90 rows is a column of noise
 *   that hides the eight that matter.
 */
function rateTextFor(row) {
  const percent = row?.rate_parts?.percent;
  if (!percent) return '';
  return WORDS
    .filter(([key]) => Number(percent[key]) > 0)
    .map(([key, say]) => say(trim(percent[key])))
    .join(JOIN);
}

module.exports = { rateTextFor, JOIN };
