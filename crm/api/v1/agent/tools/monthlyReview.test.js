const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadWith } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * Diane's three review tools, with no database
 * ***************************************************
 *
 * A BULK NO STOPS PAYING REAL PEOPLE, so every guard here is pinned rather
 * than trusted to a sentence in a description. The incident behind
 * confirmFirst is in that file's banner: asked to rename a company she
 * asked "shall I go ahead?", was never answered, and on the next turn
 * described the change as done.
 */

const SUBJECT = require.resolve('./monthlyReview');
const REPO = require.resolve('../../repos/monthlyReview.repo');
// THE QUEUE MOVED BEHIND A HELPER, because it prints money and had to
// start paying the rates. See shared/reviewQueue.helper.js: the tool asks
// it, not the repo, so the stub follows the tool.
const QUEUE = require.resolve('../../shared/reviewQueue.helper');
// THE REAL PRECEDENCE, not a stub of it. Which of the reasons wins is what
// the block header says, so faking it would test the fake.
const { reviewReason, REVIEW_REASON } = require('../../shared/reviewQueue.helper');
const CLOCK = require.resolve('../../shared/presetMonth.helper');

const DEAL = (over = {}) => ({
  id: 1,
  person_id: 'gloria',
  person_name: 'Gloria',
  group_name: 'ZZTEST',
  company: 'Acqua',
  role_label: 'Director',
  monthly_amount: 2000,
  currency: 'GBP',
  end_on: '2025-08-01',
  answer: null,
  ...over,
});

/** The repo, faked, plus a log of everything the tool asked it to write. */
function load(rows, { onAnswer } = {}) {
  const wrote = [];
  const tools = loadWith(SUBJECT, {
    [REPO]: {
      ANSWERS: ['yes', 'final', 'no'],
      // THE REAL ARITHMETIC, not a stub of it. The dates the queue reads
      // aloud have to be the ones the write would actually use.
      STOPS_AT: require('../../repos/monthlyReview.repo').STOPS_AT,
      answerOne: async (dealId, period, answer) => {
        wrote.push({ dealId, answer });
        return onAnswer ? onAnswer(dealId, answer) : { stoppedOn: '2026-07-31' };
      },
    },
    // The real queue filters in SQL. Honoured here or a test would pass on
    // a tool that reached every row.
    [QUEUE]: {
      reviewReason,
      REVIEW_REASON,
      dueThisMonth: async (period, opts = {}) => rows.filter((row) => {
        if (opts.answered === false && row.answer) return false;
        if (opts.company && row.company !== opts.company) return false;
        if (opts.group && row.group_name !== opts.group) return false;
        return true;
      }),
    },
    [CLOCK]: { currentMonth: () => '2026-08', lastDayOf: () => '2026-08-31' },
    /**
     * THE SHEET'S OWN LISTS, MATCHING THESE ROWS.
     *
     * `scopeArgs` reads them to take a group out of a name or a sentence,
     * so unstubbed it would answer from the REAL database while every row
     * here is invented: "Nexus" is a company on these rows and a GROUP on
     * the live sheet, and the tool narrowed to the wrong half of Gloria's
     * deals. Added 2026-09-29, when routing this door through the resolver
     * made it depend on them.
     */
    [require.resolve('../../repos/people.repo')]: {
      filterOptions: async () => ({
        groups: [...new Set(rows.map((r) => r.group_name).filter(Boolean))],
        companies: [...new Set(rows.map((r) => r.company).filter(Boolean))],
        people: [...new Set(rows.map((r) => r.person_name).filter(Boolean))]
          .map((name) => ({ personId: name, name })),
      }),
    },
    // STOPS_AT is the repo's real arithmetic, not a stub: the dates in the
    // reply must be the ones the write would actually use.
  });
  return { tools, wrote };
}

// ===============================
// * list_monthly_review
// ===============================

test('the QUEUE says the count AND the money, because the money is the point', async () => {
  const { tools } = load([DEAL(), DEAL({ id: 2, person_name: 'Paddy', monthly_amount: 500 })]);
  const out = await tools.listMonthlyReview.handler({});
  assert.match(out.reply, /2 of 2 unanswered for August 2026/);
  assert.match(out.reply, /2,500\.00 a month/);
});

test('an ANSWERED one still shows, or answering it wrong is unfindable', async () => {
  const { tools } = load([DEAL(), DEAL({ id: 2, person_name: 'Paddy', answer: 'no' })]);
  const out = await tools.listMonthlyReview.handler({});
  assert.match(out.summary, /1 of 2 unanswered/);
  assert.match(out.summary, /answered no/);
});

test('NOTHING DUE is said plainly, never as an empty list', async () => {
  const { tools } = load([]);
  const out = await tools.listMonthlyReview.handler({});
  assert.match(out.reply, /Nothing is up for review/);
});

test('SHE CANNOT GUESS WHICH PERSON, even to read', async () => {
  const { tools } = load([
    DEAL({ person_id: 'gloria', person_name: 'Gloria' }),
    DEAL({ id: 2, person_id: 'gloria-d', person_name: 'Gloria Difference' }),
  ]);
  const out = await tools.listMonthlyReview.handler({ person: 'Gloria D' });
  assert.equal(out.ambiguous, true);
  assert.match(out.summary, /matches 2 different people/);
});

// ===============================
// * answer_monthly_review
// ===============================

test('ONE DEAL, and it says what it stopped and when', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.answerMonthlyReview.handler({ person: 'Gloria', answer: 'no' });
  assert.deepEqual(wrote, [{ dealId: 1, answer: 'no' }]);
  assert.match(out.reply, /answered no/);
  assert.match(out.reply, /stops on 2026-07-31/);
});

test('SHE CANNOT ANSWER FOR A DEAL NOBODY IS ASKING ABOUT', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.answerMonthlyReview.handler({ person: 'Nathan', answer: 'no' });
  assert.equal(wrote.length, 0, 'nothing may be written');
  assert.match(out.summary, /nothing up for review/);
  assert.match(out.summary, /do not claim to have changed anything/);
});

test('ONE NAME WITH TWO DEALS IS THE BULK ACT WEARING THIS ONE\'S FACE', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, company: 'Nexus' })]);
  const out = await tools.answerMonthlyReview.handler({ person: 'Gloria', answer: 'no' });
  assert.equal(wrote.length, 0);
  assert.equal(out.ambiguous, true);
  // THE GROUP IS NAMED TOO. The same company in two groups is two deals,
  // so a list of company names alone cannot separate them and offers no
  // way to answer either one.
  assert.match(out.summary, /Acqua in ZZTEST; Nexus in ZZTEST/);
  assert.match(out.summary, /naming the company AND the group/);
});

test('TWO PEOPLE ONE NAME still stops it dead', async () => {
  const { tools, wrote } = load([
    DEAL({ person_id: 'a', person_name: 'Gloria' }),
    DEAL({ id: 2, person_id: 'b', person_name: 'Gloria Difference' }),
  ]);
  const out = await tools.answerMonthlyReview.handler({ person: 'Gloria D', answer: 'no' });
  assert.equal(wrote.length, 0);
  assert.equal(out.ambiguous, true);
});

test('AN INVENTED ANSWER writes nothing', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.answerMonthlyReview.handler({ person: 'Gloria', answer: 'maybe' });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /not an answer/);
});

// ===============================
// * bulk_answer_monthly_review
// ===============================

test('THE FIRST CALL WRITES NOTHING AND SAYS SO', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, person_name: 'Paddy' })]);
  const out = await tools.bulkAnswerMonthlyReview.handler({ answer: 'no', group: 'ZZTEST' });
  assert.equal(wrote.length, 0, 'the preview call must not write');
  assert.equal(out.pending, true);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED YET/);
  assert.match(out.summary, /2 deals/);
});

test('THE PREVIEW CARRIES THE MONEY, so the count is not the only number', async () => {
  const { tools } = load([DEAL(), DEAL({ id: 2, monthly_amount: 500 })]);
  const out = await tools.bulkAnswerMonthlyReview.handler({ answer: 'no', group: 'ZZTEST' });
  assert.match(out.summary, /2,500\.00 a month/);
});

test('CONFIRMED writes, and reports the count and what it stopped', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, person_name: 'Paddy' })]);
  const out = await tools.bulkAnswerMonthlyReview.handler({
    answer: 'no', group: 'ZZTEST', confirmed: true,
  });
  assert.equal(wrote.length, 2);
  assert.match(out.reply, /Answered no for 2 deals/);
  assert.match(out.reply, /2 stop on 2026-07-31/);
});

test('NO SCOPE AND NO "everything" IS REFUSED, not run over the sheet', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.bulkAnswerMonthlyReview.handler({ answer: 'no', confirmed: true });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /no scope was given/);
});

test('IT ONLY REACHES THE UNANSWERED, never a decision already made', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, answer: 'yes' })]);
  const out = await tools.bulkAnswerMonthlyReview.handler({
    answer: 'no', group: 'ZZTEST', confirmed: true,
  });
  assert.deepEqual(wrote, [{ dealId: 1, answer: 'no' }]);
  assert.match(out.reply, /for 1 deal/);
});

test('A YES PREVIEW SAYS NOTHING STOPS, which is what survives', async () => {
  const { tools } = load([DEAL()]);
  const out = await tools.bulkAnswerMonthlyReview.handler({ answer: 'yes', group: 'ZZTEST' });
  assert.match(out.summary, /Nothing stops/);
});

test('A NAME THAT LANDS ON NOBODY IS NOT "ALL OF THEM"', async () => {
  // resolvePerson hands back the WHOLE list when a name matches nothing,
  // flagged `matched: false`. Reading that as a result here would turn
  // "mark Nathan no" into a bulk no across everybody in the queue.
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, person_id: 'p', person_name: 'Paddy' })]);
  const out = await tools.bulkAnswerMonthlyReview.handler({
    answer: 'no', person: 'Nathan', confirmed: true,
  });
  assert.equal(wrote.length, 0, 'nothing may be written for a name nobody has');
  assert.match(out.summary, /Nothing is unanswered for Nathan/);
});

test('AN EMPTY SCOPE IS SAID, never reported as done', async () => {
  const { tools, wrote } = load([]);
  const out = await tools.bulkAnswerMonthlyReview.handler({
    answer: 'no', group: 'NOBODY', confirmed: true,
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /do not report anything as done/);
});

// ===============================
// * the shape every tool must keep
// ===============================

test('THREE TOOLS, one job each, in their own list', () => {
  const { tools } = load([]);
  assert.deepEqual(
    tools.monthlyReviewTools.map((t) => t.name),
    ['list_monthly_review', 'answer_monthly_review', 'bulk_answer_monthly_review'],
  );
});

test('ONLY THE BULK ONE TAKES confirmed, so the two cannot be confused', () => {
  const { tools } = load([]);
  const takesConfirmed = (t) => 'confirmed' in (t.parameters?.properties ?? {});
  assert.equal(takesConfirmed(tools.bulkAnswerMonthlyReview), true);
  assert.equal(takesConfirmed(tools.answerMonthlyReview), false);
  assert.equal(takesConfirmed(tools.listMonthlyReview), false);
});

test('NOT IN tools/masterSheet.js, which is where it must never go', () => {
  // The file is thousands of lines and a tool that can stop paying six
  // people buried in it is one nobody can find or test on its own.
  const masterSheet = require('./masterSheet');
  const names = (masterSheet.masterSheetTools ?? []).map((t) => t.name);
  for (const name of ['list_monthly_review', 'answer_monthly_review', 'bulk_answer_monthly_review']) {
    assert.equal(names.includes(name), false, name);
  }
  assert.equal(path.basename(SUBJECT), 'monthlyReview.js');
});

// ===============================
// * FOUND BY A LIVE CONVERSATION, 2026-09-16
// ===============================
// Both of these were prompt rules that she ignored on the first run.

test('ONE NAMED PERSON IS REFUSED BY THE BULK TOOL', async () => {
  // "ZZ Gloria is still going, mark it yes" reached the bulk tool, which
  // previewed FOUR deals. A yes to a sentence about one person would have
  // answered four. The mirror of the single tool refusing two.
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, person_id: 'p', person_name: 'Paddy' })]);
  const out = await tools.bulkAnswerMonthlyReview.handler({
    answer: 'yes', person: 'Gloria', confirmed: true,
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /ONE deal up for review/);
  assert.match(out.summary, /answer_monthly_review, not this one/);
});

test('TWO DEALS FOR ONE PERSON IS STILL THE BULK TOOL\'S JOB', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, company: 'Nexus' })]);
  const out = await tools.bulkAnswerMonthlyReview.handler({
    answer: 'yes', person: 'Gloria', confirmed: true,
  });
  assert.equal(wrote.length, 2, 'that is what it is for');
  assert.doesNotMatch(out.reply, /not this one/);
});

test('A PERSON INSIDE A WIDER SCOPE IS NOT THE SINGLE CASE', async () => {
  // They named a group as well, so they are not talking about one deal.
  const { tools, wrote } = load([DEAL()]);
  await tools.bulkAnswerMonthlyReview.handler({
    answer: 'yes', person: 'Gloria', group: 'ZZTEST', confirmed: true,
  });
  assert.equal(wrote.length, 1);
});



test('THE QUEUE STATES BOTH STOP DATES, from the server\'s clock', async () => {
  // Asked when "final" would stop somebody she answered "the end of
  // August" in SEPTEMBER, with no tool call. There is no other tool to
  // ask, so this one carries the answer.
  const { tools } = load([DEAL()]);
  const out = await tools.listMonthlyReview.handler({});
  // IN WORDS SINCE 2026-09-17, and with the year, which the old ISO
  // string had but the per row dates did not.
  assert.match(out.reply, /Final stops on 31 August 2026/);
  assert.match(out.reply, /No stops on 31 July 2026/);
});


test('"NOTHING UP FOR REVIEW" AND "ALL ANSWERED" ARE DIFFERENT FACTS', async () => {
  // Live 2026-09-17: asked what was up for review in a group whose three
  // deals were all answered, she said "nothing is up for review for
  // ZZTEST". Three deals WERE up for review. That sentence leaves somebody
  // believing the group has nothing past its end date at all.
  const answered = load([DEAL({ answer: 'yes' }), DEAL({ id: 2, answer: 'final' })]);
  const done = await answered.tools.listMonthlyReview.handler({
    group: 'ZZTEST', onlyUnanswered: true,
  });
  assert.match(done.reply, /has been answered/);
  assert.doesNotMatch(done.reply, /Nothing is up for review/);

  const none = load([]);
  const empty = await none.tools.listMonthlyReview.handler({ group: 'ZZTEST' });
  assert.match(empty.reply, /Nothing is up for review for ZZTEST/);
  // And it says what WOULD put one there, so the answer is actionable.
  assert.match(empty.reply, /end date has passed/);
  assert.match(empty.reply, /winding down/);
});

/**
 * ===============================
 * * THE SHAPE OF THE ANSWER, reported on sight 2026-09-17
 * ===============================
 * It was one run on sentence per deal, thirty six of them, each repeating
 * the company and the end date. Grouped by company it is about twelve
 * numbered blocks with NOTHING left out.
 */
test('IT GROUPS BY COMPANY AND GROUP, NUMBERED', async () => {
  const { tools } = load([
    DEAL({ id: 1, person_id: 'a', person_name: 'Alex', company: 'Northstar Care' }),
    DEAL({ id: 2, person_id: 'b', person_name: 'Blake', company: 'Northstar Care' }),
    DEAL({ id: 3, person_id: 'c', person_name: 'Casey', company: 'Acqua' }),
  ]);
  const out = await tools.listMonthlyReview.handler({});

  assert.match(out.summary, /^1\. Northstar Care, ZZTEST, ended /m);
  assert.match(out.summary, /^2\. Acqua, ZZTEST, ended /m);
  // The company is said ONCE, not on every person's line.
  assert.equal((out.summary.match(/Northstar Care/g) ?? []).length, 1);
  // And each person sits under it, indented.
  assert.match(out.summary, /^ {3}Alex, Director, GBP 2,000\.00$/m);
  assert.match(out.summary, /^ {3}Blake, Director, GBP 2,000\.00$/m);
});

/**
 * ONE COMPANY IN TWO GROUPS IS TWO BLOCKS.
 *
 * Live 2026-09-18: one person held four Workforce deals across four
 * groups and the list printed four identical lines under one heading.
 * Nothing on screen told them apart, and "gloria workforce" could not
 * resolve to one of them either.
 */
test('the SAME company in two groups is two blocks', async () => {
  const { tools } = load([
    DEAL({
      id: 1, person_id: 'g', person_name: 'Gloria', company: 'Workforce', group_name: 'ZZTEST',
    }),
    DEAL({
      id: 2, person_id: 'g', person_name: 'Gloria', company: 'Workforce', group_name: 'ZZOTHER',
    }),
  ]);
  const out = await tools.listMonthlyReview.handler({});

  assert.match(out.summary, /^1\. Workforce, ZZTEST, /m);
  assert.match(out.summary, /^2\. Workforce, ZZOTHER, /m);
  assert.equal((out.summary.match(/^\d\. /gm) ?? []).length, 2, 'two headings, not one');
});

test('NOTHING IS CUT. Every deal is in the answer', async () => {
  // The cap existed because the old shape was a wall. Grouping is what
  // makes it readable, so there is nothing left to hide.
  const many = Array.from({ length: 30 }, (_, i) => DEAL({
    id: i + 1, person_id: `p${i}`, person_name: `Person ${i}`, company: `Co ${i}`,
  }));
  const { tools } = load(many);
  const out = await tools.listMonthlyReview.handler({});

  assert.match(out.summary, /^30\. Co 29, /m, 'the last block is numbered 30');
  assert.doesNotMatch(out.summary, /not listed/);
  assert.equal(out.dealIds.length, 30);
});

test('THE DATE CARRIES ITS YEAR, and does not shift', async () => {
  // "ended Thu Jan 01" was the old output: no year, and a day earlier than
  // the column said on any host behind UTC.
  const { tools } = load([DEAL({ end_on: '2026-01-01' })]);
  const out = await tools.listMonthlyReview.handler({});
  assert.match(out.summary, /ended 1 January 2026/);
  assert.doesNotMatch(out.summary, /December 2025/);
});

test('AN ANSWERED DEAL SAYS SO, on its own line', async () => {
  const { tools } = load([DEAL({ answer: 'yes' })]);
  const out = await tools.listMonthlyReview.handler({});
  assert.match(out.summary, /, answered yes$/m);
});

test('A LIQUIDATION BLOCK SAYS IT ENDS, never that it ended', async () => {
  // Its end date may be months away. "ended" would claim a future date had
  // passed.
  const { tools } = load([DEAL({ end_on: '2027-12-31', review_monthly: true, company_status: 'liquidation' })]);
  const out = await tools.listMonthlyReview.handler({});
  assert.match(out.summary, /in liquidation, ends 31 December 2027/);
  assert.doesNotMatch(out.summary, /ended 31 December 2027/);
});

test('THE HEADLINE NAMES THE MONTH IN WORDS, and both stop dates', async () => {
  const { tools } = load([DEAL()]);
  const out = await tools.listMonthlyReview.handler({});
  assert.match(out.reply, /^1 of 1 unanswered for August 2026, GBP 2,000\.00 a month\./m);
  assert.match(out.reply, /Final stops on 31 August 2026\. No stops on 31 July 2026\./);
});

// 2026-09-25: her answers wrote without a broadcast, so the pages stayed stale
// and the runtime read a real stop as "nothing was written".
test('AN ANSWER THAT WRITES TELLS THE PAGES, as the page route does', async () => {
  const { watchWrites } = require('../../shared/writeTap.helper');
  const { tools } = load([DEAL()]);
  const { wrote } = await watchWrites(() => tools.answerMonthlyReview.handler({ person: 'Gloria', answer: 'no' }));
  assert.equal(wrote, true);
});

// 2026-09-28: "keep Dov's Acqua deal running and mark his Nexus deal as final"
// wrote Acqua, then the second call was refused: never one act. Turned back first.
test('SEVERAL OF THEIR DEALS IN ONE MESSAGE IS TURNED BACK BEFORE ANY WRITE', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, company: 'Nexus' })]);
  const out = await tools.answerMonthlyReview.handler({
    person: 'Gloria', company: 'Acqua', answer: 'yes', said: "keep Gloria's Acqua deal running and mark her Nexus deal as final",
  });
  assert.equal(wrote.length, 0, 'nothing written before the bulk act');
  assert.match(out.summary, /call bulk_answer_monthly_review with `entries`/);
  // One deal named is still the single answer.
  const one = await tools.answerMonthlyReview.handler({ person: 'Gloria', company: 'Acqua', answer: 'yes', said: "keep Gloria's Acqua deal running" });
  assert.equal(wrote.length, 1);
  assert.match(one.reply, /answered yes/);
});

// 2026-09-28: on "yes" the sentence is only "yes"; the two deals were named one message back.
test('THE CONFIRMING "YES" STILL SEES THE DEALS NAMED BEFORE IT', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, company: 'Nexus' })]);
  const out = await tools.answerMonthlyReview.handler({
    person: 'Gloria', company: 'Acqua', answer: 'yes', said: 'yes',
    saidRecent: "keep Gloria's Acqua deal running and mark her Nexus deal as final\nyes",
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /call bulk_answer_monthly_review with `entries`/);
});

// 2026-09-30: the queue is DRAWN in the sheet check's format, a section per
// reason, and the bubble keeps only the headline and stop dates.
test('THE QUEUE IS A CARD, the bubble only its headline', async () => {
  const { tools } = load([DEAL(), DEAL({ id: 2, person_name: 'Paddy', answer: 'no' })]);
  const out = await tools.listMonthlyReview.handler({});
  assert.equal(out.list.kind, 'review');
  assert.equal(out.list.rows.length, 2);
  assert.match(out.list.sections[0].rows[1].detail, /answered no/);
  assert.doesNotMatch(out.reply, /Paddy/);
  assert.match(out.summary, /Paddy/);
});
