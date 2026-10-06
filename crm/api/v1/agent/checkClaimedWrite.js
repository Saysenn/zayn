// ***************************************************
// * "IT WAS INCREASED" WITH NOTHING WRITTEN
// ***************************************************
//
// 2026-09-25. "add 4% more to bram okafor's fee", she asked for a yes with
// no tool call, heard "yes", and said "Bram Okafor's profile fee was
// increased by 4%". Nothing was written. A yes turn that wrote nothing may
// not say something changed.

const { agreed } = require('./confirmReplay');

// A change reported as made. Checked per sentence, never across them.
const DONE = /\b(?:is now|are now|(?:was|were|has been|have been) (?:just |now |already )?(?:set|increased|raised|changed|updated|removed|reduced|lowered|put back|undone|reverted|applied|added|cleared|ended|stopped|closed|archived|answered|made|marked|moved)|all done|all set|(?:is|are|was|were) kept (?:running|going)|answered (?:yes|no|final) for|(?:marked|set) (?:as |to )?(?:final|yes|no)\b|(?:is|are) back (?:live|on)|(?:is|are) back (?:to|on) (?:their|its|the|his|her) (?:original|previous|old|earlier|former)|(?:was|were|has been|have been) (?:rolled|put|set) back|(?:was|were|has been|have been) (?:resumed|reinstated|brought back|renamed))\b/i;
// First person, past tense: a write she says she made.
const I_DID = /\bI(?:'ve| have| just)\s+(?:just\s+)?(?:added|set|marked|made|changed|updated|stopped|ended|closed|removed|applied|put|raised|lowered|reduced|increased|resumed|reinstated|brought|renamed|undone|reverted)\b/i;
// A deal KEPT is a write whatever they said: "ZZ Close Co" alone got "Ines's deal
// at ZZ Close Co is kept running", nothing written, not even up for review. 2026-09-25.
const KEPT = /\b(?:is|are|was|were) kept (?:running|going)\b/i;
// "Nothing was changed", "already on 5%", "would be set": not a claim.
const NOT_A_CLAIM = /\b(?:nothing|not|no|already|would|will|if)\b/i;

/**
 * @param {string} reply what she is about to say
 * @param {{ said: string, wrote: boolean }} turn their message, and whether
 *   anything was actually written this turn
 */
function claimedWrite(reply, { said, wrote }) {
  if (wrote) return false;
  const sentences = String(reply ?? '').split(/(?<=[.!?])\s+/);
  // HER OWN ACT, on any turn: "I've added 500 to Suki's payable" beside a
  // question about Ines, with nothing written. 2026-09-25.
  if (sentences.some((s) => (I_DID.test(s) || KEPT.test(s)) && !NOT_A_CLAIM.test(s))) return true;
  if (!agreed(said)) return false;
  return sentences.some((s) => DONE.test(s) && !NOT_A_CLAIM.test(s));
}

// A STOP OR AN ARCHIVE is only true when a tool that stops deals wrote. "Stop her
// deal" once wrote Should be paid = No and was reported as moved to the Archive. 2026-09-28.
const STOPPED = /\b(?:(?:is|are|was|were|has been|have been|is now|are now) (?:stopped|ended|archived)|moved (?:it |them )?(?:in)?to the archive)\b/i;

/**
 * @param {string} reply what she is about to say
 * @param {{ wrote: boolean, stopped: boolean }} turn whether anything wrote, and whether a
 *   tool that stops deals did. A read answer about a past stop is history, never a claim.
 */
function claimedStop(reply, { wrote, stopped }) {
  if (!wrote || stopped) return false;
  return String(reply ?? '').split(/(?<=[.!?])\s+/)
    .some((s) => STOPPED.test(s) && !NOT_A_CLAIM.test(s));
}

module.exports = { claimedWrite, claimedStop };
