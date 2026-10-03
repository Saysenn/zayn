/**
 * THE PAYMENT START COLUMN IS NOT ALWAYS A DATE.
 *
 * Two kinds of words turn up in it on the live sheet, and they mean opposite
 * things:
 *
 *   "Ongoing"            twelve rows. A long-standing arrangement with no
 *                        recorded start, which is what a BLANK cell means:
 *                        the full month is owed.
 *
 *   "AUGUST END FULL"    six rows. Not a date and not an instruction, just a
 *   "OCTOBER END FULL"   human note over the top of a formula. The real
 *                        value is the formula's: APPOINTMENT + 90 DAYS, the
 *                        same one every other row in the column carries.
 *
 * THE WORDS WERE READ AS A DATE ONCE, AND IT COST MONEY. Migration 037 took
 * "AUGUST END FULL" to mean a start of 31 August plus a standing instruction
 * to pay a whole month. The boss's own August drafts say otherwise on both
 * counts: Monument Marketing starts 2026-08-03 and is paid 29 days
 * (£1,169.35, not £1,250), and the "OCTOBER END FULL" pair start 2026-11-03
 * and are paid nothing at all in August. Both of those dates are appointment
 * plus 90. So the column's own formula was the answer the whole time, and
 * anything read out of the prose itself was invention.
 *
 * WHAT THIS FUNCTION DOES NOW is only tell the caller WHICH KIND of words it
 * is looking at. It never returns a date: deriving one is
 * `repairFromAppointment`'s job, and it is the boss's rule re-run rather
 * than a rule we made up.
 */

// The sentinel canonical.js already names. In this column it means what a
// blank cell means.
const ONGOING = /^ongoing$/i;

/**
 * @param {unknown} value the Payment start date cell, as the sheet gave it
 * @returns {'ongoing'|'prose'|null} null when the cell is not words at all,
 *   which is every ordinary row.
 */
function readPaymentStart(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return ONGOING.test(text) ? 'ongoing' : 'prose';
}

module.exports = { readPaymentStart };
