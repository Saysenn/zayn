const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../configs/db');
const repo = require('./masterSheetRows.repo');
const { masterSheetTools } = require('../agent/tools/masterSheet');

/**
 * ***************************************************
 * * "WHOSE DEALS ARE ENDING SOON" HAD NO FILTER
 * ***************************************************
 *
 * She answered "no deals are marked as ended right now", which is true and
 * about a different column. `status` is what a row IS this month; `end_on`
 * is the date written on it. Rows ending this month and next were sitting
 * on the sheet while the answer was none.
 *
 * The fault is not that she lied. There was no filter, so she reached for
 * the nearest column that existed. Same shape as the `paymentStartWhen`
 * incident: a missing filter is answered confidently and wrongly.
 *
 * BY MONTH, like the two filters beside it, because that is what the sheet
 * means. And `none` is a real answer: no end date is ONGOING.
 */

// The SQL and its parameters, without a database. An unstubbed pool would
// reach for real Postgres and hang instead of failing.
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

test('EVERY BRANCH FILTERS ON end_on, BY MONTH', async () => {
  // `end_on` alone is in the SELECT list, so matching that proves nothing.
  // The month comparison is the filter.
  for (const endWhen of ['soon', 'this-month', 'future', 'past']) {
    // eslint-disable-next-line no-await-in-loop
    const { text } = await capture({ endWhen });
    assert.match(
      text,
      /date_trunc\('month', end_on\)/,
      `${endWhen} does not narrow by the end date at all`,
    );
  }
  const { text } = await capture({ endWhen: 'none' });
  assert.match(text, /end_on IS NULL/);
});

test('THE MONTH IS BOUND, never asked of the database', async () => {
  // Same rule as every other month filter: see monthFilterZone.test.js.
  const { currentMonth } = require('../shared/presetMonth.helper');
  for (const endWhen of ['soon', 'this-month', 'future', 'past']) {
    // eslint-disable-next-line no-await-in-loop
    const { params } = await capture({ endWhen });
    assert.ok(
      params.includes(`${currentMonth()}-01`),
      `${endWhen} did not bind the business month: ${JSON.stringify(params)}`,
    );
  }
});

test('NO END DATE IS ONGOING, never "ends today"', async () => {
  const { text } = await capture({ endWhen: 'none' });
  assert.match(text, /end_on IS NULL/);

  // Every other branch must EXCLUDE the null rows, or "ending soon" quietly
  // answers with the 37 rows that have no end date at all.
  for (const endWhen of ['soon', 'this-month', 'future', 'past']) {
    // eslint-disable-next-line no-await-in-loop
    const { text: sql } = await capture({ endWhen });
    assert.match(sql, /end_on IS NOT NULL/, `${endWhen} would include rows with no end date`);
  }
});

test('IT DOES NOT ASK POSTGRES WHAT DAY IT IS', async () => {
  // The month travels as a bound parameter, same rule as every other
  // month filter. See monthFilterZone.test.js.
  for (const endWhen of ['soon', 'this-month', 'future', 'past']) {
    // eslint-disable-next-line no-await-in-loop
    const { text } = await capture({ endWhen });
    assert.doesNotMatch(text, /current_date|now\(\)/i, `${endWhen} asks the database`);
  }
});

test('SOON IS BOUNDED AT BOTH ENDS, so it cannot mean "has an end date"', async () => {
  const { text, params } = await capture({ endWhen: 'soon' });
  assert.match(text, />=/, 'soon has no lower bound, so past end dates are included');
  assert.match(text, /<=/, 'soon has no upper bound, so it means every future end date');
  assert.ok(
    params.includes(repo.ENDING_SOON_MONTHS),
    `the horizon is not bound as a parameter: ${JSON.stringify(params)}`,
  );
});

test('THE HORIZON IS ONE NUMBER, shared by the SQL and the sentence', async () => {
  // Two numbers here would disagree: the reply would say three months while
  // the query looked at six, and nobody would be able to tell from the
  // answer which one was wrong.
  assert.equal(typeof repo.ENDING_SOON_MONTHS, 'number');
  assert.ok(repo.ENDING_SOON_MONTHS > 0);

  const filter = masterSheetTools.find((t) => t.name === 'filter_master_sheet');
  const described = filter.parameters.properties.endWhen.description;
  assert.match(
    described,
    new RegExp(`\\b${repo.ENDING_SOON_MONTHS}\\b`),
    'the tool describes a different horizon from the one the SQL uses',
  );
});

test('THE TOOL OFFERS IT, and says it is not the same as status', async () => {
  const filter = masterSheetTools.find((t) => t.name === 'filter_master_sheet');
  const endWhen = filter.parameters.properties.endWhen;

  assert.ok(endWhen, 'the tool has no endWhen, so the question has no filter again');
  assert.deepEqual(endWhen.items.enum, ['soon', 'this-month', 'future', 'past', 'none']);
  // The sentence that stops the substitution that caused this.
  assert.match(endWhen.description, /NOT the same as status/);
});

test('and the filter REACHES the repo, rather than being accepted and ignored', async () => {
  const real = repo.findAll;
  let seen = null;
  repo.findAll = async (f) => { seen = f; return { rows: [], total: 0 }; };
  try {
    const filter = masterSheetTools.find((t) => t.name === 'filter_master_sheet');
    await filter.handler({ endWhen: 'soon', said: 'whose deals are ending soon?' });
  } finally {
    repo.findAll = real;
  }
  assert.equal(seen.endWhen, 'soon');
});
