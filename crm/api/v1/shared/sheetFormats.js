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

module.exports = { DATE_FMT, MONEY_FMT };
