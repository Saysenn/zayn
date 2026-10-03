const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * ***************************************************
 * * THE SUITE MUST NOT CARE WHAT MONTH IT IS
 * ***************************************************
 *
 * On 1 September thirteen tests failed and nothing had changed. Their
 * fixtures were pinned to `preset_on: '2026-08-01'`, and `countsTowardTotal`
 * falls back to `isForMonth(row)`, which means the month we are in NOW. All
 * August they counted; the next day none of them did, totals went to zero,
 * and the failures pointed at the breakdown writer.
 *
 * FIXING THE FIXTURES IS NOT THE SAME AS PROVING IT CANNOT HAPPEN AGAIN.
 * This runs the load-bearing rules under a MOVED CLOCK: next month, six
 * months on, a year on, and across a year boundary. If any of them still
 * depends on today, it fails here rather than on the first of some month
 * when nobody has changed anything and nobody believes the suite.
 */

const { countsTowardTotal } = require('../shared/owedThisMonth.helper');
const { isForMonth, currentMonth } = require('../shared/presetMonth.helper');

const RealDate = Date;

/** Run `fn` as though today were the first of `iso` ('YYYY-MM'). */
function atMonth(iso, fn) {
  const pretend = new RealDate(`${iso}-15T12:00:00Z`).getTime();
  class Fake extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(pretend);
      else super(...args);
    }

    static now() { return pretend; }
  }
  global.Date = Fake;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

// Every month of a year plus two, so a year boundary and a December to
// January roll are both covered rather than assumed.
const MONTHS = [
  '2026-09', '2026-10', '2026-11', '2026-12',
  '2027-01', '2027-02', '2027-06', '2027-12', '2028-01', '2031-07',
];

test('the clock helper actually moves the clock', () => {
  // Guards the guard. Without this the whole file could pass by doing
  // nothing at all.
  assert.notEqual(atMonth('2031-07', currentMonth), currentMonth());
  assert.equal(atMonth('2031-07', currentMonth), '2031-07');
  assert.equal(global.Date, RealDate, 'the real clock must be put back');
});

test('A FIXTURE FOR "THIS MONTH" COUNTS IN EVERY MONTH, forever', () => {
  const { presetNow } = require('./months');

  for (const month of MONTHS) {
    const counts = atMonth(month, () => {
      const row = {
        preset_on: presetNow(), payable_amount: 500, payable_days: 31, status: 'active',
      };
      return countsTowardTotal(row);
    });
    assert.equal(counts, true, `a current-month fixture stopped counting in ${month}`);
  }
});

test('a fixture for ANOTHER month stays out, in every month', () => {
  const { presetOffset } = require('./months');

  for (const month of MONTHS) {
    const counts = atMonth(month, () => countsTowardTotal({
      preset_on: presetOffset(1), payable_amount: 500, payable_days: 31, status: 'active',
    }));
    assert.equal(counts, false, `next month's row counted in ${month}`);
  }
});

test('NAMING THE MONTH BEATS THE CLOCK, which is the actual fix', () => {
  // `countsTowardTotal` took no month and always asked about today, so a
  // document built FOR August was judged against September.
  const august = { preset_on: '2026-08-01', payable_amount: 500, payable_days: 31, status: 'active' };

  for (const month of MONTHS) {
    atMonth(month, () => {
      assert.equal(
        countsTowardTotal(august, { month: '2026-08' }), true,
        `naming August failed while the clock said ${month}`,
      );
      assert.equal(
        countsTowardTotal(august, { month: '2024-01' }), false,
        `naming a different month counted anyway in ${month}`,
      );
    });
  }
});

test('a ROLLED row ignores the clock entirely, because it carries the answer', () => {
  // `rollToMonth` stamps `for_this_month`, and that is what production
  // relies on. It must win over both the clock and the argument.
  for (const month of MONTHS) {
    atMonth(month, () => {
      const rolled = {
        preset_on: '2026-08-01', for_this_month: true,
        payable_amount: 500, payable_days: 31, status: 'active',
      };
      assert.equal(countsTowardTotal(rolled, { month: '2024-01' }), true, month);
    });
  }
});

test('isForMonth still defaults to now, which is what the fallback means', () => {
  // Pinned so nobody "tidies" the default away and changes what an
  // unrolled row means in production.
  for (const month of MONTHS) {
    atMonth(month, () => {
      assert.equal(isForMonth({ preset_on: `${month}-01` }), true, month);
      assert.equal(isForMonth({ preset_on: '2020-01-01' }), false, month);
      // No preset is the standing roster: owed every month, always.
      assert.equal(isForMonth({ preset_on: null }), true, month);
    });
  }
});
