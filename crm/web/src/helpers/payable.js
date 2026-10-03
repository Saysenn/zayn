/**
 * The sheet's payable formula, for the OPTIMISTIC value only.
 *
 *   =K/DAY(EOMONTH(G,0))*I     monthly / days-in-preset-month * payable-days
 *
 * A DELIBERATE MIRROR of the server's calculator/computePayable.js, and the
 * server stays authoritative: this figure lives only until the mutation
 * settles and the real row replaces it. It exists because an inline cell
 * has no Save button and no spinner — typing 2000 into Monthly and watching
 * Payable sit on the old number for 450ms reads as "the edit did not take".
 *
 * If the two ever disagree the server wins, and this is the copy to fix.
 * Kept to one small function for exactly that reason: there is one place to
 * change, and it is this comment's job to say where the other one is.
 *
 * The month length comes from the preset date, so February pays over 28
 * days (29 in a leap year) and July over 31 — never a fixed 30.
 */

import { forcesFullMonth } from './fromAppointment.js';

/** Days in the calendar month a date falls in. UTC throughout: a date read
 *  in a negative-offset zone rolls back a month and changes the divisor. */
export function daysInMonthOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * @returns {number|null} null when it cannot be worked out. Not zero —
 *   zero means "owed nothing", null means "we don't know", and collapsing
 *   them would show somebody £0 who is simply missing a date.
 */
export function payableFromDays({ monthlyAmount, presetOn, payableDays }) {
  const monthly = Number(monthlyAmount);
  if (!Number.isFinite(monthly)) return null;

  // No preset month means no pro-rata period, so the full monthly amount
  // is owed. The same reading the server takes, and what the sheet does on
  // its twelve "NA" rows.
  if (!presetOn) return monthly;
  const inMonth = daysInMonthOf(presetOn);
  if (!inMonth) return monthly;

  const days = Number(payableDays);
  if (!Number.isFinite(days)) return null;

  // Rounded to the penny once, at the end.
  return Math.round((monthly / inMonth) * days * 100) / 100;
}

/**
 * The sheet's day count, column I, restated.
 *
 *   =IF(F>G+DAY(EOMONTH(G,0))-1, 0,
 *      IF(F<=G, DAY(EOMONTH(G,0)), DAY(EOMONTH(G,0))-DAY(F)+1))
 *
 * MISSING, AND THAT WAS A BUG. `withPayable` recomputed the amount from
 * `row.payable_days`, the count from BEFORE the edit, so moving a payment
 * start painted the new date beside an amount worked out against the old
 * one. It corrected itself on the refetch, which is exactly the flicker
 * this file exists to remove.
 *
 * @returns {number|null} null when it cannot be known. Not zero: zero is
 *   "owed nothing", null is "we do not know".
 */
export function payableDaysFor(
  paymentStartOn,
  presetOn,
  { appointmentOn = null, specialCaseDeal = false } = {},
) {
  const preset = presetOn instanceof Date ? presetOn : new Date(presetOn);
  if (!presetOn || Number.isNaN(preset.getTime())) return null;

  const days = daysInMonthOf(preset);
  /**
   * SOMEBODY SAID THIS MONTH PAYS IT, so it pays the WHOLE month.
   * `special_case_deal`, migration 064. Counted from a start that lands after
   * the month it would be 0, and a toggle that put a row in the total at
   * nothing is a toggle that appears to do nothing.
   *
   * CONTRACT with `payableDaysFor` in api/v1/calculator/computePayable.js,
   * which takes the same option under the same name and answers the same
   * way. Each side pins its own half; this one is what paints the row
   * between the click and the refetch landing.
   */
  if (specialCaseDeal) return days;
  // A first week deal holds the last Friday of month 3 as its start, and is
  // owed the WHOLE of that month. Only month 3; later months need nothing.
  if (forcesFullMonth(appointmentOn, preset)) return days;
  // A blank start is the sheet's "Ongoing": no recorded start, full month.
  if (paymentStartOn == null || paymentStartOn === '') return days;

  const start = paymentStartOn instanceof Date ? paymentStartOn : new Date(paymentStartOn);
  if (Number.isNaN(start.getTime())) return null;

  const at = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monthStart = Date.UTC(preset.getUTCFullYear(), preset.getUTCMonth(), 1);
  const monthEnd = Date.UTC(preset.getUTCFullYear(), preset.getUTCMonth(), days);

  if (at(start) > monthEnd) return 0;
  if (at(start) <= monthStart) return days;
  return days - start.getUTCDate() + 1;
}

/** The inputs whose change makes the amount stale. Mirrors the server's
 *  RATE_INPUTS + DATE_INPUTS in recomputePayable.helper.js. `assignedOn`
 *  is here because the appointment drives the start, which drives both. */
export const PAYABLE_INPUTS = [
  'monthlyAmount', 'payableDays', 'paymentStartOn', 'presetOn', 'assignedOn',
  // `specialCaseDeal`, migration 064. Missing here, `withPayable` returned
  // early and the switch moved on screen beside a day count and an amount
  // that stayed at zero until the refetch. It is in the server's
  // DATE_INPUTS for the same reason.
  'specialCaseDeal',
];

/** The inputs that move the DAY COUNT, as opposed to only the amount. */
export const DAY_COUNT_INPUTS = ['paymentStartOn', 'presetOn', 'assignedOn', 'specialCaseDeal'];
