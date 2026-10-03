/**
 * WHAT THE SHEET WRITES INSTEAD OF AN ANSWER.
 *
 * Two sentinels the boss's own file uses in place of a value. Offered as
 * options in the Add person wizard and the row editor rather than retyped,
 * and the editor reads NEVER_BANK back to decide whether its banking
 * toggle is on, so they are real data and never something to strip.
 *
 * Was written out as a literal in four places. A copy of a string that is
 * COMPARED against a stored value is the repeated-literal rule at its
 * worst: change one, miss another, and the banking toggle silently stops
 * reflecting the row it is describing.
 *
 * The api's list is masterSheet/canonical.js's SENTINELS, which holds
 * these two plus "In person meet", "Ongoing" and "Not applicable" and is
 * what canonicalises them on upload. Two lists, never one import: the two
 * codebases are separate deploys. The strings must match it exactly.
 */
export const NEVER_BANK = 'Will never be bank';
export const INTERNAL = 'Handled internally';
export const IN_PERSON = 'In person meet';

/**
 * THE TWO HIS END DATE COLUMN CARRIES, September 2026. 31 of 92 rows.
 *
 * They mean opposite things, which is the whole reason they are two
 * strings and not one "prose" case:
 *
 *   GOING_CONCERN     no end date, it keeps running
 *   REVIEWED_MONTHLY  decided month by month, so it is in the Review list
 *
 * Compared against a stored `end_note` to choose the cell's tag, so these
 * must match `shared/endNote.helper.js` exactly. Two lists, never one
 * import: the codebases are separate deploys.
 */
export const GOING_CONCERN = 'Going concern';
export const REVIEWED_MONTHLY = 'Reviewed monthly';

/**
 * Which badge tint his phrase takes on the end date cell.
 *
 * The KEY, never the words: the class is built from it, and a phrase
 * nobody has taught it would otherwise produce a class name with spaces.
 * An unknown one still prints verbatim, in red, because the date is empty
 * and the words are not a value anything can use.
 */
export function endNoteTone(note) {
  if (note === REVIEWED_MONTHLY) return 'review_monthly';
  if (note === GOING_CONCERN) return 'going_concern';
  return 'end_note_unknown';
}

/**
 * ===============================
 * * THE TAG ON THE END DATE CELL, FROM EITHER SOURCE
 * ===============================
 * HIS WORDS FIRST when the sheet wrote any: "Going concern", "Reviewed
 * monthly", or a phrase nobody has taught it. They are the most specific
 * answer there is, because he wrote them about that row.
 *
 * AND THE TICK OTHERWISE. A deal checked on the status screen, under
 * liquidation or under review, is reviewed monthly just as surely, and its
 * cell was blank: the tag only ever read `end_note`, which the import
 * sets and the checklist does not. His call 2026-09-21.
 *
 * @returns {{ label: string, tone: string } | null}
 */
export function endCellTag(row) {
  if (row?.end_note) return { label: row.end_note, tone: endNoteTone(row.end_note) };
  if (row?.review_monthly) return { label: REVIEWED_MONTHLY, tone: 'review_monthly' };
  return null;
}

/**
 * The cap on every percentage the CRM stores: add on, fee, crypto.
 *
 * THE CONTRACT. The api pins the same number in `v1/shared/rates.helper.js`
 * and refuses anything above it. Two definitions, never one import: the
 * codebases are separate deploys. Above this a form would accept a value
 * the server sends straight back as a 400.
 */
export const MAX_PERCENT = 100;
