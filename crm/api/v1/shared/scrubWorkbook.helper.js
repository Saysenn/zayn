/**
 * TAKE THE FINGERPRINTS OFF A FILE BEFORE IT LEAVES THE BUILDING.
 *
 * An exported sheet should not say where it came from or when it was
 * made. Measured on a real export before this existed, `docProps/core.xml`
 * carried:
 *
 *   <dcterms:created>2026-08-27T08:35:28Z</dcterms:created>
 *   <dc:creator>Unknown</dc:creator>
 *
 * and the two breakdown builders set `dc:creator = "Intake CRM"`, which
 * names the system outright.
 *
 * THE TIMESTAMP IS THE REAL TELL. It says to the second when the file was
 * generated, which is exactly the thing that betrays a document claimed to
 * have been prepared at some other time. Leaving the fields UNSET does not
 * help: exceljs then writes today's date, so they have to be pinned.
 *
 * ---- STRIPPED, NEVER FAKED ----
 * This clears the fields. It does not invent a plausible author, and it
 * should not: writing somebody's name into a file they did not make is
 * forging provenance, which is a different act from declining to record
 * your own. Empty is honest and achieves the same thing.
 *
 * ---- "Unknown" is the scrub WORKING, not failing ----
 * exceljs writes `this.creator || 'Unknown'` (lib/doc/workbook.js), so an
 * empty string always comes out as the word Unknown. That is the right
 * outcome and it is left alone: it names no person and no system, which is
 * the whole requirement. The alternative, writing a plausible name, is
 * forging authorship.
 *
 * ---- what this CANNOT reach ----
 * `docProps/app.xml` carries `<Application>Microsoft Excel</Application>`
 * and `<AppVersion>16.0300</AppVersion>`, both hardcoded by exceljs with no
 * property API behind them. Reaching them means rewriting the zip after
 * the fact. Left alone deliberately: they name a spreadsheet program
 * rather than this system, so they reveal nothing, and unpicking a zip to
 * change a string that is already harmless is a lot of machinery for
 * nothing. Worth re-checking if exceljs ever changes what it writes there.
 *
 * The FILENAME is metadata too, and it is not this function's job:
 * `shared/exportFileName.helper.js` owns that.
 */

/**
 * The one fixed moment every generated file claims.
 *
 * 1980-01-01 because that is the earliest a zip entry can represent, so
 * the workbook's own properties and the zip's entry timestamps can be the
 * same instant. Two different fixed dates would be a discrepancy somebody
 * could read something into.
 */
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1));

/**
 * Clear a workbook's identifying properties. Call it LAST, just before the
 * buffer is written, so nothing set during the build survives.
 *
 * @param {import('exceljs').Workbook} wb
 * @returns {import('exceljs').Workbook} the same workbook, for chaining
 */
function scrubWorkbook(wb) {
  if (!wb) return wb;

  wb.creator = '';
  wb.lastModifiedBy = '';
  wb.company = '';
  wb.manager = '';
  wb.title = '';
  wb.subject = '';
  wb.keywords = '';
  wb.category = '';
  wb.description = '';

  wb.created = FIXED_DATE;
  wb.modified = FIXED_DATE;
  // Never printed. Left set rather than undefined, because undefined here
  // is another place exceljs reaches for the clock.
  wb.lastPrinted = FIXED_DATE;

  return wb;
}

module.exports = { scrubWorkbook, FIXED_DATE };
