// Extension included: node's test runner resolves ESM literally, and
// paymentPeriod.js already writes it this way. Vite takes it either way.
import { startFromAppointment, endFromAppointment, PAYMENT_START_OFFSET_DAYS } from './fromAppointment.js';

// ***************************************************
// * What the three dates could be, and never what they are
// ***************************************************

/**
 * A DELIBERATE MIRROR of api/v1/shared/suggestDates.helper.js, the same
 * arrangement fromAppointment.js, payable.js and paymentStartState.js
 * already use. The server stays authoritative and this exists so the master
 * sheet can mark a cell without asking the export what it thinks. If the
 * two disagree, fix this one. Each side is pinned by its own test.
 *
 * THREE DATES, ONE RULE, EIGHT COMBINATIONS.
 *
 *   payment start = appointment + 90 days
 *   end date      = appointment + 1 year
 *
 * so any one of the three implies the other two. Against the live sheet,
 * 96 rows: 68 carry all three, 10 miss the end, 6 miss the start, 12 carry
 * none. Nothing misses only the appointment.
 *
 * ===============================
 * * FORWARD IS WRITTEN. BACKWARD IS ONLY EVER SUGGESTED.
 * ===============================
 * Deriving the start or the end FROM the appointment restates his own
 * formula. Deriving the APPOINTMENT from either of them invents one, and an
 * appointment is a real event: the day somebody was onboarded. A
 * back-derived appointment would then drive the forward cascade and look
 * identical to a real one, so nothing here writes anything.
 */

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function subDays(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n));
}

function subYear(d) {
  return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
}

const ISO = (d) => (d instanceof Date && !Number.isNaN(d.getTime())
  ? d.toISOString().slice(0, 10)
  : null);

/** The appointment his payment start implies. Backward: suggestion only. */
export function appointmentFromStart(paymentStartOn) {
  const d = asDate(paymentStartOn);
  return d ? subDays(d, PAYMENT_START_OFFSET_DAYS) : null;
}

/** The appointment his end date implies. Backward: suggestion only. */
export function appointmentFromEnd(endOn) {
  const d = asDate(endOn);
  return d ? subYear(d) : null;
}

/**
 * What is missing on this row, and what it would be.
 *
 * @param {object} row snake_case, as the cache holds it
 * @returns {null|{direction: 'forward'|'backward', fields: object, from: string}}
 *   null when there is nothing to suggest, which includes the twelve rows
 *   that legitimately carry none of the three.
 */
export function suggestDates(row) {
  const appointment = asDate(row?.assigned_on);
  const start = asDate(row?.payment_start_on);
  const end = asDate(row?.end_on);

  // All three. Whether they AGREE is mismatchedDates below, not this.
  if (appointment && start && end) return null;
  // None of the three. `Ongoing`. Correct as it stands.
  if (!appointment && !start && !end) return null;

  if (appointment) {
    const fields = {};
    if (!start) fields.paymentStartOn = ISO(startFromAppointment(appointment));
    if (!end) fields.endOn = ISO(endFromAppointment(appointment));
    if (Object.keys(fields).length === 0) return null;
    return { direction: 'forward', fields, from: 'appointment date' };
  }

  // No appointment, so one is being invented from a payment date. The start
  // is preferred over the end: +90 is exact, where the end date is his own
  // "provisional" column.
  const derivedAppointment = start ? appointmentFromStart(start) : appointmentFromEnd(end);
  if (!derivedAppointment) return null;

  const fields = { assignedOn: ISO(derivedAppointment) };
  if (!start) fields.paymentStartOn = ISO(startFromAppointment(derivedAppointment));
  if (!end) fields.endOn = ISO(endFromAppointment(derivedAppointment));
  return {
    direction: 'backward',
    fields,
    from: start ? 'payment start date' : 'end date',
  };
}

/**
 * A row carrying an appointment where a stored date disagrees with it.
 *
 * Not an error and never corrected: his own file has the INDIGO pair, paid
 * a whole month where the formula gives six days. It is worth SAYING, so
 * the difference is a decision somebody made rather than one nobody noticed.
 */
export function mismatchedDates(row) {
  const appointment = asDate(row?.assigned_on);
  const start = asDate(row?.payment_start_on);
  const end = asDate(row?.end_on);
  if (!appointment || (!start && !end)) return null;

  const off = [];
  if (start && ISO(start) !== ISO(startFromAppointment(appointment))) {
    off.push({
      field: 'paymentStartOn', is: ISO(start), formula: ISO(startFromAppointment(appointment)),
    });
  }
  if (end && ISO(end) !== ISO(endFromAppointment(appointment))) {
    off.push({ field: 'endOn', is: ISO(end), formula: ISO(endFromAppointment(appointment)) });
  }
  return off.length ? off : null;
}
