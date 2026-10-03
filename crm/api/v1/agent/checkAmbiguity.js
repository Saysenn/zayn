/**
 * ***************************************************
 * * Did she invent the question she asked?
 * ***************************************************
 *
 * Live 2026-09-17. "There are several Richards on the sheet. Could you tell
 * me which one you mean." There is ONE Richard, on one row. Two turns later
 * she drew his card and said "Richard has one deal", and asked which one he
 * was again on the turn after that.
 *
 * NO TOOL SAID IT. `searchFuzzy("Richard")` returns a single row and
 * `resolvePerson` returns `ambiguous: false` for every sentence in that
 * conversation, checked against the live sheet. She composed the refusal.
 *
 * ===============================
 * * EVERY OTHER GUARD HERE CATCHES HER CLAIMING SHE DID SOMETHING
 * ===============================
 * `checkClaims` catches a change she did not make, `checkFigures` a number
 * no tool produced, `notTwice` a paragraph she already said. Nothing was
 * watching the opposite shape: a refusal she was never handed.
 *
 * It is the worse half of the pair. A wrong figure is at least an answer
 * somebody can challenge; an invented ambiguity ends the turn, sends the
 * admin looking for a second person who does not exist, and cannot be
 * argued with because the data it describes is not there to check.
 *
 * ===============================
 * * WHAT MAKES IT SAFE TO CHECK
 * ===============================
 * A genuine ambiguity always comes from a tool, because she cannot resolve
 * a name herself: `resolvePerson` is the one exit and every refusal built
 * on it now carries `ambiguous: true`. So the question is simply whether
 * any tool this turn reported one.
 *
 * NARROW ON PURPOSE. Only a reply that says there are SEVERAL PEOPLE, or
 * asks WHICH of them is meant. "Which company did you mean" is a real
 * question about a row she holds, and it is not this.
 *
 * REPORTS, never rewrites. Same as every other check here.
 */

/**
 * She says a name reaches more than one PERSON.
 *
 * The noun list is people only. A first draft ended in `\w+s` and flagged
 * "Richard has three deals and they are all on screen", which is the
 * correct answer to an ordinary question: every count of anything matched.
 */
const SEVERAL = new RegExp(
  '\\b(?:several|multiple|more than one|two|three|a few|number of)\\b[^.;!?]{0,30}?'
  + '\\b(?:people|persons?|of them)\\b',
  'i',
);

// Or asks them to pick between people. "Which ONE" and "which of them" are
// the shapes she actually used; "which company" is not, and must not be.
const WHICH_ONE = /\bwhich\s+(?:one|of (?:them|these|those)|person)\b/i;

// The plural possessive she reached for: "there are several Richards".
// A NAME made plural is the tell, and it is what no tool ever produced.
// Deliberately NOT case insensitive past the first word: the capital is
// what makes it a name rather than "there are three deals".
const PLURAL_NAME = /\b[Tt]here (?:are|is)\b[^.;!?]{0,20}\b[A-Z][a-z]+s\b/;

/** Did any tool this turn actually report an ambiguity? */
function toolSawOne(toolResults = []) {
  return toolResults.some((r) => r && typeof r === 'object' && r.ambiguous === true);
}

/** Does the reply claim one, or ask them to resolve one? */
function claimsOne(reply) {
  const text = String(reply ?? '');
  if (!text) return false;
  return SEVERAL.test(text) || WHICH_ONE.test(text) || PLURAL_NAME.test(text);
}

/**
 * @param {string} reply what she is about to say
 * @param {object[]} toolResults every tool result from this turn
 * @returns {{ ok: boolean, invented: boolean }}
 */
function checkAmbiguity(reply, toolResults = []) {
  /**
   * NOTHING RAN IS NOT PROOF OF ANYTHING HERE.
   *
   * A turn with no tool call at all is usually her answering the admin's
   * own follow up ("which one did you mean?" about the list she just
   * offered), and flagging that would fire on the correct half of every
   * ambiguity conversation. The fault being caught is a refusal invented
   * on the back of a LOOKUP, so a lookup has to have happened.
   */
  if (toolResults.length === 0) return { ok: true, invented: false };
  if (toolSawOne(toolResults)) return { ok: true, invented: false };
  const invented = claimsOne(reply);
  return { ok: !invented, invented };
}

module.exports = {
  checkAmbiguity, claimsOne, toolSawOne, SEVERAL, WHICH_ONE,
};
