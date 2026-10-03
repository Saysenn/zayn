const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveContext, openingTools, HELD_UNTIL_NEEDED } = require('./contexts');

/**
 * ***************************************************
 * * THE FIRST ROUND CARRIES LESS, AND SHE IS NEVER TOLD LESS
 * ***************************************************
 *
 * His call 2026-09-29. The context was 39 tools and ~21,000 tokens of
 * schema on EVERY round of every turn, before a word of the conversation.
 *
 * He proposed a context per CRUD verb. That cut does not survive his own
 * transcripts (one request calls a read then an update), so the line is
 * what a tool can REACH: bulk acts and the destructive ones wait until the
 * turn asks for one.
 *
 * THE DANGEROUS HALF IS NOT THE SAVING, IT IS THE SILENCE. A tool that is
 * absent from the schema and absent from what she believes she can do
 * becomes "I can't do that, darling" — the exact false limitation this
 * whole session was spent fixing. So the test that matters here is not the
 * byte count, it is that her capability block still describes every held
 * tool and that reaching for one HANDS IT OVER rather than refusing.
 */

const context = resolveContext('master-sheet');
const opening = openingTools(context.tools);
const size = (tools) => JSON.stringify(
  tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
).length;

test('EVERY HELD NAME IS A REAL TOOL', () => {
  // A misspelling here holds nothing back and nobody would notice.
  for (const name of HELD_UNTIL_NEEDED) {
    assert.ok(context.tools.some((t) => t.name === name), `${name} is not a tool`);
  }
});

test('AND EVERY ONE OF THEM IS A BULK ACT OR A DESTRUCTIVE ONE', () => {
  // The line is what it can REACH, not what verb it is. A one deal write
  // held back would cost a round on the commonest request there is.
  for (const name of HELD_UNTIL_NEEDED) {
    assert.match(
      name,
      /^bulk_|^delete_|^rename_|^undo_/,
      `${name} is neither bulk nor destructive, so holding it back only costs a round`,
    );
  }
});

test('THE OPENING SET IS EVERYTHING ELSE, and it is smaller', () => {
  assert.equal(opening.length, context.tools.length - HELD_UNTIL_NEEDED.length);
  for (const name of HELD_UNTIL_NEEDED) {
    assert.equal(opening.some((t) => t.name === name), false, `${name} is still in round one`);
  }
  // Worth having: under a tenth would not pay for the extra round it costs
  // on a bulk turn. Measured at 24% when this was written.
  const saved = 1 - size(opening) / size(context.tools);
  assert.ok(saved > 0.15, `only ${Math.round(saved * 100)}% saved, which does not pay for itself`);
});

test('EVERY READ AND EVERY ONE DEAL WRITE IS STILL IN ROUND ONE', () => {
  // The requests that make up most turns must never cost an extra round.
  for (const name of [
    'filter_master_sheet', 'total_master_sheet', 'find_and_show_details',
    'update_master_sheet_row', 'update_person', 'add_deal', 'stop_deal', 'resume_deal',
    'answer_monthly_review', 'list_monthly_review',
  ]) {
    assert.ok(opening.some((t) => t.name === name), `${name} must be there from the first round`);
  }
});

/**
 * ===============================
 * * AND THIS IS THE ONE THAT MATTERS
 * ===============================
 * Her capability block is built from ALL the tools, so what she believes
 * she can do does not change between rounds. Build it from the opening set
 * instead and she starts telling him the CRM cannot amend many deals.
 */
test('SHE STILL BELIEVES SHE CAN DO THE HELD THINGS', () => {
  const block = context.prompt.slice(context.prompt.indexOf('WHAT YOU CAN DO'));
  assert.ok(block.length > 0, 'the capability block is in the prompt');
  for (const [what, said] of [
    ['many deals at once', /amend one deal or many/i],
    ['undo', /undo a change/i],
    ['review many', /answer one deal or many/i],
    ['rename a company', /rename one/i],
    ['close several', /close or reopen one or several/i],
  ]) {
    assert.match(block, said, `she is no longer told she can ${what}`);
  }
});

test('AND THE BLOCK IS BUILT FROM ALL OF THEM, not the opening set', () => {
  // The seam where this would break silently: `resolveContext` hands the
  // prompt its tool list, and handing it the narrowed one would read as a
  // tidy one line change.
  const src = fs.readFileSync(path.join(__dirname, 'contexts.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /const tools = ctx\.tools\(\);[\s\S]*?prompt: ctx\.prompt\(tools\)/);
  assert.doesNotMatch(src, /ctx\.prompt\(openingTools/);
});

/**
 * ===============================
 * * A HELD TOOL IS HANDED OVER, never refused
 * ===============================
 * Falling through to "No such tool here" would be the false limitation
 * again, one layer down and harder to see.
 */
test('REACHING FOR A HELD TOOL WIDENS THE TURN', () => {
  const src = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
  // To the round's own bookkeeping, which is well past the branch. Ending
  // at `for (const call of calls)` cut it in half: the branch contains one.
  const from = src.indexOf('A HELD TOOL IS ANNOUNCED');
  const branch = src.slice(from, src.indexOf('same call twice in one round', from));

  assert.match(branch, /HELD_UNTIL_NEEDED\.includes\(c\.function\?\.name\)/);
  assert.match(branch, /roundTools = openAITools/, 'the rest of the turn carries everything');
  assert.match(branch, /IS AVAILABLE NOW/);
  assert.match(branch, /Nothing was done and nothing was `\s*\+ 'refused/);
  // ONLY ONCE. Widening every round would re-announce a tool she already has.
  assert.match(branch, /if \(!widened\)/);
  assert.match(branch, /widened = true/);
});

test('AND THE REQUEST ACTUALLY SENDS THE PER ROUND LIST', () => {
  // The whole saving is one word. `tools: openAITools` would compile, pass
  // every test above, and send the full schema every round.
  const src = fs.readFileSync(path.join(__dirname, 'runAgent.js'), 'utf8');
  assert.match(src, /^\s*tools: roundTools,$/m);
  assert.doesNotMatch(src, /^\s*tools: openAITools,$/m);
  assert.match(src, /let roundTools = openingAITools/);
});
