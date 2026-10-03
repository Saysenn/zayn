const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * ***************************************************
 * * CONTRACT: the month belongs to the business, not to UTC
 * ***************************************************
 *
 * `currentMonth` was `toISOString().slice(0, 7)`. The admin is on Pacific
 * time, so from 5pm on the last day of every month until midnight UTC the
 * CRM was already in the next one: every total, every cell colour and every
 * export said September while the calendar on the wall said 31 August.
 *
 * Wrong for seven hours a month, only ever at a boundary, and it looks
 * exactly like a real drop in the total. The other half of this contract is
 * `crm/web/src/components/export/MasterSheetExportModal.jsx`, which reads
 * the browser's own zone and pins it with its own test.
 */

// The zone is read per call, so setting it is enough: no cache busting,
// and a stale formatter cannot hide behind a fresh require.
const load = (tz) => { process.env.TIMEZONE = tz; return require('./presetMonth.helper'); };

// 1 September, 02:00 UTC. Still 31 August at 7pm in Los Angeles.
const BOUNDARY = new Date('2026-09-01T02:00:00Z');

test('THE LAST EVENING OF THE MONTH IS STILL THAT MONTH', () => {
  const { currentMonth } = load('America/Los_Angeles');
  assert.equal(currentMonth(BOUNDARY), '2026-08');
});

test('and UTC, which is what it used to do, disagrees', () => {
  // The test is only worth having if the two answers differ here.
  assert.equal(BOUNDARY.toISOString().slice(0, 7), '2026-09');
});

test('a zone AHEAD of UTC gets the same treatment', () => {
  const { currentMonth } = load('Asia/Manila');
  // 31 August 23:00 UTC is already 1 September in Manila.
  assert.equal(currentMonth(new Date('2026-08-31T23:00:00Z')), '2026-09');
});

test('an unset TIMEZONE still returns a real month, never a crash', () => {
  const { currentMonth } = load('');
  assert.match(currentMonth(BOUNDARY), /^\d{4}-(0[1-9]|1[0-2])$/);
});

test('THE ROW TEST FOLLOWS IT, so the total moves with the month', () => {
  const { isForMonth } = load('America/Los_Angeles');
  const august = { preset_on: '2026-08-01' };

  // Defaulting to "now" is what every total does when no month is passed.
  // If that default is UTC, an August row drops out of the August run on
  // the evening of the 31st.
  assert.equal(isForMonth(august, '2026-08'), true);
  assert.equal(isForMonth(august, '2026-09'), false);
});
