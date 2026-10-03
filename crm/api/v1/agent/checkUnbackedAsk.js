// ***************************************************
// * A "SHALL I?" WITH NOTHING WAITING BEHIND IT
// ***************************************************
//
// 2026-09-25. "take 1% off suki" was asked in prose and the yes built the
// real preview, so the admin agreed twice. "add 99%" offered 104% past the
// cap. A question asking for a yes needs a pending change this turn.

const { isSetInstruction } = require('./setIntent');

const { asksRateCheck } = require('./askShapes');

// "Keep her review deal going" is an answer to write, like "end" is.
const KEEPS = /^\s*keep\b/i;
// A rate change with no verb: "99% to suki's add on" got "from 0% (or whatever
// it is now) to 99%?", nothing looked up. 2026-09-25.
const RATE_ASK = /\d+(?:\.\d+)?\s*%[^.?!]*\b(?:add[\s-]?ons?|fees?|rates?)\b|\b(?:add[\s-]?ons?|fees?|rates?)\b[^.?!]*\d+(?:\.\d+)?\s*%/i;

// Asking them to agree to something. "Which one?" is not this.
const ASKS_YES = /\b(?:shall|should|can|may) I\b[^?]*\?|\b(?:would you like|do you want|want) me to\b[^?]*\?|\b(?:go ahead|proceed|confirm(?: this| that| these| it)?)\s*\?/i;

/**
 * @param {string} reply what she is about to say
 * @param {{ said, pending, applied }} turn their words, and whether a tool
 *   made a pending change this turn or a held one was applied
 */
function unbackedAsk(reply, { said, pending, applied }) {
  if (pending || applied) return false;
  // A question they asked may end on an offer; only an instruction needs its pending.
  const text = String(said ?? '');
  const rateChange = RATE_ASK.test(text) && !asksRateCheck(text);
  if (!isSetInstruction(said) && !KEEPS.test(text) && !rateChange) return false;
  return ASKS_YES.test(String(reply ?? ''));
}

module.exports = { unbackedAsk, ASKS_YES };
