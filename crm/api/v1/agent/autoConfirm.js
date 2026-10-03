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

module.exports = { mayAutoConfirm, couldSkip, autoConfirmOffer, MAY_SKIP };
