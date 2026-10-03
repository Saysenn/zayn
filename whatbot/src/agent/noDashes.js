/**
 * Takes the dashes out of anything the model wrote.
 *
 * The prompt already asks for commas and full stops. It is asked, and it is
 * mostly obeyed, and "mostly" is not a standard — one em dash in a message
 * about somebody's wages is the tell that a machine wrote it, and the whole
 * point of `conversation/` is that we do not sound like one.
 *
 * MODEL PROSE ONLY. Never run this over a code-built display: company names
 * (`Anteep-Sourcing`), dates (`2026-08-31`) and filenames all carry hyphens
 * that belong there, and every one of those is written in code precisely so it
 * reads exactly as the sheet holds it.
 */

/**
 * An em or en dash between words becomes a comma, because that is what it
 * was standing in for. These never form a real word — nobody hyphenates
 * "part-time" with one — so they're caught whether or not the model left
 * spaces around them. The model writes both styles interchangeably.
 *
 *   "sorry — try your Indigo number"  -> ", try your"
 *   "you—just let me know"            -> "you, just let me know"
 */
const UNICODE_DASH = /\s*[—–]\s*/g;

/**
 * A plain hyphen tight against a word is a hyphen inside it and stays —
 * "part-time", "Anteep-Sourcing" — so this only fires when it has space on
 * both sides, where it can only have been standing in for a pause.
 */
const SPACED_HYPHEN = /\s+-+\s+/g;

/** a dash opening a line, which is a bullet point by another name */
const LEADING_DASH = /^[\s]*[—–-]+\s*/gm;

export function noDashes(text) {
  return (
    text
      .replace(LEADING_DASH, "")
      .replace(UNICODE_DASH, ", ")
      .replace(SPACED_HYPHEN, ", ")
      // "sorry, , try" — a dash that already had a comma in front of it
      .replace(/,\s*,/g, ",")
      .trim()
  );
}
