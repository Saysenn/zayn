const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SNAPSHOT_MONTHS, monthsToPrune,
  DASHBOARD_HISTORY_OPTIONS, DEFAULT_DASHBOARD_HISTORY, dashboardHistoryMonths,
} = require('./snapshotWindow.helper');
const { pruneOld, snapshotTick } = require('../masterSheet/snapshotScheduler');

/**
 * ***************************************************
 * * Twelve months, pruned AFTER the write
 * ***************************************************
 *
 * Nothing pruned before 2026-09-09: `remove` sat on the repo with no caller
 * and snapshots accumulated forever.
 */

const monthsFrom = (start, count) => Array.from({ length: count }, (_, i) => {
  const [y, m] = start.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + i, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
});

test('twelve is the window, and one place says so', () => {
  assert.equal(SNAPSHOT_MONTHS, 12);
});

test('HIS WORKED EXAMPLE: twelve held drops nothing, thirteen drops the oldest', () => {
  // September 2026 taken with eleven already held is twelve. Nothing goes.
  const twelve = monthsFrom('2025-10', 12);
  assert.deepEqual(monthsToPrune(twelve), []);

  // October 2026 taken next month makes thirteen. October 2025 goes.
  assert.deepEqual(monthsToPrune([...twelve, '2026-10']), ['2025-10']);
});

test('it drops the OLDEST, whatever order they arrive in', () => {
  const jumbled = ['2026-08', '2025-10', '2026-03', '2025-11'];
  assert.deepEqual(monthsToPrune(jumbled, 2), ['2025-10', '2025-11']);
});

test('a fresh table with nothing to prune prunes nothing', () => {
  assert.deepEqual(monthsToPrune([]), []);
  assert.deepEqual(monthsToPrune(['2026-08']), []);
});

test('duplicates and blanks cannot make it delete a real month', () => {
  const held = ['2026-08', '2026-08', null, '', '2026-09'];
  assert.deepEqual(monthsToPrune(held, 2), []);
});

/**
 * ===============================
 * * AFTER THE WRITE, NEVER BEFORE
 * ===============================
 * Making room first leaves eleven months and nothing to replace the twelfth
 * if the snapshot then throws.
 */

test('a tick that writes nothing prunes nothing', async () => {
  let pruned = false;
  const out = await snapshotTick({
    now: new Date('2026-09-30T12:00:00Z'),
    timeZone: 'UTC',
    findMeta: async () => ({ month: '2026-09' }), // already saved
    snapshot: async () => { throw new Error('must not be called'); },
    prune: async () => { pruned = true; return []; },
  });
  assert.equal(out.existed, true);
  assert.equal(pruned, false, 'the window did not move, so nothing is dropped');
});

test('a tick that WRITES then prunes, in that order', async () => {
  const order = [];
  const out = await snapshotTick({
    now: new Date('2026-09-30T12:00:00Z'),
    timeZone: 'UTC',
    findMeta: async () => null,
    snapshot: async (month) => { order.push(`take:${month}`); return { month }; },
    prune: async () => { order.push('prune'); return ['2025-09']; },
  });
  assert.deepEqual(order, ['take:2026-09', 'prune']);
  assert.deepEqual(out.pruned, ['2025-09']);
});

test('A FAILED PRUNE NEVER LOSES THE SNAPSHOT, which is the valuable half', async () => {
  const out = await snapshotTick({
    now: new Date('2026-09-30T12:00:00Z'),
    timeZone: 'UTC',
    findMeta: async () => null,
    snapshot: async (month) => ({ month }),
    prune: async () => { throw new Error('stale row'); },
  });
  assert.equal(out.month, '2026-09', 'the month is still saved');
  assert.deepEqual(out.pruned, []);
});

test('pruneOld removes every stale month, not just the first', async () => {
  const removed = [];
  const held = monthsFrom('2025-06', 16).map((month) => ({ month }));
  const out = await pruneOld({
    list: async () => held,
    remove: async (month) => { removed.push(month); return { month }; },
  });
  assert.equal(removed.length, 4, 'sixteen held, twelve kept');
  assert.deepEqual(removed, ['2025-06', '2025-07', '2025-08', '2025-09']);
  assert.deepEqual(out, removed);
});

/**
 * ===============================
 * * THE SETTING CAPS THE VIEW, IT DOES NOT DELETE
 * ===============================
 * The obvious version of this dropdown drove retention too, so 12 -> 3
 * would delete nine immutable snapshots on the next cron tick. A snapshot
 * froze the sheet as it stood that day and cannot be rebuilt from anything.
 * His call 2026-09-09 to separate them.
 */

test('the dropdown offers three, six or twelve, defaulting to three', () => {
  assert.deepEqual([...DASHBOARD_HISTORY_OPTIONS], [3, 6, 12]);
  assert.equal(DEFAULT_DASHBOARD_HISTORY, 3);
});

test('RETENTION IGNORES THE SETTING ENTIRELY', () => {
  // The pruner takes no setting and has no parameter for one. Twelve is
  // kept whether the dashboard offers 3 or 12, which is what makes raising
  // the setting instant rather than a year of history nobody can recover.
  const twelve = monthsFrom('2025-10', 12);
  assert.deepEqual(monthsToPrune(twelve), [], 'nothing goes at the default of 3');
  // ONE REQUIRED ARGUMENT: what is stored. `keep` defaults to the constant
  // and no caller passes a setting, so there is no route for one.
  assert.equal(monthsToPrune.length, 1);
  assert.equal(SNAPSHOT_MONTHS, 12);
});

test('an unknown or missing value is the default, never a throw', () => {
  // The dashboard refusing to load over a settings row is worse than a
  // shorter dropdown.
  for (const bad of [undefined, null, '', 0, 4, 99, 'twelve', -3]) {
    assert.equal(dashboardHistoryMonths(bad), DEFAULT_DASHBOARD_HISTORY, String(bad));
  }
  // A real one passes through, as a number whatever shape it arrived in.
  assert.equal(dashboardHistoryMonths(6), 6);
  assert.equal(dashboardHistoryMonths('12'), 12);
});
