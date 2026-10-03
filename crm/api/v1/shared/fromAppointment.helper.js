// ***************************************************
// * The two dates the appointment date drives
// ***************************************************

/**
 * THE APPOINTMENT IS THE ONE TYPED DATE, AND TWO COLUMNS FOLLOW IT.
 *
 * His sheet, verified against docs/boss/references/master.xlsx:
 *
 *   F  payment start  =E2+90                                    78 of 96 rows
 *   H  end date       =DATE(YEAR(E9)+1, MONTH(E9), DAY(E9))      73 of 96 rows
 *
 * and then column I reads F, and column L reads I. So one typed date moves
 * four cells. His own words, `docs/boss/Structure for the maths.docx`:
 * "Payment start date: it is usually 12 weeks from the appointment date",
 * "Payment end date: one year from the appointment date. This is
 * provisional as sometimes job finish early and or they last longer."
 *
 * NINETY, NOT EIGHTY FOUR. Both of his written documents say 12 weeks and
 * "84 days from incorporation"; his spreadsheet says 90 on every one of
 * those 78 rows. The sheet is what the money was paid against, so 90 it is.
 * Decided 2026-09-08. See docs/todo.md.
 */
const PAYMENT_START_OFFSET_DAYS = 90;

/**
 * ===============================
 * * A FIRST WEEK APPOINTMENT IS PAID IN MONTH 3, NOT MONTH 4
 * ===============================
 * His call, 2026-09-18: "it is unfair to make someone wait 4 months."
 *
 * +90 tips a first week appointment just past the end of month 3, in
 * almost every month there is. Appointed Mon 3 Aug, +90 is Sun 1 Nov, so
 * October pays nothing and the first money arrives at the end of November.
 * Checked across two years: for a day 3 appointment, +90 lands on the 1st
 * to the 4th of month 4 in eleven months out of twelve.
 *
 * So week 1 is pulled back into month 3 and paid the WHOLE of it. Everyone
 * else is unchanged: mid or end of month is +90 and a part month, exactly
 * as his own document describes it.
 *
 * WEEK 1 IS UP TO AND INCLUDING THE FIRST FRIDAY, his definition. It is
 * also the rhythm his whole operating document runs on: "the first Friday
 * of each month" appears against four separate groups. Never "days 1 to 7",
 * which reaches into the second working week in months that start late.
 *
 * THE DATE STORED IS THE LAST FRIDAY OF MONTH 3, because that is the day
 * the money is handed over and it is what he wants to see on the sheet.
 * The day COUNT does not follow from it: see `payableDaysFor`, which
 * forces the full month while the preset is month 3. The two disagree on
 * purpose, once, on that one cell, and `dateNotices` says so on screen.
 */
const WEEK_ONE_FULL_MONTH = 3;

function addDays(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

const FRIDAY = 5;

/** The day of the month the first Friday falls on, 1 to 7. */
function firstFridayOf(year, monthIndex) {
  let day = 1;
  while (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() !== FRIDAY) day += 1;
  return day;
}

/**
 * Was this appointment in the first week of its month?
 *
 * No weekend test is needed and none is wanted: 162 appointment dates
 * across his four files are all weekdays, and a Saturday typed in by hand
 * should still be answered rather than refused.
 */
function isWeekOneAppointment(appointmentOn) {
  if (!isRealDate(appointmentOn)) return false;
  const first = firstFridayOf(appointmentOn.getUTCFullYear(), appointmentOn.getUTCMonth());
  return appointmentOn.getUTCDate() <= first;
}

/** Which month a deal's month 3 is, as a `YYYY-MM` string. */
function monthThreeOf(appointmentOn) {
  if (!isRealDate(appointmentOn)) return null;
  const m = new Date(Date.UTC(
    appointmentOn.getUTCFullYear(), appointmentOn.getUTCMonth() + (WEEK_ONE_FULL_MONTH - 1), 1,
  ));
  return m.toISOString().slice(0, 7);
}

/** The last Friday of month 3, which is the day the first payment lands. */
function lastFridayOfMonthThree(appointmentOn) {
  if (!isRealDate(appointmentOn)) return null;
  // Day 0 of the NEXT month is the last day of this one.
  const end = new Date(Date.UTC(
    appointmentOn.getUTCFullYear(), appointmentOn.getUTCMonth() + WEEK_ONE_FULL_MONTH, 0,
  ));
  while (end.getUTCDay() !== FRIDAY) end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

/**
 * Is this the one month whose day count is forced to the whole month?
 *
 * ONLY month 3, and that is the whole of it. From month 4 the stored start
 * sits before the month begins, so his own formula takes its `F<=G` branch
 * and returns a full month unaided. Forcing beyond month 3 would be a
 * special case with nothing to fix.
 */
function forcesFullMonth(appointmentOn, presetOn) {
  if (!isWeekOneAppointment(appointmentOn) || !isRealDate(presetOn)) return false;
  return presetOn.toISOString().slice(0, 7) === monthThreeOf(appointmentOn);
}

// Excel's DATE(Y+1, M, D) rolls 29 Feb to 1 March in a non leap year, and
// so does Date.UTC with a day of 29 in a 28 day month. Matching by
// accident is still matching, but it is pinned in the tests.
function addYear(d) {
  return new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
}

function isRealDate(v) {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

/**
 * The payment start, which is his column F on all but the first week.
 *
 * Week 1 is the last Friday of month 3 instead, so the first payment lands
 * at the end of month 3 rather than month 4.
 */
function startFromAppointment(appointmentOn) {
  if (!isRealDate(appointmentOn)) return null;
  if (isWeekOneAppointment(appointmentOn)) return lastFridayOfMonthThree(appointmentOn);
  return addDays(appointmentOn, PAYMENT_START_OFFSET_DAYS);
}

/** The end date his column H computes, or null with no appointment. */
function endFromAppointment(appointmentOn) {
  return isRealDate(appointmentOn) ? addYear(appointmentOn) : null;
}

const DERIVES = { start: startFromAppointment, end: endFromAppointment };

/**
 * ===============================
 * * DOES THIS CELL STILL HOLD THE FORMULA'S ANSWER?
 * ===============================
 * THE CASCADE'S GUARD, and deliberately not `manually_overridden_fields`.
 *
 * Two guards, two questions. The claim array asks whether a file may
 * overwrite a cell. This asks whether the cascade may. They cannot be the
 * same array: the cascade WRITES payment start and end, so those columns
 * would be claimed by its own output and the second appointment edit would
 * be blocked by the first.
 *
 * This is what Excel does. A cell holds either the formula or a literal
 * somebody typed over it, and only the first recalculates. With no formula
 * to inspect, the test is whether the stored value is still what the old
 * appointment would have produced.
 *
 * @param {Date|string|null} stored the cell as it stands
 * @param {Date|null} oldAppointmentOn the appointment before this edit
 * @param {'start'|'end'} kind which of the two columns
 */
function stillTheFormulasAnswer(stored, oldAppointmentOn, kind) {
  // An empty cell has nothing to protect, so the formula fills it. This is
  // case 2 and case 3 of the spec: a row missing one of the two dates.
  if (!stored) return true;
  // No old appointment means nothing derived this value, so a human did.
  if (!isRealDate(oldAppointmentOn)) return false;
  const was = DERIVES[kind](oldAppointmentOn);
  const held = stored instanceof Date ? stored : new Date(stored);
  if (!isRealDate(held) || !was) return false;
  return sameDay(held, was);
}

// Compared by day, never by timestamp: a `date` column comes back as
// midnight in some zone and an equality on getTime() would be a coin toss.
function sameDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

/**
 * ===============================
 * * A DATE COLUMN IS WRITTEN AS `YYYY-MM-DD`, NEVER AS A Date
 * ===============================
 * The route's own `parseDate` returns a plain string, and this is why.
 *
 * These functions build UTC midnight, because every comparison in the
 * money rules is on UTC day components. `pg` serialises a Date using LOCAL
 * time, so a UTC midnight Date leaves as `2026-07-13T17:00:00-07:00` on a
 * Pacific machine, and Postgres then casts that to a `date` using the
 * SESSION timezone: right in a UTC session, a day early in a Pacific one.
 * Diane's own `formatValue` reads it with local getters and says the day
 * before, which is how this was found.
 *
 * A string has no timezone to get wrong. Anything writing one of these
 * into a patch converts first.
 */
function asDateString(d) {
  return isRealDate(d) ? d.toISOString().slice(0, 10) : null;
}

module.exports = {
  PAYMENT_START_OFFSET_DAYS,
  WEEK_ONE_FULL_MONTH,
  startFromAppointment,
  endFromAppointment,
  stillTheFormulasAnswer,
  isWeekOneAppointment,
  lastFridayOfMonthThree,
  monthThreeOf,
  forcesFullMonth,
  firstFridayOf,
  asDateString,
  addDays,
  addYear,
  isRealDate,
};
