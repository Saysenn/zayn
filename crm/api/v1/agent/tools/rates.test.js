const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');
const { currentMonth } = require('../../shared/presetMonth.helper');

// RELATIVE, never a literal month. A month far from the business month with
// no year in `said` is treated as a guess and dropped, so a pinned 2026-08
// passes today and fails once test:drift runs the suite years on.
const MONTH = currentMonth();

/**
 * ***************************************************
 * * She can READ a rate, and a card carries only what was asked
 * ***************************************************
 *
 * She could SET a person's two rates and read none of them, which is the
 * wrong way round: asked "what is Gloria on" she had to guess.
 */

const ROWS = [
  {
    id: 1, person_id: 'gloria', person_name: 'Gloria', company: 'A J Rayson', group_name: 'NEXUS',
    role_label: 'Closure', payable_amount: 500, currency: 'GBP', payment_method: 'bank',
    addon_percent: 3, fee_percent: 0, bank_details: 'Barclays', account_number: '63618234',
    sort_code: '20 - 72 - 91', phone: '+447950463625', postcode: 'RM3 8JA', location: 'Main City',
    monthly_amount: 500, payable_days: 31, preset_on: `${MONTH}-01`, notes: '', label: '',
  },
  {
    id: 2, person_id: 'gloria', person_name: 'Gloria', company: 'Workforce', group_name: 'INDIGO',
    role_label: 'Closer', payable_amount: 500, currency: 'GBP', payment_method: 'crypto',
    addon_percent: 0, fee_percent: 0, monthly_amount: 500, payable_days: 31, preset_on: `${MONTH}-01`,
  },
];

function load({ rows = ROWS, cryptoPercent = 1, rates = new Map([['gloria', { addon: 5, fee: 2 }]]) } = {}) {
  const toolPath = require.resolve('./masterSheet.js');
  const paths = {
    rowsRepo: require.resolve('../../repos/masterSheetRows.repo.js'),
    people: require.resolve('../../repos/people.repo.js'),
    companies: require.resolve('../../repos/companies.repo.js'),
    concerns: require.resolve('../../repos/concerns.repo.js'),
    settings: require.resolve('../../repos/settings.repo.js'),
    sockets: require.resolve('../../sockets/index.js'),
  };
  for (const p of [toolPath, ...Object.values(paths)]) delete require.cache[p];

  require.cache[paths.rowsRepo] = stub({ async searchFuzzy() { return rows; } });
  require.cache[paths.people] = stub({ async rateMap() { return rates; } });
  require.cache[paths.companies] = stub({});
  require.cache[paths.concerns] = stub({});
  require.cache[paths.settings] = stub({
    async get() { return { color_uses_end_date: false, crypto_percent: cryptoPercent }; },
  });
  require.cache[paths.sockets] = { id: 'x', filename: 'x', loaded: true, exports: { broadcast() {} } };

  const { masterSheetTools } = require(toolPath);
  return (n) => masterSheetTools.find((t) => t.name === n);
}

/* ===============================
 * * check_rates
 * =============================== */

test('it answers all three rates, per deal, with the direction on each', async () => {
  const out = await load()('check_rates').handler({ person: 'Gloria' });

  assert.equal(out.person.addon, 5, 'her standing add on');
  assert.equal(out.person.fee, 2);
  assert.deepEqual(out.deals.map((d) => d.addonPercent), [8, 5], '5% + 3% on the first row');
  assert.deepEqual(out.deals.map((d) => d.cryptoPercent), [0, 1], 'only the crypto row');
  for (const word of ['added', 'deducted', 'crypto']) {
    assert.ok(out.summary.includes(word), `the summary must say "${word}"`);
  }
});

test('NEVER a rate without its direction', async () => {
  // "Gloria is on 5%" is useless: added and deducted are ten percent apart.
  const out = await load()('check_rates').handler({ person: 'Gloria' });
  assert.match(out.summary, /add on .*added/);
  assert.match(out.summary, /fee .*deducted/);
  assert.match(out.summary, /never call an effective figure the deal's own rate/);
});

/**
 * ===============================
 * * A STACKED RATE PRINTED AS THE DEAL'S OWN
 * ===============================
 * These lines are EFFECTIVE figures, person plus deal, and only the
 * heading said so. Each line read "Workforce in INDIGO: 5% add on", so
 * she told the admin "their deal at INDIGO has a 5% add on" when that
 * deal carries 0% and the 5% is the person's. Live 2026-09-24, and again
 * one line down as an 8% on a deal holding 3%.
 */
test('EVERY LINE carries its own split, because a heading is not a label', async () => {
  const out = await load()('check_rates').handler({ person: 'Gloria' });
  assert.match(out.summary, /\(person \d+(?:\.\d+)?% \+ deal \d+(?:\.\d+)?%\)/);
});

test('it says person and deal STACK, because she would invent it otherwise', async () => {
  const out = await load()('check_rates').handler({ person: 'Gloria' });
  assert.match(out.summary, /stacks on top of it, never\s+replacing it/);
  assert.match(out.summary, /Add ons are applied first/);
});

// ===============================
// * The crypto charge, only where it applies
// ===============================
//
// Real transcript. Asked about Gloria, who is paid entirely in cash, she
// volunteered the 1% crypto charge. Told to stop she agreed warmly, then
// did it again next turn: the tool appended the line to EVERY answer, so
// there was nothing she could have done differently.

const CASH_ONLY = [{
  id: 3, person_id: 'abe', person_name: 'Abe Lincoln', company: 'Umbrella co', group_name: 'INDIGO',
  role_label: 'Mid 2', payable_amount: 500, currency: 'GBP', payment_method: 'cash',
  addon_percent: 0, fee_percent: 0, monthly_amount: 500, payable_days: 31, preset_on: `${MONTH}-01`,
}];

test('no crypto row, no crypto charge in the answer', async () => {
  const out = await load({ rows: CASH_ONLY, rates: new Map() })('check_rates')
    .handler({ person: 'Abe Lincoln' });

  /**
   * SILENT, NOT TOLD TO BE SILENT.
   *
   * This used to require the summary to SAY "do NOT mention the crypto
   * charge", and the test worked around its own instruction to check the
   * rate was absent. Then she read that instruction out: "None of their
   * deals is paid in coin", to an admin who had not asked. Live
   * 2026-09-24.
   *
   * The words are not supplied at all now, so the whole subject is
   * absent rather than forbidden.
   */
  assert.ok(!/crypto/i.test(out.summary), 'the crypto charge is still in the answer');
  assert.ok(!/coin/i.test(out.summary), 'it hands her the sentence she read out');
  assert.ok(!/1%/.test(out.summary.split('Effective per deal:')[0]), 'the rate leaked anyway');
});

test('a crypto row still gets the charge, or the fix went too far', async () => {
  // Guards the guard: the test above passes trivially if the line is gone.
  const out = await load()('check_rates').handler({ person: 'Gloria' });
  assert.match(out.summary, /crypto charge is 1%/);
});

test('a name that matches nobody says only that', async () => {
  const out = await load({ rows: [] })('check_rates').handler({ person: 'Nobody' });
  assert.ok(!/crypto/i.test(out.summary), 'the crypto rate rode along on a failed search');
  assert.match(out.summary, /check the spelling/);
});

test('with no person it answers the crypto rate alone', async () => {
  const out = await load({ cryptoPercent: 2.5 })('check_rates').handler({});
  assert.match(out.summary, /2\.5%/);
  assert.match(out.summary, /cannot change it/, 'it is read only');
  assert.equal(out.deals, undefined);
});

test('two different people stops it dead, same rule as everywhere', async () => {
  const rows = [
    { ...ROWS[0], person_id: 'gloria', person_name: 'Gloria' },
    { ...ROWS[0], id: 9, person_id: 'gloria-nexus', person_name: 'Gloria' },
  ];
  const out = await load({ rows })('check_rates').handler({ person: 'Gloria' });
  assert.match(out.summary, /more than one person/);
  assert.equal(out.deals, undefined, 'nothing shown until they pick');
});

/* ===============================
 * * Bank details nobody has
 * =============================== */
//
// Real transcript. Asked for bank details for three people she drew seven
// full cards and then said none of them had any. The cards answered a
// question nobody asked.

const NO_BANK = [
  {
    id: 10, person_id: 'paddy', person_name: 'Paddy', company: 'Workforce', group_name: 'ALL GROUPS',
    role_label: 'Admin', payable_amount: 13500, currency: 'AED', payment_method: 'bank',
    bank_details: 'Will never be bank', account_number: 'Will never be bank',
    sort_code: 'Will never be bank', monthly_amount: 13500, payable_days: 31,
  },
];

test('asked for bank details nobody has, she says so in a sentence', async () => {
  const out = await load({ rows: NO_BANK })('find_and_show_details')
    .handler({ name: 'Paddy', show: 'bank' });

  assert.equal(out.cards, undefined, 'it drew cards to say there was nothing to draw');
  assert.match(out.summary, /NOT ONE of them has bank details/);
  assert.match(out.summary, /Do not list\s+the rows/);
});

// A CARD ONLY WHEN THEY ASK TO SEE ONE (his rule, 2026-10-03), so every
// test that expects a card says so the way the admin would.
const SHOW_ME = "show me Gloria's card";

test('a real account number still gets its card', async () => {
  // Guards the guard: the test above passes trivially if cards never come
  // back. Gloria's first row has Barclays and an account number on it.
  const out = await load()('find_and_show_details').handler({ name: 'Gloria', show: 'bank', said: SHOW_ME });
  assert.ok(Array.isArray(out.cards) && out.cards.length > 0, 'a bank row must still show');
});

test('a SENTINEL is not a bank detail', async () => {
  // "Will never be bank" is the sheet saying there is nothing to pay into,
  // so a row full of it must count as having none.
  const blank = [{ ...NO_BANK[0], bank_details: '', account_number: '', sort_code: '' }];
  const out = await load({ rows: blank })('find_and_show_details')
    .handler({ name: 'Paddy', show: 'bank' });
  assert.equal(out.cards, undefined, 'empty columns must read the same as the sentinel');
});

/* ===============================
 * * a card of what was asked for
 * =============================== */

const labelsOf = (card) => card.groups.flatMap((g) => g.cells.map((c) => c.label));

test('`show: bank` returns the bank fields and drops the rest', async () => {
  const out = await load()('find_and_show_details').handler({ name: 'Gloria', show: 'bank', said: SHOW_ME });
  const labels = labelsOf(out.cards[0]);

  for (const want of ['Company', 'Phone', 'Payable', 'Bank', 'Account', 'Sort code']) {
    assert.ok(labels.includes(want), `${want} is a bank column`);
  }
  for (const gone of ['Appointment', 'Preset', 'End', 'Postcode', 'Monthly']) {
    assert.ok(!labels.includes(gone), `${gone} is not, and must go`);
  }
});

test('the NAME survives every narrowing, because a nameless card is dangerous', async () => {
  for (const show of ['bank', 'cash', 'expensing']) {
    const out = await load()('find_and_show_details').handler({ name: 'Gloria', show, said: SHOW_ME });
    assert.equal(out.cards[0].name, 'Gloria', show);
  }
});

test('it SAYS it narrowed, so nobody reads a short card as the whole row', async () => {
  const out = await load()('find_and_show_details').handler({ name: 'Gloria', show: 'bank' });
  assert.match(out.summary, /Showing the bank fields only/);
});

test('no `show` is the FULL card, unchanged', async () => {
  const out = await load()('find_and_show_details').handler({ name: 'Gloria', said: SHOW_ME });
  const labels = labelsOf(out.cards[0]);
  for (const want of ['Appointment', 'Preset', 'Bank', 'Monthly', 'Postcode']) {
    assert.ok(labels.includes(want), want);
  }
  assert.ok(!out.summary.includes('Showing the'), 'nothing was narrowed');
});

test('THE COLUMN SETS ARE THE EXPORT`S, never a second list', async () => {
  // A fourth list here would be a second answer to "what does a bank run
  // need", and the two would drift the first time either was touched.
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet.js'), 'utf8');
  assert.match(src, /const \{ SEND \} = require\('\.\.\/\.\.\/masterSheet\/buildPayoutSheet'\)/);

  const { SEND, REQUIRED } = require('../../masterSheet/buildPayoutSheet');
  for (const set of Object.values(SEND)) {
    for (const col of REQUIRED) assert.ok(set.includes(col), `${col} must be in every set`);
  }
});

/* ===============================
 * * she can read and write a DEAL's rates
 * =============================== */

test('every summarised row carries the deal rates', async () => {
  const out = await load()('find_and_show_details').handler({ name: 'Gloria' });
  assert.equal(out.rows[0].addonPercent, 3);
  assert.equal(out.rows[0].feePercent, 0);
  assert.equal(out.rows[1].paymentMethod, 'crypto', 'so she can see why a crypto charge applies');
});

test('she can SET a deal rate, capped at the same number the route uses', () => {
  const { MAX_PERCENT } = require('../../shared/rates.helper');
  const tool = load()('update_master_sheet_row');
  const props = tool.parameters.properties.fields?.properties ?? tool.parameters.properties;

  for (const field of ['addonPercent', 'feePercent']) {
    assert.ok(props[field], `${field} must be settable`);
    assert.equal(props[field].maximum, MAX_PERCENT, 'one cap, not a second literal');
  }
});

/* ===============================
 * * "Gloria" must not match "Gloria difference"
 * =============================== */

// The real sheet: one Gloria on four groups, plus a separate person called
// "Gloria difference". Asked for Gloria's fee she asked which, and
// answering "Gloria" re-ran the same fuzzy search and asked again, forever.
const GLORIAS = [
  { ...ROWS[0], id: 1, person_id: 'gloria', person_name: 'Gloria', group_name: 'INDIGO' },
  { ...ROWS[0], id: 2, person_id: 'gloria', person_name: 'Gloria', group_name: 'MILKMAN' },
  { ...ROWS[0], id: 3, person_id: 'gloria', person_name: 'Gloria', group_name: 'MANBAT' },
  { ...ROWS[0], id: 4, person_id: 'gloriadiff', person_name: 'Gloria difference', group_name: 'ALL GROUPS' },
];

test('THE LOOP: typing the name EXACTLY resolves it', async () => {
  const tool = load({ rows: GLORIAS })('check_rates');
  for (const typed of ['Gloria', 'gloria', '  Gloria  ']) {
    const out = await tool.handler({ person: typed });
    assert.equal(out.person?.name, 'Gloria', typed);
    assert.equal(out.deals.length, 3, 'her three deals, not the other person');
  }
});

test('the OTHER person is reachable by their own exact name', async () => {
  const out = await load({ rows: GLORIAS })('check_rates').handler({ person: 'Gloria difference' });
  assert.equal(out.person.name, 'Gloria difference');
  assert.equal(out.deals.length, 1);
});

test('a partial name still ASKS, and offers the names exactly as written', async () => {
  const out = await load({ rows: GLORIAS })('check_rates').handler({ person: 'Glor' });
  assert.equal(out.deals, undefined, 'nothing until they pick');
  assert.match(out.summary, /Gloria, Gloria difference/, 'both offered, verbatim');
  assert.match(out.summary, /EXACTLY as written/);
  assert.match(out.summary, /resolves it/, 'the question must say how to end it');
});

/* ===============================
 * * THE NAME SHE SHORTENED
 * =============================== */

test('THE LONGEST NAME THEY ACTUALLY SAID WINS', async () => {
  // Live transcript. Asked to "show me gloria difference" she called the
  // tool with "Gloria", because `difference` reads as the English word,
  // and Gloria's four deals came back instead of Gloria difference's one.
  // She then asked what they wanted to know "about the difference".
  const { resolvePerson } = require('./resolvePerson');
  const rows = [
    { person_id: 'gloria', person_name: 'Gloria' },
    { person_id: 'gd', person_name: 'Gloria difference' },
  ];

  const short = resolvePerson(rows, 'Gloria', 'show me gloria difference');
  assert.deepEqual(short.rows.map((r) => r.person_name), ['Gloria difference']);

  // A TYPO IN THE SENTENCE STILL LANDS. "sohw me gloria - diference".
  const typo = resolvePerson(rows, 'Gloria', 'sohw me gloria - diference');
  assert.deepEqual(typo.rows.map((r) => r.person_name), ['Gloria difference']);
});

test('GUARDS THE GUARD: plain "Gloria" must not become the longer one', async () => {
  // The sentence decides, so a sentence that never says "difference" must
  // leave her with Gloria. Without this the fix would silently redirect
  // every lookup to whichever name happens to be longest.
  const { resolvePerson } = require('./resolvePerson');
  const rows = [
    { person_id: 'gloria', person_name: 'Gloria' },
    { person_id: 'gd', person_name: 'Gloria difference' },
  ];

  for (const said of ['show me gloria details', 'what is gloria owed this month', '']) {
    const out = resolvePerson(rows, 'Gloria', said);
    assert.deepEqual(out.rows.map((r) => r.person_name), ['Gloria'], `"${said}"`);
  }
});

test('punctuation and spacing are not the name', () => {
  const { resolvePerson } = require('./resolvePerson');
  const rows = [{ person_id: 'gd', person_name: 'Gloria difference' }, { person_id: 'z', person_name: 'Zayn' }];
  for (const typed of ['Gloria difference', 'gloria-difference', 'GLORIA  DIFFERENCE']) {
    const out = resolvePerson(rows, typed);
    assert.equal(out.ambiguous, false, typed);
    assert.equal(out.rows[0].person_name, 'Gloria difference', typed);
  }
});

test('a typo may never reach a SECOND person', () => {
  // The tolerance exists to forgive a slip, never to choose between two
  // people. Two candidates in range is a real question.
  const { resolvePerson } = require('./resolvePerson');
  const rows = [
    { person_id: 'a', person_name: 'Jonathan Smithe' },
    { person_id: 'b', person_name: 'Jonathan Smythe' },
  ];
  const out = resolvePerson(rows, 'Jonathan Smithh');
  assert.equal(out.ambiguous, true, 'it picked one of two near-identical names');
});

test('ONE definition of the exit, so a fifth tool cannot forget half of it', () => {
  // It was written out four times and the fourth copy had the ambiguity
  // check WITHOUT the exact-name exit, which is what caused the loop.
  const read = (m) => require('node:fs').readFileSync(require.resolve(m), 'utf8');
  const owner = read('./resolvePerson.js');
  const tools = read('./masterSheet.js');

  // MATCHED ON THE ACT, not the keyword. This grepped `const exact = ` and
  // failed the day the resolver learned to fall back to a near match, which
  // needed a `let`. A test that breaks on a keyword is testing the spelling.
  assert.equal(
    (owner.match(/exact = rows\.filter/g) || []).length, 1,
    'the exact-match filter lives in resolvePerson.js, once',
  );
  // The point of the move: no tools file may grow its own copy back.
  assert.equal(
    (tools.match(/exact = rows\.filter/g) || []).length, 0,
    'masterSheet.js has a second copy of the exit again',
  );
  // Every tool that takes a name goes through it.
  assert.ok((tools.match(/resolvePerson\(/g) || []).length >= 5, 'declared once, called by each tool');
});

/* ===============================
 * * Several people in one answer, and converted
 * =============================== */

const MIXED = [
  { ...ROWS[0], id: 1, person_id: 'gloria', person_name: 'Gloria', payable_amount: 500, currency: 'GBP', payment_method: 'cash', addon_percent: 0, for_this_month: true, payment_start_on: '2025-01-01', end_on: null, status: 'active' },
  { ...ROWS[0], id: 2, person_id: 'gloria', person_name: 'Gloria', payable_amount: 1500, currency: 'GBP', payment_method: 'cash', addon_percent: 0, for_this_month: true, payment_start_on: '2025-01-01', end_on: null, status: 'active' },
  { ...ROWS[0], id: 3, person_id: 'gd', person_name: 'Gloria difference', payable_amount: 150, currency: 'AED', payment_method: 'cash', addon_percent: 0, for_this_month: true, payment_start_on: '2025-01-01', end_on: null, status: 'active' },
];

function loadTotals({ rows = MIXED, fx = null } = {}) {
  const fxPath = require.resolve('../../shared/fxRates.helper.js');
  delete require.cache[fxPath];
  require.cache[fxPath] = {
    id: 'x',
    filename: 'x',
    loaded: true,
    exports: {
      async usdPerGbp() {
        return fx ?? {
          usdPerGbp: 1.362553, perUsd: { GBP: 1 / 1.362553, USD: 1, AED: 3.6725 },
          source: 'live', asOf: 'Fri, 29 Aug 2026',
        };
      },
    },
  };
  const byName = (q) => rows.filter((r) => r.person_name.toLowerCase().startsWith(String(q).toLowerCase().slice(0, 4)));
  return load({ rows, rates: new Map() , cryptoPercent: 0 }) && (() => {
    const toolPath = require.resolve('./masterSheet.js');
    const rowsPath = require.resolve('../../repos/masterSheetRows.repo.js');
    delete require.cache[toolPath];
    delete require.cache[rowsPath];
    // findAll too: the totals tool reads the WHOLE sheet to see whether the
    // sentence named a second person, because the fuzzy match for one name
    // cannot see the other. A stub missing it made the guard read undefined.
    require.cache[rowsPath] = stub({
      async searchFuzzy({ q }) { return byName(q); },
      async findAll() { return { rows, total: rows.length }; },
    });
    const { masterSheetTools } = require(toolPath);
    return (n) => masterSheetTools.find((t) => t.name === n);
  })();
}

test('SEVERAL PEOPLE are added ONCE, not by her calling twice', async () => {
  const out = await loadTotals()('total_master_sheet')
    .handler({ people: ['Gloria', 'Gloria difference'], month: MONTH });

  assert.equal(out.total.GBP, 2000, 'both of Gloria`s rows');
  assert.equal(out.total.AED, 150);
  assert.match(out.reply, /Gloria: GBP 2,000/);
  assert.match(out.reply, /Gloria Difference: AED 150/);
});

test('combined people stay in the order the admin requested', async () => {
  const out = await loadTotals()('total_master_sheet').handler({
    people: ['Gloria difference', 'Gloria'],
    month: MONTH,
    said: 'show Gloria and Gloria difference totals',
  });

  assert.ok(out.reply, JSON.stringify(out));
  assert.ok(out.reply.indexOf('Gloria: GBP') < out.reply.indexOf('Gloria Difference: AED'));
});

test('CONVERTED only when asked, with a compact combined line', async () => {
  const tool = loadTotals()('total_master_sheet');

  const plain = await tool.handler({ people: ['Gloria', 'Gloria difference'], month: MONTH });
  assert.equal(plain.converted, null, 'never converts unasked');

  const usd = await tool.handler({ people: ['Gloria', 'Gloria difference'], month: MONTH, convertTo: 'USD', said: 'what is that in dollars' });
  // 2,000 GBP at 1.362553 is 2,725.11, plus 150 AED at 3.6725 is 40.85.
  assert.equal(usd.converted.usd, 2765.95);
  assert.equal(usd.converted.rate, 1.362553);
  assert.match(usd.reply, /Combined in USD: USD 2,765\.95/);
});

test('an explicit USD request is completed even when the model omits convertTo', async () => {
  const out = await loadTotals()('total_master_sheet').handler({
    people: ['Gloria', 'Gloria difference'],
    month: MONTH,
    said: 'add Gloria and Gloria difference then convert it to USD',
  });

  assert.equal(out.converted.usd, 2765.95);
  assert.match(out.reply, /Combined in USD: USD 2,765\.95/);
});

test('a currency with NO RATE is named and left out, never converted at par', async () => {
  // Converting an unsourced currency at 1:1 is how a figure becomes wrong
  // without looking wrong.
  const rows = [{ ...MIXED[0], currency: 'XYZ', payable_amount: 900 }];
  const out = await loadTotals({ rows })('total_master_sheet')
    .handler({ people: ['Gloria'], month: MONTH, convertTo: 'USD', said: 'what is that in dollars' });

  assert.equal(out.converted.usd, 0, 'nothing convertible');
  assert.deepEqual(out.converted.unconvertible, ['XYZ 900']);
  assert.match(out.reply, /Not converted: XYZ 900/);
});

test('the rate SOURCE travels, so a fallback cannot pass as live', async () => {
  const fx = {
    usdPerGbp: 1.362553, perUsd: { GBP: 1 / 1.362553 }, source: 'fallback: rates endpoint timed out', asOf: null,
  };
  const out = await loadTotals({ fx })('total_master_sheet')
    .handler({ people: ['Gloria'], month: MONTH, convertTo: 'USD', said: 'what is that in dollars' });

  assert.match(out.converted.source, /fallback/);
  assert.ok(!out.reply.includes("today's rate"), 'a stale rate must not read as live');
});

test('ONE unresolvable name refuses the WHOLE total', async () => {
  // A combined figure quietly missing somebody is worse than a question.
  const out = await loadTotals()('total_master_sheet')
    .handler({ people: ['Gloria', 'Nobody At All'], month: MONTH });

  assert.equal(out.total, undefined, 'no figure at all');
  assert.match(out.summary, /matches nobody/);
  assert.match(out.summary, /worse than a question/);
});

/* ===============================
 * * The exchange rate, with its provenance
 * =============================== */

function loadFx(fx) {
  const toolPath = require.resolve('./masterSheet.js');
  const fxPath = require.resolve('../../shared/fxRates.helper.js');
  delete require.cache[toolPath];
  delete require.cache[fxPath];
  require.cache[fxPath] = {
    id: 'x', filename: 'x', loaded: true, exports: { async usdPerGbp() { return fx; } },
  };
  return require(toolPath).masterSheetTools.find((t) => t.name === 'exchange_rate');
}

const LIVE = {
  usdPerGbp: 1.3625531234,
  perUsd: { GBP: 0.73, USD: 1, AED: 3.6725, EUR: 0.85, ALL: 95 },
  source: 'live',
  asOf: 'Fri, 29 Aug 2026 00:02:31 +0000',
};

test('SIX DECIMALS, never 1.36', async () => {
  // The conversions always used the full rate. A reader checking 9,275 GBP
  // against a two decimal rate lands twenty dollars out.
  const out = await loadFx(LIVE).handler();
  // The STATEMENT of the rate, not the whole summary: the instruction below
  // it names 1.36 deliberately, telling her not to round to it.
  const stated = out.summary.match(/USD per GBP is (\d+\.\d+)/)[1];
  assert.equal(stated, '1.362553', 'six decimals, from a rate carrying more');
  assert.match(out.summary, /SIX DECIMALS/, 'and she is told to say it that way');
});

test('it says WHERE the rate came from, and when', async () => {
  const out = await loadFx(LIVE).handler();
  assert.equal(out.live, true);
  assert.match(out.summary, /It is live/);
  assert.match(out.summary, /published Fri, 29 Aug 2026/);
});

test('a FALLBACK must not read as live', async () => {
  // Stale and live look identical in a figure. This is the whole reason
  // `source` travels with the rate.
  const out = await loadFx({
    usdPerGbp: 1.362553, perUsd: { GBP: 0.73 }, source: 'fallback: rates endpoint timed out', asOf: null,
  }).handler();

  assert.equal(out.live, false);
  assert.match(out.summary, /NOT live/);
  assert.match(out.summary, /Say that out loud/);
});

test('the AED PEG is named as a peg, not a rate', async () => {
  const out = await loadFx(LIVE).handler();
  assert.equal(out.aedPerUsd, 3.6725);
  assert.match(out.summary, /pegged at 3\.6725/);
  assert.match(out.summary, /does not depend on the feed/);
});

test('a follow-up can request only the currencies used in the conversion', async () => {
  const out = await loadFx(LIVE).handler({ currencies: ['GBP', 'AED'] });

  assert.match(out.reply, /^Here are the current exchange rates:/);
  assert.match(out.reply, /1 GBP = 1\.362553 USD/);
  assert.match(out.reply, /1 USD = 3\.6725 AED/);
  assert.doesNotMatch(out.reply, /EUR/);
  assert.equal(out.computedReply, true);
});

test('a rate reply uses plain readable lines and clear cached wording', async () => {
  const out = await loadFx({ ...LIVE, source: 'cache' }).handler({ currencies: ['GBP', 'AED'] });

  assert.doesNotMatch(out.reply, /[â€¢•]/);
  assert.match(out.reply, /Current cached rate, published/);
  assert.doesNotMatch(out.reply, /Live rate, cached/);
});

test('the previous conversion limits a rate follow-up even if the model omits currencies', async () => {
  const out = await loadFx(LIVE).handler({
    priorAnswer: 'Gloria is owed GBP 2,000.\nIn USD: USD 2,725.11.',
  });

  assert.match(out.reply, /1 GBP = 1\.362553 USD/);
  assert.doesNotMatch(out.reply, /AED|EUR/);
});

test('ordinary words in a prior answer are never inferred as currencies', async () => {
  const out = await loadFx(LIVE).handler({
    currencies: ['GBP', 'ALL'],
    priorAnswer: 'All 4 deals belong to Nicola. Nicola is owed GBP 2,900.',
    said: 'what are the current exchange rates?',
  });

  assert.match(out.reply, /1 GBP = 1\.362553 USD/);
  assert.doesNotMatch(out.reply, /\bALL\b.*exchange|1 USD = .* ALL/i);
  assert.doesNotMatch(out.reply, /Albanian/i);
});

test('it CONVERTS NOTHING, so there is one place that does', async () => {
  const tool = loadFx(LIVE);
  assert.equal(tool.parameters.properties.currencies.type, 'array');
  assert.match(tool.description, /converts nothing/);
  assert.match(tool.description, /total_master_sheet with convertTo/);
});

/* ===============================
 * * the figure guard knows every part of an answer
 * =============================== */

test('checkFigures accepts add ons, crypto, the resolved total and the conversion', () => {
  // The key list still said `totalWithFee`, renamed when add ons arrived.
  // Those figures passed only because the tool also writes them into its
  // own summary, which is luck rather than a guard.
  const { figuresFrom } = require('../checkFigures');
  const known = figuresFrom({
    total: { GBP: 2000 },
    addon: { GBP: 100 },
    crypto: { GBP: 150 },
    fee: { GBP: 120 },
    totalWithRates: { GBP: 2130 },
    converted: { usd: 2902.21, rate: 1.362553 },
  });

  for (const n of [2000, 100, 150, 120, 2130, 2902.21]) {
    assert.ok(known.has(n), `${n} must be a figure the tools produced`);
  }
});

/* ===============================
 * * search_master_sheet is retired
 * =============================== */

test('the raw search is GONE, so she cannot pick the tool with no exit', async () => {
  // It returned every candidate and never resolved, so "Gloria Difference"
  // was answered with five rows to choose from, and answering re-ran the
  // same search. Two tools took one job and only one had a way out.
  const { masterSheetTools } = require('./masterSheet.js');
  const names = masterSheetTools.map((t) => t.name);

  assert.ok(!names.includes('search_master_sheet'), 'retired');
  assert.ok(names.includes('find_and_show_details'), 'the one that resolves stays');
  assert.ok(names.includes('filter_master_sheet'), 'and the one that answers set questions');
});

test('nothing still tells her to get an id from the retired tool', async () => {
  const src = require('node:fs').readFileSync(require.resolve('./masterSheet.js'), 'utf8');
  const live = src.slice(src.indexOf('const rowDetails = {'));
  assert.ok(
    !/search_master_sheet first/.test(live),
    'every "get the id from" now points at find_and_show_details',
  );
});

test('a company question has somewhere to go now the search is gone', async () => {
  // The retired tool matched on company too. That was its one job the
  // filter could not do, so the filter gained it.
  const tool = load()('filter_master_sheet');
  assert.ok(tool.parameters.properties.searchField.items.enum.includes('company'));

  const { SEARCH_COLUMNS } = (() => {
    const src = require('node:fs').readFileSync(
      require.resolve('../../repos/masterSheetRows.repo.js'), 'utf8',
    );
    return { SEARCH_COLUMNS: /company: \['company'\]/.test(src) };
  })();
  assert.ok(SEARCH_COLUMNS, 'and the repo can actually filter on it');
});

test('"Gloria Difference" now resolves rather than listing candidates', async () => {
  const rows = [
    { ...ROWS[0], id: 1, person_id: 'gloria', person_name: 'Gloria', group_name: 'INDIGO' },
    { ...ROWS[0], id: 2, person_id: 'gloria', person_name: 'Gloria', group_name: 'MILKMAN' },
    { ...ROWS[0], id: 3, person_id: 'gd', person_name: 'Gloria difference', group_name: 'ALL GROUPS' },
  ];
  // Typed with a capital D, stored lowercase: an exact match either way.
  const out = await load({ rows })('find_and_show_details')
    .handler({ name: 'Gloria Difference', show: 'bank', said: "show me Gloria Difference's card" });

  assert.equal(out.cards.length, 1, 'one person, one deal, no question');
  assert.equal(out.cards[0].name, 'Gloria Difference');
});

// 2026-09-28: "what rate do we convert GBP to USD at?" printed "1 USD = 1 USD".
test('USD IS NEVER GIVEN A RATE OF ITS OWN', async () => {
  const out = await loadFx(LIVE).handler({ said: 'what rate do we convert GBP to USD at?', currencies: ['GBP', 'USD'] });
  const text = String(out.summary ?? '') + String(out.reply ?? '');
  assert.match(text, /1 GBP = 1\.362553 USD/);
  assert.doesNotMatch(text, /1 USD = 1 USD/);
});
