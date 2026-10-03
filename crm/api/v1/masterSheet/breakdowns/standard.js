/**
 * ***************************************************
 * * STAGE 2: method, location, currency, and a grand total
 * ***************************************************
 *
 * HIS OWN SHAPE, read from `docs/boss/references/nexus august.xlsx`:
 *
 *     Row Labels        Sum of Payable amount:
 *     Bank
 *       Main city                      1,250.00
 *     Bank Total                       1,250.00
 *     Cash
 *       Abu dhabi                        500.00
 *       Black country                    750.00
 *       South east                     2,250.00
 *     Cash Total                       3,500.00
 *     Grand Total                      4,750.00
 *
 * LOCATION IS THE POINT OF THIS STAGE. It is the one thing that says where
 * the cash physically has to go, and stage 1 does not carry it.
 *
 * ===============================
 * * ONE CURRENCY, NO CURRENCY LINE
 * ===============================
 * With one currency in the whole group the location carries its own figure
 * and the currency row under it is dropped. It repeated the same code on
 * every line and pushed each figure an indent away from the place it is
 * going. Several currencies keep the row, because then it is the answer.
 *
 * ===============================
 * * WITH MORE THAN ONE CURRENCY, A TOTAL GATHERS THEM
 * ===============================
 * HE HAS NO EXAMPLE. Every multi currency sheet of his is drawn stage 1's
 * way, currency first, so this shape only ever appears on a single currency
 * group in his work. Decided here, 2026-09-12:
 *
 *     Bank Total                       1,250.00     one currency, one line
 *     Cash Total
 *         AED                          3,675.00     several, gathered
 *         GBP                          3,500.00
 *
 * A total stays on one line when its block holds one currency, which keeps
 * his own sheet identical to what he writes, and becomes a heading with
 * currency rows under it when it holds more. NOTHING BLENDS: no figure ever
 * adds across two currencies.
 *
 * ===============================
 * * THIS AND `simple` SWAPPED, 2026-09-12
 * ===============================
 * This was stage 1 and the currency summary was stage 2, so the ladder read
 * backwards: picking "standard" over "simple" gave you less. The IDS DID
 * NOT MOVE, so a saved ?breakdownDesign= keeps pointing at a stage.
 *
 * `Bank`, not `Bank Transfer`, his call. Only `advance` keeps the long
 * spelling, because that is what its pivots have always written.
 */

const { writeRatesNote } = require('./ratesNote');

module.exports = {
  id: 'standard',
  label: 'Standard',
  description:
    'Method, then location, then currency, with a total per method and a grand total. '
    + 'The level that says where the cash goes. No conversion: every figure stays in '
    + 'the currency it is paid in.',

  write(ctx, breakdown, opts = {}) {
    const {
      sheet, addBandRow, styleBandRow, stylePlainRow,
      VALUE_COL, BAND_SPAN, GRAND_FILL, GRAND_BORDER, BAND_FILL, BAND_TEXT,
      BREAKDOWN_HEADERS,
    } = ctx;

    if (breakdown.methods.length === 0) return;

    sheet.addRow({});
    const head = addBandRow(sheet, BREAKDOWN_HEADERS[0]);
    head.getCell(VALUE_COL).value = BREAKDOWN_HEADERS[1];
    styleBandRow(head, { bold: true, heading: true });

    /**
     * One line when there is one currency, a heading and rows when there
     * are several. Used by both the method totals and the grand total, so
     * the two cannot end up shaped differently.
     *
     * @returns {object[]} every row it wrote, for the caller to tint
     */
    function writeTotal(label, totals, { indent = 0 } = {}) {
      if (totals.length === 1) {
        return [stylePlainRow(addBandRow(sheet, label, totals[0].total), { bold: true, indent })];
      }
      const rows = [stylePlainRow(addBandRow(sheet, label), { bold: true, indent })];
      for (const t of totals) {
        rows.push(stylePlainRow(
          addBandRow(sheet, t.currency, t.total),
          { bold: true, indent: indent + 2 },
        ));
      }
      return rows;
    }

    // ONE CURRENCY IN THE GROUP, so naming it on every location says
    // nothing. Read off `grand`, the same figures the totals gather, so the
    // layout and the totals cannot disagree about how many there are.
    const oneCurrency = breakdown.grand.length === 1;

    for (const m of breakdown.methods) {
      // The method alone on its line with no figure beside it. Its total is
      // the row below the locations, and a figure here reads as a second,
      // disagreeing one.
      stylePlainRow(addBandRow(sheet, m.method), { bold: true });

      for (const loc of m.locations) {
        // ALREADY NET. The rates live on the Monthly amount, so the line
        // arrives with them inside it. Re-adding the parts here would
        // charge every rate twice, and the named rows that used to sit
        // between these are in the block below the grand total now.
        if (oneCurrency) {
          // One currency means one line per location, so this IS the total.
          stylePlainRow(addBandRow(sheet, loc.location, loc.lines[0].total), { indent: 1 });
          continue;
        }
        stylePlainRow(addBandRow(sheet, loc.location), { indent: 1 });
        for (const line of loc.lines) {
          stylePlainRow(addBandRow(sheet, line.currency, line.total), { indent: 2 });
        }
      }

      writeTotal(`${m.method} Total`, m.totals);
      sheet.addRow({});
    }

    // The block somebody signs. Its HEADING wears the same dark band as the
    // person and group rows, so the eye finds it at the weight it finds
    // every other heading; the figures under it sit on the pale ground,
    // because white reversed out of a dark fill is a lot of ink for a block
    // that is mostly figures.
    const rows = writeTotal('Grand Total', breakdown.grand);
    rows.forEach((row, i) => {
      // ONE currency is ONE row, and that row is the heading AND the figure.
      // It takes the band: a pale strip with nothing above it reads as a
      // supporting line rather than the total.
      const head = i === 0;
      for (const n of BAND_SPAN) {
        const cell = row.getCell(n);
        cell.fill = head ? BAND_FILL : GRAND_FILL;
        if (head) cell.font = { ...(cell.font ?? {}), bold: true, color: BAND_TEXT };
        cell.border = {
          top: i === 0 ? GRAND_BORDER : undefined,
          bottom: i === rows.length - 1 ? GRAND_BORDER : undefined,
          left: n === BAND_SPAN[0] ? GRAND_BORDER : undefined,
          right: n === BAND_SPAN[BAND_SPAN.length - 1] ? GRAND_BORDER : undefined,
        };
      }
    });

    // BELOW THE GRAND TOTAL, never above it. It explains the figures; it
    // must never be met on the way to them.
    if (opts.percentagesTable) writeRatesNote(ctx, breakdown);
  },
};
