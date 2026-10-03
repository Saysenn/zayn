const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotTick, monthBefore, isLastDay } = require('./snapshotScheduler');

test('month boundary scheduler targets the last day month', async () => {
  const calls = [];
  const result = await snapshotTick({
    now: new Date('2026-08-31T12:00:00.000Z'),
    timeZone: 'UTC',
    findMeta: async () => null,
    snapshot: async (month) => { calls.push(month); return { month, existed: false }; },
  });
  assert.equal(result.target, '2026-08');
  assert.deepEqual(calls, ['2026-08']);
});

test('the first day catches up the previous month', async () => {
  const calls = [];
  const result = await snapshotTick({
    now: new Date('2026-09-01T12:00:00.000Z'),
    timeZone: 'UTC',
    findMeta: async () => null,
    snapshot: async (month) => { calls.push(month); return { month, existed: false }; },
  });
  assert.equal(result.target, '2026-08');
  assert.deepEqual(calls, ['2026-08']);
});

test('existing immutable snapshots are never overwritten', async () => {
  let called = false;
  const existing = { month: '2026-08', row_count: 4 };
  const result = await snapshotTick({
    now: new Date('2026-09-01T12:00:00.000Z'),
    timeZone: 'UTC',
    findMeta: async () => existing,
    snapshot: async () => { called = true; },
  });
  assert.equal(result.existed, true);
  assert.equal(called, false);
});

test('ordinary days do not snapshot', async () => {
  let called = false;
  const result = await snapshotTick({
    now: new Date('2026-08-20T12:00:00.000Z'),
    timeZone: 'UTC',
    findMeta: async () => null,
    snapshot: async () => { called = true; },
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test('calendar helpers handle leap years and year rollover', () => {
  assert.equal(isLastDay({ year: '2028', month: '02', day: '29' }), true);
  assert.equal(monthBefore('2027-01'), '2026-12');
});
