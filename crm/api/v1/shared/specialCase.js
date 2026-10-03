/**
 * ***************************************************
 * * WHAT THE ADMIN CALLS `special_case_deal`
 * ***************************************************
 *
 * The column was `pay_this_month` until migration 065, and the toggle read
 * "Pay this deal for September 2026". Both are gone. The switch now reads
 * "Make this deal Special Case", so that is the phrase the admin types, and
 * Diane's card, her field description and her prompt each carried a
 * different leftover name for the same thing: the card said "Paid this
 * month by hand", the description led on "should be paid this month".
 *
 * A NAME SHE DOES NOT RECOGNISE IS A FIELD SHE CANNOT REACH. Asked to
 * "make Mayah a special case" she has nothing to match on, and the nearest
 * thing by words is `overrideShouldBePaid`, which carries no month and
 * quietly drops the row out of a payout instead.
 *
 * So the name is defined ONCE and read everywhere that says it out loud.
 * When the switch is relabelled again, this file is the edit.
 *
 * ===============================
 * * THE PHRASINGS ARE FOR ROUTING, NEVER FOR PERMISSION
 * ===============================
 * `confirmSpecialCaseDeal` is what stops this field being written without
 * the admin agreeing, and it does not care which words got her there. This
 * list only decides WHICH FIELD a sentence is about. Adding a phrase here
 * can never widen what she may do with it.
 */

// What the switch says on screen. `crm/web` pins its own half in
// MasterSheetPage's `switchLabel`: the two must read the same.
const SPECIAL_CASE_SWITCH = 'Make this deal Special Case';

// The same fact as a READOUT, which is what a card cell is.
const SPECIAL_CASE_LABEL = 'Special case';

/**
 * How the admin actually asks for it, his words and the sheet's.
 *
 * The first four are the switch's own name in the orders people say it.
 * The rest predate the rename and still arrive, because the sheet's column
 * is headed "shoukd be paid or not" and that is what the team reads.
 */
const SPECIAL_CASE_PHRASES = [
  'make this a special case',
  'special case deal',
  'special deal case',
  'special deal',
  'should be paid this month',
  'pay them anyway',
  'pay them this month even though',
];

/** For a description or a prompt line: "a", "b", "c" or "d". */
const quotedPhrases = () => SPECIAL_CASE_PHRASES.map((p) => `"${p}"`).join(', ');

module.exports = {
  SPECIAL_CASE_SWITCH,
  SPECIAL_CASE_LABEL,
  SPECIAL_CASE_PHRASES,
  quotedPhrases,
};
