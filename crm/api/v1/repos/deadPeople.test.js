const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');
const {
  monthsBetween, journeyByCompany, recordedEarnings, shapeDeadPerson,
} = require('../shared/deadPersonJourney.helper');

// ***************************************************
// * The dead list: who is on it, and how their journey reads
// ***************************************************
// No database: the pool and the rows cache are stubbed.

const REPO = require.resolve('./deadPeople.repo');
const DB = require.resolve('../../configs/db');
const ROWS = require.resolve('./masterSheetRows.repo');

function loadRepo(answer) {
  const ran = [];
  const repo = loadWith(REPO, {
    [DB]: { async query(sql, params) { ran.push({ sql, params }); return { rows: [answer] }; } },
    [ROWS]: { readThrough: (key, fn) => fn() },
  });
  return { repo, ran };
}

test('DEAD IS "EVERY DEAL STOPPED": a live deal anywhere keeps them off', () => {
  const { DEAD_IDS_SQL } = loadRepo({}).repo;
  assert.match(DEAD_IDS_SQL, /stopped_on IS NOT NULL/);
  assert.match(DEAD_IDS_SQL, /NOT EXISTS \(\s*SELECT 1 FROM tb_mastersheet l\s*WHERE l\.person_id = m\.person_id AND l\.stopped_on IS NULL\)/);
});

test('A DEAL ADDED BACK takes them off the list: findById says not dead', async () => {
  const { repo } = loadRepo({ deal_count: 3, live_count: 1, deals: [] });
  assert.equal(await repo.findById('dov ashgrove'), null);
});

test('never had a deal is not dead either', async () => {
  const { repo } = loadRepo({ deal_count: 0, live_count: 0 });
  assert.equal(await repo.findById('nobody'), null);
});

test('every deal stopped: the record comes back', async () => {
  const { repo } = loadRepo({ deal_count: 2, live_count: 0, deals: [], display_name: 'Dov' });
  assert.equal((await repo.findById('dov ashgrove')).display_name, 'Dov');
});

test('a slug display name falls back to the name on their deals (066)', () => {
  const { ran, repo } = loadRepo({ rows: [], total: 0 });
  return repo.findAll({}).then(() => {
    assert.match(ran[0].sql, /NULLIF\(p\.display_name, p\.person_id\)/);
  });
});

test('months are whole calendar months, both ends counted', () => {
  assert.equal(monthsBetween('2025-01-01', '2026-08-31'), 20);
  assert.equal(monthsBetween('2026-08-01', '2026-08-31'), 1);
  assert.equal(monthsBetween(null, '2026-08-31'), 0, 'never started');
});

const deal = (id, company, over = {}) => ({
  id, company, group_name: 'ZZTEST', role_label: 'Director', currency: 'GBP', monthly_amount: 1000,
  payment_start_on: '2025-01-01', stopped_on: '2026-08-31', stopped_reason: 'stopped_by_hand', ...over,
});

test('THE JOURNEY IS COMPANY BY COMPANY, a company in a group, oldest first', () => {
  const companies = journeyByCompany([
    deal(1, 'Co B', { payment_start_on: '2025-06-01' }),
    deal(2, 'Co A'),
    deal(3, 'Co A', { role_label: 'Mid 1', stopped_on: '2026-09-25' }),
  ]);
  assert.deepEqual(companies.map((c) => c.company), ['Co A', 'Co B']);
  assert.deepEqual(companies[0].roles, ['Director', 'Mid 1']);
  assert.equal(companies[0].stoppedOn, '2026-09-25', 'the company ends at its last deal');
});

test('owed a month is RATED: 1000 with a 2% person fee is 980', () => {
  const [c] = journeyByCompany([deal(1, 'Co A', { person_fee_percent: 2 })]);
  assert.equal(c.deals[0].owedMonthly, 980);
});

test('RECORDED EARNINGS are the kept months, only the rows that counted', () => {
  const kept = recordedEarnings([
    { month: '2026-08', row: { ...deal(1, 'Co A'), preset_on: '2026-08-01', payable_amount: 1000, stopped_on: null } },
    // Marked for another month: not counted in August.
    { month: '2026-08', row: { ...deal(2, 'Co B'), preset_on: '2026-07-01', payable_amount: 500, stopped_on: null } },
  ]);
  assert.deepEqual(kept.byCurrency, { GBP: 1000 });
  assert.deepEqual(kept.months, ['2026-08']);
});

test('no combined monthly figure: the deals never all ran at once', () => {
  const out = shapeDeadPerson({ deals: [deal(1, 'Co A'), deal(2, 'Co B')], snapshot_rows: [], live_count: 0 });
  assert.equal(out.owedMonthly, undefined);
  assert.equal(out.companyCount, 2);
  assert.equal(out.live_count, undefined, 'an internal count is not part of the record');
});
