const test = require('node:test');
const assert = require('node:assert/strict');
const { presetNow } = require('../../testing/months');
const { stub } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * Ambiguity is about WHICH PERSON, not how many rows
 * ***************************************************
 *
 * "Show me all of Nicola's details" was answered with "there are 4 Nicolas
 * in INDIGO, which do you mean?" when it is ONE Nicola holding four
 * companies. Four rows is her answer, not an obstacle to it.
 *
 * Two DIFFERENT people still stops it dead. That is the rule worth keeping:
 * showing the wrong person's pay is worse than one extra question.
 */

function loadTool({ rows, loose = [], search = null }) {
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');

  for (const p of [toolPath, repoPath]) delete require.cache[p];
  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: new Proxy({
      async searchFuzzy(args) { return search ? search(args) : (args.loose ? loose : rows); },
      async findAll() { return { rows, total: rows.length }; },
    }, { get: (t, k) => (k in t ? t[k] : async () => []) }),
  };

  const { masterSheetTools } = require(toolPath);
  const tool = masterSheetTools.find((t) => t.name === 'find_and_show_details');
  assert.ok(tool, 'the tool must still be registered');
  return tool;
}

const deal = (over = {}) => ({
  id: 1,
  person_id: 'nicola',
  person_name: 'Nicola',
  company: 'Acqua resourcing',
  group_name: 'INDIGO',
  role_label: 'Mid 1',
  currency: 'GBP',
  ...over,
});

test("one person's four companies are shown, not queried", async () => {
  const tool = loadTool({
    rows: [
      deal({ id: 1, company: 'Acqua resourcing' }),
      deal({ id: 2, company: 'Leadstone solutions' }),
      deal({ id: 3, company: 'Social work partners PR' }),
      deal({ id: 4, company: 'Imperium resourcing PR' }),
    ],
  });
  // "show me": a card is drawn only when they ask to see one (his rule, 2026-10-03).
  const out = await tool.handler({ name: 'Nicola', said: "show me all of Nicola's details" });

  assert.equal(out.cards?.length, 4, 'every deal she holds is a card');
  assert.ok(!/which one/i.test(out.summary), 'it must not ask which one');
  assert.match(out.summary, /All 4 of their deals/);
});

test('two different people still stop it dead', async () => {
  // Neither is an exact hit, so there is a real choice to make. An EXACT
  // match deliberately wins outright: see the next test.
  const tool = loadTool({
    rows: [
      deal({ id: 1, person_id: 'nicola', person_name: 'Nicola' }),
      deal({ id: 2, person_id: 'nicolawong', person_name: 'Nicola Wong' }),
    ],
  });
  const out = await tool.handler({ name: 'Nic' });

  assert.equal(out.cards, undefined, 'nothing is shown until they pick');
  assert.match(out.summary, /2 different people/);
  assert.match(out.summary, /ask which ONE/);
});

test('the question names the PEOPLE, not every row', async () => {
  // Two people holding six deals between them is a choice of two, and
  // listing six rows makes the admin do the grouping themselves.
  const tool = loadTool({
    rows: [
      deal({ id: 1, person_id: 'a', person_name: 'Nicola', company: 'X' }),
      deal({ id: 2, person_id: 'a', person_name: 'Nicola', company: 'Y' }),
      deal({ id: 3, person_id: 'a', person_name: 'Nicola', company: 'Z' }),
      deal({ id: 4, person_id: 'b', person_name: 'Nicola Wong', company: 'X' }),
      deal({ id: 5, person_id: 'b', person_name: 'Nicola Wong', company: 'Y' }),
    ],
  });
  const out = await tool.handler({ name: 'Nic' });

  assert.match(out.summary, /2 different people/);
  assert.equal(out.summary.match(/Nicola Wong/g)?.length, 1, 'each person named once');
});

test('a single deal still reads as one card', async () => {
  const tool = loadTool({ rows: [deal()] });
  const out = await tool.handler({ name: 'Nicola', said: 'show me Nicola' });
  assert.equal(out.cards?.length, 1);
  assert.match(out.summary, /ALREADY ON SCREEN as a card/);
});

test('a successful details lookup ends with a short deterministic reply', async () => {
  const tool = loadTool({ rows: [deal()] });
  const out = await tool.handler({ name: 'Nicola', said: 'show me Nicola' });

  assert.equal(out.computedReply, true);
  assert.match(out.reply, /^Nicola has one deal\./);
  assert.doesNotMatch(out.reply, /paid another way|their profile|her profile/i);
});

test('two overlapping names explicitly requested together are both shown', async () => {
  const rows = [
    deal({ id: 1, person_id: 'gloria', person_name: 'Gloria', company: 'Workforce' }),
    deal({ id: 2, person_id: 'difference', person_name: 'Gloria difference', company: 'Workforce' }),
  ];
  const tool = loadTool({ rows });
  const out = await tool.handler({
    name: 'Gloria difference',
    said: 'show me Gloria and Gloria difference',
  });

  assert.deepEqual(out.cards.map((card) => card.name), ['Gloria', 'Gloria Difference']);
  assert.match(out.reply, /Gloria and Gloria Difference/);
});

test('multi-person recovery runs before a combined lookup phrase can miss', async () => {
  const rows = [
    deal({ id: 1, person_id: 'gloria', person_name: 'Gloria' }),
    deal({ id: 2, person_id: 'difference', person_name: 'Gloria difference' }),
  ];
  const tool = loadTool({
    rows,
    search: ({ q }) => (String(q).includes(' and ') ? [] : rows),
  });
  const out = await tool.handler({
    name: 'Gloria and Gloria difference',
    said: 'show me Gloria and Gloria difference',
  });

  assert.equal(out.cards.length, 2);
});

test('details put positive payable deals before zero-value deals', async () => {
  const tool = loadTool({
    rows: [
      deal({ id: 1, company: 'Zero', payable_amount: '0' }),
      deal({ id: 2, company: 'Paid', payable_amount: '700' }),
    ],
  });
  const out = await tool.handler({ name: 'Nicola', said: 'show me Nicola' });

  assert.deepEqual(out.cards.map((card) => card.headline), ['GBP 700', 'GBP 0']);
});

test('a company named with the person narrows details to that deal', async () => {
  const tool = loadTool({
    rows: [
      deal({ id: 1, company: 'Acqua resourcing' }),
      deal({ id: 2, company: 'Ackerman Pearce payroll' }),
      deal({ id: 3, company: 'Leadstone solutions' }),
    ],
  });
  const out = await tool.handler({
    name: 'Nicola',
    said: 'show me Nicola at Ackerman Pearce payroll',
  });

  assert.equal(out.cards.length, 1);
  assert.equal(out.rows[0].company, 'Ackerman Pearce payroll');
});

test('listing one person deals returns a compact chooser in stable order', async () => {
  const tool = loadTool({
    rows: [
      deal({ id: 3, company: 'Zero co', payable_amount: 0 }),
      deal({ id: 2, company: 'Leadstone solutions', payable_amount: 800 }),
      deal({ id: 1, company: 'Ackerman Pearce payroll', payable_amount: 1400 }),
    ],
  });
  const out = await tool.handler({ name: 'Nicola', said: 'list Nicola deals' });

  assert.equal(out.cards, undefined);
  assert.deepEqual(out.list.rows.map((row) => row.where), [
    'Ackerman Pearce payroll · INDIGO',
    'Leadstone solutions · INDIGO',
    'Zero co · INDIGO',
  ]);
  assert.doesNotMatch(out.reply, /every group/i);
});

test('an exact name wins over fuzzier neighbours, and still shows every deal', async () => {
  // Loosening the threshold so "Zine" finds "Zane" also made "Zane" match
  // "Zayn". An exact hit is not a question.
  const tool = loadTool({
    rows: [
      deal({ id: 1, person_id: 'zane', person_name: 'Zane', company: 'Workforce' }),
      deal({ id: 2, person_id: 'zane', person_name: 'Zane', company: 'Relia PA' }),
      deal({ id: 3, person_id: 'zayn', person_name: 'Zayn' }),
    ],
  });
  const out = await tool.handler({ name: 'Zane', said: 'show me Zane' });

  assert.equal(out.cards?.length, 2, 'both of Zane\'s deals, and none of Zayn\'s');
  assert.ok(!/different people/.test(out.summary));
});

/**
 * ===============================
 * * THE GLORIA LOOP
 * ===============================
 * "Gloria" fuzzy-matches both `Gloria` and `Gloria difference`, so the
 * total tool asked which; the admin said "Gloria"; it asked again, and
 * again. The question had no exit, because answering it re-ran the same
 * fuzzy search. An exact name now ends it.
 */
function loadTotal({ rows }) {
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
  const settingsPath = require.resolve('../../repos/settings.repo.js');
  // STUBBED TOO, or the handler reaches the real people repo for the fee
  // map, opens a pool and the test process never exits.
  const peoplePath = require.resolve('../../repos/people.repo.js');

  for (const p of [toolPath, repoPath, settingsPath, peoplePath]) delete require.cache[p];
  require.cache[repoPath] = stub({ async searchFuzzy() { return rows; } });
  require.cache[settingsPath] = stub({ async get() { return { color_uses_end_date: false }; } });
  require.cache[peoplePath] = stub({ async rateMap() { return new Map(); } });

  const { masterSheetTools } = require(toolPath);
  return masterSheetTools.find((t) => t.name === 'total_master_sheet');
}

const gloriaRows = [
  deal({
    id: 1, person_id: 'gloria', person_name: 'Gloria', company: 'Workforce', payable_amount: '500', preset_on: presetNow(),
  }),
  deal({
    id: 2, person_id: 'gloriadifference', person_name: 'Gloria difference', company: 'X', payable_amount: '900', preset_on: presetNow(),
  }),
];

test('answering the question with the exact name ENDS it', async () => {
  const tool = loadTotal({ rows: gloriaRows });
  const out = await tool.handler({ person: 'Gloria' });

  assert.ok(!/matches more than one person/.test(out.summary), out.summary);
  // HIS RULE 2026-10-07: "Gloria difference" is part of Gloria, so it is added in
  assert.equal(out.total?.GBP, 1400, 'Gloria and her difference, one person');
});

test('an ambiguous name still asks, and names them exactly as written', async () => {
  const tool = loadTotal({ rows: gloriaRows });
  const out = await tool.handler({ person: 'Glor' });

  assert.match(out.summary, /matches more than one person/);
  assert.match(out.summary, /Gloria, Gloria difference/);
  // So the admin can repeat one back and have it match exactly.
  assert.match(out.summary, /EXACTLY as written/);
  assert.equal(out.total, undefined, 'nothing is summed while it is ambiguous');
});

test('one person on several companies is summed, never queried', async () => {
  const tool = loadTotal({
    rows: [
      deal({ id: 1, person_id: 'gloria', person_name: 'Gloria', company: 'A', payable_amount: '500', preset_on: presetNow() }),
      deal({ id: 2, person_id: 'gloria', person_name: 'Gloria', company: 'B', payable_amount: '500', preset_on: presetNow() }),
    ],
  });
  const out = await tool.handler({ person: 'Gloria' });
  assert.equal(out.total?.GBP, 1000);
});

test('no match at all offers the closest names rather than dead-ending', async () => {
  const tool = loadTool({
    rows: [],
    loose: [deal({ id: 9, person_name: 'Nikola' })],
  });
  const out = await tool.handler({ name: 'Nicolla' });
  assert.match(out.summary, /No exact match/);
  assert.match(out.summary, /Nikola/);
  assert.equal(out.cards, undefined);
});

/**
 * ***************************************************
 * * A NARROWED ASK GETS A NARROWED ANSWER
 * ***************************************************
 *
 * Live 2026-09-17. "Whats richards payable days" drew a twenty cell card
 * and said "the full details are on screen". Fixing the sentence alone left
 * the value ON TOP of the same wall, which is not what was asked for
 * either.
 */
const richard = (over = {}) => deal({
  id: 91,
  person_id: 'richard',
  person_name: 'Richard',
  company: 'Workforce',
  group_name: 'ALL GROUPS',
  role_label: 'Loss lead',
  payable_days: 30,
  monthly_amount: '500',
  payable_amount: '500',
  payment_method: 'cash',
  ...over,
});

test('naming a field answers the VALUE and draws no card', async () => {
  const tool = loadTool({ rows: [richard()] });
  const out = await tool.handler({ name: 'Richard', said: 'whats richards payable days' });

  assert.equal(out.reply, "Richard's payable days: 30.");
  assert.equal(out.cards, undefined, 'the card was the answer to a question nobody asked');
  assert.doesNotMatch(out.summary, /on screen/);
});

// The case the first fix got wrong: "only" made her pass `show`, the old
// `!args.show` test threw the field answer away, and the admin got a
// narrowed card captioned "the full details are on screen".
test('"show me only his payable days" is still a FIELD ask, even with show set', async () => {
  const tool = loadTool({ rows: [richard()] });
  const out = await tool.handler({
    name: 'Richard', show: 'cash', said: 'show me only richard payable days',
  });

  assert.equal(out.reply, "Richard's payable days: 30.");
  assert.equal(out.cards, undefined);
});

// A payout SET is not a field. `Bank` is one cell inside the bank set, so
// answering that cell alone would hand back less than they asked for.
// The set is now SAID in full, bank, account and sort code, rather than a
// narrowed card (clone run 2026-10-05: "bank details is Barclays").
test('a bank details ask answers the whole set, never the one cell', async () => {
  const tool = loadTool({ rows: [richard({ bank_details: 'Barclays', account_number: '12345678' })] });
  const out = await tool.handler({
    name: 'Richard', show: 'bank', said: 'show me his bank details',
  });

  assert.equal(out.reply, "Richard's bank details are Barclays, account 12345678.");
  assert.equal(out.cards, undefined);
});

test('naming NO field keeps the card, so "show me richard" is unchanged', async () => {
  const tool = loadTool({ rows: [richard()] });
  const out = await tool.handler({ name: 'Richard', said: 'show me richard' });

  assert.equal(out.cards?.length, 1);
  assert.match(out.reply, /Richard has one deal/);
});

test('several deals keep the cards: there is no single value to say', async () => {
  const tool = loadTool({
    rows: [
      richard({ id: 91, company: 'Workforce', payable_days: 30 }),
      richard({ id: 92, company: 'Acqua', payable_days: 12 }),
    ],
  });
  const out = await tool.handler({ name: 'Richard', said: 'show me richards payable days' });

  assert.equal(out.cards?.length, 2);
  assert.doesNotMatch(out.reply, /payable days: /);
});

/**
 * ===============================
 * * WHY A ROW IS NOT IN THE MONTH, in words
 * ===============================
 * "Why is Richard not payable this month" was answered "monthly 500,
 * payable 0", which is true and is not the reason. The reason was 0
 * payable days and nothing on the card said it.
 */
const notPayable = (over = {}) => richard({
  payment_period: 'active', payable_amount: '0', payable_days: 0, ...over,
});

test('an ACTIVE row owing nothing says WHY', async () => {
  const tool = loadTool({ rows: [notPayable()] });
  const out = await tool.handler({ name: 'Richard', said: 'why is he not payable this month' });
  assert.equal(out.reply, "Richard's payable this month: No, payable days is 0.");
});

test('a row that owes something says yes', async () => {
  const tool = loadTool({ rows: [notPayable({ payable_amount: '500', payable_days: 30 })] });
  const out = await tool.handler({ name: 'Richard', said: 'is he payable this month' });
  assert.equal(out.reply, "Richard's payable this month: Yes.");
});

test('and an ended row names the period, not the day count', async () => {
  const tool = loadTool({ rows: [notPayable({ payment_period: 'ended' })] });
  const out = await tool.handler({ name: 'Richard', said: 'is he payable this month' });
  assert.equal(out.reply, "Richard's payable this month: No, Ended.");
});

// A read that did not ask for the period cannot answer the question, and a
// guessed answer about money is worse than an empty cell.
test('with no period read, the cell is empty rather than guessed', async () => {
  const tool = loadTool({ rows: [richard({ payment_period: undefined })] });
  const out = await tool.handler({ name: 'Richard', said: 'is he payable this month' });
  assert.equal(out.reply, "Richard's payable this month: not set.");
});

// ===============================
// * THE COMPANY'S status, from the PERSON
// ===============================
// "Is Richard's company liquidating" hunted for a company CALLED Richard
// and burned four tool calls.
test("a person's company status is answerable from their row", async () => {
  const tool = loadTool({ rows: [richard({ company_status: 'liquidation' })] });
  const out = await tool.handler({ name: 'Richard', said: "is richard's company liquidating" });
  assert.equal(out.reply, "Richard's company status: Liquidation.");
});

test('and the plain company question still gives the NAME', async () => {
  const tool = loadTool({ rows: [richard({ company_status: 'active' })] });
  const out = await tool.handler({ name: 'Richard', said: 'whats his company' });
  assert.equal(out.reply, "Richard's company: Workforce.");
});
