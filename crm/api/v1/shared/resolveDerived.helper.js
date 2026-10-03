const { payableDaysFor, payableFromDays } = require('../calculator/computePayable');

// ***************************************************
// * A derived column follows its inputs, not the file
// ***************************************************

/**
 * WHAT AN UPLOAD MUST WRITE INTO payable_days AND payable_amount.
 *
 * The upsert decides every column on its own: a claimed one keeps the
 * stored value, an unclaimed one takes the file's. That is right for a
 * value somebody chose and wrong for one the CRM worked out, because the
 * two derived columns were then resolved against inputs that had moved.
 *
 * Edit a monthly amount to 2000 and upload a file still carrying a new
 * payment start: `monthly_amount` is claimed so it stays 2000, the start is
 * not so it moves, and `payable_amount` came from the file, computed off
 * 1100 against the old start. The row then printed a figure that followed
 * neither its own monthly amount nor its own dates.
 *
 * So the inputs are resolved FIRST, exactly as the upsert will resolve
 * them, and the two derived columns are computed from the result.
 *
 * NOT A SECOND FORMULA. `computePayable` is the one definition and this
 * only decides what to hand it. Writing the arithmetic into the upsert's
 * SET list would have been a fourth copy of the money rule.
 */

// The three the two derived columns are worked out from, and the two they
// are. Snake_case: these are compared against stored columns and claims.
const INPUT_COLUMNS = ['payment_start_on', 'preset_on', 'monthly_amount'];
const DERIVED_COLUMNS = ['payable_days', 'payable_amount'];

// Incoming rows are camelCase (the parser's shape), stored rows snake_case.
const INCOMING_FOR = {
  payment_start_on: 'paymentStartOn',
  preset_on: 'presetOn',
  monthly_amount: 'monthlyAmount',
  payable_days: 'payableDays',
  payable_amount: 'payableAmount',
};

/**
 * Is there anything here for the guard to change?
 *
 * When there is not, the parser's own figures are already right and are
 * left alone. That matters beyond speed: the parser knows `startUnknown`,
 * the case where the payment start was unreadable prose, and recomputing
 * here without it would turn "we do not know" into a full month.
 *
 * A CLAIMED DERIVED COLUMN COUNTS TOO. Checking only the inputs let a hand
 * set `payable_days` through untouched, so the file's own day count and
 * amount overwrote it: the admin's 10 days became the sheet's 31.
 */
function needsResolving(claimed, writable) {
  return INPUT_COLUMNS.some((c) => claimed.has(c) || !writable.has(c))
    || DERIVED_COLUMNS.some((c) => claimed.has(c));
}

/**
 * @param {object} incoming the parsed row, camelCase, as the upsert will send it
 * @param {object} stored   the row as it stands, snake_case, or null for an insert
 * @param {Set<string>} claimed  that row's manually_overridden_fields
 * @param {Set<string>} writable the columns this file carried
 * @returns {null|{payableDays: number|null, payableAmount: number|null}}
 *   null when nothing needs changing, which is the ordinary case
 */
function resolveDerived(incoming, stored, claimed, writable) {
  // A new row has no stored value and no claim, so the file's own figures
  // are the only ones there are.
  if (!stored) return null;
  if (!needsResolving(claimed, writable)) return null;

  // Exactly the upsert's own decision, per column: a file that never
  // mentioned a column has no opinion on it, and a claimed one is the
  // human's.
  const resolve = (column) => {
    if (!writable.has(column) || claimed.has(column)) return stored[column];
    return incoming[INCOMING_FOR[column]] ?? null;
  };

  const paymentStartOn = resolve('payment_start_on');
  const presetOn = resolve('preset_on');
  const monthlyAmount = resolve('monthly_amount');

  // A hand set day count is the admin's, and the amount is then computed
  // from it rather than from the dates. Same order recomputePayable uses.
  const payableDays = claimed.has('payable_days')
    ? stored.payable_days
    : payableDaysFor(asDate(paymentStartOn), asDate(presetOn), {
      // A first week deal is owed the whole of month 3, so the appointment
      // has to reach the day count here too or an upload undoes it.
      appointmentOn: asDate(resolve('assigned_on')),
    });

  const payableAmount = claimed.has('payable_amount')
    ? stored.payable_amount
    : payableFromDays({ monthlyAmount, presetOn: asDate(presetOn), payableDays });

  return { payableDays, payableAmount };
}

/** Postgres hands a `date` back as a Date, the parser as a Date or null. */
function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { resolveDerived, INPUT_COLUMNS, DERIVED_COLUMNS };
