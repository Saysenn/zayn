const test = require('node:test');
const assert = require('node:assert/strict');
const { masterSheetTools, monthsAsked } = require('./masterSheet');
const { answerEach, listAsked, perGroup } = require('./answerEach');

/**
 * ***************************************************
 * * A QUESTION CAN BE PLURAL. THE ARGUMENT HAS TO BE TOO.
 * ***************************************************
 *
 * Two questions, one turn apart, one right and one wrong:
 *
 *   "Give me the total of Gloria plus Gloria Difference"   correct
 *   "How much does Nicola owe for August and September"    wrong
 *
 * Not because one is harder. Because `people` was an array and `month` was
 * a string. Somebody thought about several people; nobody thought about
 * several months. One call could not carry two months, so a two month
 * question needed two calls, nothing said so, and she filled the gap.
 *
 * THIS TEST IS THE POINT OF THE FIX, more than the array is. A tool added
 * next year with a singular `month` reopens the whole class silently, and
 * the only thing that can notice is a rule that reads the schemas.
 */

/**
 * A dimension a question can name several SUBJECTS of. Where a tool accepts
 * one of these at all, it has to accept a list.
 *
 * SUBJECTS ONLY, and the distinction is the whole design. Asking about two
 * people wants TWO answers, kept apart. Asking about cash AND bank wants
 * ONE answer over a wider filter. `answerEach` is right for the first and
 * flatly wrong for the second, which would hand back two totals where one
 * was asked for. Plural FILTER VALUES need `ANY` in the query instead, and
 * are listed at the foot of this file rather than enforced here.
 */
const PLURAL_DIMENSIONS = [
  { one: 'person', many: 'people' },
  { one: 'month', many: 'months' },
  { one: 'group', many: 'groups' },
];

/**
 * SINGULAR ON PURPOSE, and the reason has to survive next to it.
 *
 * Two entries, and each earns its place:
 *
 *   export_sheet:month   an export is one file for one month, picked
 *                        through the export session's own guided step.
 *                        "Several months" is not a bigger argument there,
 *                        it is a different feature.
 *
 *   update_person:person a WRITE. Plural reads are free; a plural write is
 *                        a bulk write, and this codebase already decided
 *                        what those need: the two call `confirmed` shape
 *                        `bulk_update_master_sheet` uses. Widening this
 *                        one to a list would be a bulk write with no
 *                        confirmation step, which is the opposite of the
 *                        rule. If it is ever wanted, it is wanted WITH
 *                        that shape.
 */
const SINGULAR_BY_DESIGN = new Set([
  'export_sheet:month',
  // THE EXPORT'S SHEET IS ONE MONTH'S FILE, like export_sheet: several
  // months is several files, not one picture.
  'show_sheet_preset:month',
  // A RATE IS FOR ONE MONTH. "What was August's rate" has one answer, saved
  // with that month's snapshot; several months is several rates and that is
  // a history question for compare_months, not a rate lookup.
  'exchange_rate:month',
  'update_person:person',
  // The same write rule, on the group side. Each of these is a WRITE, and a
  // plural write is a bulk write: it gets the two call `confirmed` shape or
  // it does not get a list.
  'update_person:group',
  'bulk_update_master_sheet:group',
  'undo_master_sheet_change:group',
  // A DELETE cannot be undone from here, so its scope is one group and one
  // company. The PEOPLE are plural, which is where the bulk of it lives:
  // several groups at once is the widest possible unrecoverable act.
  'delete_master_sheet_row:group',
  'delete_master_sheet_row:company',
  // ONE TRANSCRIPT IS SHOWN (2026-10-04): the filters only find the one
  // conversation, so several people or months is a recall question.
  'show_past_conversation:person',
  'show_past_conversation:month',
  // A DELETE FOR GOOD, scoped the same way: the preview lists every
  // conversation it would remove, and before/after already span months.
  'delete_past_conversations:person',
  'delete_past_conversations:month',
]);

/**
 * ===============================
 * * THE GAPS THIS RULE FINDS
 * ===============================
 *
 * Written down rather than allowlisted away. The assertion below compares
 * the gap set EXACTLY, so this list can only be wrong in two ways and both
 * of them fail:
 *
 *   a NEW tool ships with a singular argument   -> unexpected entry, fails
 *   one of these is fixed and left listed       -> stale entry, fails
 *
 * So it cannot become a dumping ground, and it cannot quietly outlive the
 * work. See docs/todo.md.
 */
// EMPTY, and that is the assertion. Every plural SUBJECT a tool accepts
// takes a list. The comparison below is exact, so the next tool that ships
// with a singular one fails here rather than in a live answer.
const KNOWN_GAPS = [];

const propsOf = (tool) => tool.parameters?.properties ?? {};

test('EVERY TOOL THAT TAKES A DIMENSION TAKES SEVERAL OF IT', () => {
  const gaps = [];

  for (const tool of masterSheetTools) {
    const props = propsOf(tool);
    for (const { one, many } of PLURAL_DIMENSIONS) {
      if (!props[one]) continue;
      if (SINGULAR_BY_DESIGN.has(`${tool.name}:${one}`)) continue;
      if (!props[many]) {
        gaps.push(`${tool.name} takes \`${one}\` but not \`${many}\``);
        continue;
      }
      assert.equal(
        props[many].type,
        'array',
        `${tool.name}: \`${many}\` must be an array, not ${props[many].type}`,
      );
    }
  }

  assert.deepEqual(
    gaps.sort(),
    [...KNOWN_GAPS].sort(),
    'the set of plural gaps changed. Close it and remove it from KNOWN_GAPS, or add the new '
    + 'one with a reason. A question can be plural here and the argument cannot.',
  );
});

test('the total tool declares both, and both are arrays', () => {
  // Named directly as well as by the rule above, so deleting the rule does
  // not silently delete the coverage with it.
  const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');
  assert.ok(total, 'total_master_sheet is gone');
  assert.equal(propsOf(total).people?.type, 'array');
  assert.equal(propsOf(total).months?.type, 'array');
});

test('`months` tells her never to reuse one month for another', () => {
  // The wrong half of the Nicola answer was "the same rows apply as for
  // August", so the instruction against it lives on the argument she reads.
  const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');
  const said = propsOf(total).months.description;
  assert.match(said, /never call this tool once per month/i);
  assert.match(said, /never reuse one month/i);
});

/* ---- which months actually come out of the argument ---- */

test('monthsAsked keeps only YYYY-MM', () => {
  assert.deepEqual(monthsAsked({ months: ['2026-08', '2026-09'] }), ['2026-08', '2026-09']);
  assert.deepEqual(monthsAsked({ months: ['august', '2026-13', '', null, '2026-9'] }), []);
});

test('deduped and sorted, so the answer does not depend on how they said it', () => {
  assert.deepEqual(
    monthsAsked({ months: ['2026-09', '2026-08', '2026-09'] }),
    ['2026-08', '2026-09'],
  );
});

test('no months at all is not a multi month call', () => {
  assert.deepEqual(monthsAsked({}), []);
  assert.deepEqual(monthsAsked({ months: 'august' }), []);
  assert.deepEqual(monthsAsked({ month: '2026-08' }), []);
});

test('the admin words repair a model call that dropped or guessed a month', () => {
  assert.deepEqual(
    monthsAsked({
      said: 'total of Nicola last August and this month',
      months: ['2023-08', '2024-09'],
    }, '2026-09'),
    ['2026-08', '2026-09'],
  );
  assert.deepEqual(
    monthsAsked({ said: 'how much does Zayn owe last month and this month', month: '2026-09' }, '2026-09'),
    ['2026-08', '2026-09'],
  );
  assert.deepEqual(
    monthsAsked({ said: 'last August and this September' }, '2026-09'),
    ['2026-08', '2026-09'],
  );
});

test('an internal single month answer does not split the original sentence again', () => {
  assert.deepEqual(
    monthsAsked({
      said: 'how much does Zayn owe last month and this month',
      month: '2026-08',
      answeredPlural: 'months',
    }, '2026-09'),
    [],
  );
});

/* ---- the three gaps this file found, now closed ---- */

test('the three tools the rule caught all take a list now', () => {
  // Named as well as covered by the rule, so deleting the rule does not
  // silently delete the coverage. Each of these was a gap the schema scan
  // found rather than a bug anybody hit.
  const closed = [
    ['active_companies', 'months'],
    ['check_rates', 'people'],
    ['recall_past_conversations', 'people'],
  ];
  for (const [name, many] of closed) {
    const tool = masterSheetTools.find((t) => t.name === name);
    assert.ok(tool, `${name} is gone`);
    assert.equal(propsOf(tool)[many]?.type, 'array', `${name} lost \`${many}\``);
  }
});

/* ---- several groups, answered separately ---- */

test('all six read tools that take a group take a list of them', () => {
  const six = [
    'filter_master_sheet', 'total_master_sheet', 'active_companies',
    'check_rates', 'recall_past_conversations', 'list_concerns',
  ];
  for (const name of six) {
    const tool = masterSheetTools.find((t) => t.name === name);
    assert.ok(tool, `${name} is gone`);
    assert.equal(propsOf(tool).groups?.type, 'array', `${name} lost \`groups\``);
  }
});

test('SEPARATE, never combined, and the argument says so', () => {
  // Decided 2026-09-03. Leaving the group out already answers the combined
  // question, so this one had no answer at all until now.
  const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');
  const said = propsOf(total).groups.description;
  assert.match(said, /never added\s+together/i);
  assert.match(said, /leave both this and `group` out/i);
});

test('perGroup answers each group and keeps the rest of the question', async () => {
  const seen = [];
  const wrapped = perGroup({
    name: 'fake',
    parameters: { type: 'object', properties: { group: { type: 'string' } } },
    handler: async (a) => { seen.push(a); return { summary: `total for ${a.group}` }; },
  });

  const out = await wrapped.handler({ groups: ['MILKMAN', 'INDIGO'], month: '2026-08' });
  assert.deepEqual(seen.map((a) => a.group), ['INDIGO', 'MILKMAN'], 'deduped and sorted');
  assert.deepEqual(seen.map((a) => a.groups), [undefined, undefined], 'or it recurses');
  assert.deepEqual(seen.map((a) => a.month), ['2026-08', '2026-08'], 'the rest is carried');
  assert.match(out.summary, /total for INDIGO/);
  assert.match(out.summary, /total for MILKMAN/);
});

test('ONE group in the list is just the ordinary question', async () => {
  const seen = [];
  const wrapped = perGroup({
    name: 'fake',
    parameters: { type: 'object', properties: { group: { type: 'string' } } },
    handler: async (a) => { seen.push(a); return { summary: 'x' }; },
  });

  await wrapped.handler({ groups: ['INDIGO'] });
  assert.equal(seen[0].group, 'INDIGO');
  assert.equal(seen[0].groups, undefined);
  // And no sections wrapper, because there is only one answer.
  assert.equal((await wrapped.handler({ groups: ['INDIGO'] })).summary, 'x');
});

test('the exact group in the sentence repairs a different valid model group', async () => {
  const peopleRepo = require('../../repos/people.repo');
  const original = peopleRepo.filterOptions;
  peopleRepo.filterOptions = async () => ({ groups: ['MANBAT', 'MILKMAN'], companies: [] });
  const seen = [];
  const wrapped = perGroup({
    name: 'fake',
    parameters: { type: 'object', properties: { group: { type: 'string' } } },
    handler: async (a) => { seen.push(a); return { summary: a.group }; },
  });
  try {
    await wrapped.handler({ group: 'MILKMAN', said: 'show the MANBAT group total' });
    assert.equal(seen[0].group, 'MANBAT');
  } finally {
    peopleRepo.filterOptions = original;
  }
});

/* ---- one at a time, never merged ---- */

test('answerEach runs the SAME handler once per value', async () => {
  const seen = [];
  const out = await answerEach({
    values: ['2026-08', '2026-09'],
    singular: 'month',
    plural: 'months',
    args: { months: ['2026-08', '2026-09'], person: 'Nicola' },
    handler: async (a) => { seen.push(a); return { summary: `owed for ${a.month}` }; },
    guidance: 'SEPARATE MONTHS',
  });

  assert.deepEqual(seen.map((a) => a.month), ['2026-08', '2026-09']);
  // The plural argument is cleared, or the handler recurses forever.
  assert.deepEqual(seen.map((a) => a.months), [undefined, undefined]);
  // Everything else is carried, or each section answers a different question.
  assert.deepEqual(seen.map((a) => a.person), ['Nicola', 'Nicola']);
  assert.match(out.summary, /SEPARATE MONTHS/);
  assert.match(out.summary, /owed for 2026-08/);
  assert.match(out.summary, /owed for 2026-09/);
});

test('computed month sentences can end the turn without model rewording', async () => {
  const out = await answerEach({
    values: ['2026-08', '2026-09'],
    singular: 'month',
    plural: 'months',
    args: {},
    handler: async ({ month }) => ({ summary: month, say: `Owed for ${month}.` }),
    guidance: 'Use both.',
    terminal: true,
  });

  assert.equal(out.reply, 'Owed for 2026-08.\n\nOwed for 2026-09.');
  assert.equal(out.computedReply, true);
});

test('listAsked cleans, dedupes and sorts whatever arrives', () => {
  assert.deepEqual(listAsked(['  Zayn ', 'Paddy', 'Zayn']), ['Paddy', 'Zayn']);
  assert.deepEqual(listAsked(['a', '', null, undefined]), ['a']);
  assert.deepEqual(listAsked('not an array'), []);
  assert.deepEqual(listAsked(undefined), []);
});

/**
 * ===============================
 * * THE OTHER HALF: PLURAL FILTER VALUES, WHICH NEED A DIFFERENT FIX
 * ===============================
 *
 * These take an ARRAY because a question can name several. The fix is not
 * `answerEach`: "cash and bank" is one total over a wider filter, not two
 * totals. Exact values use ANY and date categories use one OR group.
 *
 *   paymentMethod   filter_master_sheet, total_master_sheet
 *   currency        filter_master_sheet, total_master_sheet
 *   status          filter_master_sheet, total_master_sheet, list_concerns
 *   searchField     filter_master_sheet, total_master_sheet
 *   presetWhen      filter_master_sheet, total_master_sheet
 *   paymentStartWhen filter_master_sheet, total_master_sheet
 *   endWhen         filter_master_sheet, total_master_sheet
 *   source          filter_master_sheet, total_master_sheet
 *
 * Three dimensions that were missing are direct array filters now too. A
 * missing filter is worse than a singular one because she reaches for the
 * nearest column and answers confidently from the wrong fact.
 *
 *   company, roleLabel, tier
 *
 * Recorded here because this test reads the schemas and fails on drift.
 */
test('every filter value that can be plural is an array', () => {
  // These stay ONE query and one answer. The repository widens them with
  // ANY or an OR group; answerEach would answer a different question.
  const FILTER_PLURALS = {
    paymentMethod: ['filter_master_sheet', 'total_master_sheet'],
    currency: ['filter_master_sheet', 'total_master_sheet'],
    status: ['filter_master_sheet', 'total_master_sheet', 'list_concerns'],
    searchField: ['filter_master_sheet', 'total_master_sheet'],
    presetWhen: ['filter_master_sheet', 'total_master_sheet'],
    paymentStartWhen: ['filter_master_sheet', 'total_master_sheet'],
    endWhen: ['filter_master_sheet', 'total_master_sheet'],
    source: ['filter_master_sheet', 'total_master_sheet'],
  };

  for (const [arg, tools] of Object.entries(FILTER_PLURALS)) {
    for (const name of tools) {
      const props = propsOf(masterSheetTools.find((t) => t.name === name));
      assert.equal(props[arg]?.type, 'array', `${name}.${arg} cannot carry several values`);
      assert.equal(props[arg]?.items?.type, 'string', `${name}.${arg} has no string items`);
    }
  }

  // The three that used to have no read filter at all.
  const reads = ['filter_master_sheet', 'total_master_sheet'];
  for (const arg of ['company', 'roleLabel', 'tier']) {
    for (const name of reads) {
      const props = propsOf(masterSheetTools.find((t) => t.name === name));
      assert.equal(props[arg]?.type, 'array', `${name} cannot filter by several ${arg} values`);
      assert.equal(props[arg]?.items?.type, 'string');
    }
  }
});
