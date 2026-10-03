import { payableDaysFor, payableFromDays } from './payable.js';

// ***************************************************
// * WHEN AN EDIT WOULD WIPE A FIGURE SOMEBODY TYPED
// ***************************************************

/**
 * A HAND TYPED PAYABLE AMOUNT DOES NOT SURVIVE THE NEXT DATE EDIT, and
 * until now nothing said so.
 *
 * Typing into Payable amount wins in that patch: `recomputePayable` sees it
 * and returns early. But the NEXT edit to any of its five inputs recomputes
 * it from the formula and the typed figure is gone, silently, with no
 * warning and no toast. Somebody sets 5,000 by hand, moves the appointment
 * a week later, and the row quietly reads 1,935.48.
 *
 * Odd asymmetry it removes: that same typed figure is protected from an
 * UPLOAD, because `manually_overridden_fields` claims the column, and not
 * from your own next edit on the same row.
 *
 * ---- it fires only when there is something to lose ----
 * Only when a HUMAN claimed the column. A derived value is never claimed
 * (`repo.update` excludes the derived keys from the array on purpose), so
 * this stays quiet on the ordinary row. Without that test it would ask on
 * every date edit in the CRM and everybody would click through it, which
 * is the same as not asking.
 */

/** The five columns whose edit re-derives the payable amount. */
export const RECOMPUTE_INPUTS = Object.freeze({
  monthlyAmount: 'Monthly amount',
  payableDays: 'Payable days',
  paymentStartOn: 'Payment start',
  presetOn: 'Preset date',
  assignedOn: 'Appointment date',
});

const CLAIMED_COLUMN = 'payable_amount';

function claimedByHand(row) {
  const claims = row?.manually_overridden_fields;
  return Array.isArray(claims) && claims.includes(CLAIMED_COLUMN);
}

/**
 * @param {object} row snake_case, as the cache holds it
 * @param {object} fields the patch, camelCase, as the API takes it
 * @returns {null|{labels: string[], was: number, willBe: number|null}}
 *   null when nothing would be lost, which is the ordinary case.
 */
export function recomputeWarning(row, fields) {
  if (!row || !fields) return null;
  // An explicit amount in the same patch wins, so there is nothing to warn
  // about: the admin is setting it right now. Same rule the server applies.
  if (fields.payableAmount !== undefined) return null;
  if (!claimedByHand(row)) return null;

  const touched = Object.keys(RECOMPUTE_INPUTS).filter((k) => fields[k] !== undefined);
  if (touched.length === 0) return null;

  const was = Number(row.payable_amount);
  if (!Number.isFinite(was)) return null;

  // The row as it WILL be, so the figure shown is the real one rather than
  // "it might change". A warning that cannot say the new number is a
  // warning nobody can act on.
  const presetOn = fields.presetOn ?? row.preset_on;
  const paymentStartOn = fields.paymentStartOn ?? row.payment_start_on;
  const appointmentOn = fields.assignedOn ?? row.assigned_on;
  const payableDays = fields.payableDays ?? payableDaysFor(paymentStartOn, presetOn, { appointmentOn });
  const willBe = payableFromDays({
    monthlyAmount: fields.monthlyAmount ?? row.monthly_amount,
    presetOn,
    payableDays,
  });

  // Nothing is lost when the formula lands on the same figure anyway.
  if (willBe !== null && Math.abs(willBe - was) < 0.005) return null;

  return { labels: touched.map((k) => RECOMPUTE_INPUTS[k]), was, willBe };
}

/** The patch that KEEPS the typed figure: send it back with the edit. */
export function keepingPayable(fields, row) {
  return { ...fields, payableAmount: Number(row.payable_amount) };
}
