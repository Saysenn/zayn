// ***************************************************
// * A QUESTION ABOUT THE DATA IS ANSWERED FROM A TOOL
// ***************************************************
// "who is up for review in ZZTEST?" was answered "Nobody" with no tool call;
// three were. Then "which companies are in liquidation?" named two, with no
// tool call; none are. 2026-09-28. Figure, count and card guards cannot see
// a list of names nobody looked up, so the rule is on the turn itself.

const { isSetInstruction } = require('./setIntent');

// Their message asks something: a question mark, or a question word first.
const ASKS = /\?\s*$|^\s*(?:who|what|which|how|is|are|does|do|did|has|have|any|anyone|anybody|list|show)\b/i;
// About the business, not about her: "what can you do?" and "how are you" are not.
const ABOUT_DATA = /\b(?:back ?ups?|deals?|compan(?:y|ies)|people|person|group|sheet|owed?|owing|paid|pay(?:ing|able)?|totals?|amounts?|review|stopped|archive|dead list|rates?|fees?|add ons?|concerns?|flagged|liquidation|dissolved|closed|tier|status|preset|months?|cash|bank|crypto|handlers?|roles?)\b/i;
const EMPTY = /\b(?:nobody|no one|no-one|nothing|none|no (?:deals?|people|person|rows?|one|changes?)|there (?:is|are) no)\b/i;

/**
 * @param {string} reply what she is about to say
 * @param {{ said: string, toolCount: number }} turn their message, and how many
 *   tools ran this turn
 * @returns {boolean} true when a question about the data has no tool behind the answer
 */
function answeredFromMemory(reply, { said, toolCount }) {
  if (toolCount > 0) return false;
  const text = String(said ?? '');
  // AN INSTRUCTION has its own guards (setIntent, claimedWrite): judged here as well,
  // "stop Bram's deal" cost a round and "delete Suki" was sent to the dead list.
  if (isSetInstruction(text)) return false;
  // A REQUEST NEED NOT BE A QUESTION: "back up status" got an invented "it passes
  // its checksum" with no tool; the backup is not even configured. 2026-09-28.
  if (ABOUT_DATA.test(text)) return true;
  return ASKS.test(text) && EMPTY.test(String(reply ?? ''));
}

module.exports = { answeredFromMemory };
