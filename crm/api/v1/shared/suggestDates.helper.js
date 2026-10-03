const {
  startFromAppointment, endFromAppointment, isRealDate,
  PAYMENT_START_OFFSET_DAYS,
} = require('./fromAppointment.helper');

// ***************************************************
// * What the three dates could be, and never what they are
// ***************************************************

/**
 * THREE DATES, ONE RULE, EIGHT COMBINATIONS.
 *
 *   payment start = appointment + 90 days
 *   end date      = appointment + 1 year
 *
 * so any one of the three implies the other two. Counted against the live
 * sheet, docs/boss/references/master.xlsx, 96 rows:
 *
 *   A S E   68 rows   all three, nothing to do
 *   A S -   10 rows   end derivable
 *   A - E    6 rows   start derivable, the `END FULL` rows
 *   A - -    0 rows
 *   - S E    0 rows
 *   - S -    0 rows
 *   - - E    0 rows
 *   - - -   12 rows   the `Ongoing` roster. CORRECT as blank, never a fault
 *
 * ===============================
 * * FORWARD IS WRITTEN. BACKWARD IS ONLY EVER SUGGESTED.
 * ===============================
 * Deriving the start or the end FROM the appointment restates his own
 * formula. Deriving the APPOINTMENT from either of them invents one, and
 * an appointment is a real event: his words, "the date of allocation, the
 * day the person was onboarded". Arithmetic cannot recover that.
 *
 * A back-derived appointment would then drive the forward cascade and look
 * identical to a real one, and the next export would hand him an onboarding
 * date the CRM made up. So it is offered, a human accepts it, and nothing
 * here writes anything. Decided 2026-09-08.
 *
 * 0 of the 202 rows across his four reference files need it. It exists
 * because it was asked for, and it is a suggestion for that reason.
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

/** The appointment his payment start implies. Backward: suggestion only. */
function appointmentFromStart(paymentStartOn) {
  const d = asDate(paymentStartOn);
  return d ? subDays(d, PAYMENT_START_OFFSET_DAYS) : null;
}

/** The appointment his end date implies. Backward: suggestion only. */
function appointmentFromEnd(endOn) {
  const d = asDate(endOn);
  return d ? subYear(d) : null;
}

const ISO = (d) => (isRealDate(d) ? d.toISOString().slice(0, 10) : null);

/**
 * What is missing on this row, and what it would be.
 *
 * @param {object} row snake_case, as stored
 * @returns {null|{direction: 'forward'|'backward', fields: object, from: string}}
 *   null when there is nothing to suggest, which includes the twelve rows
 *   that legitimately carry none of the three.
 */
function suggestDates(row) {
  const appointment = asDate(row?.assigned_on);
  const start = asDate(row?.payment_start_on);
  const end = asDate(row?.end_on);

  // Case 1: all three. Nothing to fill. Whether they AGREE is a different
  // question, and mismatchedDates below is where it is asked.
  if (appointment && start && end) return null;
  // Case 8: none of the three. `Ongoing`. Correct as it stands.
  if (!appointment && !start && !end) return null;

  // Cases 2, 3 and 4. The appointment is real, so this restates his
  // formula rather than inventing anything.
  if (appointment) {
    const fields = {};
    if (!start) fields.paymentStartOn = ISO(startFromAppointment(appointment));
    if (!end) fields.endOn = ISO(endFromAppointment(appointment));
    if (Object.keys(fields).length === 0) return null;
    return { direction: 'forward', fields, from: 'appointment date' };
  }

  // Cases 5, 6 and 7. No appointment, so one is being invented from a
  // payment date. The start is preferred over the end: +90 is exact, where
  // the end date is his own "provisional" column.
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
 * A row carrying all three where they do not agree with each other.
 *
 * Not an error and never corrected: his own file has two of them, the
 * INDIGO pair he paid a whole month where his formula gives six days. It
 * is worth SAYING, so the difference is a decision somebody made rather
 * than one nobody noticed.
 */
function mismatchedDates(row) {
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

module.exports = {
  suggestDates, mismatchedDates, appointmentFromStart, appointmentFromEnd,
};
