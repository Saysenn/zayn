const test = require('node:test');
const assert = require('node:assert/strict');

const {
  startFromAppointment, endFromAppointment, isWeekOneAppointment,
  lastFridayOfMonthThree, forcesFullMonth,
} = require('./fromAppointment.helper');
const { payableDaysFor, payableAmountFor } = require('../calculator/computePayable');

/**
 * ***************************************************
 * * A FIRST WEEK APPOINTMENT IS PAID IN MONTH 3
 * ***************************************************
 *
 * His call, 2026-09-18: "it is unfair to make someone wait 4 months."
 *
 * +90 tips a first week appointment just past the end of month 3. Appointed
 * Mon 3 Aug, +90 is Sun 1 Nov, so October pays nothing and the first money
 * arrives at the end of November. So week 1 is pulled back to the last
 * Friday of month 3 and paid the WHOLE of that month.
 *
 * WEEK 1 IS UP TO AND INCLUDING THE FIRST FRIDAY. Not "days 1 to 7", which
 * reaches into the second working week in months that start late.
 *
 * Every expected date below is written out, never computed by calling the
 * thing under test.
 */

const d = (iso) => new Date(`${iso}T00:00:00Z`);

test('week 1 is up to and including the first Friday, whatever weekday the month starts on', () => {
  // August 2026 starts on a Saturday, so its first Friday is the 7th.
  for (const day of ['01', '03', '05', '07']) {
    assert.equal(isWeekOneAppointment(d(`2026-08-${day}`)), true, `2026-08-${day}`);
  }
  for (const day of ['08', '10', '12', '31']) {
    assert.equal(isWeekOneAppointment(d(`2026-08-${day}`)), false, `2026-08-${day}`);
  }
  // September 2026 starts on a Tuesday, first Friday the 4th. The 7th is a
  // Monday and belongs to the SECOND working week.
  assert.equal(isWeekOneAppointment(d('2026-09-04')), true);
  assert.equal(isWeekOneAppointment(d('2026-09-07')), false);
  // May 2026 starts ON a Friday, so week 1 is the 1st alone.
  assert.equal(isWeekOneAppointment(d('2026-05-01')), true);
  assert.equal(isWeekOneAppointment(d('2026-05-04')), false);
});

test('week 1 starts on the last Friday of month 3, and everyone in that week shares it', () => {
  for (const day of ['03', '05', '07']) {
    assert.equal(
      startFromAppointment(d(`2026-08-${day}`)).toISOString().slice(0, 10),
      '2026-10-30',
      `appointed 2026-08-${day}`,
    );
  }
});

test('weeks 2 to 4 are untouched: still appointment + 90', () => {
  assert.equal(startFromAppointment(d('2026-08-10')).toISOString().slice(0, 10), '2026-11-08');
  assert.equal(startFromAppointment(d('2026-08-12')).toISOString().slice(0, 10), '2026-11-10');
  assert.equal(startFromAppointment(d('2026-08-31')).toISOString().slice(0, 10), '2026-11-29');
});

test('the end date is appointment + 1 year in BOTH branches', () => {
  assert.equal(endFromAppointment(d('2026-08-03')).toISOString().slice(0, 10), '2027-08-03');
  assert.equal(endFromAppointment(d('2026-08-12')).toISOString().slice(0, 10), '2027-08-12');
});

// Year rollover and February fall out of the date maths, so nothing here
// carries a month or a year of its own.
test('it holds across the year boundary and in February', () => {
  const cases = {
    '2026-11-03': '2027-01-29',
    '2026-12-03': '2027-02-26',
    '2027-12-03': '2028-02-25',
    '2026-02-03': '2026-04-24',
  };
  for (const [appt, start] of Object.entries(cases)) {
    assert.equal(lastFridayOfMonthThree(d(appt)).toISOString().slice(0, 10), start, appt);
  }
});

/**
 * ===============================
 * * THE DAY COUNT DOES NOT FOLLOW THE START, FOR ONE MONTH
 * ===============================
 * The stored start is the last Friday, the day the money lands. Counted
 * from there October would be two days; he is owed the whole month.
 */
test('month 3 is forced to the whole month, and it is the month LENGTH not 31', () => {
  const appt = d('2026-08-03');
  assert.equal(payableDaysFor(d('2026-10-30'), d('2026-10-01'), { appointmentOn: appt }), 31);
  assert.equal(
    payableAmountFor({
      monthlyAmount: 3000, paymentStartOn: d('2026-10-30'), presetOn: d('2026-10-01'), appointmentOn: appt,
    }),
    3000,
  );
  // A month 3 of 30 days pays 30, never a hardcoded 31.
  const sept = d('2026-07-01');
  assert.equal(isWeekOneAppointment(sept), true);
  assert.equal(payableDaysFor(d('2026-09-25'), d('2026-09-01'), { appointmentOn: sept }), 30);
});

test('ONLY month 3. Month 4 onward is ordinary, and needs no forcing', () => {
  const appt = d('2026-08-03');
  assert.equal(forcesFullMonth(appt, d('2026-10-01')), true);
  assert.equal(forcesFullMonth(appt, d('2026-11-01')), false);
  // And the ordinary formula already returns a full month there, because
  // the stored start sits before the month begins.
  assert.equal(payableDaysFor(d('2026-10-30'), d('2026-11-01'), { appointmentOn: appt }), 30);
  assert.equal(payableDaysFor(d('2026-10-30'), d('2026-12-01'), { appointmentOn: appt }), 31);
});

test('a weeks 2 to 4 deal is never forced, in any month', () => {
  const appt = d('2026-08-12');
  for (const preset of ['2026-10-01', '2026-11-01', '2026-12-01']) {
    assert.equal(forcesFullMonth(appt, d(preset)), false, preset);
  }
  // 10 Nov start against November: 30 - 10 + 1 = 21, the ordinary pro rata.
  assert.equal(payableDaysFor(d('2026-11-10'), d('2026-11-01'), { appointmentOn: appt }), 21);
});

test('no appointment means no forcing, and the old behaviour stands', () => {
  assert.equal(forcesFullMonth(null, d('2026-10-01')), false);
  assert.equal(payableDaysFor(d('2026-10-30'), d('2026-10-01')), 2);
});
