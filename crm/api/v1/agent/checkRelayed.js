// ***************************************************
// * A DEAL SHE LEFT OUT OF THE LIST SHE WAS ASKED TO RELAY
// ***************************************************
//
// `confirmFirst` sends `lines` when a COUNT is not enough to judge by: a
// mixed act ("this one final, that one ended") cannot be confirmed from a
// number, because a single wrong line is invisible in it. Its summary ends
// "Relay the block above EXACTLY as written, every line", and that is a
// sentence. Observed 2026-09-23: given a three person block she wrote her
// own sentence instead. That one kept every name and every value, so it
// was fine; nothing checks that the next one will be.
//
// ===============================
// * IT CHECKS THE FACTS, NOT THE WORDING
// ===============================
// Demanding the block verbatim would fire on every correct answer. She
// writes "Quillon Marsh's payable days to 10" where the block says
// "Quillon Marsh: payable days to \"10\" (1 row)", and that is the same
// list read aloud. What must not happen is a LINE GOING MISSING.
//
// So each line's names and figures have to appear in the reply. A rephrase
// passes. A dropped person, or a value she quietly rounded, does not.
//
// Same comparison as confirmReplay, and deliberately the same one: both
// ask "did she say this to the admin", and two answers to that would
// disagree about the same money. See confirmReplay.js `facts`.
const { facts } = require('./confirmReplay');

/**
 * The list the admin was meant to be shown, or null.
 *
 * THE LAST ONE WINS. A turn that produced two pending lists has already
 * failed a different way, and the one she is answering is the latest.
 */
function linesShown(toolResults = []) {
  /**
   * EVERY PENDING LIST THIS TURN, not the last one. "his monthly 1600 and
   * mark him paid" is two previews for one person, both held, and one yes
   * applies both. She showed only the paid line, and the monthly change
   * went through unseen. gpt-4.1 messy sweep, 2026-10-06. A list that is
   * not pending (already done) is a report, and the last of those wins.
   */
  const pending = toolResults.filter((r) => r?.pending && Array.isArray(r.lines) && r.lines.length > 0);
  if (pending.length > 1) return pending.flatMap((r) => r.lines);
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const lines = toolResults[i]?.lines;
    if (Array.isArray(lines) && lines.length > 0) return lines;
  }
  return null;
}

/**
 * @param {string} reply what she is about to say
 * @param {object[]} toolResults every tool result from this turn
 * @returns {{ ok: boolean, missing: string[] }} `missing` is the lines
 *   whose facts are not all in the reply.
 */
function checkRelayed(reply, toolResults = []) {
  const lines = linesShown(toolResults);
  if (!lines) return { ok: true, missing: [] };

  const said = facts(reply);
  const missing = lines.filter((line) => {
    const want = facts(line);
    // A line with nothing identifiable in it cannot be checked, so it is
    // never reported missing. There is no such line today.
    if (want.size === 0) return false;
    for (const fact of want) if (!said.has(fact)) return true;
    return false;
  });

  return { ok: missing.length === 0, missing };
}

module.exports = { checkRelayed, linesShown };
