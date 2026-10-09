const test = require('node:test');
const assert = require('node:assert');
const { judgeGroups, decisionOf, otherOf, mergeDecisions } = require('./groupJudge');
const { readGroupAnswers } = require('./runPlan');

/**
 * HER JUDGEMENT OF THE GROUPS, proved without a paid call: the model's
 * answer is stood in for, and what OUR half does with it is checked.
 */
const clientSaying = (groups) => ({
  chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ groups }) } }] }) } },
});
const FOUND = {
  unfamiliar: [{ name: 'RIDGE', people: 8, newcomers: 3, rows: 8, shares: [{ group: 'NEXUS', shared: 5, of: 5 }] }, { name: 'HALCYON', people: 20, newcomers: 20, rows: 20, shares: [] }],
  ourSizes: { NEXUS: 5, MILKMAN: 4 }, inFile: ['MILKMAN'],
};

test('HER JUDGEMENT IS HELD TO THE FACTS: no made-up group, none of ours that is not ours, none skipped', async () => {
  const judged = await judgeGroups(FOUND, ['NEXUS', 'MILKMAN'], {
    client: clientSaying([
      { name: 'RIDGE', kind: 'renamed', ours: ['NEXUS'], sure: true, question: '' },
      { name: 'GHOST', kind: 'new', ours: [], sure: true, question: '' },
    ]),
  });
  assert.deepEqual(judged.map((j) => `${j.name}=${j.kind}${j.sure ? '' : '?'}`), ['RIDGE=renamed', 'HALCYON=new?'], 'GHOST dropped; HALCYON skipped by her, so asked');
  const odd = await judgeGroups(FOUND, ['NEXUS', 'MILKMAN'], {
    client: clientSaying([{ name: 'RIDGE', kind: 'renamed', ours: ['INVENTED'], sure: true, question: '' }, { name: 'HALCYON', kind: 'new', ours: [], sure: true, question: '' }]),
  });
  assert.equal(odd[0].kind, 'new', 'a rename to a group we do not have is not taken');
  assert.equal(odd[0].sure, false);
});

test('WHEN SHE CANNOT BE ASKED, the rules decide (null), and a file with no unfamiliar group asks nothing', async () => {
  const broken = { chat: { completions: { create: async () => { throw new Error('down'); } } } };
  assert.equal(await judgeGroups(FOUND, ['NEXUS'], { client: broken }), null);
  assert.deepEqual(await judgeGroups({ unfamiliar: [] }, ['NEXUS'], { client: broken }), []);
});

test('WHAT HER JUDGEMENT MEANS to the check, and what "no" means', () => {
  assert.deepEqual(mergeDecisions(decisionOf({ name: 'RIDGE', kind: 'renamed', ours: ['NEXUS'] })), { aliases: {}, renames: { RIDGE: ['NEXUS'] }, notRenamed: [], dropGroups: [] });
  assert.deepEqual(mergeDecisions(decisionOf({ name: 'Milk Grp', kind: 'ours', ours: ['MILKMAN'] })).aliases, { 'Milk Grp': 'MILKMAN' });
  assert.deepEqual(mergeDecisions(decisionOf({ name: 'HALCYON', kind: 'new', ours: [] })).renames, {}, 'judged: no rename by the 60% rule either');
  assert.deepEqual(mergeDecisions(otherOf({ name: 'RIDGE', kind: 'renamed', ours: ['NEXUS'] })).notRenamed, ['RIDGE']);
  assert.equal(mergeDecisions({ aliases: { A: 'B' } }).renames, null, 'without her judgement the rules still rename');
});

test('THEIR ANSWER TO HER QUESTION: yes is her guess, no is the other reading, "leave it out" drops it', () => {
  const j = { name: 'SUMMIT', kind: 'renamed', ours: ['MANBAT'] };
  const qs = [{ kind: 'ai', name: 'SUMMIT', judged: 'renamed', like: 'MANBAT', text: 'SUMMIT: …', yes: decisionOf(j), no: otherOf(j) }];
  const base = mergeDecisions(decisionOf({ name: 'HALCYON', kind: 'new', ours: [] }));
  assert.deepEqual(readGroupAnswers('yes', qs, base).decided.renames, { SUMMIT: ['MANBAT'] });
  assert.deepEqual(readGroupAnswers('no its a new group', qs, base).decided.notRenamed, ['HALCYON', 'SUMMIT']);
  assert.deepEqual(readGroupAnswers('nope', qs, base).decided.notRenamed, ['HALCYON', 'SUMMIT']);
  assert.deepEqual(readGroupAnswers('leave summit out', qs, base).decided.dropGroups, ['SUMMIT']);
  assert.equal(readGroupAnswers('hmm', qs, base).decided, null, 'not an answer: asked again');
});

test('HER VERDICT HELD TO THE FACTS: a slip holding a missing group is that group; half a missing group is never "new" in silence', async () => {
  const found = {
    unfamiliar: [
      { name: 'MIKLMAN', people: 20, newcomers: 0, rows: 22, shares: [{ group: 'MILKMAN', shared: 20, of: 22 }], looksLike: { group: 'MILKMAN', kind: 'a slip of the same name' } },
      { name: 'MANBAT 2', people: 9, newcomers: 6, rows: 9, shares: [{ group: 'MANBAT', shared: 3, of: 5 }], looksLike: { group: 'MANBAT', kind: 'a different name built on it' } },
      { name: 'RIDGE', people: 8, newcomers: 5, rows: 8, shares: [{ group: 'NEXUS', shared: 3, of: 6 }] },
    ],
    inFile: ['INDIGO'],
  };
  const judged = await judgeGroups(found, ['MILKMAN', 'MANBAT', 'NEXUS', 'INDIGO'], {
    client: clientSaying([
      { name: 'MIKLMAN', kind: 'renamed', ours: ['MILKMAN'], sure: true, question: '' },
      { name: 'MANBAT 2', kind: 'new', ours: [], sure: true, question: '' },
      { name: 'RIDGE', kind: 'renamed', ours: ['NEXUS'], sure: true, question: '' },
    ]),
  });
  const by = Object.fromEntries(judged.map((j) => [j.name, j]));
  assert.deepEqual([by.MIKLMAN.kind, by.MIKLMAN.sure], ['ours', true], 'a slip is ours, never a rename to the typo');
  assert.deepEqual([by['MANBAT 2'].kind, by['MANBAT 2'].sure], ['new', false], 'half of missing MANBAT: asked');
  assert.match(by['MANBAT 2'].question, /^MANBAT 2: 3 of MANBAT's 5 people, plus 6 new, and MANBAT is not in the file\. I'd add it as a new group\. Right, or MANBAT renamed\?$/);
  assert.deepEqual(mergeDecisions(otherOf(by['MANBAT 2'])).renames, { 'MANBAT 2': ['MANBAT'] }, '"no" is MANBAT renamed');
  assert.equal(by.RIDGE.sure, false, 'renamed with half of NEXUS: asked');
});

test('THE OTHER KIND SAID BARE is her other reading (upload test 2026-10-10)', () => {
  // eslint-disable-next-line global-require
  const { readGroupAnswers } = require('./runPlan');
  const asNew = [{ kind: 'ai', name: 'MANBAT 3', judged: 'new', like: 'MANBAT', groups: ['MANBAT'] }];
  assert.equal(readGroupAnswers('1 renamed', asNew).pick['MANBAT 3'], 'no');
  const asRenamed = [{ kind: 'ai', name: 'willow', judged: 'renamed', like: 'INDIGO', groups: ['INDIGO'] }];
  assert.equal(readGroupAnswers('1 renamed', asRenamed).pick.willow, 'guess');
  assert.equal(readGroupAnswers('1 new', asRenamed).pick.willow, 'new');
});

test('HER "NEW" GUESS WITH NO GROUP OF OURS: "renamed" is the group her question named, never a drop', () => {
  const q = [{ kind: 'ai', name: 'SAFFRON', judged: 'new', like: null, groups: ['MANBAT', 'INDIGO'], text: "SAFFRON: 3 of MANBAT's 5 people, plus 3 new. I'd take it as new. Right, or MANBAT renamed?" }];
  assert.deepEqual(readGroupAnswers('1 renamed', q).pick.SAFFRON, { judged: true, renames: { SAFFRON: ['MANBAT'] } });
  assert.deepEqual(readGroupAnswers('1 no', q).pick.SAFFRON, { judged: true, renames: { SAFFRON: ['MANBAT'] } });
  assert.equal(readGroupAnswers('1 new', q).pick.SAFFRON, 'new');
});
