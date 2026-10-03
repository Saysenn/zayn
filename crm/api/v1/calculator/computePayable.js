/**
 * The whole of the "calculator", in one file.
 *
 * There is no earnings cascade in the boss's real sheet — a Director's
 * figure is not a share of a Mid's, and 20 of the 28 multi-handler
 * companies pay their handlers different negotiated amounts. So the only
 * arithmetic the CRM actually owes anyone is the pro-rata:
 *
 *     payable_days   = how much of the preset month this deal was live for
 *     payable_amount = monthly_amount / days_in_preset_month * payable_days
 *
 * WHY THIS IS COMPUTED AND NOT READ
 * The sheet has both figures as formula columns, and they are unreliable:
 * of 96 deals in master.xlsx, `Payable amount` resolves on only 67 and
 * `Payable days` on only 58. Two causes — Excel saving without cached
 * formula results, and text ("OCTOBER END FULL") sitting in a date column
 * so the formula chain can't evaluate at all. Trusting column 12 means a
 * third of the roster silently reads £0.
 *
 * WHICH MONTH IS THE DENOMINATOR
 * The PRESET month — the month being paid for. The boss's own file also
 * divides by the month the contract happens to END in on rows 74-83, which
 * changes 17 people's pay by up to £160 each (dividing by February's 28
 * days pays 11% more than July's 31). Confirmed with the user as a
 * copy-paste error in the sheet, corrected on import.
 */

/** Days in the calendar month `d` falls in. UTC throughout — a `date`
 *  column read in a negative-offset zone otherwise rolls back to the
 *  previous month and silently changes the denominator. */
const { forcesFullMonth } = require('../shared/fromAppointment.helper');

function daysInMonthOf(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function isRealDate(v) {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

/**
 * The sheet's own IF formula, restated:
 *
 *   started after this month ended        -> 0    (nothing owed yet)
 *   started on or before the month began  -> full month
 *   started mid-month                     -> the remainder from that day
 *
 * `startUnknown` separates two cases that both arrive as a null date and
 * mean opposite things:
 *
 *   blank cell   -> a long-standing arrangement with no recorded start,
 *                   which the sheet leaves empty. Full month.
 *   unreadable   -> the cell held prose nothing could read. We do not know
 *                   the start, so we do not know the days: leave it empty
 *                   and flag it rather than invent a figure.
 *
 * THERE IS NO "PAY A FULL MONTH ANYWAY" ESCAPE HATCH, and there was one for
 * a day. "AUGUST END FULL" in the payment start column was read as a start
 * of 31 August plus a standing instruction to pay the whole month; the
 * boss's own August drafts pay that row 29 days from a start of 2026-08-03,
 * and pay the "OCTOBER END FULL" pair nothing at all. The words were a note
 * over the column's own formula, never a rule. See migration 038.
 *
 * @returns {number|null} null when it genuinely cannot be known. Null is
 *   not zero: zero means "owed nothing", null means "we don't know", and
 *   collapsing them would quietly pay someone £0.
 */
function payableDaysFor(
  paymentStartOn,
  presetOn,
  { startUnknown = false, appointmentOn = null, specialCaseDeal = false } = {},
) {
  if (!isRealDate(presetOn)) return null;
  if (startUnknown) return null;

  const days = daysInMonthOf(presetOn);
  /**
   * ===============================
   * * SOMEBODY SAID THIS MONTH PAYS IT, SO IT PAYS THE WHOLE MONTH
   * ===============================
   * `special_case_deal`, migration 064. Counted from a start that lands after
   * the month it would be 0, so the toggle would put a row in the total
   * for nothing and read as broken. The whole month is what he means by
   * it, and it is the same answer the first week rule below already gives
   * for the same reason.
   */
  if (specialCaseDeal) return days;
  /**
   * THE ONE MONTH THE COUNT DOES NOT FOLLOW FROM THE START DATE.
   *
   * A first week appointment stores the last Friday of month 3 as its
   * payment start, because that is the day the money lands and it is what
   * he wants on the sheet. Counted from there it would be two days. He is
   * owed the whole month, so month 3 is forced and every later month is
   * ordinary. See fromAppointment.helper.js.
   */
  if (forcesFullMonth(appointmentOn, presetOn)) return days;
  if (paymentStartOn == null) return days;
  if (!isRealDate(paymentStartOn)) return null;

  const monthStart = Date.UTC(presetOn.getUTCFullYear(), presetOn.getUTCMonth(), 1);
  const monthEnd = Date.UTC(presetOn.getUTCFullYear(), presetOn.getUTCMonth(), days);
  const start = Date.UTC(
    paymentStartOn.getUTCFullYear(),
    paymentStartOn.getUTCMonth(),
    paymentStartOn.getUTCDate(),
  );

  if (start > monthEnd) return 0;
  if (start <= monthStart) return days;
  return days - paymentStartOn.getUTCDate() + 1;
}

/**
 * @returns {number|null} null when it cannot be worked out. A missing
 *   monthly amount is treated as unknown; a monthly amount of 0 is a real,
 *   known figure (the sheet writes it for deals that are agreed but not
 *   yet paying) and prorates to 0 like any other.
 */
function payableAmountFor({
  monthlyAmount, paymentStartOn, presetOn, startUnknown = false, appointmentOn = null,
  specialCaseDeal = false,
}) {
  const monthly = Number(monthlyAmount);
  if (!Number.isFinite(monthly)) return null;

  // No preset month means there is no pro-rata period to apply, so the
  // full monthly amount is owed. This is not an assumption: the sheet
  // writes the literal text "NA" in the Preset date column for the
  // standing internal roster (the 12 ALL GROUPS rows: Admin, Sales,
  // Holding, Accounts, Maid) and sets Payable amount equal to Monthly
  // amount on every single one of them. Trusting the document.
  if (!isRealDate(presetOn)) return monthly;

  const days = payableDaysFor(paymentStartOn, presetOn, { startUnknown, appointmentOn, specialCaseDeal });
  if (days === null) return null;

  const inMonth = daysInMonthOf(presetOn);
  // Rounded to the penny. Un-rounded, 1100/31*13 carries twelve decimal
  // places into the xlsx and prints as £461.2903225806452 on a payout sheet.
  return Math.round((monthly / inMonth) * days * 100) / 100;
}

/**
 * The sheet's own arithmetic, with the day count GIVEN rather than derived.
 *
 *   =K/DAY(EOMONTH(G,0))*I     monthly / days-in-preset-month * payable-days
 *
 * payableAmountFor works out the days itself from the payment start, which
 * is right on an upload. This one is for an admin editing the cells: they
 * may set Payable days by hand, and the amount still has to follow the
 * same formula rather than a second one written out again here.
 *
 * No preset month means no pro-rata period, so the full monthly amount is
 * owed — the same reading payableAmountFor takes, and what the sheet does
 * on its twelve "NA" rows.
 *
 * @returns {number|null} null when it genuinely cannot be worked out. Not
 *   zero: zero means "owed nothing", null means "we don't know".
 */
function payableFromDays({ monthlyAmount, presetOn, payableDays }) {
  const monthly = Number(monthlyAmount);
  if (!Number.isFinite(monthly)) return null;
  if (!isRealDate(presetOn)) return monthly;

  const days = Number(payableDays);
  if (!Number.isFinite(days)) return null;

  const inMonth = daysInMonthOf(presetOn);
  // Rounded to the penny, once, at the end. The sheet leaves 1100/31*13 as
  // 461.2903225806452; a payout document should not.
  return Math.round((monthly / inMonth) * days * 100) / 100;
}

module.exports = { payableDaysFor, payableAmountFor, payableFromDays, daysInMonthOf, isRealDate };
