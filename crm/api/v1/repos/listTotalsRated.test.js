const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');

// The People and Companies LISTS summed `monthly_amount` in SQL, so one
// person read 4,000 on the list and 4,200 everywhere else. 2026-09-24.
// No database: the pool is stubbed and hands back one row of parts.

const DB = require.resolve('../../configs/db');
const PARTS = { GBP: [{ monthly_amount: 4000, person_addon_percent: 5, payment_method: 'bank' }] };

function load(subject) {
  const ran = [];
  const repo = loadWith(require.resolve(subject), {
    [DB]: {
      async query(sql) {
        ran.push(sql);
        return { rows: [{ total: 1, rows: [{ name: 'X', monthly_parts: PARTS }] }] };
      },
    },
  });
  return { repo, ran };
}

for (const subject of ['./people.repo', './companies.repo']) {
  test(`${subject} rates its list total, never a raw SUM`, async () => {
    const { repo, ran } = load(subject);
    const { rows } = await repo.findAll({ cryptoPercent: 1 });
    assert.deepEqual(rows[0].monthly_totals, { GBP: 4200 });
    assert.equal(rows[0].monthly_parts, undefined, 'the parts leaked onto the page');
    assert.doesNotMatch(ran[0], /SUM\(monthly_amount\)/);
    assert.match(ran[0], /person_addon_percent/, 'the person half of the rate is not carried');
  });
}
