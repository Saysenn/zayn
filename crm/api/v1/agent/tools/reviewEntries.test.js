const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * ONE MESSAGE, MANY SCOPES, DIFFERENT ANSWERS
 * ***************************************************
 *
 * The review is dictated:
 *
 *   zayn milkman final
 *   zayn indigo continue
 *   paddy workforce ended
 *   close everything in manbat
 *
 * Every scope existed and every answer was ONE value across all of them,
 * so that was four calls, four confirmations and nothing to undo as one
 * act. The entry is keyed on the DEAL, not the person: Zayn wants
 * different answers in two groups.
 */

const deal = (over = {}) => ({
  id: 1,
  person_id: 'zayn',
  person_name: 'Zayn',
  group_name: 'MILKMAN',
  company: 'Milkman Ltd',
  role_label: 'Developer',
  monthly_amount: 4000,
  currency: 'AED',
  end_on: '2026-01-01',
  liquidation: false,
  answer: null,
  ...over,
});

const QUEUE = [
  deal({ id: 1, group_name: 'MILKMAN', company: 'Milkman Ltd' }),
  deal({ id: 2, group_name: 'INDIGO', company: 'Acqua' }),
  deal({
    id: 3, person_id: 'paddy', person_name: 'Paddy', group_name: 'INDIGO', company: 'Workforce', role_label: 'Admin', monthly_amount: 500, currency: 'GBP',
  }),
  deal({
    id: 4, person_id: 'nicola', person_name: 'Nicola', group_name: 'MANBAT', company: 'Kryptonia', role_label: 'Mid 1', monthly_amount: 500, currency: 'GBP',
  }),
  deal({
    id: 5, person_id: 'gary', person_name: 'Gary', group_name: 'MANBAT', company: 'KP', role_label: 'KP', monthly_amount: 6250, currency: 'GBP',
  }),
  // Four Workforce deals for one person, in four groups. The reason the
  // list had to start naming the group.
  deal({
    id: 6, person_id: 'gloria', person_name: 'Gloria', group_name: 'INDIGO', company: 'Workforce', role_label: 'Closer', monthly_amount: 500, currency: 'GBP',
  }),
  deal({
    id: 7, person_id: 'gloria', person_name: 'Gloria', group_name: 'MILKMAN', company: 'Workforce', role_label: 'Closer', monthly_amount: 500, currency: 'GBP',
  }),
];

function loadTool({ rows = QUEUE, failOn = [] } = {}) {
  const toolPath = require.resolve('./monthlyReview.js');
  const repoPath = require.resolve('../../repos/monthlyReview.repo.js');
  // THE QUEUE MOVED BEHIND A HELPER, because it prints money and had to
  // start paying the rates. See shared/reviewQueue.helper.js.
  const queuePath = require.resolve('../../shared/reviewQueue.helper.js');
  for (const p of [toolPath, repoPath, queuePath]) delete require.cache[p];

  const wrote = [];
  const real = jest();
  require.cache[repoPath] = stub({
    ANSWERS: real.ANSWERS,
    STOPS_AT: real.STOPS_AT,
    async answerOne(id, period, answer) {
      if (failOn.includes(id)) throw new Error('nope');
      wrote.push({ id, answer });
      return { stoppedOn: real.STOPS_AT[answer](period) };
    },
  });

  // The real queue filters in SQL. A stub that ignored group and company
  // would let the single value path look like it reached every row, so
  // the test would pass on a tool that was broken.
  require.cache[queuePath] = stub({
    async dueThisMonth(period, opts = {}) {
      const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
      return rows.filter((r) => (opts.answered === false ? !r.answer : true))
        .filter((r) => (opts.group ? same(r.group_name, opts.group) : true))
        .filter((r) => (opts.company ? same(r.company, opts.company) : true));
    },
  });

  const tool = require(toolPath).monthlyReviewTools
    .find((t) => t.name === 'bulk_answer_monthly_review');
  return { tool, wrote };
}

// The real answer map, so the test cannot drift from what the three
// answers actually do to a date.
function jest() {
  const p = require.resolve('../../repos/monthlyReview.repo.js');
  const cached = require.cache[p];
  delete require.cache[p];
  // eslint-disable-next-line global-require
  const mod = require(p);
  const out = { ANSWERS: mod.ANSWERS, STOPS_AT: mod.STOPS_AT };
  if (cached) require.cache[p] = cached;
  return out;
}

const PERIOD_SAID = 'zayn milkman final, zayn indigo continue, paddy workforce ended';

test('THE FIRST CALL WRITES NOTHING and names every deal', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    entries: [
      { answer: 'final', person: 'Zayn', group: 'MILKMAN' },
      { answer: 'continue', person: 'Zayn', group: 'INDIGO' },
      { answer: 'ended', person: 'Paddy', company: 'Workforce' },
    ],
    said: PERIOD_SAID,
  });

  assert.equal(wrote.length, 0);
  assert.equal(out.pending, true);
  // Grouped by GROUP, and each line carries company, group and role so two
  // deals never read the same.
  assert.match(out.summary, /MILKMAN/);
  assert.match(out.summary, /INDIGO/);
  assert.match(out.summary, /Zayn, Milkman Ltd, MILKMAN, Developer/);
  assert.match(out.summary, /Zayn, Acqua, INDIGO, Developer/);
  assert.match(out.summary, /Paddy, Workforce, INDIGO, Admin/);
});

test('their own words are read: continue, ended, done, stop', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({
    entries: [
      { answer: 'continue', person: 'Zayn', group: 'INDIGO' },
      { answer: 'done', person: 'Paddy' },
    ],
    confirmed: true,
    said: 'zayn indigo continue, paddy done',
  });
  assert.deepEqual(
    wrote.sort((a, b) => a.id - b.id),
    [{ id: 2, answer: 'yes' }, { id: 3, answer: 'no' }],
  );
});

test('a word that is not an answer refuses the WHOLE message', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    entries: [
      { answer: 'final', person: 'Zayn', group: 'MILKMAN' },
      { answer: 'maybe', person: 'Paddy' },
    ],
    confirmed: true,
    said: 'go',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
});

// A group or company named with no person means the whole of it, which is
// what "close everything in manbat" says.
test('a scope with NO person answers all of it', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({
    entries: [{ answer: 'no', group: 'MANBAT' }],
    confirmed: true,
    said: 'close everything in manbat',
  });
  assert.deepEqual(wrote.map((w) => w.id).sort(), [4, 5]);
});

/**
 * ===============================
 * * A PERSON AIMING AT ONE DEAL AND MISSING
 * ===============================
 * Gloria holds Workforce in four groups. "gloria workforce ended" cannot
 * mean one of them, and answering all four off an unqualified name is the
 * bulk act wearing the single tool's face.
 */
test('a person plus a scope still reaching several ASKS, and writes nothing', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    entries: [{ answer: 'ended', person: 'Gloria', company: 'Workforce' }],
    confirmed: true,
    said: 'gloria workforce ended',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NEEDS A DECISION/);
  assert.match(out.summary, /reaches 2 deals/);
  assert.match(out.summary, /INDIGO/);
  assert.match(out.summary, /MILKMAN/);
});

test('and naming the group settles it', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({
    entries: [{ answer: 'ended', person: 'Gloria', company: 'Workforce', group: 'MILKMAN' }],
    confirmed: true,
    said: 'gloria workforce milkman ended',
  });
  assert.deepEqual(wrote, [{ id: 7, answer: 'no' }]);
});

/**
 * TWO ENTRIES, ONE DEAL, DIFFERENT ANSWERS. The real risk in a mixed
 * message: overlapping scopes where the admin did not notice they overlap.
 */
test('two entries disagreeing about one deal refuses, and names it', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    entries: [
      { answer: 'no', group: 'MANBAT' },
      { answer: 'final', person: 'Gary' },
    ],
    confirmed: true,
    said: 'close manbat, gary final',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /Gary/);
  assert.match(out.summary, /"no" and "final"|"final" and "no"/);
});

test('but the SAME answer twice is not a conflict', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({
    entries: [
      { answer: 'no', group: 'MANBAT' },
      { answer: 'ended', person: 'Gary' },
    ],
    confirmed: true,
    said: 'close manbat, gary ended too',
  });
  assert.deepEqual(wrote.map((w) => w.id).sort(), [4, 5], 'Gary written once, not twice');
});

// A miss is invisible in a count, so it is listed rather than dropped, and
// it does not abort the rest: they see the whole picture in one pass.
test('a fragment matching nothing is LISTED, and the rest still previews', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({
    entries: [
      { answer: 'final', person: 'Zayn', group: 'MILKMAN' },
      { answer: 'no', group: 'MILMAN' },
    ],
    said: 'zayn milkman final, close milman',
  });
  assert.match(out.summary, /MATCHED NOTHING/);
  assert.match(out.summary, /MILMAN/);
  assert.match(out.summary, /Zayn, Milkman Ltd/, 'the good half still shows');
});

/**
 * "Close manbat" and "close 3 of manbat" must not read the same, so the
 * rest of a group somebody named is listed as untouched.
 */
test('the deals NOT touched in a named group are listed too', async () => {
  const { tool } = loadTool();
  const out = await tool.handler({
    entries: [{ answer: 'ended', person: 'Nicola', group: 'MANBAT' }],
    said: 'nicola manbat ended',
  });
  assert.match(out.summary, /Nicola, Kryptonia, MANBAT/);
  assert.match(out.summary, /Gary, KP, MANBAT.*not touched/);
  assert.match(out.summary, /1 change, 1 untouched/);
});

test('CONFIRMED, each deal gets its own answer', async () => {
  const { tool, wrote } = loadTool();
  const out = await tool.handler({
    entries: [
      { answer: 'final', person: 'Zayn', group: 'MILKMAN' },
      { answer: 'continue', person: 'Zayn', group: 'INDIGO' },
      { answer: 'ended', person: 'Paddy', company: 'Workforce' },
    ],
    confirmed: true,
    said: 'go ahead',
  });
  assert.deepEqual(
    wrote.sort((a, b) => a.id - b.id),
    [{ id: 1, answer: 'final' }, { id: 2, answer: 'yes' }, { id: 3, answer: 'no' }],
  );
  assert.match(out.summary, /Answered 3 of 3 deals/);
});

test('a row that DID NOT TAKE is named, never averaged into a count', async () => {
  const { tool } = loadTool({ failOn: [3] });
  const out = await tool.handler({
    entries: [
      { answer: 'final', person: 'Zayn', group: 'MILKMAN' },
      { answer: 'ended', person: 'Paddy', company: 'Workforce' },
    ],
    confirmed: true,
    said: 'go',
  });
  assert.match(out.summary, /Answered 1 of 2/);
  assert.match(out.summary, /DID NOT TAKE/);
  assert.match(out.summary, /Paddy/);
});

/**
 * ===============================
 * * A SCOPE WORD IS TRIED AS BOTH, SO SHE NEVER HAS TO CLASSIFY IT
 * ===============================
 * Live 2026-09-18: "zayn milkman final" arrived with MILKMAN in `company`.
 * It is a group, there is no company of that name, and the entry was
 * reported back as "not up for review" while the deal sat in the queue.
 */
test('a GROUP name put in the company field still finds the deal', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({
    entries: [{ answer: 'final', person: 'Zayn', company: 'MILKMAN' }],
    confirmed: true,
    said: 'zayn milkman final',
  });
  assert.deepEqual(wrote, [{ id: 1, answer: 'final' }]);
});

test('and a COMPANY name put in the group field does too', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({
    entries: [{ answer: 'ended', person: 'Paddy', group: 'Workforce' }],
    confirmed: true,
    said: 'paddy workforce ended',
  });
  assert.deepEqual(wrote, [{ id: 3, answer: 'no' }]);
});

/**
 * ===============================
 * * "NOTHING UP FOR REVIEW" WAS A FALSE STATEMENT
 * ===============================
 * Live 2026-09-18: "Gloria at Workforce in MILKMAN final" filtered the
 * single tool's SQL by exact column, matched nothing, and she reported
 * "Gloria has nothing up for review this month". Gloria had four.
 */
test('the single tool matches a scope word against BOTH columns', async () => {
  const toolPath = require.resolve('./monthlyReview.js');
  const repoPath = require.resolve('../../repos/monthlyReview.repo.js');
  // THE QUEUE MOVED BEHIND A HELPER, because it prints money and had to
  // start paying the rates. See shared/reviewQueue.helper.js.
  const queuePath = require.resolve('../../shared/reviewQueue.helper.js');
  for (const p of [toolPath, repoPath, queuePath]) delete require.cache[p];
  const wrote = [];
  const real = jest();
  require.cache[repoPath] = stub({
    ANSWERS: real.ANSWERS,
    STOPS_AT: real.STOPS_AT,
    async answerOne(id, period, answer) {
      wrote.push({ id, answer });
      return { stoppedOn: real.STOPS_AT[answer](period) };
    },
  });
  require.cache[queuePath] = stub({ async dueThisMonth() { return QUEUE; } });
  const one = require(toolPath).monthlyReviewTools
    .find((t) => t.name === 'answer_monthly_review');

  // Company and group both given, and the group is where it belongs.
  const out = await one.handler({
    person: 'Gloria', company: 'Workforce', group: 'MILKMAN', answer: 'final', said: 'gloria at workforce in milkman final',
  });
  assert.deepEqual(wrote, [{ id: 7, answer: 'final' }], out.summary);
});

test('and a scope that misses says they DO have deals, not that they have none', async () => {
  const toolPath = require.resolve('./monthlyReview.js');
  const repoPath = require.resolve('../../repos/monthlyReview.repo.js');
  // THE QUEUE MOVED BEHIND A HELPER, because it prints money and had to
  // start paying the rates. See shared/reviewQueue.helper.js.
  const queuePath = require.resolve('../../shared/reviewQueue.helper.js');
  for (const p of [toolPath, repoPath, queuePath]) delete require.cache[p];
  const wrote = [];
  const real = jest();
  require.cache[repoPath] = stub({
    ANSWERS: real.ANSWERS,
    STOPS_AT: real.STOPS_AT,
    async answerOne(id, period, answer) { wrote.push({ id, answer }); return { stoppedOn: null }; },
  });
  require.cache[queuePath] = stub({ async dueThisMonth() { return QUEUE; } });
  const one = require(toolPath).monthlyReviewTools
    .find((t) => t.name === 'answer_monthly_review');

  const out = await one.handler({
    person: 'Gloria', company: 'Nowhere Ltd', answer: 'no', said: 'gloria at nowhere ended',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.doesNotMatch(out.summary, /nothing up for review/);
  assert.match(out.summary, /they DO have 2/);
});

test('the single value path is untouched by any of this', async () => {
  const { tool, wrote } = loadTool();
  await tool.handler({ answer: 'no', group: 'MANBAT', confirmed: true, said: 'close manbat' });
  assert.deepEqual(wrote.map((w) => w.id).sort(), [4, 5]);
});
