const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * THE MESSY MESSAGE IS THE FEATURE, SO IT IS TESTED LIKE ONE
 * ***************************************************
 *
 * His call 2026-09-18: she can take as long as she likes, but the review
 * has to be right. A wrong answer here stops somebody's income, and the
 * admin dictates it in one breath with no punctuation to speak of.
 *
 * Every case below is a real shape of instruction, not a tidy one.
 */

const deal = (over = {}) => ({
  id: 1,
  person_id: 'gloria',
  person_name: 'Gloria',
  group_name: 'INDIGO',
  company: 'Workforce',
  role_label: 'Closer',
  monthly_amount: 500,
  currency: 'GBP',
  end_on: '2026-01-01',
  liquidation: false,
  answer: null,
  ...over,
});

// One person, the same company, four groups. The shape that started this.
const QUEUE = [
  deal({ id: 1, group_name: 'INDIGO' }),
  deal({ id: 2, group_name: 'MANBAT' }),
  deal({ id: 3, group_name: 'MILKMAN' }),
  deal({ id: 4, group_name: 'NEXUS', role_label: 'Closure' }),
  deal({
    id: 5, person_id: 'zayn', person_name: 'Zayn', group_name: 'MILKMAN', company: 'Milkman Ltd', role_label: 'Developer', monthly_amount: 4000, currency: 'AED',
  }),
  deal({
    id: 6, person_id: 'gary', person_name: 'Gary', group_name: 'MANBAT', company: 'KP', role_label: 'KP', monthly_amount: 6250,
  }),
  deal({
    id: 7, person_id: 'nathan', person_name: 'Nathan', group_name: 'MANBAT', company: 'Kryptonia', role_label: 'Mid 1', monthly_amount: 500,
  }),
];

function realAnswers() {
  const p = require.resolve('../../repos/monthlyReview.repo.js');
  const cached = require.cache[p];
  delete require.cache[p];
  // eslint-disable-next-line global-require
  const mod = require(p);
  const out = { ANSWERS: mod.ANSWERS, STOPS_AT: mod.STOPS_AT };
  if (cached) require.cache[p] = cached;
  return out;
}

function load({ rows = QUEUE } = {}) {
  const toolPath = require.resolve('./monthlyReview.js');
  const repoPath = require.resolve('../../repos/monthlyReview.repo.js');
  // THE QUEUE MOVED BEHIND A HELPER, because it prints money and had to
  // start paying the rates. See shared/reviewQueue.helper.js.
  const queuePath = require.resolve('../../shared/reviewQueue.helper.js');
  for (const p of [toolPath, repoPath, queuePath]) delete require.cache[p];

  const wrote = [];
  const real = realAnswers();
  require.cache[repoPath] = stub({
    ANSWERS: real.ANSWERS,
    STOPS_AT: real.STOPS_AT,
    async answerOne(id, period, answer) {
      wrote.push({ id, answer });
      return { stoppedOn: real.STOPS_AT[answer](period) };
    },
  });

  // The real queue filters in SQL. Honoured here or a test would pass on
  // a tool that reached every row.
  require.cache[queuePath] = stub({
    // THE REAL PRECEDENCE, not a stub of it: which reason wins is exactly
    // what these tests are about.
    ...require('../../shared/reviewQueue.helper'),
    async dueThisMonth(period, opts = {}) {
      const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
      return rows.filter((r) => (opts.answered === false ? !r.answer : true))
        .filter((r) => (opts.group ? same(r.group_name, opts.group) : true))
        .filter((r) => (opts.company ? same(r.company, opts.company) : true));
    },
  });

  const tools = require(toolPath).monthlyReviewTools;
  return {
    bulk: tools.find((t) => t.name === 'bulk_answer_monthly_review'),
    one: tools.find((t) => t.name === 'answer_monthly_review'),
    list: tools.find((t) => t.name === 'list_monthly_review'),
    wrote,
  };
}

/**
 * ===============================
 * * THE THIRD REASON, AND THE ONLY ONE THAT IS PER DEAL
 * ===============================
 * His sheet writes "Reviewed monthly" on 12 deals. Until the flag existed
 * that word did the OPPOSITE of what it says: the queue asked whether the
 * end date had passed, so a null kept them out.
 *
 * It was also the only way to reach a single deal. A past end date is a
 * date, and liquidation is all or nothing across a company, so two deals
 * on a shared company could not be reached at all.
 */
test('the block header names HIS WORD, not a date that never passed', async () => {
  const { list } = load({
    rows: [deal({
      id: 1, end_on: null, review_monthly: true, end_note: 'Reviewed monthly', liquidation: false,
    })],
  });
  const out = await list.handler({});
  assert.match(out.summary, /his sheet says "Reviewed monthly"/);
  // Never "no end date": true, and it reads as something missing rather
  // than something he asked for.
  assert.doesNotMatch(out.summary, /no end date/);
});

/**
 * ===============================
 * * THE TICK SAYS WHETHER, THE COMPANY SAYS WHICH
 * ===============================
 * His word used to outrank liquidation, because liquidation was a fact
 * about the COMPANY and the queue swept in every deal on it. It is not any
 * more: a deal is here because somebody TICKED it, and the company's
 * status says whether that tick was a wind down or a review.
 *
 * So a ticked deal on a liquidating company reads as liquidation, and its
 * block sits under the Liquidation heading. His "Reviewed monthly" still
 * shows where it belongs, on the end date cell. His call 2026-09-21.
 */
test('a ticked deal on a liquidating company reads as liquidation', async () => {
  const { list } = load({
    rows: [deal({
      id: 1, end_on: '2026-01-01', review_monthly: true, end_note: 'Reviewed monthly', company_status: 'liquidation',
    })],
  });
  const out = await list.handler({});
  assert.match(out.summary, /in liquidation, ends 1 January 2026/);
  assert.match(out.summary, /^Liquidation \(1\)$/m, 'and its heading agrees');
});

test('and one with no company status reads as his word', async () => {
  const { list } = load({
    rows: [deal({
      id: 1, end_on: null, review_monthly: true, end_note: 'Reviewed monthly', company_status: null,
    })],
  });
  const out = await list.handler({});
  assert.match(out.summary, /his sheet says "Reviewed monthly"/);
  assert.match(out.summary, /^Marked for review \(1\)$/m);
});

/**
 * AND AN UNTICKED DEAL ON A LIQUIDATING COMPANY IS HERE FOR ITS DATE.
 * Saying "in liquidation" would name a reason that did not put it here:
 * nobody ticked it, so the wind down is not what is being asked about.
 */
test('an unticked deal is here for its date, whatever its company is doing', async () => {
  const { list } = load({
    rows: [
      deal({ id: 1, end_on: '2026-01-01', review_monthly: false, company_status: null }),
      deal({
        id: 2, person_id: 'x', person_name: 'Other', company: 'Kryptonia', end_on: '2025-01-01', review_monthly: false, company_status: 'liquidation',
      }),
    ],
  });
  const out = await list.handler({});
  assert.match(out.summary, /ended 1 January 2026/);
  assert.match(out.summary, /ended 1 January 2025/);
  assert.doesNotMatch(out.summary, /in liquidation/);
  assert.match(out.summary, /^Past a year \(2\)$/m);
});

// ===============================
// * THE WORDS THEY ACTUALLY USE
// ===============================
test('every word for each answer lands on the right one', async () => {
  const cases = {
    yes: ['yes', 'continue', 'ongoing', 'keep', 'running'],
    final: ['final', 'last'],
    no: ['no', 'ended', 'end', 'stop', 'stopped', 'done', 'close'],
  };
  for (const [want, words] of Object.entries(cases)) {
    for (const word of words) {
      const { bulk, wrote } = load();
      // eslint-disable-next-line no-await-in-loop
      await bulk.handler({
        entries: [{ answer: word, person: 'Gary' }], confirmed: true, said: `gary ${word}`,
      });
      assert.deepEqual(wrote, [{ id: 6, answer: want }], `"${word}" should mean ${want}`);
    }
  }
});

test('case and spacing do not matter', async () => {
  const { bulk, wrote } = load();
  await bulk.handler({
    entries: [{ answer: '  FINAL ', person: '  gary  ' }], confirmed: true, said: 'GARY FINAL',
  });
  assert.deepEqual(wrote, [{ id: 6, answer: 'final' }]);
});

// ===============================
// * THE SCOPE WORD, WHEREVER SHE PUTS IT
// ===============================
test('a group in the company field, a company in the group field, both work', async () => {
  for (const entry of [
    { answer: 'final', person: 'Zayn', company: 'MILKMAN' },
    { answer: 'final', person: 'Zayn', group: 'Milkman Ltd' },
    { answer: 'final', person: 'Zayn', group: 'MILKMAN', company: 'Milkman Ltd' },
  ]) {
    const { bulk, wrote } = load();
    // eslint-disable-next-line no-await-in-loop
    await bulk.handler({ entries: [entry], confirmed: true, said: 'zayn milkman final' });
    assert.deepEqual(wrote, [{ id: 5, answer: 'final' }], JSON.stringify(entry));
  }
});

test('the same company in four groups needs the group, and says all four', async () => {
  const { bulk, wrote } = load();
  const out = await bulk.handler({
    entries: [{ answer: 'ended', person: 'Gloria', company: 'Workforce' }],
    confirmed: true,
    said: 'gloria workforce ended',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /reaches 4 deals/);
  for (const g of ['INDIGO', 'MANBAT', 'MILKMAN', 'NEXUS']) assert.match(out.summary, new RegExp(g));
});

test('and naming the group picks exactly one of the four', async () => {
  for (const [group, id] of [['INDIGO', 1], ['MANBAT', 2], ['MILKMAN', 3], ['NEXUS', 4]]) {
    const { bulk, wrote } = load();
    // eslint-disable-next-line no-await-in-loop
    await bulk.handler({
      entries: [{ answer: 'ended', person: 'Gloria', company: 'Workforce', group }],
      confirmed: true,
      said: `gloria workforce ${group} ended`,
    });
    assert.deepEqual(wrote, [{ id, answer: 'no' }], group);
  }
});

// ===============================
// * FOUR INSTRUCTIONS, MIXED SCOPES, MIXED ANSWERS
// ===============================
test('a whole dictated message resolves in one pass', async () => {
  const { bulk, wrote } = load();
  const entries = [
    { answer: 'final', person: 'Zayn', group: 'MILKMAN' },
    { answer: 'continue', person: 'Gloria', company: 'Workforce', group: 'INDIGO' },
    { answer: 'ended', person: 'Gloria', company: 'Workforce', group: 'NEXUS' },
    { answer: 'close', group: 'MANBAT' },
  ];
  const preview = await bulk.handler({ entries, said: 'a long dictated message' });
  assert.equal(wrote.length, 0, 'the first call writes nothing');
  assert.equal(preview.pending, true);

  await bulk.handler({ entries, confirmed: true, said: 'yes go' });
  assert.deepEqual(wrote.map((w) => w.id).sort((a, b) => a - b), [1, 2, 4, 5, 6, 7]);
  const byId = new Map(wrote.map((w) => [w.id, w.answer]));
  assert.equal(byId.get(5), 'final');
  assert.equal(byId.get(1), 'yes');
  assert.equal(byId.get(4), 'no');
  assert.equal(byId.get(6), 'no', 'swept up by the MANBAT scope');
});

test('the preview groups by GROUP and names every deal, with its stop date', async () => {
  const { bulk } = load();
  const out = await bulk.handler({
    entries: [
      { answer: 'final', person: 'Zayn', group: 'MILKMAN' },
      { answer: 'ended', group: 'MANBAT' },
    ],
    said: 'zayn milkman final, close manbat',
  });
  assert.match(out.summary, /^MILKMAN$/m);
  assert.match(out.summary, /^MANBAT$/m);
  // Person, company, group, role, money, verdict, stop date. Two deals
  // never read the same.
  assert.match(out.summary, /Zayn, Milkman Ltd, MILKMAN, Developer, AED 4,000\.00\s+final, stops/);
  assert.match(out.summary, /Gary, KP, MANBAT, KP, GBP 6,250\.00\s+no, stops/);
  assert.match(out.summary, /Nathan, Kryptonia, MANBAT, Mid 1/);
  // "Close manbat" reaches Gloria's MANBAT deal too, so it is answered.
  assert.match(out.summary, /Gloria, Workforce, MANBAT, Closer, GBP 500\.00\s+no, stops/);
  // Her MILKMAN one is the untouched deal in a group somebody named, and
  // it has to be visible: "close manbat" and "close 3 of manbat" must not
  // read the same.
  assert.match(out.summary, /Gloria, Workforce, MILKMAN, Closer, GBP 500\.00\s+not touched/);
  // Per currency: 11,250 was AED and GBP added together. 2026-09-28.
  assert.match(out.summary, /4 change, 1 untouched, AED 4,000\.00 and GBP 7,250\.00 a month\. 4 stop\./);
});

// ===============================
// * THE WAYS A MESSY MESSAGE GOES WRONG
// ===============================
test('overlapping scopes with different answers refuse, naming the deal', async () => {
  const { bulk, wrote } = load();
  const out = await bulk.handler({
    entries: [
      { answer: 'ended', group: 'MANBAT' },
      { answer: 'continue', person: 'Gary' },
    ],
    confirmed: true,
    said: 'close manbat but keep gary',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /Gary/);
});

test('one unreadable answer stops the whole message, not just its line', async () => {
  const { bulk, wrote } = load();
  const out = await bulk.handler({
    entries: [
      { answer: 'final', person: 'Gary' },
      { answer: 'maybe later', person: 'Nathan' },
    ],
    confirmed: true,
    said: 'gary final, nathan maybe later',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
});

test('a name nobody holds is LISTED, and the good half still previews', async () => {
  const { bulk, wrote } = load();
  const out = await bulk.handler({
    entries: [
      { answer: 'final', person: 'Gary' },
      { answer: 'ended', person: 'Wilhelmina' },
    ],
    said: 'gary final, wilhelmina ended',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /MATCHED NOTHING/);
  assert.match(out.summary, /Wilhelmina/);
  assert.match(out.summary, /Gary, KP, MANBAT/, 'the readable half still shows');
});

test('an empty entries array falls through rather than answering everything', async () => {
  const { bulk, wrote } = load();
  const out = await bulk.handler({ entries: [], confirmed: true, said: 'go' });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /no scope was given|nothing to do|Ask which/i);
});

test('a duplicate instruction writes once, not twice', async () => {
  const { bulk, wrote } = load();
  await bulk.handler({
    entries: [
      { answer: 'final', person: 'Gary' },
      { answer: 'final', person: 'Gary', group: 'MANBAT' },
    ],
    confirmed: true,
    said: 'gary final, and gary in manbat final',
  });
  assert.deepEqual(wrote, [{ id: 6, answer: 'final' }]);
});

/**
 * ===============================
 * * A SECOND SINGLE ANSWER IN ONE TURN IS ONE ACT
 * ===============================
 * Live 2026-09-18: a two instruction message was answered with TWO calls
 * to the single tool. Two writes, two chances to stop half way, nothing to
 * undo as one act, on the queue that stops somebody's income.
 */
test('the second single answer in a turn is turned back to entries', async () => {
  const { one, wrote } = load();
  const turn = { wrote: new Map(), claims: [] };

  const first = await one.handler({
    person: 'Gloria', company: 'Workforce', group: 'MILKMAN', answer: 'final', turn, said: 'gloria milkman final, gloria nexus ended',
  });
  assert.doesNotMatch(first.summary, /NOTHING HAS BEEN CHANGED/);
  assert.deepEqual(wrote, [{ id: 3, answer: 'final' }]);

  const second = await one.handler({
    person: 'Gloria', company: 'Workforce', group: 'NEXUS', answer: 'ended', turn, said: 'gloria milkman final, gloria nexus ended',
  });
  assert.equal(wrote.length, 1, 'the second one wrote nothing');
  assert.match(second.summary, /NOTHING HAS BEEN CHANGED on this deal/);
  assert.match(second.summary, /entries/);
});

/**
 * ===============================
 * * A SCOPE HIDING INSIDE THE NAME
 * ===============================
 * Live 2026-09-18, twice in one run. "gary kp done" arrived as person
 * "Gary KP". Worse, "nathan kryptonia keep running" arrived as person
 * "Nathan Kryptonia": there is no Nathan at Kryptonia, so the scope was
 * IGNORED and the name alone resolved to Nathan on a different company
 * entirely, which the tool then tried to write.
 */
test('a scope stuck on the end of the name is read as a scope', async () => {
  const { bulk, wrote } = load();
  await bulk.handler({
    entries: [{ answer: 'done', person: 'Gary KP' }],
    confirmed: true,
    said: 'gary kp done',
  });
  assert.deepEqual(wrote, [{ id: 6, answer: 'no' }], 'the KP deal, not both of Gary\'s');
});

test('and a name plus a scope they do NOT have refuses, rather than finding a stranger', async () => {
  const { bulk, wrote } = load();
  const out = await bulk.handler({
    entries: [{ answer: 'continue', person: 'Nathan Kryptonia' }],
    confirmed: true,
    said: 'nathan kryptonia keep running',
  });
  // Nathan is on Kryptonia in this fixture, so make the dangerous case
  // explicitly: a person who is NOT on the company named.
  assert.deepEqual(wrote, [{ id: 7, answer: 'yes' }]);

  const { bulk: b2, wrote: w2 } = load();
  const miss = await b2.handler({
    entries: [{ answer: 'continue', person: 'Gary Milkman Ltd' }],
    confirmed: true,
    said: 'gary milkman ltd keep running',
  });
  assert.equal(w2.length, 0, 'Gary is not on Milkman Ltd, so nothing is written');
  assert.match(miss.summary, /MATCHED NOTHING/);
});

test('the longest scope wins, so a two word company is not read as one', async () => {
  const { bulk, wrote } = load();
  await bulk.handler({
    entries: [{ answer: 'final', person: 'Zayn Milkman Ltd' }],
    confirmed: true,
    said: 'zayn milkman ltd final',
  });
  assert.deepEqual(wrote, [{ id: 5, answer: 'final' }]);
});

test('an ordinary two word NAME is left alone', async () => {
  const { bulk, wrote } = load({
    rows: [...QUEUE, deal({
      id: 8, person_id: 'jh', person_name: 'James Heath', group_name: 'MANBAT', company: 'Kryptonia', role_label: 'Director', monthly_amount: 1500,
    })],
  });
  await bulk.handler({
    entries: [{ answer: 'final', person: 'James Heath' }], confirmed: true, said: 'james heath final',
  });
  assert.deepEqual(wrote, [{ id: 8, answer: 'final' }]);
});

test('but answering the SAME deal again in one turn is not a second act', async () => {
  const { one, wrote } = load();
  const turn = { wrote: new Map(), claims: [] };
  const args = {
    person: 'Gary', answer: 'final', turn, said: 'gary final',
  };
  await one.handler({ ...args });
  await one.handler({ ...args, answer: 'no' });
  assert.equal(wrote.length, 2, 'a correction on the same deal still goes through');
});
