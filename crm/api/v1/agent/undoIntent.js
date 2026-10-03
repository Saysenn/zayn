// ***************************************************
// * When the admin asks to UNDO
// ***************************************************
//
// An undo puts back what the value WAS, which only the change log knows.
// 2026-09-28: "undo the tier change" went to bulk_update_companies, which
// proposed clearing the tier: a guessed old value, dressed as an undo.
const { agreed } = require('./confirmReplay');

// Not "put it back to active": that names the value, and reopening a company is a set.
const ASKS_UNDO = /\b(?:undo|revert|roll ?back)\b/i;
// "undo that" names nothing, so the thing it undoes was named one message back.
const NAMES_NOTHING = /^\s*(?:please\s+)?(?:undo|revert)\s+(?:that|it|this)\b[\s.!?]*$/i;

const asksUndo = (said) => ASKS_UNDO.test(String(said ?? ''));

/**
 * The sentence to read an undo off: theirs, unless it is only a "yes" or an
 * "undo that", when the last two messages say what is meant.
 */
function undoSentence({ said, saidRecent } = {}) {
  const now = String(said ?? '');
  return (agreed(now) || NAMES_NOTHING.test(now)) && saidRecent ? String(saidRecent) : now;
}

// The refusal a SETTING tool gives when the sentence asked to undo.
const USE_UNDO = 'NOTHING HAS BEEN CHANGED. They asked to UNDO, which puts back what the value was '
  + 'before, and only the change log knows that. Call undo_master_sheet_change instead, and never '
  + 'guess the old value.';

module.exports = { asksUndo, undoSentence, USE_UNDO };
