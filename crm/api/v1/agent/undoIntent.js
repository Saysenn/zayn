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

/**
 * ===============================
 * * AN UNDO IN EVERYDAY WORDS
 * ===============================
 * Live 2026-10-03: right after "bump abe's pay to 600", both "actually scrap
 * that" and "no I meant cancel the change you just made to abe" were
 * answered with Abe's total. The undo tool is held until asked for, and
 * neither sentence held a word on the list, so she was never handed it.
 *
 * A VERB OF TAKING BACK, about THE CHANGE: "cancel the export" or "scrap
 * the 5% idea, make it 4" name something else, so the verb alone is not
 * enough; it has to point at what was just done.
 */
const UNDO_VERB = /\b(?:undo|revert|reverse|roll ?back|scrap|cancel|scratch|take (?:that|it|this) back|put (?:that|it|this|everything|them) back|change (?:that|it|this|them) back|set (?:that|it|this|them) back|go back to (?:what|how) it was)\b/i;
const AT_THE_CHANGE = /\b(?:that|it|this|the (?:last )?(?:change|edit|update)|what you (?:just )?(?:did|changed|made|set)|(?:the )?(?:change|edit) you (?:just )?made|your (?:last )?(?:change|edit))\b/i;
const NEW_VALUE = /\b(?:to|make it|set it to|instead)\s+\d/i;
const asksUndoPlainly = (said) => {
  const text = String(said ?? '');
  return UNDO_VERB.test(text) && AT_THE_CHANGE.test(text) && !NEW_VALUE.test(text);
};
// "undo that" names nothing, so the thing it undoes was named one message back.
const NAMES_NOTHING = /^\s*(?:please\s+)?(?:undo|revert)\s+(?:that|it|this)\b[\s.!?]*$/i;

const asksUndo = (said) => ASKS_UNDO.test(String(said ?? '')) || asksUndoPlainly(said);

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

module.exports = { asksUndo, asksUndoPlainly, undoSentence, USE_UNDO };
