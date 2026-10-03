const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../../testing/stubRepos');

// Diane on the dead list: read only, exact name first, and every figure from the helper.

const TOOL = require.resolve('./deadPeople');
const DEAD = require.resolve('../../repos/deadPeople.repo');
const SETTINGS = require.resolve('../../repos/settings.repo');

const LIST = [
  { person_id: 'bram tevish', display_name: 'Bram Tevish', deal_count: 3, company_count: 2, last_stopped: '2026-09-25' },
  { person_id: 'bram okafor', display_name: 'Bram Okafor', deal_count: 1, company_count: 1, last_stopped: '2026-08-31' },
];
const RECORD = {
  deal_count: 1,
  live_count: 0,
  display_name: 'Bram Tevish',
  phones: ['07000 000001'],
  deals: [{
    id: 1, company: 'Co A', group_name: 'ZZTEST', role_label: 'Director', currency: 'GBP', monthly_amount: 900,
    payment_start_on: '2025-01-01', stopped_on: '2026-09-25', stopped_reason: 'stopped_by_hand',
  }],
  snapshot_rows: [],
};

function load({ rows = LIST, record = RECORD } = {}) {
  const { deadPeopleTools } = loadWith(TOOL, {
    [DEAD]: {
      async findAll({ q }) {
        const hit = q ? rows.filter((r) => r.display_name.toLowerCase().includes(String(q).toLowerCase())) : rows;
        return { rows: hit, total: hit.length };
      },
      async findById() { return record; },
    },
    [SETTINGS]: { async get() { return {}; } },
  });
  return (name) => deadPeopleTools.find((t) => t.name === name);
}

test('the list says the TRUE count and each name with its figures', async () => {
  const out = await load()('list_dead_people').handler({});
  assert.match(out.summary, /^2 people are on the dead list/);
  assert.match(out.summary, /Bram Tevish: 3 deals on 2 companies, last stopped 25 September 2026/);
});

test('nobody dead says so, never an empty list', async () => {
  const out = await load({ rows: [] })('list_dead_people').handler({ q: 'suki' });
  assert.match(out.summary, /Nobody matching "suki" is on the dead list/);
});

test('AN EXACT NAME WINS: "Bram Tevish" never asks about Bram Okafor', async () => {
  const out = await load()('dead_person_details').handler({ person: 'Bram Tevish' });
  assert.match(out.summary, /Bram Tevish is on the dead list: 1 deal on 1 company/);
  assert.match(out.summary, /Co A \(ZZTEST\), Director: 1 January 2025 to 25 September 2026, GBP 900.00 a month over 21 months/);
});

test('two people behind one word is a question, nothing else', async () => {
  const out = await load()('dead_person_details').handler({ person: 'bram' });
  assert.equal(out.ambiguous, true);
  assert.match(out.summary, /could be Bram Tevish, Bram Okafor/);
});

test('added back since the list was read: says so', async () => {
  const out = await load({ record: null })('dead_person_details').handler({ person: 'Bram Tevish' });
  assert.match(out.summary, /no longer on the dead list/);
});

test('NEITHER TOOL WRITES', () => {
  const tool = load();
  assert.ok(!tool('list_dead_people').writes);
  assert.ok(!tool('dead_person_details').writes);
});
