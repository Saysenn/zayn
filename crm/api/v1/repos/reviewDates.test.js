const test = require('node:test');
const assert = require('node:assert/strict');
const { STOPS_AT, ANSWERS } = require('./monthlyReview.repo');
const { lastDayOf, currentDay } = require('../shared/presetMonth.helper');

/**
 * ***************************************************
 * * WHAT EACH ANSWER DOES TO THE DATE
 * ***************************************************
 *
 * The gap between "final" and "no" is ONE MONTH'S MONEY for one person,
 * which is the whole reason they are two buttons. Nothing else in the CRM
 * pins that difference, so it is pinned here.
 *
 * NO DATABASE. These are the arithmetic, and the arithmetic is where a
 * wrong month comes from.
 */

test('THREE ANSWERS, no more and no fewer', () => {
  assert.deepEqual([...ANSWERS].sort(), ['final', 'no', 'yes']);
});

test('YES STOPS NOTHING. It is the answer and nothing else', () => {
  assert.equal(STOPS_AT.yes('2026-08'), null);
  assert.equal(STOPS_AT.yes('2026-01'), null);
});

test('FINAL is the END OF THIS MONTH, so this month is paid in full', () => {
  assert.equal(STOPS_AT.final('2026-08'), '2026-08-31');
  assert.equal(STOPS_AT.final('2026-09'), '2026-09-30');
  assert.equal(STOPS_AT.final('2026-02'), '2026-02-28');
});

test('NO is the END OF LAST MONTH, so this month is NOT paid', () => {
  assert.equal(STOPS_AT.no('2026-08'), '2026-07-31');
  assert.equal(STOPS_AT.no('2026-03'), '2026-02-28');
});

test('THE TWO ARE A MONTH APART, which is the point of having both', () => {
  // If these ever return the same date, one of the buttons is a lie.
  for (const period of ['2026-01', '2026-02', '2026-08', '2026-12']) {
    assert.notEqual(STOPS_AT.final(period), STOPS_AT.no(period), period);
  }
});

test('JANUARY ROLLS BACK A YEAR, not to month zero', () => {
  assert.equal(STOPS_AT.no('2026-01'), '2025-12-31');
  assert.equal(STOPS_AT.final('2026-01'), '2026-01-31');
});

test('A LEAP FEBRUARY IS 29 DAYS, and nothing writes the length down', () => {
  assert.equal(STOPS_AT.final('2028-02'), '2028-02-29');
  assert.equal(STOPS_AT.no('2028-03'), '2028-02-29');
});

test('lastDayOf refuses a month it cannot read rather than guessing', () => {
  assert.equal(lastDayOf('nonsense'), null);
  assert.equal(lastDayOf(''), null);
  assert.equal(lastDayOf('2026-08'), '2026-08-31');
});

test('currentDay is a DAY, in the shape a date column takes', () => {
  assert.match(currentDay(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(currentDay(new Date('2026-08-20T12:00:00Z')), '2026-08-20');
});

test('THE BUSINESS TIMEZONE, NEVER THE HOST\'S', () => {
  // 23:30 UTC on the 20th is already the 21st in Dubai, and a stop written
  // on the wrong day at a month boundary is a month of somebody's money.
  const wasTz = process.env.TIMEZONE;
  process.env.TIMEZONE = 'Asia/Dubai';
  try {
    assert.equal(currentDay(new Date('2026-08-20T23:30:00Z')), '2026-08-21');
  } finally {
    if (wasTz === undefined) delete process.env.TIMEZONE;
    else process.env.TIMEZONE = wasTz;
  }
});
