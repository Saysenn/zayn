const {
  buildMasterSheetWorkbook, listExportColumns, RATES_COLUMN,
} = require('../../masterSheet/buildWorkbook');

// Every column the picker offers, for the case where nothing was picked.
// Read rather than listed: a column added to the sheet must not need a
// second edit here to keep working with the switch on.
const everyColumnKey = () => listExportColumns().map((c) => c.key);

/**
 * The master sheet's own shape: one row per deal, the boss's columns in
 * his order and his spelling, one tab per group.
 *
 * This is the drop-in replacement for the file the team already works
 * from, which is why the header typos are preserved rather than tidied —
 * our own parsers match those headers as typed.
 *
 * Thin on purpose. The layout lives in buildWorkbook.js and this only
 * gives it a name the Export modal can show.
 */
module.exports = {
  id: 'master-sheet',
  label: 'Master sheet',
  // What the DOWNLOADED FILE is called, separate from `label` because a
  // filename has to survive being short, uppercase and sorted in a folder
  // next to eleven other months of the same run. See fileLabelFor.
  fileLabel: 'MASTER SHEET',
  description: 'One sheet, every group, shaped like the working file. The drop-in replacement for it.',
  /**
   * ONE TAB BY DEFAULT, Group column, no totals: a replacement for the
   * working document, so it is shaped like the working document.
   *
   * PER GROUP TABS ON REQUEST. His call 2026-09-22: the same sheet split a
   * tab per group, in ONE workbook. That is not the zipped "one file per
   * group" option, which hands back several files; it is one file he can
   * flick between groups in. The tab name carries the group, which is also
   * how a re-upload puts each row back where it came from.
   *
   * NAMED, NOT SPREAD. This template takes the options below and no
   * others: the month tab's layout switches must not reach a file that has
   * no totals to switch. `tintEmpty` and `includeTags` paint what is
   * already there and change no row.
   */
  /**
   * ===============================
   * * THE RATES COME WITH IT, BUT THE WAGE COLUMN STAYS RAW
   * ===============================
   * His call 2026-09-22. This tab forwarded neither `rates` nor
   * `cryptoPercent`, so a person level add on reached no figure in it:
   * Zayn printed 4,000 where his own sheet says 4,200 and the Maid 4,700
   * against his 4,935. Only the deal's own `addon_percent` applied,
   * because that rides on the row.
   *
   * Payable amount carries them. Monthly amount does NOT, and that is the
   * whole of the care here: this is the file he UPLOADS BACK, `mapSheetRow`
   * reads Monthly as the wage and computes Payable from it rather than
   * reading it, and this tab prints no "Add ons" block for `declaredRatesIn`
   * to reverse. A rated Monthly would return as the wage, and the next
   * export would rate it again, and again, every month, silently. That is
   * the incident `reverseRates.js` was written about.
   */
  /**
   * ===============================
   * * TWO THINGS THIS FILE CAN BE CONFIGURED WITH. His call 2026-09-23.
   * ===============================
   * `primaryColor` paints the header band and `secondaryColor` every tint
   * on it, the payable amount of a row out of the month's figure included.
   * Both reached every other document and not this one, for the same
   * reason `rates` did not: the options are NAMED here, so each new one
   * has to be listed by hand and each one can be forgotten by hand.
   *
   * `showRates` appends the "Rates applied" column, which says in words
   * what went on top of the figure beside it. It is a SWITCH rather than a
   * pickable column, so it is added to the chosen set here rather than
   * being offered in a list of his own headers.
   */
  build: (rows, {
    columns, tintEmpty, includeTags, perGroupTabs, rates, cryptoPercent,
    primaryColor, secondaryColor, showRates, month,
  } = {}) => (
    buildMasterSheetWorkbook(rows, {
      // THE MONTH THE FILE IS FOR, judging which amounts count. Forgotten
      // here like the options above, so every export judged by today's
      // month. 2026-10-04.
      month,
      rates,
      cryptoPercent,
      primaryColor,
      secondaryColor,
      rawMonthly: true,
      singleTab: !perGroupTabs,
      /**
       * NEITHER THE PIVOT NOR THE COMPANY LIST. This is the working file,
       * and the working file is deal rows and nothing else. The per group
       * path is shared with the month generation, which wants both, so
       * splitting this sheet into tabs inherited them: the first file out
       * had an Active company list beside the rows and a Grand Total under
       * them. Found on sight 2026-09-22.
       *
       * Said here rather than in the builder, because it is a fact about
       * THIS document, not about tabs.
       */
      breakdown: false,
      companyList: false,
      /**
       * AN EMPTY CHOICE STILL MEANS EVERY COLUMN, so the switch cannot be
       * expressed by adding a key to an empty list: that would narrow the
       * file to one column. `RATES_COLUMN` is spread onto whatever was
       * picked, and onto the full set when nothing was.
       */
      columns: showRates
        ? [...(columns?.length ? columns : everyColumnKey()), RATES_COLUMN]
        : columns,
      tintEmpty,
      includeTags,
    })
  ),
};
