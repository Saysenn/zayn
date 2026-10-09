const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { loadWith } = require('../testing/stubRepos');
// THE REAL PRECEDENCE, not a stub of it. Which of the three reasons wins
// is the thing these tests are about, so faking it would test the fake.
const { reviewReason, REVIEW_REASON } = require('./reviewQueue.helper');

/**
 * ***************************************************
 * * WHAT SHE SAYS WHEN YOU SIGN IN
 * ***************************************************
 *
 * A COUNT SHE SAYS, EVERY ROW SHE SHOWS. "Richard, Euro boss, Gab and 9 other
 * deals" hid the rows he needed. His call 2026-09-28.
 *
 * And every sentence is computed, never composed by a model: a model call
 * carries ~30,300 tokens before a word of conversation, and a number she
 * writes herself is a number she can get wrong.
 */

const SUBJECT = require.resolve('./briefing.helper');
const REVIEW = require.resolve('./reviewQueue.helper');
const ROWS = require.resolve('../repos/masterSheetRows.repo');
const CONCERNS = require.resolve('../repos/concerns.repo');
const SETTINGS = require.resolve('../repos/settings.repo');
const PEOPLE = require.resolve('../repos/people.repo');

// Owed this month, unpaid, nobody has touched the override.
const OWED = {
  id: 1,
  person_name: 'Gloria',
  company: 'Workforce',
  preset_on: '2026-09-01',
  payment_start_on: '2025-01-01',
  for_this_month: true,
  stopped_on: null,
  override_paid: null,
  needs_review: false,
};

function load({ due = [], rows = [], concerns = { rows: [], total: 0 } } = {}) {
  return loadWith(SUBJECT, {
    [REVIEW]: { dueThisMonth: async () => due, reviewReason, REVIEW_REASON },
    [ROWS]: { findAllRows: async () => rows },
    [CONCERNS]: { listGrouped: async () => concerns },
    [SETTINGS]: { get: async () => ({ color_uses_end_date: false, crypto_percent: 0 }) },
    [PEOPLE]: { rateMap: async () => new Map([['gloria', { addon: 5, fee: 0 }]]) },
  });
}

// ===============================
// * The list itself
// ===============================

test('A COUNT SAID, and EVERY ROW carried, never "and 2 others"', async () => {
  const due = [
    { id: 1, company: 'Workforce' }, { id: 2, company: 'Workforce' }, { id: 3, company: 'Relia PA' },
    { id: 4, company: 'Gab' }, { id: 5, company: 'KP' }, { id: 6, company: 'Kryptonia' },
  ];
  const out = await load({ due }).briefing('2026-09');
  const item = out.items.find((i) => i.key === 'pastYear');
  assert.equal(item.sentence, '6 deals are past a year.');
  assert.deepEqual(item.rows.map((r) => r.id), ['1', '2', '3', '4', '5', '6'], 'nothing cut');
  assert.doesNotMatch(item.sentence, /other|GBP|EUR|AED/);
});

/**
 * ===============================
 * * THE QUEUE IS SPLIT BY WHY
 * ===============================
 * "30 deals are up for review" is one sentence about three different
 * situations. A company winding down, a deal past its year and a row he
 * asked for by name need different answers, and hearing them as one number
 * tells somebody nothing about which they are looking at. His call
 * 2026-09-21.
 */
test('THREE REASONS, THREE LINES', async () => {
  const out = await load({
    due: [
      { company: 'A J Rayson', person_name: 'Abe', review_monthly: true, company_status: 'liquidation' },
      { company: 'A J Rayson', person_name: 'Juan', review_monthly: true, company_status: 'liquidation' },
      { company: 'Reliapay', person_name: 'Sean' },
      { company: 'Workforce', person_name: 'Richard', review_monthly: true, company_status: 'review' },
    ],
  }).briefing('2026-09');

  assert.deepEqual(out.items.map((i) => i.key), ['liquidating', 'pastYear', 'reviewMonthly']);
  assert.equal(out.items[0].sentence, '2 deals are on companies winding down.');
  assert.equal(out.items[1].sentence, '1 deal is past a year.');
  // THIS month, his words 2026-09-28, never "every month".
  assert.equal(out.items[2].sentence, '1 deal is marked for review this month.');
});

/**
 * THE TICK SAYS WHETHER, THE COMPANY SAYS WHICH. A row is here because
 * somebody ticked it or because a date passed; the company's status only
 * decides which of the two ticked lines it lands on. It is never said
 * twice.
 */
test('A TICKED DEAL ON A WINDING DOWN COMPANY IS ONE LINE, liquidation', async () => {
  const out = await load({
    due: [{
      company: 'Workforce', person_name: 'Klaud', review_monthly: true, company_status: 'liquidation',
    }],
  }).briefing('2026-09');
  assert.deepEqual(out.items.map((i) => i.key), ['liquidating']);
});

test('AND ONE WITH NO STATUS BEHIND IT IS THE REVIEW LINE', async () => {
  // His sheet writing "Reviewed monthly" on a row with no company status
  // is still somebody asking for it. Without this it belongs to no line at
  // all, which is how 12 Workforce rows would vanish.
  const out = await load({
    due: [{ company: 'Workforce', person_name: 'Richard', review_monthly: true, company_status: null }],
  }).briefing('2026-09');
  assert.deepEqual(out.items.map((i) => i.key), ['reviewMonthly']);
});

test('AN UNTICKED DEAL IS PAST A YEAR, whatever its company is doing', async () => {
  // Nobody ticked it, so the wind down is not what is being asked about.
  const out = await load({
    due: [{ company: 'Workforce', person_name: 'Gloria', review_monthly: false, company_status: 'liquidation' }],
  }).briefing('2026-09');
  assert.deepEqual(out.items.map((i) => i.key), ['pastYear']);
});

test('AN EMPTY BRIEFING IS EMPTY, never a cheerful zero', async () => {
  const out = await load().briefing('2026-09');
  assert.deepEqual(out.items, []);
});

test('MONEY FIRST, TIDYING LAST', async () => {
  const out = await load({
    due: [{ company: 'Workforce' }],
    rows: [OWED, { ...OWED, id: 2, person_name: 'Paddy', needs_review: true }],
    concerns: { rows: [{ person_name: 'Zayn' }], total: 1 },
  }).briefing('2026-09');
  assert.deepEqual(out.items.map((i) => i.key), ['pastYear', 'unpaid', 'concerns', 'needsReview']);
});

// ===============================
// * Unpaid, the one that is computed rather than counted
// ===============================

test('UNPAID IS WHAT THE MONTH OWES AND NOBODY TICKED', async () => {
  const out = await load({ rows: [OWED] }).briefing('2026-09');
  // PEOPLE, NOT DEALS (his call 2026-10-07)
  assert.equal(out.items.find((i) => i.key === 'unpaid').sentence,
    '1 person has not been marked paid this month.');
});

test('ONE PERSON, ONE ROW: their deals counted, each currency on its own', async () => {
  const out = await load({ rows: [
    { ...OWED, id: 1, person_id: 'nathan', person_name: 'Nathan', company: 'Acqua', group_name: 'INDIGO', currency: 'GBP', payable_amount: 500 },
    { ...OWED, id: 2, person_id: 'nathan', person_name: 'Nathan', company: 'Souracore', group_name: 'MILKMAN', currency: 'GBP', payable_amount: 700 },
    { ...OWED, id: 3, person_id: 'nathan', person_name: 'Nathan', company: 'Workforce', group_name: 'MILKMAN', currency: 'AED', payable_amount: 150 },
    { ...OWED, id: 4, person_id: 'abe', person_name: 'Abe', company: 'KP', group_name: 'NEXUS', currency: 'GBP', payable_amount: 300 },
  ] }).briefing('2026-09');
  const item = out.items.find((i) => i.key === 'unpaid');
  assert.equal(item.sentence, '2 people have not been marked paid this month.');
  const nathan = item.rows.find((r) => r.person === 'Nathan');
  assert.equal(nathan.deals, 3);
  assert.equal(nathan.company, null, 'several companies are a count, not one name');
  assert.equal(nathan.group, 'INDIGO, MILKMAN');
  assert.deepEqual(nathan.totals.map((t) => t.currency), ['GBP', 'AED']);
  assert.equal(nathan.id, 'person:nathan');
});

test('EACH ROW SAYS WHO, WHERE AND WHAT THEY ARE PAID, rates on', async () => {
  const out = await load({ rows: [{ ...OWED, person_id: 'gloria', group_name: 'INDIGO', currency: 'GBP', payable_amount: 2000 }] })
    .briefing('2026-09');
  assert.deepEqual(out.items.find((i) => i.key === 'unpaid').rows[0], {
    id: 'person:gloria', personId: 'gloria', person: 'Gloria', company: 'Workforce', deals: 1, group: 'INDIGO',
    amount: 2100, monthly: 0, currency: 'GBP', totals: [{ amount: 2100, currency: 'GBP' }],
  });
});

test('AN UNTOUCHED OVERRIDE IS NOT PAID, because NULL is a real third state', async () => {
  for (const override_paid of [null, false]) {
    const out = await load({ rows: [{ ...OWED, override_paid }] }).briefing('2026-09');
    assert.ok(out.items.find((i) => i.key === 'unpaid'), String(override_paid));
  }
  const paid = await load({ rows: [{ ...OWED, override_paid: true }] }).briefing('2026-09');
  assert.equal(paid.items.find((i) => i.key === 'unpaid'), undefined);
});

test('A STOPPED DEAL IS NOT UNPAID, it is over', async () => {
  const out = await load({ rows: [{ ...OWED, stopped_on: '2026-08-01' }] }).briefing('2026-09');
  assert.equal(out.items.find((i) => i.key === 'unpaid'), undefined);
});

test('A DEAL MARKED FOR ANOTHER MONTH IS NOT THIS MONTH\'S', async () => {
  const out = await load({ rows: [{ ...OWED, for_this_month: false, preset_on: '2026-08-01' }] })
    .briefing('2026-09');
  assert.equal(out.items.find((i) => i.key === 'unpaid'), undefined);
});

test('A DEAL WITH NO HANDLER IS NAMED BY ITS COMPANY', async () => {
  // A blank in the middle of a spoken sentence is worse than a company.
  const out = await load({ rows: [{ ...OWED, person_name: null }] }).briefing('2026-09');
  assert.equal(out.items.find((i) => i.key === 'unpaid').rows[0].person, 'Workforce');
});

// ===============================
// * The two that were named wrongly
// ===============================

/**
 * PEOPLE, NOT CONCERNS. `listGrouped` groups by PERSON, so its total is
 * how many people have something open, and one person can have five. It
 * read "15 concerns are still open" over a count of 15 people: a wrong
 * number wearing the right shape. Reported 2026-09-21.
 */
test('THE CONCERNS LINE COUNTS PEOPLE, and says whose flag it is', async () => {
  const out = await load({
    concerns: {
      rows: [{ person_id: 'zayn', person_name: 'Zayn', group_name: 'MILKMAN', concern_count: 3 }],
      total: 1,
    },
  }).briefing('2026-09');
  const item = out.items.find((i) => i.key === 'concerns');
  assert.equal(item.sentence, '1 person has 3 flags from whatbot, waiting on you.');
  assert.deepEqual(item.rows[0], { id: 'MILKMAN|zayn', personId: 'zayn', person: 'Zayn', group: 'MILKMAN', flags: 3 });
});

/**
 * AND "flagged" IS NOT ITS NAME EITHER. The Flagged PAGE is where the
 * concerns line goes; these are rows the import could not settle, and the
 * column is `needs_review`. One word for two things is how somebody clicks
 * the wrong line.
 */
test('THE IMPORT LINE IS needsReview, never flagged', async () => {
  const out = await load({
    rows: [{ ...OWED, needs_review: true, person_name: 'Paddy' }],
  }).briefing('2026-09');
  assert.equal(out.items.find((i) => i.key === 'flagged'), undefined);
  assert.equal(out.items.find((i) => i.key === 'needsReview').sentence, '1 row needs a check.');
});

// His call 2026-10-08: a portion or a changed answer is its own line, by person.
test('A PAYDAY FLAG IS THE PAYDAY LINE, not the check line', async () => {
  const out = await load({
    rows: [{ ...OWED, needs_review: true, person_name: 'Paddy', review_reason: 'payday says only part of the pay arrived' }],
  }).briefing('2026-09');
  assert.equal(out.items.find((i) => i.key === 'needsReview'), undefined);
  assert.equal(out.items.find((i) => i.key === 'payday').sentence,
    '1 person said only part of their pay arrived, or changed their payday answer.');
});

test('AND A STOPPED ROW IS NOT WAITING FOR A CHECK', async () => {
  const out = await load({
    rows: [{ ...OWED, needs_review: true, stopped_on: '2026-01-01' }],
  }).briefing('2026-09');
  assert.equal(out.items.find((i) => i.key === 'needsReview'), undefined);
});

// ===============================
// * The contract with the web half
// ===============================

/**
 * crm/api and crm/web SHARE NO FILE, and reading one across the boundary
 * is not an exemption. The web's half is
 * components/agentOrb/briefingAnswer.test.js, which pins that every one of
 * these has a route.
 */
test('THE NINE KEYS, and a new one is a deliberate change on BOTH sides', () => {
  const { SAY } = require('./briefing.helper');
  assert.deepEqual(Object.keys(SAY).sort(), [
    'concerns', 'liquidating', 'needsReview', 'pastYear', 'payableOver', 'payday', 'reviewMonthly', 'specialCase', 'unpaid',
  ]);
});

test('AND EVERY KEY POINTS AT ITS OTHER HALF', () => {
  const src = readFileSync(require.resolve('./briefing.helper'), 'utf8');
  assert.match(src, /NO ROUTES HERE/, 'the boundary has to be stated where it is kept');
});

// ===============================
// * Checks on the data itself, his call 2026-09-28
// ===============================

test('SPECIAL CASE STILL ON is its own line, a stopped deal is not', async () => {
  const out = await load({
    rows: [{ ...OWED, special_case_deal: true }, { ...OWED, id: 2, special_case_deal: true, stopped_on: '2026-08-01' }],
  }).briefing('2026-09');
  const item = out.items.find((i) => i.key === 'specialCase');
  assert.equal(item.sentence, '1 deal still has special case switched on.');
  assert.deepEqual(item.rows.map((r) => r.id), ['1']);
});

test('PAYABLE OVER MONTHLY carries both amounts, and equal is not over', async () => {
  const out = await load({
    rows: [
      { ...OWED, person_id: 'drew', payable_amount: 2000, monthly_amount: 1250 },
      { ...OWED, id: 2, person_id: 'even', payable_amount: 500, monthly_amount: 500 },
    ],
  }).briefing('2026-09');
  const item = out.items.find((i) => i.key === 'payableOver');
  assert.equal(item.sentence, '1 deal is payable more than its monthly amount this month.');
  assert.equal(item.rows.length, 1);
  assert.equal(item.rows[0].amount, 2000);
  assert.equal(item.rows[0].monthly, 1250);
});
