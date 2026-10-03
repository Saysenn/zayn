// ***************************************************
// * WORDS IN THE END DATE COLUMN
// ***************************************************

/**
 * His September sheet writes prose in the end date column on 31 of 92
 * rows, and every one of them was dropped in silence: `endOn` came back
 * null, the row was not flagged, and the import diff said nothing.
 *
 * TWO PHRASES, AND THEY MEAN OPPOSITE THINGS.
 *
 *   "Going concern"     19 rows. No end date, it keeps running. That is
 *                       what a BLANK cell already means, so null is the
 *                       right stored value and nothing needs to act on it.
 *
 *   "Reviewed monthly"  12 rows. Decided month by month rather than by a
 *                       date. Null was the OPPOSITE of what he wrote: the
 *                       review queue asks whether the end date has passed,
 *                       so a null kept these out of the one screen meant
 *                       to ask about them.
 *
 * THE WORDS ARE KEPT EITHER WAY, in `end_note`, and the cell's tag reads
 * them. Same arrangement `payment_note` already uses for prose in the
 * payment start column: never parse his words into a date, never throw
 * them away, and say on the cell why it is blank.
 *
 * ANYTHING ELSE IS NOT GUESSED AT. A third phrase keeps its words, sets no
 * flag, and is reported on the import diff, so the next one he invents is
 * visible rather than silent.
 */

const GOING_CONCERN = 'Going concern';
const REVIEWED_MONTHLY = 'Reviewed monthly';

const KNOWN = Object.freeze({
  [GOING_CONCERN.toLowerCase()]: { note: GOING_CONCERN, reviewMonthly: false },
  [REVIEWED_MONTHLY.toLowerCase()]: { note: REVIEWED_MONTHLY, reviewMonthly: true },
});

/** Is this cell words rather than a date? A Date or a blank is neither. */
function isEndNote(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * @param {unknown} value the end date cell exactly as the sheet gave it
 * @returns {null | { note: string, reviewMonthly: boolean, known: boolean }}
 *   null on an ordinary row. `known` false means a phrase nobody has
 *   taught it yet: the words are still kept, and the diff says so.
 */
function readEndNote(value) {
  if (!isEndNote(value)) return null;
  const text = value.trim().replace(/\s+/g, ' ');
  const hit = KNOWN[text.toLowerCase()];
  if (hit) return { ...hit, known: true };
  return { note: text, reviewMonthly: false, known: false };
}

module.exports = {
  readEndNote, isEndNote, GOING_CONCERN, REVIEWED_MONTHLY,
};
