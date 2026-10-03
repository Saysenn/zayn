const { buildPayoutWorkbook } = require('../../masterSheet/buildPayoutSheet');

/**
 * The payout layouts, from one definition.
 *
 * Written as a factory rather than four near-identical files: they differ
 * only in a name and which of the three column lists they draw, and four
 * copies is four places to miss the next time the registry's contract
 * changes.
 *
 * Each is a LAYOUT. The matching preset in v1/export.js decides which rows
 * arrive — cash is `payment_method = 'cash'`, bank is `'bank'`, expensing is
 * everyone — so picking Cash in the modal sets both.
 *
 * `sheet` is which column list to draw and defaults to the template's own
 * id. Bank details is the one that differs: it draws the BANK columns over
 * everyone, so the two files cannot drift apart in a column while still
 * being two documents with two names.
 */
const payoutTemplate = (id, label, description, sheet = id) => ({
  id,
  label,
  // EXPENSING / CASH / BANK / BANK DETAILS in the filename. These are handed
  // to different people and land in the same folder, so the name has to say
  // which run it is before anybody opens it.
  fileLabel: label.toUpperCase(),
  description,
  // OPTIONS FORWARDED WHOLE. Destructured to `{ columns }`, this silently
  // dropped colorUsesEndDate, so the payout files totalled on the default
  // while the master sheet obeyed the setting.
  build: (rows, opts = {}) => buildPayoutWorkbook(rows, sheet, opts),
});

module.exports = {
  expensing: payoutTemplate(
    'expensing',
    'Expensing',
    'Everyone, with the terms and the arithmetic. A General tab plus one per group.',
  ),
  cash: payoutTemplate(
    'cash',
    'Cash',
    'Paid in cash: who, where, how much, and whether it should go out. A General tab plus one per group.',
  ),
  bank: payoutTemplate(
    'bank',
    'Bank',
    'Paid by transfer: name, contact, amount, company, bank details, account number and sort code. Nothing else a transfer does not need.',
  ),
  // THE BANK SHAPE OVER EVERYONE. Its own id and label because a bank run
  // and a bank-details listing are two documents: naming them the same is
  // what put three payment runs on one filename before.
  bankDetails: payoutTemplate(
    'bank-details',
    'Bank details',
    'Everyone in the bank layout, cash and crypto included, so a row paid by transfer with no details to pay into is visible beside the ones that will never be bank.',
    'bank',
  ),
};
