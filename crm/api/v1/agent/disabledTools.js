// ***************************************************
// * Tools Diane still has, and still must not finish
// ***************************************************

/**
 * TURNED OFF, NOT TAKEN OUT. His call 2026-09-09. Every one of these keeps
 * its file, its tests, its panel and its wiring; only the handler stops
 * doing the thing. Re-enabling is deleting an entry here.
 *
 * ===============================
 * * A SENTENCE IN THE PROMPT IS NOT A SWITCH
 * ===============================
 * The obvious version of this is a line in MASTER_SHEET_PROMPT telling her
 * not to export. That is the exact shape every guard in `v1/agent/` exists
 * because of: `checkFigures`, `notTwice`, `resolvePerson`, the length
 * retry. When tempted to fix behaviour with a sentence, ask what catches it
 * when the sentence is ignored.
 *
 * So the HANDLER refuses. She can call the tool as often as she likes and
 * nothing is built and no row is written, which means she cannot tell the
 * admin she did it either: there is no card and no form to point at.
 *
 * The description is changed as well, but only to save a round trip. It is
 * the cheap half; the handler is the guard.
 *
 * ===============================
 * * THE WORDS ARE HIS, NOT HERS AND NOT MINE
 * ===============================
 * Handed back FINISHED, the same rule a tool computing a figure follows.
 * A refusal she has to compose is a refusal that drifts: it went soft, then
 * arrogant, then sweet across three turns the last time a persona rule was
 * left to the prompt.
 */

/**
 * `new_deal_checklist` is in here with `add_deal` because it IS the add
 * flow: it puts the form on screen and the form is what she submits. Left
 * on its own it would offer a form that nothing can complete.
 *
 * `edit_deal_form` and `fill_form` are NOT disabled. Editing an existing
 * row is untouched, and fill_form types into whatever form is open, which
 * is now only ever an edit form.
 */
/**
 * ===============================
 * * SHE POINTS. SHE DOES NOT OFFER TO DO IT.
 * ===============================
 * The first draft of both lines said "I can show you the crm export modal"
 * and "I can show you the crm add deal form". She cannot: opening either is
 * something she has never been able to do, and the add deal form is the
 * exact thing `new_deal_checklist` used to put up, which is now off. So the
 * sentence promised the disabled feature back and left the admin waiting
 * for a screen that never came.
 *
 * These name a REAL BUTTON on a real page instead, and describe something
 * the admin does rather than something she does. `Export` and `Add deal`
 * are both on the Master sheet toolbar; `Master sheet` is that page's own
 * nav label. If any of those three are renamed, rename them here.
 */
/**
 * THE BUTTON NAMES, ONCE. They were spelled out in the refusal, again in
 * CANNOT, and a guard checking she actually pointed at one would have been
 * a third copy. Renaming a button is this edit and no other.
 */
const EXPORT_BUTTON = 'Export';
const ADD_BUTTON = 'Add deal';
const SHEET_PAGE = 'Master sheet';

/**
 * ADDING A DEAL CAME BACK ON 2026-09-29 (his test list expects it). EXPORT
 * WENT BACK OFF the same day, his call: the Export button does it. Turning
 * one off is a line here, and in CANNOT and POINTS_AT below.
 */
const DISABLED = {
  export_sheet: `I can't export a sheet for you honey, that one is not mine any more. Hit `
    + `the ${EXPORT_BUTTON} button at the top of the ${SHEET_PAGE} page and you will have your `
    + 'file faster than I could ever build it.',
};

/** The button each refusal sends them to, for the guard below. */
const POINTS_AT = Object.freeze({
  export_sheet: EXPORT_BUTTON,
});

/**
 * ===============================
 * * THE SAME FACT, SHORT ENOUGH TO PUT IN A LIST
 * ===============================
 * The refusals above are what she SAYS when one is called. This is what
 * she must never OFFER, and it belongs beside them so a tool turned off
 * gets both halves in one edit.
 *
 * It exists because she offered one anyway: asked what she could help
 * with, she said "even helping with exports". Found 2026-09-22. See
 * capabilities.js, which builds her answer from this.
 *
 * Two names, one phrase: adding a deal and its checklist ARE the same act,
 * exactly as their refusals are the same sentence.
 */
const CANNOT = Object.freeze({
  export_sheet: `export a sheet (the ${EXPORT_BUTTON} button on the ${SHEET_PAGE} page does it)`,
});

/**
 * What the model is told, so she usually answers without spending a call.
 * The handler still refuses if she calls it anyway.
 */
function describe(reason) {
  return `TURNED OFF. This tool does nothing and cannot be made to work. Do not call it. `
    + `Reply with exactly this and nothing after it: "${reason}"`;
}

/**
 * What she gets back when she calls it regardless. The sentence, then the
 * one instruction that stops the usual recovery behaviour: trying a
 * neighbouring tool, or narrating a workaround nobody asked for.
 */
function refuse(reason, name) {
  return {
    summary: `${reason} Say exactly that line and stop. Nothing was done and nothing is on `
      + 'screen, so do not claim otherwise, do not try another tool, and do not offer to do '
      + 'it a different way.',
    // MARKED, so a guard can check she did. "Say exactly that line" is a
    // sentence, and refused an export she answered "say go or build it and
    // I'll start it": a pending export, invented, for a tool that is off.
    // Found 2026-09-24. See checkPointed.
    disabled: name,
  };
}

/**
 * @param {object[]} tools the context's own list
 * @param {object} [disabled] name to refusal; the live list unless a test passes one
 * @returns {object[]} the same list, with the disabled ones neutered
 */
function withDisabled(tools, disabled = DISABLED) {
  return tools.map((tool) => {
    const reason = disabled[tool.name];
    if (!reason) return tool;
    return {
      ...tool,
      description: describe(reason),
      // ON THE TOOL, so the gates in invokeTool can stand aside. The export
      // intent gate ran FIRST and answered "NO EXPORT CARD WAS OPENED",
      // which implies exports exist. They do not.
      disabledTool: true,
      // The parameters stay as they are. A tool that refuses does not need
      // to validate what it was given, and changing the shape would break
      // the tests that pin it for the day it comes back.
      handler: async () => refuse(reason, tool.name),
    };
  });
}

/** For tests and for anything that needs to know what is off. */
const DISABLED_TOOLS = Object.freeze(Object.keys(DISABLED));

/**
 * ===============================
 * * DID SHE POINT, OR PROMISE?
 * ===============================
 * The refusal ends "Say exactly that line and stop". Refused an export she
 * said "You want the bank master sheet for all groups in September, got
 * it! But I need you to say go or build it to start the export": a pending
 * export described in detail, for a tool that does nothing, one turn after
 * being told nothing was done and nothing is on screen.
 *
 * SHE POINTS AT A BUTTON. That is the whole of the reply, so the check is
 * whether the button is in it. Her own wording is fine; the pointer is not
 * optional, because without it the admin is left waiting for her.
 *
 * @returns {{ ok: boolean, tool: string|null, button: string|null }}
 */
function checkPointed(reply, toolResults = [], pointsAt = POINTS_AT) {
  const said = String(reply ?? '');
  for (const result of toolResults) {
    const name = result?.disabled;
    const button = pointsAt[name];
    if (!button) continue;
    /**
     * THE PHRASE, NOT THE WORD. Checking for "Export" alone passed the
     * very sentence this guard was written for: "say go or build it to
     * start the export" contains it. A BUTTON is what she is pointing at,
     * so the word "button" is the pointer and the bare verb is not.
     */
    const pointer = `${button} button`.toLowerCase();
    if (!said.toLowerCase().includes(pointer)) return { ok: false, tool: name, button };
  }
  return { ok: true, tool: null, button: null };
}

module.exports = {
  withDisabled, DISABLED_TOOLS, DISABLED, CANNOT, POINTS_AT, checkPointed,
};
