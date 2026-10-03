const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * Diane ends a deal, puts one back, and reads the Archive
 * ***************************************************
 *
 * Every guard here is pinned rather than trusted to a sentence. A stop
 * takes somebody's money out of every month from its date onward, and the
 * whole reason `confirmFirst` exists is that a description saying "confirm
 * first" is not a guard.
 */

const SUBJECT = require.resolve('./closure');
const ROWS = require.resolve('../../repos/masterSheetRows.repo');
const CLOCK = require.resolve('../../shared/presetMonth.helper');
const PEOPLE = require.resolve('../../repos/people.repo');
const SETTINGS = require.resolve('../../repos/settings.repo');

const DEAL = (over = {}) => ({
  id: 1,
  person_id: 'gloria',
  person_name: 'Gloria',
  group_name: 'ALPHA',
  company: 'Northstar Care',
  role_label: 'Director',
  monthly_amount: 2000,
  currency: 'GBP',
  stopped_on: null,
  stopped_reason: null,
  ...over,
});

/** The repo, faked, plus a log of every write it was asked to make. */
function load(rows, rates = []) {
  const wrote = [];
  const tools = loadWith(SUBJECT, {
    [ROWS]: {
      STOPPED_REASON: {
        BY_HAND: 'stopped_by_hand',
        REVIEW_NO: 'review_no',
        REVIEW_FINAL: 'review_final',
        COMPANY_CLOSED: 'company_closed',
      },
      REOPEN_THE_COMPANY: 'company_closed',
      findAll: async (opts = {}) => {
        const want = opts.stopped === true;
        const matched = rows.filter((row) => {
          if (Boolean(row.stopped_on) !== want) return false;
          if (opts.company && row.company !== opts.company) return false;
          if (opts.group && row.group_name !== opts.group) return false;
          if (opts.stoppedReason && row.stopped_reason !== opts.stoppedReason) return false;
          return true;
        });
        return { rows: matched, total: matched.length };
      },
      stop: async (id, opts) => { wrote.push({ stop: id, ...opts }); return { id, stopped_on: opts.on }; },
      resume: async (id) => { wrote.push({ resume: id }); return { id }; },
    },
    [CLOCK]: { currentDay: () => '2026-09-17', currentMonth: () => '2026-09' },
    [PEOPLE]: { rateMap: async () => new Map(rates), filterOptions: async () => ({ groups: ['ALPHA'], companies: ['Northstar Care'] }) },
    [SETTINGS]: { get: async () => ({ crypto_percent: 0 }) },
  });
  return { tools, wrote };
}

// ===============================
// * stop_deal
// ===============================

test('IT STOPS THE NAMED DEAL, and the SERVER dates it', async () => {
  // A backdated stop rewrites a month that has already been paid, and she
  // has no business choosing that day.
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.stopDeal.handler({ person: 'Gloria', confirmed: true });
  assert.deepEqual(wrote, [{ stop: 1, on: '2026-09-17', reason: 'stopped_by_hand' }]);
  assert.match(out.reply, /stopped from 17 September 2026/, 'in words, with the year');
});

test('AND IT SAYS WHERE THE ROW WENT, never just "done"', async () => {
  // A stop that reads like a deletion is the sentence that makes somebody
  // stop trusting the answer.
  const { tools } = load([DEAL()]);
  const out = await tools.stopDeal.handler({ person: 'Gloria', confirmed: true });
  assert.match(out.reply, /row is kept/);
  assert.match(out.reply, /Archive/);
  assert.match(out.reply, /already paid is untouched/);
});

test('A NAME NOBODY HAS WRITES NOTHING', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.stopDeal.handler({ person: 'Nathan' });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /no live deal/);
  assert.match(out.summary, /do not claim to have changed anything/);
});

test('TWO PEOPLE ONE NAME stops it dead', async () => {
  const { tools, wrote } = load([
    DEAL({ person_id: 'a', person_name: 'Gloria' }),
    DEAL({ id: 2, person_id: 'b', person_name: 'Gloria Difference' }),
  ]);
  const out = await tools.stopDeal.handler({ person: 'Gloria D' });
  assert.equal(wrote.length, 0);
  assert.equal(out.ambiguous, true);
});

test('ONE PERSON WITH TWO DEALS IS ASKED WHICH ONE, COMPANY AND GROUP', async () => {
  // Acting on both off one unqualified name is a bulk act wearing a single
  // tool's face.
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, company: 'Acqua' })]);
  const out = await tools.stopDeal.handler({ person: 'Gloria' });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /Northstar Care in ALPHA; Acqua in ALPHA/);
});

/**
 * ===============================
 * * THE SAME COMPANY IN FOUR GROUPS IS FOUR DEALS
 * ===============================
 * Live 2026-09-18: "Gloria holds 4 live deals: Workforce, Workforce,
 * Workforce, Workforce. Ask which company they mean." The company is what
 * all four SHARE. The question had no answerable form.
 */
test('the same company in two groups asks for the GROUP, and names both', async () => {
  const { tools, wrote } = load([
    DEAL({ id: 1, group_name: 'ALPHA' }),
    DEAL({ id: 2, group_name: 'BETA' }),
  ]);
  const out = await tools.stopDeal.handler({ person: 'Gloria' });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /Northstar Care in ALPHA; Northstar Care in BETA/);
  assert.match(out.summary, /which GROUP/);
  assert.doesNotMatch(out.summary, /Northstar Care, Northstar Care/, 'one name twice says nothing');
});

test('and naming the GROUP resolves it', async () => {
  const { tools, wrote } = load([
    DEAL({ id: 1, group_name: 'ALPHA' }),
    DEAL({ id: 2, group_name: 'BETA' }),
  ]);
  await tools.stopDeal.handler({ person: 'Gloria', group: 'BETA', confirmed: true });
  assert.deepEqual(wrote.map((w) => w.stop), [2]);
});

test('AND NAMING THE COMPANY RESOLVES IT', async () => {
  const { tools, wrote } = load([DEAL(), DEAL({ id: 2, company: 'Acqua' })]);
  await tools.stopDeal.handler({ person: 'Gloria', company: 'Acqua', confirmed: true });
  assert.deepEqual(wrote.map((w) => w.stop), [2]);
});

test('IT NEVER TOUCHES AN ALREADY STOPPED DEAL', async () => {
  const { tools, wrote } = load([DEAL({ stopped_on: '2026-08-31', stopped_reason: 'review_no' })]);
  const out = await tools.stopDeal.handler({ person: 'Gloria' });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /no live deal/);
});

// ===============================
// * resume_deal
// ===============================

test('IT PUTS A STOPPED DEAL BACK', async () => {
  const { tools, wrote } = load([DEAL({ stopped_on: '2026-08-31', stopped_reason: 'stopped_by_hand' })]);
  const out = await tools.resumeDeal.handler({ person: 'Gloria' });
  assert.deepEqual(wrote, [{ resume: 1 }]);
  assert.match(out.reply, /back on the master sheet/);
});

test('A COMPANY CLOSURE IS REFUSED, and the refusal says what to do', async () => {
  // Putting a deal back on a company that is gone is the one resume that
  // makes the sheet wrong.
  const { tools, wrote } = load([DEAL({ stopped_on: '2026-08-31', stopped_reason: 'company_closed' })]);
  const out = await tools.resumeDeal.handler({ person: 'Gloria' });
  assert.equal(wrote.length, 0, 'nothing may be written');
  assert.match(out.summary, /reopen the company/);
  assert.match(out.summary, /comes back together/);
  assert.match(out.summary, /Nothing has been changed/);
});

test('A DEAL THAT WAS NEVER STOPPED IS SAID PLAINLY', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.resumeDeal.handler({ person: 'Gloria' });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /no stopped deal/);
});

// ===============================
// * list_stopped_deals
// ===============================

const STOPPED = (over = {}) => DEAL({
  stopped_on: '2026-08-31', stopped_reason: 'stopped_by_hand', ...over,
});

test('THE ARCHIVE READS BACK WITH THE MONEY', async () => {
  const { tools } = load([STOPPED(), STOPPED({ id: 2, person_name: 'Paddy', monthly_amount: 500 })]);
  const out = await tools.listStoppedDeals.handler({});
  assert.match(out.reply, /2 stopped deals/);
  assert.match(out.reply, /2,500\.00 a month/);
});

test('AND IT NAMES WHY EACH ONE STOPPED', async () => {
  // Four things stop a deal and they are not interchangeable.
  const { tools } = load([
    STOPPED(),
    STOPPED({ id: 2, person_name: 'Paddy', stopped_reason: 'review_no' }),
    STOPPED({ id: 3, person_name: 'Zane', stopped_reason: 'company_closed' }),
  ]);
  const out = await tools.listStoppedDeals.handler({});
  assert.match(out.summary, /stopped by hand/);
  assert.match(out.summary, /answered no at review/);
  assert.match(out.summary, /its company closed/);
});

test('IT READS ONLY STOPPED ROWS, never the live sheet', async () => {
  const { tools } = load([DEAL(), STOPPED({ id: 2, person_name: 'Paddy' })]);
  const out = await tools.listStoppedDeals.handler({});
  assert.match(out.reply, /1 stopped deal,/);
  assert.doesNotMatch(out.reply, /Gloria/);
});


test('NOTHING MATCHING IS SAID, never an empty list', async () => {
  const { tools } = load([]);
  const out = await tools.listStoppedDeals.handler({ group: 'ALPHA' });
  assert.match(out.reply, /Nothing is stopped for ALPHA/);
});

test('A LIST OF NAMES IS A SENTENCE, not a join', async () => {
  // "Nothing stopped for Reliapay,KP,Kryptonia matches that." Live
  // 2026-09-24: a plural filter went in raw and read as one company with
  // a strange name.
  const { tools } = load([]);
  const out = await tools.listStoppedDeals.handler({ company: ['Reliapay', 'KP', 'Kryptonia'] });
  assert.match(out.reply, /Reliapay, KP and Kryptonia/);
  assert.doesNotMatch(out.reply, /Reliapay,KP/);
});

test('STOPPED IS NOT PAST ITS END DATE, and the answer says so', async () => {
  // The same turn drew a panel of three deals past a year and then said
  // nothing matched. Both were true; neither said which question it had
  // answered.
  const { tools } = load([]);
  const out = await tools.listStoppedDeals.handler({ company: ['Reliapay'] });
  assert.match(out.summary, /PAST ITS END DATE is not a stopped deal/);
});

test('IT WRITES NOTHING, EVER', async () => {
  const { tools, wrote } = load([STOPPED()]);
  await tools.listStoppedDeals.handler({});
  assert.deepEqual(wrote, []);
});

test('THREE TOOLS, and the two that write are not the one that reads', () => {
  const { tools } = load([]);
  assert.deepEqual(
    tools.closureTools.map((t) => t.name),
    ['stop_deal', 'resume_deal', 'list_stopped_deals'],
  );
  // STOP previews since 2026-09-29 (his test list: the confirm names what
  // survives). Resume still does not: it only ever puts a deal back.
  const has = (name) => 'confirmed' in (tools.closureTools.find((t) => t.name === name).parameters?.properties ?? {});
  assert.equal(has('stop_deal'), true);
  assert.equal(has('resume_deal'), false);
});

test('A STOP PREVIEWS FIRST, and says what survives', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.stopDeal.handler({ person: 'Gloria' });
  assert.equal(out.pending, true);
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /WHAT SURVIVES/);
  assert.match(out.summary, /Archive/);
});

test('"DELETE" NEVER BECOMES A STOP', async () => {
  const { tools, wrote } = load([DEAL()]);
  const out = await tools.stopDeal.handler({ person: 'Gloria', said: 'delete gloria deal', confirmed: true });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /delete_master_sheet_row/);
});

test('THE ARCHIVE IS GROUPED AND NOTHING IS CUT', async () => {
  // Same shape and the same reason as the review queue: it was one long
  // sentence per deal repeating the company, the date and the reason.
  const many = Array.from({ length: 30 }, (_, i) => STOPPED({
    id: i + 1, person_id: `p${i}`, person_name: `Person ${i}`, company: `Co ${i}`,
  }));
  const { tools } = load(many);
  const out = await tools.listStoppedDeals.handler({});

  assert.match(out.summary, /^30\. Co 29, stopped /m, 'the last block is numbered 30');
  assert.doesNotMatch(out.summary, /not listed/);
  assert.equal(out.dealIds.length, 30);
});

test('THE REASON IS PART OF THE BLOCK, not merged away', async () => {
  // Two deals on one company stopped the same day for different reasons
  // are two different facts.
  const { tools } = load([
    STOPPED({ id: 1, person_id: 'a', person_name: 'Alex' }),
    STOPPED({ id: 2, person_id: 'b', person_name: 'Blake', stopped_reason: 'review_no' }),
  ]);
  const out = await tools.listStoppedDeals.handler({});
  assert.match(out.summary, /^1\. Northstar Care, stopped 31 August 2026, stopped by hand$/m);
  assert.match(out.summary, /^2\. Northstar Care, stopped 31 August 2026, answered no at review$/m);
});

test('AND THE DATE CARRIES ITS YEAR', async () => {
  const { tools } = load([STOPPED({ stopped_on: '2026-01-01' })]);
  const out = await tools.listStoppedDeals.handler({});
  assert.match(out.summary, /stopped 1 January 2026/);
  assert.doesNotMatch(out.summary, /December 2025/);
});

test('A STOP TELLS THE PAGES, as the page route does', async () => {
  const { watchWrites } = require('../../shared/writeTap.helper');
  const { tools } = load([DEAL()]);
  const { wrote } = await watchWrites(() => tools.stopDeal.handler({ person: 'Gloria', confirmed: true }));
  assert.equal(wrote, true);
});

// It printed the raw wage and added GBP to AED in one headline. 2026-09-28.
test('THE ARCHIVE SPEAKS RATED MONEY, one total per currency', async () => {
  const { tools } = load([
    DEAL({ stopped_on: '2026-09-01', stopped_reason: 'stopped_by_hand' }),
    DEAL({ id: 2, person_id: 'zayn', person_name: 'Zayn', currency: 'AED', monthly_amount: 1000, stopped_on: '2026-09-01', stopped_reason: 'stopped_by_hand' }),
  ], [['gloria', { addon: 5, fee: 0 }]]);
  const out = await tools.listStoppedDeals.handler({});
  assert.match(out.summary, /^2 stopped deals, GBP 2,100.00 and AED 1,000.00 a month between them./);
  assert.match(out.summary, /Gloria, Director, GBP 2,100.00/, 'each line rated too');
  assert.doesNotMatch(out.summary, /3,100|3,000/, 'never one sum across currencies');
});

// "what was stopped in ZZTEST" arrived as company ZZTEST and answered nothing. 2026-09-28.
test('A GROUP SENT AS A COMPANY IS READ AS THE GROUP', async () => {
  const { tools } = load([DEAL({ stopped_on: '2026-09-01', stopped_reason: 'stopped_by_hand' })]);
  const out = await tools.listStoppedDeals.handler({ company: 'ALPHA', said: 'what was stopped in alpha' });
  assert.match(out.summary, /^1 stopped deal,/);
});

// 2026-09-30: "bring casey test's deal back" was refused, the apostrophe
// broke the word match, and she answered with a deal count instead.
test('A RESUME IN THEIR OWN WORDS, apostrophe and all, is heard', async () => {
  const { tools } = load([STOPPED()]);
  const out = await tools.resumeDeal.handler({ person: 'Nicola', said: "actually bring nicola's deal back" });
  assert.doesNotMatch(out.summary, /did not ask to resume/);
});

test('A FEE CHANGE IS NEVER A RESUME', async () => {
  const { tools } = load([STOPPED()]);
  const out = await tools.resumeDeal.handler({ person: 'Nicola', said: "set nicola's fee to 3%" });
  assert.match(out.summary, /did not ask to resume/);
});
