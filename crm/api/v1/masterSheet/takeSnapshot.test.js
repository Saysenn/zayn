const test = require('node:test');
const assert = require('node:assert/strict');

const rowsRepo = require('../repos/masterSheetRows.repo');
const settingsRepo = require('../repos/settings.repo');
const peopleRepo = require('../repos/people.repo');
const snapshots = require('../repos/monthSnapshots.repo');
const fxRates = require('../shared/fxRates.helper');
const { takeSnapshot, figuresFor } = require('./takeSnapshot');
const { currentMonth } = require('../shared/presetMonth.helper');

/**
 * ***************************************************
 * * A month kept exactly as it stood
 * ***************************************************
 *
 * Forecasting is only worth anything if last March still says in December
 * what it said in March. That is one claim, and everything here is a way
 * of failing it:
 *
 *   - a figure recomputed on read moves when a rule moves
 *   - a row tidied on the way in is an interpretation, not a record
 *   - an UPDATE path means the evidence can be edited after it was paid
 *   - taking it twice silently replacing the first is the same thing with
 *     extra steps
 *
 * The predicates are the LIVE ones, deliberately: the stored figure has to
 * be the figure that was on screen the day it was taken.
 */

const MONTH = currentMonth();

const deal = (over = {}) => ({
  id: 1,
  person_id: 'gloria',
  person_name: 'Gloria',
  group_name: 'INDIGO',
  company: 'Workforce',
  role_label: 'Closer',
  currency: 'GBP',
  payment_method: 'cash',
  payable_amount: 1000,
  monthly_amount: 1000,
  payable_days: 30,
  preset_on: `${MONTH}-01`,
  end_on: null,
  status: 'active',
  addon_percent: 0,
  fee_percent: 0,
  manually_overridden_fields: [],
  ...over,
});

const ROWS = [
  deal({ id: 1 }),
  deal({ id: 2, person_id: 'zayn', person_name: 'Zayn', currency: 'AED', payable_amount: 3675 }),
  deal({ id: 3, person_id: 'neo', person_name: 'Neo', group_name: 'MILKMAN', payable_amount: 500 }),
  // Marked for another month: on the sheet, out of the figure.
  deal({ id: 4, person_id: 'old', person_name: 'Old', preset_on: '2020-01-01', payable_amount: 9999 }),
];

const withRepos = (run, over = {}) => {
  const saved = {
    findAllRows: rowsRepo.findAllRows,
    get: settingsRepo.get,
    rateMap: peopleRepo.rateMap,
    usdPerGbp: fxRates.usdPerGbp,
    take: snapshots.take,
  };
  rowsRepo.findAllRows = async () => ROWS;
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });
  peopleRepo.rateMap = async () => new Map();
  fxRates.usdPerGbp = async () => ({ usdPerGbp: 1.35, source: 'live', asOf: null, perUsd: { GBP: 0.74 } });
  snapshots.take = async (month, rows, totals) => ({
    month, taken_at: new Date().toISOString(), row_count: rows.length, existed: false, rows, totals,
  });
  Object.assign(rowsRepo, {}, over.rowsRepo ?? {});
  Object.assign(snapshots, over.snapshots ?? {});
  Object.assign(settingsRepo, over.settingsRepo ?? {});

  return run().finally(() => {
    rowsRepo.findAllRows = saved.findAllRows;
    settingsRepo.get = saved.get;
    peopleRepo.rateMap = saved.rateMap;
    fxRates.usdPerGbp = saved.usdPerGbp;
    snapshots.take = saved.take;
  });
};

test('THE ROW IS STORED WHOLE, snake_case and all', async () => {
  // A column left out in September cannot be added back in December, and
  // nobody knows yet what December will ask.
  await withRepos(async () => {
    const out = await takeSnapshot(MONTH);
    const first = out.rows[0];

    assert.equal(out.rows.length, 4, 'every row, including the ones out of the figure');
    assert.ok('manually_overridden_fields' in first, 'a column was dropped on the way in');
    assert.ok('person_id' in first, 'keys were renamed');
    assert.equal(first.payable_amount, 1000, 'a value was reformatted');
  });
});

test('THE FIGURES ARE COMPUTED ONCE AND STORED', async () => {
  await withRepos(async () => {
    const { totals } = await takeSnapshot(MONTH);

    assert.deepEqual(totals.grand, { GBP: 1500, AED: 3675 });
    assert.equal(totals.counted, 3, 'the row marked for another month must not count');
    assert.equal(totals.rows, 4, 'but it is still IN the snapshot');
  });
});

test('per GROUP as well, because that is the question people ask', async () => {
  await withRepos(async () => {
    const { totals } = await takeSnapshot(MONTH);

    assert.deepEqual(totals.byGroup.INDIGO.byCurrency, { GBP: 1000, AED: 3675 });
    assert.deepEqual(totals.byGroup.MILKMAN.byCurrency, { GBP: 500 });
    assert.equal(totals.byGroup.MILKMAN.rows, 1);
  });
});

test('WHAT THE RULES WERE is stored beside the figures', async () => {
  // Without these the numbers can be repeated a year later but not
  // explained, and "why is March different" is the whole point.
  await withRepos(async () => {
    const { totals } = await takeSnapshot(MONTH);

    assert.equal(totals.settings.useEndDate, false);
    assert.equal(totals.settings.cryptoPercent, 0);
    assert.equal(totals.fx.usdPerGbp, 1.35);
    assert.equal(totals.fx.source, 'live');
  });
});

test('the END DATE SETTING changes the figure, and is recorded when it does', async () => {
  const ended = [deal({ id: 9, end_on: '2020-06-01', payable_amount: 700 })];
  await withRepos(async () => {
    rowsRepo.findAllRows = async () => ended;
    settingsRepo.get = async () => ({ color_uses_end_date: true, crypto_percent: 0 });

    const { totals } = await takeSnapshot(MONTH);
    assert.equal(totals.counted, 0, 'an ended deal must drop when the toggle is on');
    assert.equal(totals.settings.useEndDate, true);
  });
});

test('A MISSING RATE DOES NOT LOSE THE MONTH', async () => {
  // The feed being down is not a reason to have no record of September.
  await withRepos(async () => {
    fxRates.usdPerGbp = async () => { throw new Error('rates endpoint timed out'); };
    const { totals } = await takeSnapshot(MONTH);

    assert.equal(totals.fx, null);
    assert.deepEqual(totals.grand, { GBP: 1500, AED: 3675 });
  });
});

test('TAKING IT TWICE DOES NOT OVERWRITE', async () => {
  // "Take September again" after an edit would silently replace a record
  // somebody has already read and paid from.
  let writes = 0;
  await withRepos(async () => {
    snapshots.take = async (month, rows) => {
      writes += 1;
      return writes === 1
        ? { month, row_count: rows.length, existed: false }
        : { month, row_count: 4, existed: true };
    };

    const first = await takeSnapshot(MONTH);
    const again = await takeSnapshot(MONTH);

    assert.equal(first.existed, false);
    assert.equal(again.existed, true, 'the second take must report that it kept the first');
  });
});

test('a month that is not a month is refused', async () => {
  await withRepos(async () => {
    await assert.rejects(() => takeSnapshot('September'), /Not a month/);
    await assert.rejects(() => takeSnapshot('2026-13'), /Not a month/);
  });
});

test('THERE IS NO UPDATE FUNCTION, which is the point', () => {
  // Not "nobody calls it": it does not exist. A snapshot that can be
  // corrected stops being evidence.
  assert.equal(typeof snapshots.take, 'function');
  assert.equal(typeof snapshots.find, 'function');
  assert.equal(snapshots.update, undefined);
  assert.equal(snapshots.upsert, undefined);
  assert.equal(snapshots.setTotals, undefined);
  // Deleting IS allowed: a month taken by mistake must be removable, and a
  // delete is loud and total where an update is quiet and partial.
  assert.equal(typeof snapshots.remove, 'function');
});

test('and the DATABASE refuses an update too, not just this file', () => {
  // A verification script or a stray migration walks past a convention.
  const sql = require('node:fs')
    .readFileSync(require.resolve('../migrations/049_month_snapshots.sql'), 'utf8');

  assert.match(sql, /ON UPDATE TO tb_month_snapshots DO INSTEAD NOTHING/);
  assert.match(sql, /CHECK \(month ~/, 'the month shape is not enforced');

  const repo = require('node:fs')
    .readFileSync(require.resolve('../repos/monthSnapshots.repo'), 'utf8');
  assert.doesNotMatch(repo, /ON CONFLICT \(month\)/, 'PostgreSQL refuses ON CONFLICT when the table has an UPDATE rule');
});

test('figuresFor is pure, so a caller cannot change what was recorded', () => {
  // Called twice with the same rows it must give the same answer: no
  // clock, no settings read, nothing but its arguments.
  const opts = { useEndDate: false, rates: null, cryptoPercent: 0, fx: null };
  const a = figuresFor(ROWS, MONTH, opts);
  const b = figuresFor(ROWS, MONTH, opts);
  assert.deepEqual(a, b);
});
