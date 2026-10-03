const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../configs/db');
const repo = require('./masterSheetRows.repo');

/**
 * ***************************************************
 * * ONE AUTHORITY DECIDES WHAT MONTH IT IS
 * ***************************************************
 *
 * `currentMonth()` was made to answer in the business's zone. The database
 * was not: this connects through the SUPABASE POOLER, which swallows
 * startup `options`, and a `SET TIME ZONE` on pool.on('connect') cannot be
 * awaited so it races the first query on a new connection. Both were tried
 * and both came back UTC.
 *
 * So between midnight and 7am UTC the two disagreed about the DATE, and at
 * a month boundary about the MONTH: the total said August while the
 * "starts this month" filter said September, off one screen. One wrong
 * answer is a bug. Two different answers is a bug nobody can reproduce.
 *
 * No SQL may ask what day it is. The month travels as a bound parameter.
 */

// 1 September 02:00 UTC. Still 31 August, 7pm, in Los Angeles.
const BOUNDARY = new Date('2026-09-01T02:00:00Z');

const atBoundary = async (run) => {
  const RealDate = Date;
  const zone = process.env.TIMEZONE;
  process.env.TIMEZONE = 'America/Los_Angeles';
  global.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(BOUNDARY); }
    static now() { return BOUNDARY.getTime(); }
  };
  try {
    return await run();
  } finally {
    global.Date = RealDate;
    if (zone === undefined) delete process.env.TIMEZONE; else process.env.TIMEZONE = zone;
  }
};

// The SQL and its parameters, without a database. An unstubbed pool would
// reach for real Postgres and the test would hang instead of failing.
const capture = async (filter) => {
  const real = pool.query;
  let seen = null;
  pool.query = async (text, params) => {
    seen = { text, params };
    return { rows: [{ total: 0, rows: [] }] };
  };
  try {
    await repo.findAll(filter);
  } finally {
    pool.query = real;
  }
  return seen;
};

test('NO FILTER ASKS THE DATABASE WHAT DAY IT IS', async () => {
  for (const filter of [{ presetWhen: 'current' }, { paymentStartWhen: 'future' }]) {
    // eslint-disable-next-line no-await-in-loop
    const { text } = await capture(filter);
    assert.doesNotMatch(text, /current_date/i, `${JSON.stringify(filter)} still asks Postgres`);
  }
});

test('THE BUSINESS MONTH IS BOUND, and it is AUGUST at the boundary', async () => {
  await atBoundary(async () => {
    const { params } = await capture({ presetWhen: 'current' });
    assert.ok(
      params.includes('2026-08-01'),
      `the month passed was ${JSON.stringify(params)}, and UTC would have said September`,
    );
  });
});

test('the payment start filter uses the SAME month', async () => {
  await atBoundary(async () => {
    const { params } = await capture({ paymentStartWhen: 'this-month' });
    assert.ok(params.includes('2026-08-01'));
  });
});

test('BOTH FILTERS AT ONCE bind the month twice, not once', async () => {
  // They push independently. A shared placeholder would silently shift one
  // of them onto the other filter's value.
  await atBoundary(async () => {
    const { text, params } = await capture({ presetWhen: 'current', paymentStartWhen: 'future' });
    assert.equal(params.filter((p) => p === '2026-08-01').length, 2);
    // Two DIFFERENT placeholders, each pointing at its own slot.
    const used = [...text.matchAll(/\$(\d+)::date/g)].map((m) => Number(m[1]));
    assert.equal(new Set(used).size, 2, `both filters share a placeholder: ${text}`);
    for (const n of used) assert.equal(params[n - 1], '2026-08-01');
  });
});

test('an unknown value is ignored rather than erroring', async () => {
  const { text } = await capture({ presetWhen: 'sideways' });
  assert.doesNotMatch(text, /preset_on IS NOT NULL/);
});
