const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilityBlock, AREAS, INTERNAL } = require('./capabilities');
const { DISABLED_TOOLS, DISABLED, CANNOT } = require('./disabledTools');
const { resolveContext } = require('./contexts');

/**
 * ***************************************************
 * * SHE OFFERED AN EXPORT SHE CANNOT DO
 * ***************************************************
 *
 * Live 2026-09-22, asked what she could help with:
 *
 *   "...finding details, sorting out companies, and even helping with
 *    exports."
 *
 * She cannot export. `export_sheet` has been off since 2026-09-09 and its
 * description already says TURNED OFF in capitals. In the same sentence
 * she left out that she can change a company's STATUS, close one, and mark
 * which of its deals are reviewed every month.
 *
 * ONE FAULT, TWO SYMPTOMS: there was no list, so she answered from a
 * general sense of her job. She invented one capability and forgot three.
 */

const toolNames = () => resolveContext('master-sheet').tools.map((t) => t.name);

// ===============================
// * The completeness guard
// ===============================

/**
 * THE ONE THAT STOPS THIS COMING BACK. A hand written list in the prompt
 * would have been the same bug with a delay: the day a tool is added, the
 * sentence stops being true and nothing goes red.
 *
 * So every tool she holds is either claimed by an area, listed as internal,
 * or this test fails and names it.
 */
test('EVERY TOOL SHE HOLDS IS CLAIMED BY AN AREA, or named as internal', () => {
  const claimed = new Set([...AREAS.flatMap((a) => a.tools), ...INTERNAL, ...DISABLED_TOOLS]);
  const orphans = toolNames().filter((name) => !claimed.has(name));
  assert.deepEqual(
    orphans,
    [],
    'These tools exist and nothing says whether she can offer them:\n  '
    + `${orphans.join('\n  ')}\nAdd each to an AREA in capabilities.js, or to INTERNAL.`,
  );
});

/**
 * ===============================
 * * AND `INTERNAL` IS A CLOSED LIST, or it is a way to hide a capability
 * ===============================
 * The test above only asks that SOMETHING claims each tool, so moving a
 * real ability into INTERNAL silenced it and stayed green. That is this
 * whole incident in one edit: a capability that exists and is never said.
 *
 * Four names, each of them plumbing. Adding a fifth has to be deliberate
 * and has to go red here first.
 */
test('INTERNAL HOLDS THE PLUMBING AND NOTHING ELSE', () => {
  assert.deepEqual([...INTERNAL].sort(), ['edit_deal_form', 'fill_form', 'say', 'state_claims']);
});

/**
 * THE ONES SHE ACTUALLY LEFT OUT, named. Every tool that CHANGES a company
 * has to sit in an area: those are the abilities the live answer missed,
 * and they are the ones that move money.
 */
test('EVERY COMPANY WRITE IS AN ADVERTISED CAPABILITY', () => {
  const claimed = new Set(AREAS.flatMap((a) => a.tools));
  for (const name of ['update_company', 'bulk_update_companies', 'bulk_close_companies', 'rename_company']) {
    assert.ok(claimed.has(name), `${name} changes a company and she does not say she can`);
  }
});

test('AND NO AREA CLAIMS A TOOL THAT DOES NOT EXIST', () => {
  // An area whose tools have all been renamed prints a capability with
  // nothing behind it, which is the invented "exports" in another form.
  const live = new Set(toolNames());
  const ghosts = AREAS.flatMap((a) => a.tools).filter((name) => !live.has(name));
  assert.deepEqual(ghosts, [], `capabilities.js names tools nothing serves: ${ghosts.join(', ')}`);
});

test('AND NOTHING IS CLAIMED TWICE', () => {
  // Two areas holding one tool means she says the same ability twice, in
  // two different phrasings, in one answer.
  const all = [...AREAS.flatMap((a) => a.tools), ...INTERNAL];
  const seen = new Set();
  const twice = all.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
  assert.deepEqual(twice, []);
});

test('A DISABLED TOOL IS NEVER IN AN AREA', () => {
  // An area is what she OFFERS. Anything in DISABLED belongs in the second
  // half of the block, never the first.
  const claimed = new Set(AREAS.flatMap((a) => a.tools));
  for (const name of DISABLED_TOOLS) {
    assert.equal(claimed.has(name), false, `${name} is turned off and is offered as a capability`);
  }
});

// ===============================
// * What the block actually says
// ===============================

test('THE BLOCK REFUSES TO OFFER EXPORT, and offers adding a deal', () => {
  // Adding a deal back on 2026-09-29; export off again the same day.
  const block = capabilityBlock(resolveContext('master-sheet').tools);

  const [can, cannot] = block.split('WHAT YOU CANNOT DO');
  assert.ok(cannot, 'the block must have both halves');
  assert.doesNotMatch(can, /export/i, 'export is offered as something she can do');
  assert.match(cannot, /export a sheet/);
  assert.match(can, /add a new deal/);
  assert.doesNotMatch(cannot, /add a/);
});

test('AND IT NAMES THE COMPANY POWERS SHE LEFT OUT', () => {
  const block = capabilityBlock(resolveContext('master-sheet').tools);
  const can = block.split('WHAT YOU CANNOT DO')[0];

  // "sorting out companies" was the vague phrase that hid these. The two
  // that move money are the two that have to be said.
  assert.match(can, /liquidation/);
  assert.match(can, /close or reopen/);
  assert.match(can, /reviewed every month/);
  assert.match(can, /STATUS/);
});

test('THE TWO HALVES ARE BUILT FROM THE TOOL LIST, not written out', () => {
  // An area with no surviving tool is not printed. This is what makes
  // turning a whole area off a one line change rather than a prose edit.
  const only = [{ name: 'list_concerns' }, { name: 'export_sheet' }];
  const block = capabilityBlock(only);

  assert.match(block, /- concerns anybody has raised/);
  assert.doesNotMatch(block, /the monthly review:/, 'an area with no tools was still claimed');
  assert.match(block.split('WHAT YOU CANNOT DO')[1], /- export a sheet/, 'a held-but-disabled tool is still refused by name');
});

test('AND A TOOL SHE WAS NOT GIVEN IS NEITHER OFFERED NOR REFUSED', () => {
  // Absent is not the same as turned off. Refusing a tool she does not
  // hold would answer a question nobody could have asked.
  const block = capabilityBlock([{ name: 'list_concerns' }]);
  assert.doesNotMatch(block, /export a sheet/);
  assert.doesNotMatch(block, /add a deal/);
});

test('THE ADD DEAL PAIR IS ONE PHRASE, not the same line twice', () => {
  // `add_deal` and `new_deal_checklist` are one act, exactly as their
  // refusals are one sentence.
  const block = capabilityBlock([{ name: 'add_deal' }, { name: 'new_deal_checklist' }]);
  const lines = block.split('\n').filter((l) => l.includes('add a new deal'));
  assert.equal(lines.length, 1);
});

// ===============================
// * And it reaches her
// ===============================

test('THE BLOCK IS IN THE PROMPT SHE IS ACTUALLY SENT', () => {
  const { prompt } = resolveContext('master-sheet');
  assert.match(prompt, /WHAT YOU CAN DO\./);
  assert.match(prompt, /WHAT YOU CANNOT DO\./);
  // Built from the same call's tools, not a second resolve.
  const src = require('node:fs').readFileSync(require.resolve('./contexts'), 'utf8');
  assert.match(src, /const tools = ctx\.tools\(\);/);
  assert.match(src, /prompt: ctx\.prompt\(tools\), tools/);
});

test('EVERY REFUSAL HAS A SHORT PHRASE BESIDE IT', () => {
  // Both halves live in disabledTools.js so turning a tool off is one
  // edit. A refusal with no phrase would silently drop out of the block.
  for (const name of DISABLED_TOOLS) {
    assert.ok(CANNOT[name], `${name} has a refusal and no phrase for the capability list`);
    assert.ok(DISABLED[name], `${name} has a phrase and no refusal`);
  }
});
