const { PERSONA } = require('./prompts/persona');
const { masterSheetPrompt } = require('./prompts/masterSheet');
const { masterSheetTools } = require('./tools/masterSheet');
const { sharedTools } = require('./tools/shared');
// Its own file and its own list. A tool that can stop paying six people
// does not go in the 5,000 line one. See tools/monthlyReview.js.
const { monthlyReviewTools } = require('./tools/monthlyReview');
// Ending a deal, putting one back, and reading the Archive.
const { closureTools } = require('./tools/closure');
// Many companies at once: the tidy up, and the one that ends them.
const { companyTools } = require('./tools/companies');
// The dead list, read only. See tools/deadPeople.js.
const { deadPeopleTools } = require('./tools/deadPeople');
// Work parked for a later month, and the standing list of it.
const { scheduledTools, withWhen } = require('./tools/parkForMonth');
const { withDisabled } = require('./disabledTools');
// What she says she can do, BUILT from the list below rather than written
// out in the prompt. See capabilities.js: she offered an export she cannot
// do and left out half of what she can.
const { capabilityBlock } = require('./capabilities');

/**
 * Diane's working contexts — the ONE place the mapping from a selected
 * workspace to its prompt and its tools lives.
 *
 * The rule this exists to enforce: in any given request Diane gets the
 * tools for exactly one workspace. Not "all the tools plus an instruction
 * about which to use" — another workspace's tools are physically absent
 * from the request, so acting on the wrong table isn't something she has
 * to be trusted to avoid. It's impossible.
 *
 * Down to one context after the refactor. The expensing/cash/bank
 * workspaces existed because `calculator_rows` was a separate table Diane
 * could edit independently; that table is gone (migration 022) and those
 * three are now just filtered VIEWS of the deals she already has full
 * CRUD over here. Three contexts over one table would have been three
 * ways to describe the same tools.
 *
 * Adding a workspace later is one entry here plus one tools file.
 * runAgent.js never needs to know how many there are.
 */

const CONTEXTS = {
  'master-sheet': {
    label: 'Master sheet',
    // TAKES THE TOOLS, so the capability block describes the list she is
    // actually handed this request and not a sentence somebody wrote once.
    prompt: (tools) => `${PERSONA}\n\n${masterSheetPrompt({
      exporting: tools.some((t) => t.name === 'export_sheet' && !t.disabledTool),
    })}\n\n${capabilityBlock(tools)}`,
    // WRAPPED HERE, so a tool that is off is off in every context that
    // offers it. See disabledTools.js: they keep their file and their
    // tests, and only the handler stops doing the thing.
    tools: () => withDisabled(withWhen([
      ...masterSheetTools, ...monthlyReviewTools, ...closureTools, ...companyTools, ...deadPeopleTools,
      ...scheduledTools, ...sharedTools,
    ])),
  },
};

/**
 * ***************************************************
 * * WHAT THE FIRST ROUND DOES NOT CARRY
 * ***************************************************
 *
 * His call 2026-09-29, and his own diagnosis: the context is overloaded.
 * Measured, it is 39 tools and ~21,000 tokens of schema on EVERY round of
 * every turn, before a word of the conversation. `bulk_update_master_sheet`
 * alone is 15% of it.
 *
 * ---- split by RISK, not by verb ----
 *
 * He proposed a context per CRUD operation. That cut does not survive his
 * own transcripts: "add 100 to zayn milkman" calls a READ to find the deal
 * and then an UPDATE, in one turn. Any verb-shaped context either breaks
 * that request or hands the lookup back, at which point it is the big
 * context again. And a router picking the context up front faces the same
 * ambiguity she does.
 *
 * So the line is what a tool can REACH, which needs no router:
 *
 *   held    it changes many rows at once, or it destroys, renames or
 *           reverses something
 *   round 1 everything else, which is every read and every one deal write
 *
 * ---- and she is never told they do not exist ----
 *
 * `capabilityBlock` is built from ALL the tools, held ones included, so
 * what she can DO does not change between rounds. Calling a held one is
 * answered by the runtime with "it is there now, call it again" and the
 * next round carries it. That costs ONE round, only on the turns that need
 * it, and it is the reason this cannot become a false "I cannot do that":
 * the fault this whole session kept hitting.
 *
 * A NEW TOOL IS NOT HELD unless it is named here, so forgetting costs a
 * little schema and never a refusal.
 */
const HELD_UNTIL_NEEDED = Object.freeze([
  'bulk_update_master_sheet',
  'bulk_answer_monthly_review',
  'bulk_update_companies',
  'bulk_close_companies',
  'delete_master_sheet_row',
  'rename_company',
  'undo_master_sheet_change',
  'delete_past_conversations',
  // The general read: its schema rode on every turn for a few questions.
  'summarize_deals',
]);

/** The first round's tools: everything that is not held back. */
const openingTools = (tools) => tools.filter((t) => !HELD_UNTIL_NEEDED.includes(t.name));

const DEFAULT_CONTEXT = 'master-sheet';

function isValidContext(name) {
  return Object.prototype.hasOwnProperty.call(CONTEXTS, name);
}

/**
 * @returns {{ key: string, label: string, prompt: string, tools: object[] }}
 */
function resolveContext(name) {
  const key = isValidContext(name) ? name : DEFAULT_CONTEXT;
  const ctx = CONTEXTS[key];
  // BUILT ONCE and handed to the prompt. Calling `ctx.tools()` twice would
  // let the block describe one list while she is given another.
  const tools = ctx.tools();
  return { key, label: ctx.label, prompt: ctx.prompt(tools), tools };
}

module.exports = {
  resolveContext, isValidContext, CONTEXT_KEYS: Object.keys(CONTEXTS), DEFAULT_CONTEXT,
  HELD_UNTIL_NEEDED, openingTools,
};
