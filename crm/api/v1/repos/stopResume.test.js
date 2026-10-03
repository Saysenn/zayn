const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');

/**
 * ***************************************************
 * * Stopping a deal, and the one resume that is refused
 * ***************************************************
 *
 * NO DATABASE. The pool is stubbed and the SQL is read as text, which is
 * where the guards actually live: a resume that forgot its WHERE clause
 * would pass any test that only checked the return value.
 */

const SUBJECT = require.resolve('./masterSheetRows.repo');
const DB = require.resolve('../../configs/db');
const CACHE = require.resolve('../shared/cache.helper');

/** Every query the repo ran, in order, with its parameters. */
function load(rowsBack = [{ id: 1 }]) {
  const ran = [];
  const repo = loadWith(SUBJECT, {
    [DB]: {
      query: async (sql, params) => { ran.push({ sql, params }); return { rows: rowsBack, rowCount: rowsBack.length }; },
      connect: async () => ({ query: async () => ({ rows: rowsBack }), release() {} }),
    },
    [CACHE]: { createCache: () => ({ wrap: (k, fn) => fn(), invalidate() {} }) },
  });
  return { repo, ran };
}

test('FOUR STOP REASONS, and the set is closed', () => {
  const { repo } = load();
  assert.deepEqual(Object.values(repo.STOPPED_REASON).sort(), [
    'company_closed', 'review_final', 'review_no', 'stopped_by_hand',
  ]);
});

test('AN INVENTED REASON IS REFUSED BEFORE ANY SQL RUNS', async () => {
  const { repo, ran } = load();
  await assert.rejects(
    () => repo.stop(1, { on: '2026-08-31', reason: 'because' }),
    /not a stop reason/,
  );
  assert.equal(ran.length, 0, 'nothing may reach the database');
});

test('STOP WRITES BOTH COLUMNS, never one of them', async () => {
  const { repo, ran } = load();
  await repo.stop(7, { on: '2026-08-31', reason: repo.STOPPED_REASON.BY_HAND });
  assert.match(ran[0].sql, /SET stopped_on = \$2, stopped_reason = \$3/);
  // The fourth is who stopped it, for the change log the stop now writes.
  assert.deepEqual(ran[0].params, [7, '2026-08-31', 'stopped_by_hand', 'admin']);
});

test('STOP IS AN UPDATE, NEVER A DELETE. The row is payroll', async () => {
  const { repo, ran } = load();
  await repo.stop(7, { on: '2026-08-31', reason: repo.STOPPED_REASON.BY_HAND });
  assert.doesNotMatch(ran[0].sql, /DELETE/i);
  // An UPDATE inside a CTE that also logs it: still no delete anywhere.
  assert.match(ran[0].sql, /\bUPDATE tb_mastersheet\b/);
});

test('RESUME CLEARS BOTH, so the pair constraint cannot be broken', async () => {
  const { repo, ran } = load();
  await repo.resume(7);
  assert.match(ran[0].sql, /SET stopped_on = NULL, stopped_reason = NULL/);
});

test('RESUME REFUSES A COMPANY CLOSURE IN THE SQL, not only in the route', async () => {
  // A second caller would not think to re-check, and putting a deal back
  // on a company that is gone is the one resume that makes the sheet wrong.
  const { repo, ran } = load();
  await repo.resume(7);
  assert.match(ran[0].sql, /stopped_reason IS DISTINCT FROM \$2/);
  assert.equal(ran[0].params[1], 'company_closed');
  assert.equal(repo.REOPEN_THE_COMPANY, 'company_closed');
});

test('stopMany SKIPS ROWS ALREADY STOPPED, so a date cannot be overwritten', async () => {
  const { repo, ran } = load();
  await repo.stopMany([1, 2], { on: '2026-08-31', reason: repo.STOPPED_REASON.REVIEW_NO });
  assert.match(ran[0].sql, /AND stopped_on IS NULL/);
});

test('stopMany with NOTHING runs no query at all', async () => {
  const { repo, ran } = load();
  assert.deepEqual(await repo.stopMany([], { on: 'x', reason: repo.STOPPED_REASON.BY_HAND }), []);
  assert.equal(ran.length, 0);
});

test('stopMany DROPS ANYTHING THAT IS NOT AN ID rather than passing it on', async () => {
  const { repo, ran } = load();
  await repo.stopMany([1, 'x', null, 1, 2], { on: '2026-08-31', reason: repo.STOPPED_REASON.BY_HAND });
  assert.deepEqual(ran[0].params[0], [1, 2], 'deduped, and only real ids');
});

test('CLOSING A COMPANY only touches its LIVE deals', async () => {
  const { repo, ran } = load();
  await repo.stopCompany('Acqua', { on: '2026-08-31' });
  assert.match(ran[0].sql, /AND stopped_on IS NULL/);
  assert.equal(ran[0].params[2], 'company_closed');
});

/**
 * ===============================
 * * `ids` NARROWS THE CASCADE, and `undefined` is not `[]`
 * ===============================
 * The closure confirm ticks which deals stop, all of them by default.
 * Nothing mentioned means every live deal, which is what Diane relies on;
 * an empty list is a human saying none of them, and must not run a bare
 * UPDATE that stops the lot.
 */
test('NO IDS MEANS EVERY LIVE DEAL, and the clause stands down', async () => {
  const { repo, ran } = load();
  await repo.stopCompany('Acqua', { on: '2026-08-31' });
  assert.match(ran[0].sql, /\$4::int\[\] IS NULL OR id = ANY\(\$4::int\[\]\)/);
  assert.equal(ran[0].params[3], null, 'null, so the OR short circuits to every row');
});

test('IDS NARROW IT TO THOSE ROWS', async () => {
  const { repo, ran } = load();
  await repo.stopCompany('Acqua', { on: '2026-08-31', ids: [4, 9] });
  assert.deepEqual(ran[0].params[3], [4, 9]);
  assert.match(ran[0].sql, /AND stopped_on IS NULL/, 'still only the live ones');
});

test('AN EMPTY LIST RUNS NO SQL AT ALL', async () => {
  // `id = ANY('{}')` is false for every row, so this would be harmless.
  // Returning early is the guard against the day somebody drops the clause.
  const { repo, ran } = load();
  assert.deepEqual(await repo.stopCompany('Acqua', { on: '2026-08-31', ids: [] }), []);
  assert.equal(ran.length, 0, 'nothing may reach the database');
});

test('RUBBISH IN THE LIST IS DROPPED, not interpolated', async () => {
  const { repo, ran } = load();
  await repo.stopCompany('Acqua', { on: '2026-08-31', ids: [4, 'x); DROP TABLE', null, 9] });
  assert.deepEqual(ran[0].params[3], [4, 9]);
});

test('REOPENING only puts back what the CLOSURE stopped', async () => {
  // A deal somebody stopped by hand before the company closed stays
  // stopped: that was a separate decision about that deal.
  const { repo, ran } = load();
  await repo.resumeCompany('Acqua');
  assert.match(ran[0].sql, /AND stopped_reason = \$2/);
  assert.equal(ran[0].params[1], 'company_closed');
});

test('THE ARCHIVE AND THE SHEET ARE ONE TABLE READ TWO WAYS', async () => {
  const { repo, ran } = load([{ total: 0, rows: [] }]);
  await repo.findAll({});
  assert.match(ran[0].sql, /stopped_on IS NULL/, 'the sheet is live rows');

  const second = load([{ total: 0, rows: [] }]);
  await second.repo.findAll({ stopped: true });
  assert.match(second.ran[0].sql, /stopped_on IS NOT NULL/, 'the archive is the rest');
});

test('TWO STATES, NOT THREE. There is no "both"', async () => {
  // Mixing finished deals into the working sheet is how one gets edited by
  // accident, which is exactly what the Archive being read only prevents.
  const { repo, ran } = load([{ total: 0, rows: [] }]);
  await repo.findAll({ stopped: undefined });
  assert.match(ran[0].sql, /stopped_on IS NULL/);
});

test('THE ARCHIVE READS NEWEST FIRST, the sheet does not', async () => {
  const live = load([{ total: 0, rows: [] }]);
  await live.repo.findAll({});
  assert.doesNotMatch(live.ran[0].sql, /ORDER BY stopped_on DESC/);

  const archive = load([{ total: 0, rows: [] }]);
  await archive.repo.findAll({ stopped: true });
  assert.match(archive.ran[0].sql, /ORDER BY stopped_on DESC/);
});

test('THE STOP DATE RANGE IS HALF OPEN, so no time can be lost', async () => {
  const { repo, ran } = load([{ total: 0, rows: [] }]);
  await repo.findAll({ stopped: true, stoppedFrom: '2026-08-01', stoppedTo: '2026-08-31' });
  assert.match(ran[0].sql, /stopped_on >= \$\d+::date/);
  assert.match(ran[0].sql, /stopped_on < \(\$\d+::date \+ 1\)/);
});

test('AN INVENTED REASON FILTER NARROWS NOTHING rather than erroring', async () => {
  const { repo, ran } = load([{ total: 0, rows: [] }]);
  await repo.findAll({ stopped: true, stoppedReason: 'made up' });
  assert.doesNotMatch(ran[0].sql, /stopped_reason = \$/);
});

test('EVERY READ CARRIES THE STOP, so a tint can repaint before the refetch', async () => {
  const { repo, ran } = load([{ total: 0, rows: [] }]);
  await repo.findAll({});
  assert.match(ran[0].sql, /stopped_on, stopped_reason/);
});

test('A DEAL ROW CARRIES ITS COMPANY\'S STATUS, for the liquidation badge', async () => {
  const { repo, ran } = load([{ total: 0, rows: [] }]);
  await repo.findAll({});
  assert.match(ran[0].sql, /AS company_status/);
});
