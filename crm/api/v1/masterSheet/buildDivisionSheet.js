const ExcelJS = require('exceljs');
const { scrubWorkbook } = require('../shared/scrubWorkbook.helper');
const { paymentBreakdown } = require('./groupTables');
const { breakdownDesignFor } = require('./breakdowns');
const { sortGroupNames, METHOD_SHORT, METHOD_LABELS } = require('./buildWorkbook');
const { countsTowardTotal } = require('../shared/owedThisMonth.helper');
// THE ONE THAT APPLIES THE RATES. paymentBreakdown only reads them back.
const { withRates } = require('../shared/rates.helper');
const { fillsFor } = require('./breakdowns/palette');

/**
 * THE BREAKDOWNS, AND NOTHING ELSE. One tab per group.
 *
 * The month sheet is the deals with a breakdown appended at the foot of
 * each tab. This is the same breakdowns with the deals taken away, because
 * they answer to different people: the month sheet goes to whoever checks
 * a person's row, this goes to whoever is counting out the money. Handing
 * the second reader ninety-six rows to scroll past is handing them the
 * wrong document.
 *
 * NOT A SECOND LAYOUT. It renders through the same breakdowns/ registry
 * the month tab uses, so a design fixed in one place is fixed in both and
 * "the breakdown" means one thing wherever it appears. That is the whole
 * reason the designs became files rather than a branch inside
 * buildWorkbook.
 *
 * A group whose rows are all out of this month's run produces an empty
 * breakdown. It still gets a TAB, saying so: a missing tab reads as a
 * group somebody forgot, where an empty one reads as a group with nothing
 * to pay, and those are very different messages on a payout document.
 */

const TITLE_FONT = { bold: true, size: 13 };
const EMPTY_FONT = { size: 10, italic: true, color: { argb: 'FF6B7484' } };

// The breakdown designs write into columns 1 to 7 (two pivots, a gap
// between them). Widths here rather than in the designs: a design is a
// layout of rows, and the sheet it lands on owns its own columns.
const COL_WIDTHS = [30, 22, 26, 4, 26, 22, 26];

/**
 * @param {object[]} rows deals, any number of groups
 * @param {object} opts the export's layout options. `breakdownDesign`,
 *   `usdRate`, `usdRateSource` and `localLocations` are the ones that
 *   reach the design; everything else is ignored, since there are no deal
 *   rows here for a column selector or a totals switch to act on.
 */
function buildDivisionSheetWorkbook(rows, opts = {}) {
  const wb = new ExcelJS.Workbook();

  /**
   * ===============================
   * * RATED FIRST, THE SAME ORDER buildWorkbook USES
   * ===============================
   * `paymentBreakdown` READS the rates off a row; `withRates` is what puts
   * them there. This forwarded `opts.rates` into the breakdown instead,
   * where it was accepted and ignored, so THIS EXPORT WAS SHORT BY EVERY
   * ADD ON AND EVERY CRYPTO CHARGE while the month sheet built from the
   * same rows was correct. Found 2026-09-16.
   */
  const rated = rows.map((r) => withRates(r, opts.rates, { cryptoPercent: opts.cryptoPercent }));

  const byGroup = new Map();
  for (const r of rated) {
    const g = r.group_name || '(no group)';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(r);
  }

  const design = breakdownDesignFor(opts.breakdownDesign);
  // THE SAME PICKED PAIR THE MONTH SHEET USES. These were fixed orange
  // here and fixed green there, so one export produced two documents in
  // two palettes and neither was the colour on the picker.
  const fills = fillsFor(opts.primaryColor, opts.secondaryColor);
  // Same rule as the month tab: the design declares its own vocabulary.
  const methodLabels = design.methodStyle === 'long' ? METHOD_LABELS : METHOD_SHORT;

  for (const groupName of sortGroupNames([...byGroup.keys()])) {
    // Excel caps a sheet name at 31 characters and rejects several
    // outright, so it is sanitised rather than trusted.
    const safe = String(groupName).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
    const sheet = wb.addWorksheet(safe || 'Group');
    COL_WIDTHS.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

    const title = sheet.getCell(1, 1);
    title.value = groupName;
    title.font = TITLE_FONT;

    const breakdown = paymentBreakdown(byGroup.get(groupName), {
      methodLabels, counts: (row) => countsTowardTotal(row, { useEndDate: Boolean(opts.colorUsesEndDate) }),
    });
    if (breakdown.methods.length === 0) {
      const note = sheet.getCell(3, 1);
      note.value = 'Nothing in this month’s run for this group.';
      note.font = EMPTY_FONT;
      continue;
    }

    design.write(
      {
        sheet,
        // The band-row primitives the standard design uses. It writes
        // through addRow, which appends, and the title above is already
        // row 1, so it lands underneath without being told where.
        addBandRow: (s, label, value) => {
          const row = s.addRow([]);
          row.getCell(1).value = label;
          if (value !== undefined) row.getCell(2).value = value;
          return row;
        },
        // The title band, painted like the month sheet's. It was bold text
        // on white, so the one row naming the block read as another row.
        styleBandRow: (row, { bold = false } = {}) => {
          for (const n of [1, 2]) {
            row.getCell(n).font = { bold, color: fills.headText };
            row.getCell(n).fill = fills.head;
          }
          return row;
        },
        stylePlainRow: (row, { bold = false, indent = 0 } = {}) => {
          row.getCell(1).font = { bold };
          row.getCell(1).alignment = { indent };
          row.getCell(2).font = { bold };
          if (typeof row.getCell(2).value === 'number') row.getCell(2).numFmt = '#,##0.00';
          return row;
        },
        VALUE_COL: 2,
        BAND_SPAN: [1, 2],
        GRAND_FILL: fills.grandFill,
        GRAND_BORDER: fills.grandBorder,
        BAND_FILL: fills.head,
        BAND_TEXT: fills.headText,
        BREAKDOWN_HEADERS: ['Row Labels', 'Sum of Payable amount:'],
      },
      breakdown,
      {
        usdRate: opts.usdRate,
        usdRateSource: opts.usdRateSource,
        localLocations: opts.localLocations,
        perUsd: opts.perUsd,
        useEndDate: Boolean(opts.colorUsesEndDate),
        primaryColor: opts.primaryColor,
        secondaryColor: opts.secondaryColor,
      },
    );
  }

  return scrubWorkbook(wb);
}

module.exports = { buildDivisionSheetWorkbook };
