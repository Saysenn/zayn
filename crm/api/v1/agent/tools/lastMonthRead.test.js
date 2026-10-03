const test = require('node:test');
const assert = require('node:assert/strict');

const { monthsInQuestion } = require('../../shared/guessedYear.helper');
const { nearestMonths, MAX_MONTHS } = require('./monthHistory');

/**
 * ***************************************************
 * * "last month" answered THIS month
 * ***************************************************
 *
 * Live 2026-09-09: "show me nathan total last month" came back as September
 * 2026, with a figure that looked right. The model omits `month` for a
 * relative word, so the totals tool's `asked` was undefined and it fell
 * through to the current month.
 *
 * `compare_months` never had this, because it reads the sentence. So the
 * totals tool reads it too, through the SAME helper rather than a second
 * parser: `monthsInQuestion`.
 */

const NOW = '2026-09';

test('the sentence carries the month she left out', () => {
  assert.deepEqual(monthsInQuestion('show me nathan total last month', NOW), ['2026-08']);
  assert.deepEqual(monthsInQuestion('gloria total last month?', NOW), ['2026-08']);
  assert.deepEqual(monthsInQuestion('what about this month', NOW), ['2026-09']);
});

test('a named month is understood without a year', () => {
  assert.deepEqual(monthsInQuestion('only the converted to usd total last august', NOW), ['2026-08']);
  assert.deepEqual(monthsInQuestion('how did july go', NOW), ['2026-07']);
});

test('A QUESTION WITH NO MONTH STAYS EMPTY, so nothing is invented', () => {
  // The guard only fires when they actually named one. "how much is nathan
  // owed" is still this month, which is the right default.
  assert.deepEqual(monthsInQuestion('how much is nathan owed', NOW), []);
  assert.deepEqual(monthsInQuestion('lets export', NOW), []);
});

test('TWO MONTHS IS A COMPARISON, and the guard leaves it alone', () => {
  // The totals tool only takes the sentence's month when EXACTLY one is
  // named; `months` already carries a comparison.
  assert.equal(monthsInQuestion('july and august', NOW).length, 2);
});

/**
 * ===============================
 * * HER WINDOW IS THE DASHBOARD'S: 2 past, this month, next
 * ===============================
 * One cap could not say that. Three let her look three months FORWARD,
 * which is three times what the dashboard projects, so the same question
 * answered on two screens disagreed about how far ahead anyone can see.
 */

test('history reaches two months back, and this month', () => {
  const asked = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  assert.deepEqual(nearestMonths(asked, NOW), ['2026-07', '2026-08', '2026-09']);
});

test('THE FORECAST STOPS AT NEXT MONTH, however far she was asked', () => {
  const asked = ['2026-09', '2026-10', '2026-11', '2026-12'];
  const kept = nearestMonths(asked, NOW);
  assert.ok(kept.includes('2026-10'), 'next month is in the window');
  assert.ok(!kept.includes('2026-11'), 'two months out is not');
  assert.ok(!kept.includes('2026-12'));
});

test('a question straddling now keeps both halves of the window', () => {
  const asked = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  const kept = nearestMonths(asked, NOW);
  assert.equal(kept.length, MAX_MONTHS);
  assert.ok(kept.includes('2026-09'), 'this month survives');
  assert.ok(!kept.includes('2026-11'), 'and nothing past next month does');
});

test('the cap is still three, so the window is four with the forecast', () => {
  assert.equal(MAX_MONTHS, 3);
});

/**
 * ===============================
 * * THE WIRING, not just the parser
 * ===============================
 * `monthsInQuestion` always understood "last month". The bug was that the
 * TOTALS TOOL never asked it. So this drives the handler with the exact
 * shape of the live failure: a relative word in the sentence and no `month`
 * argument at all.
 */
const { masterSheetTools } = require('./masterSheet');
const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
const fxRates = require('../../shared/fxRates.helper');
const { currentMonth } = require('../../shared/presetMonth.helper');

const totalTool = masterSheetTools.find((tool) => tool.name === 'total_master_sheet');

function lastMonth(now = currentMonth()) {
  const [year, part] = now.split('-').map(Number);
  const date = new Date(Date.UTC(year, part - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function withRepos(run) {
  const saved = {
    searchFuzzy: repo.searchFuzzy,
    findAll: repo.findAll,
    rateMap: peopleRepo.rateMap,
    filterOptions: peopleRepo.filterOptions,
    get: settingsRepo.get,
    findMany: snapshotsRepo.findMany,
    usdPerGbp: fxRates.usdPerGbp,
  };
  const row = {
    person_name: 'Nathan',
    group_name: 'MILKMAN',
    company: 'Anteep Sourcing',
    currency: 'GBP',
    payable_amount: '700',
    preset_on: `${currentMonth()}-01`,
    end_on: null,
    payment_period: 'active',
  };
  repo.searchFuzzy = async () => [row];
  repo.findAll = async () => ({ rows: [row], total: 1 });
  peopleRepo.rateMap = async () => new Map();
  peopleRepo.filterOptions = async () => ({ groups: ['MILKMAN'], companies: ['Anteep Sourcing'] });
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });
  // No snapshot for last month, which is the honest state here. The point
  // is WHICH MONTH she went looking for, not what she found.
  snapshotsRepo.findMany = async () => [];
  fxRates.usdPerGbp = async () => ({ usdPerGbp: 1.3, perUsd: { GBP: 0.77 }, source: 'live' });
  try {
    return await run();
  } finally {
    Object.assign(repo, { searchFuzzy: saved.searchFuzzy, findAll: saved.findAll });
    Object.assign(peopleRepo, { rateMap: saved.rateMap, filterOptions: saved.filterOptions });
    settingsRepo.get = saved.get;
    snapshotsRepo.findMany = saved.findMany;
    fxRates.usdPerGbp = saved.usdPerGbp;
  }
}

test('LIVE FAILURE: "total last month" with no month argument', async () => {
  const out = await withRepos(() => totalTool.handler({
    person: 'Nathan',
    said: 'sho wme nathan total last month',
  }));

  const previous = lastMonth();
  const [y, m] = previous.split('-').map(Number);
  const words = new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  assert.match(out.summary, new RegExp(words), `it went looking for ${words}`);
  const nowWords = (() => {
    const [cy, cm] = currentMonth().split('-').map(Number);
    return new Date(Date.UTC(cy, cm - 1, 1))
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  })();
  assert.doesNotMatch(out.summary, new RegExp(`owed [^\n]*for ${nowWords}`), 'never this month');
});

test('a question naming NO month still answers this one', async () => {
  const out = await withRepos(() => totalTool.handler({
    person: 'Nathan',
    said: 'how much is nathan owed',
  }));
  const [cy, cm] = currentMonth().split('-').map(Number);
  const nowWords = new Date(Date.UTC(cy, cm - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  assert.match(out.summary, new RegExp(nowWords), 'the default is still now');
});

// 2026-09-28: "what was the total last month?" arrived WITH an invented month,
// 2024-06. The invention was dropped and it answered September.
test('LIVE FAILURE: "last month" beside an invented month argument', async () => {
  const out = await withRepos(() => totalTool.handler({
    person: 'Nathan',
    month: '2024-06',
    said: 'what was the total last month?',
  }));
  const [y, m] = lastMonth().split('-').map(Number);
  const words = new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  assert.match(out.summary, new RegExp(words), `it went looking for ${words}`);
});
