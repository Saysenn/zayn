const { buildMasterSheetWorkbook } = require('../../masterSheet/buildWorkbook');

/**
 * Next month's master sheet: the boss's own layout, figures recomputed for
 * the month being paid for.
 *
 * Identical in shape to the Master sheet template — same columns, same
 * order, same one-tab-per-group — because it has to be a drop-in for the
 * file the team already works from. The difference is entirely in the
 * rows, which `rollToMonth` has already recomputed by the time this runs.
 *
 * Thin on purpose. Giving this its own builder would mean two files
 * producing the same sheet, and the first time a column moved only one of
 * them would get it.
 */
module.exports = {
  id: 'monthly-sheet',
  label: 'Sheet for a month',
  // Not the label uppercased: "SHEET FOR A MONTH" reads as a sentence in a
  // folder listing, and the month is already the next part of the name.
  fileLabel: 'MONTH SHEET',
  description: 'The master sheet rolled to a chosen month, payable days and amounts recomputed. Ended deals carried and marked.',
  // The month itself is a filter-side decision, applied before this runs.
  //
  // TOTALS ARE THE ADMIN'S CALL, and off unless asked for: the sheet this
  // replaces has none, so the default has none either and the two switches
  // add to it. What each person gets and what the group costs are separate
  // questions, hence separate switches. Neither line ever carries a name in
  // the Name column, so a re-upload discards them instead of importing
  // every total as a deal.
  // `tiers` is the only option that is not a toggle: a company's tier is
  // the one thing on the tab that cannot be read off the deals, so it
  // arrives from tb_companies through the route.
  //
  // OPTIONS ARE FORWARDED WHOLE, not picked one by one. This used to
  // destructure a fixed list, so every option added later reached the
  // route, reached this file, and was silently dropped here: the breakdown
  // design picker changed nothing in the file and nothing said why. The
  // builder already ignores what it does not use, which is the right place
  // for that decision.
  build: (rows, opts = {}) => buildMasterSheetWorkbook(rows, { breakdown: true, ...opts }),
};
