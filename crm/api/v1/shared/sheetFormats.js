/**
 * ***************************************************
 * * Number formats every exported sheet uses.
 * ***************************************************
 *
 * Was declared once per builder, so the master sheet and the payout sheets
 * could drift into showing the same column two ways.
 */

// "September 30, 2026". The long month is deliberate: 30/09 and 09/30 are
// the same eight characters and mean different days, on a document people
// are paid from. Matches web/src/helpers/formatDate.js.
const DATE_FMT = 'mmmm d, yyyy';

// Thousands separated, always two decimals, so a column of figures lines
// up on the decimal point. Un-formatted, 774.19 and 1750 range left like
// text and a payout sheet reads as a dump.
const MONEY_FMT = '#,##0.00';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A DATE CELL HOLDS A DATE, NOT ITS SPELLING.
 *
 * pg hands DATE columns back as 'YYYY-MM-DD' (configs/pgTypes.js), and they
 * were written as that text. DATE_FMT never applied, the column would not
 * sort, and every formula's ISNUMBER(E2) was false, so one recalculation
 * in Excel blanked the payment start and paid the full monthly on every
 * part month. Found 2026-10-20.
 *
 * UTC midnight, because exceljs counts the serial off UTC. Anything that is
 * not a plain day (a note, a blank) is left exactly as it was.
 */
function excelDate(value) {
  const hit = ISO_DAY.exec(String(value ?? ''));
  return hit ? new Date(Date.UTC(Number(hit[1]), Number(hit[2]) - 1, Number(hit[3]))) : value;
}

// The deal's date columns, by the key every sheet builder writes them under.
const DATE_KEYS = ['assigned_on', 'payment_start_on', 'preset_on', 'end_on'];

/** A row's values with its date columns as real dates, for addRow. */
function withExcelDates(values) {
  const out = { ...values };
  for (const key of DATE_KEYS) if (key in out) out[key] = excelDate(out[key]);
  return out;
}

module.exports = {
  DATE_FMT, MONEY_FMT, excelDate, withExcelDates,
};
