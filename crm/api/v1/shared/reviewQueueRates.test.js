const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { loadWith } = require('../testing/stubRepos');

/**
 * ***************************************************
 * * THE REVIEW QUEUE PRINTS MONEY, SO IT PAYS THE RATES
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-21. Diane read the queue out and Zayn came back as
 * **AED 3,809.52**. He is paid **4,000**: the stored wage with his 5% add
 * on left off. The panel showed the same figure and the export warning
 * totalled it.
 *
 * THE CAUSE WAS UPSTREAM OF THE PRINTING. `QUEUE_COLUMNS` never selected
 * `addon_percent`, `fee_percent` or `payment_method`, so the queue could
 * not have applied the rates even if it had tried. Six readers, all raw.
 */

const SUBJECT = require.resolve('./reviewQueue.helper');
const REVIEW = require.resolve('../repos/monthlyReview.repo');
const PEOPLE = require.resolve('../repos/people.repo');
const SETTINGS = require.resolve('../repos/settings.repo');

// Zayn, exactly as the sheet holds him: the RAW wage, and the 5% on the
// PERSON rather than on the deal.
const ZAYN = {
  id: 7,
  person_id: 'zayn',
  person_name: 'Zayn',
  company: 'Workforce',
  group_name: 'INDIGO',
  role_label: 'Developer',
  currency: 'AED',
  monthly_amount: 3809.52,
  payable_amount: 3809.52,
  addon_percent: 0,
  fee_percent: 0,
  payment_method: 'Bank',
  answer: null,
};

function load({ rows = [ZAYN], rates = [['zayn', { addon: 5, fee: 0 }]], crypto = 1 } = {}) {
  return loadWith(SUBJECT, {
    [REVIEW]: { queue: async () => rows },
    [PEOPLE]: { rateMap: async () => new Map(rates) },
    [SETTINGS]: { get: async () => ({ crypto_percent: crypto }) },
  });
}

test('ZAYN READS 4,000, not the 3,809.52 on the row', async () => {
  const [row] = await load().dueThisMonth('2026-09');
  assert.equal(row.monthly_amount, 4000);
  // The raw is kept, so the popup can still show the sum and the import
  // can still reverse it.
  assert.equal(row.monthly_amount_raw, 3809.52);
});

test('THE DEAL RATE AND THE PERSON RATE STACK', async () => {
  // 5% on the person plus 3% on the deal is 8% of the wage, never 5% of
  // 105%. Typing 3 and getting 8.15 is the failure this prevents.
  const [row] = await load({
    rows: [{ ...ZAYN, addon_percent: 3 }],
  }).dueThisMonth('2026-09');
  assert.equal(row.monthly_amount, 4114.28);
});

test('THE CRYPTO RAIL IS A THIRD RATE, and only on a crypto row', async () => {
  const bank = await load({ rows: [{ ...ZAYN, payment_method: 'Bank' }] }).dueThisMonth('2026-09');
  const coin = await load({ rows: [{ ...ZAYN, payment_method: 'Crypto USDT' }] }).dueThisMonth('2026-09');
  assert.equal(bank[0].monthly_amount, 4000);
  assert.ok(coin[0].monthly_amount > 4000, 'the rail charge is ours to pay');
});

test('A ROW WITH NO RATE IS RETURNED UNTOUCHED', async () => {
  // Rebuilding it would round a figure nobody rated and put `rate_parts`
  // on a row with nothing to explain.
  const [row] = await load({ rates: [] }).dueThisMonth('2026-09');
  assert.equal(row.monthly_amount, 3809.52);
  assert.equal(row.rate_parts, undefined);
});

test('AND THE PENDING MONEY IS THE RATED MONEY', async () => {
  // The Review button and the export warning read this. A count is a
  // nudge; the money is why the warning exists.
  // NEVER ONE NUMBER. The queue holds GBP, EUR and AED at once, and a
  // single total across them is two currencies added together wearing one
  // symbol. Same reason `totalsOf` exists on the web half.
  const out = await load().pendingThisMonth('2026-09');
  assert.deepEqual(out, { count: 1, byCurrency: { AED: 4000 } });
});

/**
 * ===============================
 * * AND THE QUERY ACTUALLY CARRIES THE COLUMNS
 * ===============================
 * The helper cannot rate what the SELECT did not fetch, and a missing
 * column reads as a rate of zero: it fails to apply, never loudly.
 */
test('QUEUE_COLUMNS SELECTS EVERY RATE INPUT', () => {
  const sql = readFileSync(require.resolve('../repos/monthlyReview.repo'), 'utf8');
  const columns = /const QUEUE_COLUMNS = `([\s\S]*?)`;/.exec(sql)?.[1] ?? '';
  for (const column of ['m.addon_percent', 'm.fee_percent', 'm.payment_method']) {
    assert.ok(columns.includes(column), `the queue must select ${column}`);
  }
  // The PERSON's two come from the shared helper, so the guard is in two
  // halves: the queue splices it in, and it still produces both columns.
  // Written out here, this test passed while three other readers were
  // missing them entirely.
  assert.match(columns, /\$\{personRatesSql\('m'\)\}/);
  const { personRatesSql } = require('./personRates.helper');
  for (const column of ['person_addon_percent', 'person_fee_percent']) {
    assert.ok(personRatesSql('m').includes(column), `the helper must select ${column}`);
  }
});

/**
 * ===============================
 * * AND NOBODY READS THE RAW QUEUE
 * ===============================
 * Six callers: four of Diane's tools, the panel's route and the export
 * warning. A rate applied in five of them is a figure that disagrees with
 * itself, which is the `owedThisMonth` lesson in a second place.
 */
test('EVERY READER GOES THROUGH THE HELPER', () => {
  const files = [
    '../agent/tools/monthlyReview.js',
    '../monthlyReview.js',
    '../masterSheet/exportQuery.js',
  ];
  for (const file of files) {
    const src = readFileSync(require.resolve(file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.match(src, /dueThisMonth\(/, `${file} must read the rated queue`);
    assert.doesNotMatch(src, /\.queue\(/, `${file} still reads the raw queue`);
    assert.doesNotMatch(src, /repo\.pending\(/, `${file} still sums the raw money`);
  }
});
