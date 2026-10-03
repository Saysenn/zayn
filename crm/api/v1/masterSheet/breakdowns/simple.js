/**
 * ***************************************************
 * * STAGE 1: currency, then method, then that currency's total
 * ***************************************************
 *
 * HIS OWN SHAPE, read from `docs/boss/references/indigo 1 august.xlsx` and
 * `milkman august.xlsx`:
 *
 *     Row Labels        Sum of Payable amount:
 *     AED
 *       Cash                          3,675.00
 *     AED Total                       3,675.00
 *     EURO
 *       Cash                          1,000.00
 *     EURO Total                      1,000.00
 *     GBP
 *       Bank                         10,600.00
 *       Cash                         19,900.00
 *     GBP Total                      30,500.00
 *
 * NO LOCATION LEVEL AND NO GRAND TOTAL. Both are his. Two currencies are
 * two payment runs and nothing ever adds across them, so a currency's own
 * total IS the whole of that run, and a block below could only repeat the
 * same figures one indent to the left.
 *
 * THE FIGURES ARRIVE NET. Add ons, crypto charges and fees live on the
 * Monthly amount, the way his own sheet writes them, so every line here
 * already carries them and nothing is computed. Turn the percentages table
 * on and they are NAMED below, where nothing sums them.
 *
 * ===============================
 * * THIS AND `standard` SWAPPED, 2026-09-12
 * ===============================
 * Stage 1 was a method and location list and stage 2 was this, which put
 * the DETAILED one first and the summary second: picking "standard" over
 * "simple" gave you less rather than more.
 *
 * THE IDS DID NOT MOVE. `simple` and `standard` cross the wire as
 * ?breakdownDesign=, so a saved link keeps pointing at a stage rather than
 * following a layout that wandered off.
 *
 * `Bank`, not `Bank Transfer`, his call 2026-09-12. Only `advance` keeps
 * the long spelling, because that is what its pivots have always written.
 */

const { writeRatesNote } = require('./ratesNote');

module.exports = {
  // NEVER RENAME. It crosses the wire as ?breakdownDesign= and a saved link
  // would silently change the shape of a payout file.
  id: 'simple',
  label: 'Simple',
  description:
    "Currency first, then the methods paid in it, then that currency's total. "
    + 'No locations and no grand total: two currencies are two payment runs and nothing '
    + 'adds across them. The shape his own group sheets carry.',

  write(ctx, breakdown, opts = {}) {
    const {
      sheet, addBandRow, styleBandRow, stylePlainRow,
      VALUE_COL, BAND_SPAN, GRAND_FILL, BREAKDOWN_HEADERS,
    } = ctx;

    if (breakdown.methods.length === 0) return;

    sheet.addRow({});
    const head = addBandRow(sheet, BREAKDOWN_HEADERS[0]);
    head.getCell(VALUE_COL).value = BREAKDOWN_HEADERS[1];
    styleBandRow(head, { bold: true, heading: true });

    breakdown.byCurrency.forEach((block, i) => {
      // The currency alone on its line. Its figure is the total below, and
      // one here would read as a second, disagreeing one.
      stylePlainRow(addBandRow(sheet, block.currency), { bold: true });
      for (const line of block.methods) {
        stylePlainRow(addBandRow(sheet, line.method, line.total), { indent: 1 });
      }

      // Tinted, because this is the line somebody signs and there is no
      // Grand Total below to carry that weight.
      const total = stylePlainRow(
        addBandRow(sheet, `${block.currency} Total`, block.total),
        { bold: true },
      );
      for (const n of BAND_SPAN) total.getCell(n).fill = GRAND_FILL;

      // A blank line between currencies: separate payment runs, and reading
      // one total straight into the next currency's name made the total
      // look like a heading for it.
      if (i < breakdown.byCurrency.length - 1) sheet.addRow({});
    });

    // BELOW EVERYTHING. It explains the figures above and must never be met
    // on the way to them. See ratesNote.
    if (opts.percentagesTable) writeRatesNote(ctx, breakdown);
  },
};
