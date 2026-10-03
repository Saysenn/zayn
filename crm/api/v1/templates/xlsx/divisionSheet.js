const { buildDivisionSheetWorkbook } = require('../../masterSheet/buildDivisionSheet');

/**
 * The payment breakdowns, one tab per group, and nothing else.
 *
 * The month sheet carries the same blocks at the foot of each tab, under
 * the deals. This is them on their own, for the person counting the money
 * rather than the person checking a row.
 *
 * Thin on purpose; the layout lives in buildDivisionSheet.js, and the
 * breakdown itself lives in masterSheet/breakdowns/ so it is the same
 * block in both documents.
 */
module.exports = {
  id: 'division-sheet',
  label: 'Division Sheet',
  fileLabel: 'DIVISION SHEET',
  description: 'Just the payment breakdowns, one tab per group. No deal rows.',
  build: (rows, opts) => buildDivisionSheetWorkbook(rows, opts),
};
