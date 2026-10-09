/**
 * ***************************************************
 * * AUTO MODE: the confirmation she may skip, and the ones she never may
 * ***************************************************
 *
 * His call 2026-09-29, and he named the shape himself: Claude Code's
 * shift-tab. "put 5% to zayn on milkman" should land, not open a dialogue.
 *
 * ---- what this actually turns off ----
 *
 * ONE THING: the PREVIEW. `confirmFirst` returns null when `confirmed` is
 * true, so auto mode sets that flag and the handler runs. Every guard the
 * tool carries still runs, because they are not the preview:
 *
 *   resolvePerson    two people is still a question
 *   notAPerson       a name that is really a group is still corrected
 *   wrongMonthAsked  a month this write cannot reach is still refused
 *   checkFigures, checkCounts, notTwice, the whole family
 *
 * That is the whole design. Auto mode removes the SECOND look at a change
 * the admin already described; it does not remove a single thing that
 * stops her acting on a request she has not understood.
 *
 * ---- and why this is an ALLOW list ----
 *
 * A DENY list makes the next tool auto-confirmable by being forgotten, and
 * the tool after that, forever. The failure mode of forgetting has to be
 * "it asks one time too many", never "it deleted a row nobody saw".
 *
 * So a tool is on this list only when all four are true, and `everyRule`
 * below is the test, not the prose:
 *
 *   1. ONE ROW, named by the admin in the request itself.
 *   2. It does not STOP, close, dissolve or delete anything.
 *   3. It is undoable from History, field by field.
 *   4. The admin can see what happened afterwards on the screen they are on.
 *
 * `update_master_sheet_row` and `update_person` pass. Nothing else does
 * today, and adding one is a decision somebody makes on purpose here.
 */

const { fold, personMentionedIn } = require('./tools/resolvePerson');

const MAY_SKIP = Object.freeze([
  // One deal, named. Every field it writes is logged and undoable.
  'update_master_sheet_row',
  // One person's own profile. Same shape, same log.
  'update_person',
]);

/**
 * ===============================
 * * AND THREE THINGS OVERRULE THE LIST
 * ===============================
 * Belt and braces, deliberately. The list is the decision; these are the
 * properties the tool declares about itself, so a tool that GAINS the
 * ability to stop something stops being auto-confirmable without anybody
 * remembering to take it off the list.
 */
function mayAutoConfirm(name, tool, { on }) {
  if (!on) return false;
  return couldSkip(name, tool);
}

/**
 * ===============================
 * * EVERYTHING EXCEPT THE SETTING, so the setting is rarely read
 * ===============================
 * Asked BEFORE the settings query rather than after it. Thirty three of
 * the forty tools can never skip a confirmation whatever the setting says,
 * and reading a database row to discover that on every one of their calls
 * is a round trip for a foregone answer.
 *
 * It also shrinks what the setting can affect. Any code path that cannot
 * reach a tool on the list is unaffected by auto mode entirely, which is
 * one fewer thing behaving differently depending on a row.
 */
function couldSkip(name, tool) {
  if (!MAY_SKIP.includes(name)) return false;
  // It ends somebody's pay. Never, whatever the list says.
  if (tool?.stops) return false;
  // It cannot hear `confirmed`, so there is no preview to skip and setting
  // the flag would only put an argument it does not know into the call.
  if (!tool?.parameters?.properties?.confirmed) return false;
  return true;
}

/**
 * ===============================
 * * THE OFFER, MADE ONCE AND ONLY AFTER A REAL ONE
 * ===============================
 * Offered after a confirmation the admin ACTUALLY gave, for a change that
 * auto mode would have skipped. Asking before they have ever confirmed
 * anything is asking them to sign off on a shape they have not seen.
 *
 * IT IS NOT A SENTENCE SHE SAYS. The web renders it as its own bubble with
 * two buttons, and Yes calls the settings route. A spoken offer would mean
 * her next turn reading "yes" as either an answer to this or a
 * confirmation of a write, which is the ambiguity `confirmReplay` exists
 * to keep out of writes. A button cannot be misheard.
 */
function autoConfirmOffer({ on, tool, name, replayed }) {
  if (on) return null;
  if (!replayed) return null;
  if (!MAY_SKIP.includes(name)) return null;
  if (tool?.stops) return null;
  return { kind: 'autoConfirm', tool: name };
}

/**
 * ===============================
 * * A CHANGE THEY SPELLED OUT IN FULL
 * ===============================
 * The admin's call 2026-10-06, auto mode on: "add 50 to all zayn deals"
 * still asked "shall I go ahead?". It names what moves in their own words,
 * and it is undoable from History. So the per person change skips the
 * preview when every person in it is named here and it says all, both,
 * every or each of their deals, or names the company. A group, a company
 * filter or "everyone" still asks.
 *
 * AN UNDO ALWAYS ASKS which changes it puts back, their call the same day:
 * skipped, "undo the last 2 changes" put back all seven of the session.
 *
 * A bare "both" names nobody, so it still asks: it may mean the deal that
 * already changed a moment ago, and a preview is what stops it twice.
 */
// "ALL/EVERY/BOTH ... DEALS" said in words, never "in all groups": ALL
// GROUPS is a group, and reading it as "every deal" skipped the preview on
// four deals (test sweep 2026-10-07).
const EVERY_OF_THEIRS = {
  test: (text) => /\b(?:all|both|every|each)\b(?:\s+(?:of\s+)?(?:his|her|their|the)?)?(?:\s+\w+['’]?s?)?\s+deals?\b|\beverywhere\b|\b(?:\w+['’]s|his|her|their)\s+deals\b|\bboth\s+of\s+\w+|\b(?:all|both|each|every\s+one)\s+of\s+(?:his|her|their|the|\w+['’]?s?)\s+deals?\b/i
    .test(String(text ?? '').replace(/\ball\s+groups?\b/gi, ' ')),
};
// A key that ends, stops or reviews a deal is never skipped, whatever was said.
const ENDS_A_DEAL = /stop|end|status|close|delete|archive|review/i;
const PER_PERSON_ONLY = new Set(['perPerson', 'confirmed', 'said', 'saidRecent', 'turn', 'onProgress', 'priorAnswer']);

/**
 * "BOTH" TO HER OWN "WHICH GROUP, OR BOTH?" The admin's call 2026-10-09,
 * auto mode on: "add 100 to zayn" → "which group, or both?" → "both" still
 * asked "shall I go ahead and make both changes?". Nothing had changed yet
 * (she asked before writing), so their answer IS the every-deal they spell
 * out. Only a bare answer counts, and only to a question that offered it.
 */
const ALL_ANSWER = /^(?:(?:yes|yeah|yep|ok|okay)[,\s]+)?(?:both|all)(?:\s+(?:of\s+(?:them|their\s+deals)|groups?|deals?|pls|please))?[.!\s]*$/i;
function answeredAll(asked, reply) {
  return /\b(?:both|all)\b[^?]*\?\s*$/i.test(String(asked ?? '').trim()) && ALL_ANSWER.test(String(reply ?? '').trim());
}

/**
 * THE PERSON'S OWN SWITCHES (his call 2026-10-08: Should be paid and Paid are
 * the person's, set on People for every live deal). "mark kiran vale paid"
 * names every deal of hers by meaning, so it is spelled out (library PAY-010,
 * auto on, 2026-10-10: it asked, then a stray call asked "which group?").
 */
const PERSON_LEVEL = new Set(['overridePaid', 'overrideShouldBePaid']);
const personLevel = (e) => !e.add && Object.keys(e.set ?? {}).length > 0 && Object.keys(e.set).every((k) => PERSON_LEVEL.has(k));

function spelledOut(name, tool, args, said, { allAnswered = false } = {}) {
  if (tool?.stops || !tool?.parameters?.properties?.confirmed) return false;
  const text = String(said ?? '');
  if (name !== 'bulk_update_master_sheet') return false;
  const entries = args?.perPerson;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (Object.keys(args).some((k) => !PER_PERSON_ONLY.has(k))) return false;
  return entries.every((e) => e?.person && personMentionedIn(text, e.person)
    && Object.keys(e.set ?? {}).every((k) => !ENDS_A_DEAL.test(k))
    && (e.company ? fold(text).includes(fold(e.company)) : e.allDeals === true && (allAnswered || EVERY_OF_THEIRS.test(text) || personLevel(e))));
}

module.exports = {
  mayAutoConfirm, couldSkip, spelledOut, answeredAll, autoConfirmOffer, MAY_SKIP,
};
