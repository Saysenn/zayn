/**
 * The two dates his appointment column drives, for the OPTIMISTIC row only.
 *
 *   payment start  =E2+90
 *   end date       =DATE(YEAR(E9)+1, MONTH(E9), DAY(E9))
 *
 * A DELIBERATE MIRROR of api/v1/shared/fromAppointment.helper.js, the same
 * arrangement payable.js and paymentStartState.js already use: the server
 * stays authoritative and this exists so four cells move the moment the
 * appointment date is typed rather than 450ms later. If the two disagree,
 * fix this one. Each side is pinned by its own test.
 *
 * NINETY, NOT EIGHTY FOUR. Both of his written documents say 12 weeks; his
 * spreadsheet says 90 on every one of its 78 formula rows, and the money
 * was paid against the spreadsheet.
 */

export const PAYMENT_START_OFFSET_DAYS = 90;

/**
 * A FIRST WEEK APPOINTMENT IS PAID IN MONTH 3, NOT MONTH 4. His call,
 * 2026-09-18: "it is unfair to make someone wait 4 months."
 *
 * +90 tips a first week appointment just past the end of month 3 in almost
 * every month there is, so week 1 is pulled back and paid the WHOLE of
 * month 3. Week 1 is up to and including the FIRST FRIDAY, which is the
 * rhythm his own operating document already runs on.
 *
 * The stored date is the last Friday of month 3, the day the money lands.
 * The day COUNT does not follow from it: `payable.js` forces the full
 * month while the preset is month 3.
 */
const WEEK_ONE_FULL_MONTH = 3;
const FRIDAY = 5;

function firstFridayOf(year, monthIndex) {
  let day = 1;
  while (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() !== FRIDAY) day += 1;
  return day;
}

export function isWeekOneAppointment(appointmentOn) {
  const d = asDate(appointmentOn);
  if (!d) return false;
  return d.getUTCDate() <= firstFridayOf(d.getUTCFullYear(), d.getUTCMonth());
}

export function monthThreeOf(appointmentOn) {
  const d = asDate(appointmentOn);
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (WEEK_ONE_FULL_MONTH - 1), 1))
    .toISOString().slice(0, 7);
}

export function lastFridayOfMonthThree(appointmentOn) {
  const d = asDate(appointmentOn);
  if (!d) return null;
  // Day 0 of the next month is the last day of this one.
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + WEEK_ONE_FULL_MONTH, 0));
  while (end.getUTCDay() !== FRIDAY) end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

/**
 * Only month 3. From month 4 the stored start sits before the month, so
 * the ordinary formula returns a full month unaided.
 */
export function forcesFullMonth(appointmentOn, presetOn) {
  const preset = asDate(presetOn);
  if (!preset || !isWeekOneAppointment(appointmentOn)) return false;
  return preset.toISOString().slice(0, 7) === monthThreeOf(appointmentOn);
}

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC throughout: a date read in a negative-offset zone rolls back a day. */
function addDays(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

// Excel's DATE(Y+1, M, D) rolls 29 Feb to 1 March in a non leap year, and
// Date.UTC with day 29 in a 28 day month does the same.
function addYear(d) {
  return new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
}

export function startFromAppointment(appointmentOn) {
  const d = asDate(appointmentOn);
  if (!d) return null;
  if (isWeekOneAppointment(d)) return lastFridayOfMonthThree(d);
  return addDays(d, PAYMENT_START_OFFSET_DAYS);
}

export function endFromAppointment(appointmentOn) {
  const d = asDate(appointmentOn);
  return d ? addYear(d) : null;
}

const DERIVES = { start: startFromAppointment, end: endFromAppointment };

/**
 * THE CASCADE'S GUARD, and deliberately not `manually_overridden_fields`.
 *
 * Two guards, two questions. The claim array asks whether an uploaded file
 * may overwrite a cell. This asks whether the cascade may. They cannot be
 * the same array: the cascade WRITES these two columns, so they would be
 * claimed by its own output and the second appointment edit would be
 * blocked by the first.
 *
 * It is what Excel does. A cell holds either the formula or a literal
 * somebody typed over it, and only the first recalculates.
 */
export function stillTheFormulasAnswer(stored, oldAppointmentOn, kind) {
  if (!stored) return true;
  const was = DERIVES[kind](oldAppointmentOn);
  const held = asDate(stored);
  if (!held || !was) return false;
  return held.getUTCFullYear() === was.getUTCFullYear()
    && held.getUTCMonth() === was.getUTCMonth()
    && held.getUTCDate() === was.getUTCDate();
}

/** Dates go into the cache as the API writes them, `YYYY-MM-DD`. */
export function asColumnDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}
