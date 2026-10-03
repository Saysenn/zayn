const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');

/**
 * ***************************************************
 * * WHAT PUTS A DEAL IN THE REVIEW QUEUE
 * ***************************************************
 *
 * TWO REASONS since 2026-09-17, his call. The end date passing was the
 * only one, so a company wound down in month 3 of a twelve month deal was
 * never asked about: liquidation is a PERIOD, and deals inside it end at
 * points no end date predicted.
 *
 * The SQL is read as text. A stubbed pool cannot tell you whether the
 * clause is right, but it can tell you whether it is there and how it is
 * joined, which is where this rule would be lost.
 */

const SUBJECT = require.resolve('./monthlyReview.repo');
const DB = require.resolve('../../configs/db');
const ROWS = require.resolve('./masterSheetRows.repo');
const CLOCK = require.resolve('../shared/presetMonth.helper');

function load() {
  const ran = [];
  const repo = loadWith(SUBJECT, {
    [DB]: {
      query: async (sql, params) => { ran.push({ sql, params }); return { rows: [], rowCount: 0 }; },
      connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    },
    [ROWS]: { STOPPED_REASON: { REVIEW_FINAL: 'review_final', REVIEW_NO: 'review_no' }, invalidateCache() {} },
    [CLOCK]: { currentMonth: () => '2026-09', lastDayOf: () => '2026-09-30' },
  });
  return { repo, ran };
}

test('A STOPPED DEAL IS NEVER ASKED ABOUT, whatever else is true', async () => {
  // It is already over. Asking again is asking a question with no answer.
  const { repo, ran } = load();
  await repo.queue('2026-09');
  assert.match(ran[0].sql, /m\.stopped_on IS NULL/);
});

/**
 * ===============================
 * * AND A STOP THIS REVIEW WROTE IS THE ONE EXCEPTION, for ONE answer
 * ===============================
 * Both `final` and `no` used to stay on screen, so a misclick had a way
 * back. His call 2026-09-29 split them: `final` is still paid IN FULL this
 * month, so it belongs on this month's list; `no` stops at the end of LAST
 * month, so it is out of the month entirely. History is the way back for
 * both, which is why the panel's Undo answer button went with it.
 *
 * CONTRACT with web/src/configs/monthlyReview.js REVIEW_ANSWER_LEAVES_LIST,
 * which states the same split the other way round and pins its own half.
 */
test('"ALREADY ENDED" LEAVES THE QUEUE, and "final month" stays', async () => {
  const { repo, ran } = load();
  await repo.queue('2026-09');
  const due = ran[0].sql.slice(ran[0].sql.indexOf('m.stopped_on IS NULL'));
  const stays = due.slice(due.indexOf('m.stopped_reason IN'), due.indexOf('AND r.answer IS NOT NULL'));
  assert.ok(stays.length > 0, 'the exception is in the predicate at all');
  assert.match(stays, /'review_final'/, 'final is still paid this month');
  assert.doesNotMatch(stays, /'review_no'/, 'already ended is out of the month');
});

test('AND THE EXCEPTION ONLY APPLIES TO A ROW ANSWERED THIS PERIOD', async () => {
  // Without it, next month's queue would keep showing a deal this month
  // ended: `r` is joined on the period being asked about, so an unanswered
  // new month reads NULL and the row drops out on its stop date alone.
  const { repo, ran } = load();
  await repo.queue('2026-09');
  const due = ran[0].sql.slice(ran[0].sql.indexOf('m.stopped_on IS NULL'));
  assert.match(due, /m\.stopped_reason IN \([^)]*\)\s*\n?\s*AND r\.answer IS NOT NULL/);
});

test('THE COUNT AND THE GUARD SHARE THAT RULE TOO', async () => {
  // `pending` feeds the sidebar badge and the master sheet's link. A row
  // the list has dropped must not still be counted as waiting on it.
  const { repo, ran } = load();
  await repo.pending('2026-09');
  await repo.isDue(1, '2026-09');
  for (const { sql } of ran) {
    const due = sql.slice(sql.indexOf('m.stopped_on IS NULL'));
    assert.doesNotMatch(due, /'review_no'/);
  }
});

test('THE MIRROR NAMES ITS OTHER HALF', async () => {
  // A mirror nobody can find is a mirror that drifts. A POINTER, never an
  // import: crm/api and crm/web share no file.
  const src = require('node:fs').readFileSync(SUBJECT, 'utf8');
  assert.match(src, /CONTRACT with web\/src\/configs\/monthlyReview\.js/);
  assert.ok(src.includes('REVIEW_ANSWER_LEAVES_LIST'));
});

test('THE END DATE PASSING IS ONE REASON', async () => {
  const { repo, ran } = load();
  await repo.queue('2026-09');
  assert.match(ran[0].sql, /m\.end_on IS NOT NULL\s*\n?\s*AND m\.end_on < \(\$1::text \|\| '-01'\)::date/);
});

/**
 * ===============================
 * * AND THE COMPANY'S STATUS IS NOT A REASON ANY MORE
 * ===============================
 * It was `EXISTS (… status = 'liquidation')`, ORed into the predicate, so
 * EVERY live deal on a liquidating company was in the queue. The checklist
 * on the status screen promised "ticked deals join the Review list every
 * month" and unticking one removed nothing.
 *
 * HIS CALL 2026-09-21: he marks a company and then chooses which of its
 * deals it actually touches. So the status is CARRIED, for the tab the row
 * belongs to, and decides nothing about whether it is here.
 */
test('THE COMPANY STATUS IS CARRIED, never a reason', async () => {
  const { repo, ran } = load();
  await repo.queue('2026-09');

  assert.match(ran[0].sql, /AS company_status/, 'the tab needs it');
  // The predicate is everything from the stop check onward. The SELECT
  // list has its own subqueries, so slicing there is what tells them apart.
  const due = ran[0].sql.slice(ran[0].sql.indexOf('m.stopped_on IS NULL'));
  assert.doesNotMatch(due, /tb_companies/, 'a company status in the predicate is the old bug');
  assert.doesNotMatch(due, /EXISTS/);
});

test('SO THE TICK IS THE ONLY WAY IN BESIDES A DATE', async () => {
  const { repo, ran } = load();
  await repo.queue('2026-09');
  const due = ran[0].sql.slice(ran[0].sql.indexOf('m.stopped_on IS NULL'));
  assert.match(due, /m\.review_monthly = true/);
  assert.match(due, /m\.end_on IS NOT NULL/);
});

/**
 * ===============================
 * * AND HIS OWN WORD IS THE THIRD, the only one anybody can SET
 * ===============================
 * His September sheet writes "Reviewed monthly" in the end date column on
 * 12 deals: decided month by month rather than by a date. A past end date
 * is a date and liquidation is all or nothing across a company, so two
 * deals on a shared company could not be reached by either.
 *
 * It was pinned only through a stubbed queue, which cannot notice the
 * clause being dropped from the SQL: the stub answers whatever the test
 * hands it. Closed 2026-09-21.
 */
test('HIS OWN WORD ON THE DEAL IS THE THIRD REASON', async () => {
  const { repo, ran } = load();
  await repo.queue('2026-09');
  assert.match(ran[0].sql, /m\.review_monthly = true/);
});

test('THE TWO ARE OR, NOT AND', async () => {
  // AND would have been the opposite feature: only ticked deals whose end
  // date had ALSO passed, which is fewer rows than before, not more.
  const { repo, ran } = load();
  await repo.queue('2026-09');
  const due = ran[0].sql.slice(ran[0].sql.indexOf('stopped_on IS NULL'));
  assert.match(due, /\)\s*\n?\s*OR m\.review_monthly = true/);
});

test('AND THE THIRD SITS UNDER THE STOP CHECK TOO', async () => {
  // A flag somebody set must not revive a deal that is already over.
  const { repo, ran } = load();
  await repo.queue('2026-09');
  const due = ran[0].sql.slice(ran[0].sql.indexOf('m.stopped_on IS NULL'));
  const flag = due.indexOf('m.review_monthly = true');
  assert.ok(flag > -1, 'the flag is in the predicate');
  assert.match(due.slice(0, flag), /AND \(/, 'it is ANDed under the stop');
});

/**
 * NO SETTING DECIDES THIS. `color_uses_end_date` says whether an end date
 * takes part in what a month OWES; it has never had a vote in what gets
 * ASKED. A deal past its term is a question either way, and the question
 * is the whole point of the queue.
 */
test('THE QUEUE READS NO SETTING', async () => {
  const { repo, ran } = load();
  await repo.queue('2026-09');
  assert.doesNotMatch(ran[0].sql, /color_uses_end_date/);
});

test('AND BOTH SIT UNDER THE STOP CHECK, so neither can revive a stopped deal', async () => {
  const { repo, ran } = load();
  await repo.queue('2026-09');
  const due = ran[0].sql.slice(ran[0].sql.indexOf('m.stopped_on IS NULL'));
  const tick = due.indexOf('m.review_monthly = true');
  assert.ok(tick > -1, 'the tick is in the predicate');
  assert.match(due.slice(0, tick), /AND \(/, 'the two reasons are ANDed under the stop');
});

test('THE COMPANY IS MATCHED ON ITS FOLDED NAME', async () => {
  // "Relia PA" and "Relia Pa" are one company and both spellings are live.
  const { repo, ran } = load();
  await repo.queue('2026-09');
  assert.match(ran[0].sql, /lower\(regexp_replace\(btrim\(c\.name\)/);
  assert.match(ran[0].sql, /lower\(regexp_replace\(btrim\(m\.company\)/);
});

test('EVERY ROW SAYS WHICH TAB IT BELONGS TO', async () => {
  // A ticked deal on a company winding down is a different question from a
  // ticked deal on one under review, and both differ from a date that has
  // passed. Unmarked, the three read as one list.
  const { repo, ran } = load();
  await repo.queue('2026-09');
  assert.match(ran[0].sql, /AS company_status/);
  assert.match(ran[0].sql, /m.review_monthly/);
});

test('THE COUNT AND THE MONEY FOLLOW THE SAME RULE', async () => {
  // `pending` feeds the header button and the export warning. A different
  // rule there is a badge that disagrees with the list it opens.
  const { repo, ran } = load();
  await repo.pending('2026-09');
  assert.match(ran[0].sql, /m.review_monthly = true/);
  assert.match(ran[0].sql, /m\.stopped_on IS NULL/);
});

test('AND SO DOES THE GUARD ON WRITING AN ANSWER', async () => {
  // isDue is what refuses an answer for a deal nobody is asking about. A
  // narrower rule here would refuse a ticked deal the panel offered.
  const { repo, ran } = load();
  await repo.isDue(1, '2026-09');
  assert.match(ran[0].sql, /m.review_monthly = true/);
});
