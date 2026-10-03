import test from 'node:test';
import assert from 'node:assert/strict';

import {
  startFromAppointment, endFromAppointment, isWeekOneAppointment, forcesFullMonth,
} from './fromAppointment.js';
import { payableDaysFor, payableFromDays } from './payable.js';

/**
 * A FIRST WEEK APPOINTMENT IS PAID IN MONTH 3.
 *
 * THE WEB HALF of the mirror in api/v1/shared/fromAppointment.helper.js.
 * Both sides run the same cases on purpose: this is the optimistic row, and
 * a cell that paints one figure and settles to another is the flicker the
 * mirror exists to remove.
 *
 * Every expected date is written out, never computed by the code under test.
 */

const iso = (d) => d.toISOString().slice(0, 10);

test('week 1 is up to and including the first Friday', () => {
  // August 2026 starts on a Saturday, first Friday the 7th.
  for (const day of ['01', '03', '05', '07']) {
    assert.equal(isWeekOneAppointment(`2026-08-${day}`), true, `2026-08-${day}`);
  }
  for (const day of ['08', '10', '31']) {
    assert.equal(isWeekOneAppointment(`2026-08-${day}`), false, `2026-08-${day}`);
  }
  // September starts on a Tuesday: the 7th is a Monday, second week.
  assert.equal(isWeekOneAppointment('2026-09-04'), true);
  assert.equal(isWeekOneAppointment('2026-09-07'), false);
  // May 2026 starts ON a Friday, so week 1 is the 1st alone.
  assert.equal(isWeekOneAppointment('2026-05-01'), true);
  assert.equal(isWeekOneAppointment('2026-05-04'), false);
});

test('week 1 starts on the last Friday of month 3, and shares it', () => {
  for (const day of ['03', '05', '07']) {
    assert.equal(iso(startFromAppointment(`2026-08-${day}`)), '2026-10-30', day);
  }
});

test('weeks 2 to 4 are still appointment + 90', () => {
  assert.equal(iso(startFromAppointment('2026-08-10')), '2026-11-08');
  assert.equal(iso(startFromAppointment('2026-08-31')), '2026-11-29');
});

test('the end date is appointment + 1 year in both branches', () => {
  assert.equal(iso(endFromAppointment('2026-08-03')), '2027-08-03');
  assert.equal(iso(endFromAppointment('2026-08-12')), '2027-08-12');
});

test('month 3 is forced to the month LENGTH, and only month 3', () => {
  const appt = '2026-08-03';
  assert.equal(payableDaysFor('2026-10-30', '2026-10-01', { appointmentOn: appt }), 31);
  assert.equal(
    payableFromDays({ monthlyAmount: 3000, presetOn: '2026-10-01', payableDays: 31 }),
    3000,
  );
  assert.equal(forcesFullMonth(appt, '2026-11-01'), false);
  // November already returns a full month on its own: the stored start
  // sits before the month begins.
  assert.equal(payableDaysFor('2026-10-30', '2026-11-01', { appointmentOn: appt }), 30);
});

test('a 30 day month 3 pays 30, never a hardcoded 31', () => {
  assert.equal(payableDaysFor('2026-09-25', '2026-09-01', { appointmentOn: '2026-07-01' }), 30);
});

test('no appointment means no forcing, and the old behaviour stands', () => {
  assert.equal(payableDaysFor('2026-10-30', '2026-10-01'), 2);
});

/**
 * THE TWO SIDES MUST AGREE. Not a shared import, which the boundary
 * forbids: the same cases written out on both sides, and each half fails
 * on its own if it drifts.
 */
test('the cases the API half also runs', () => {
  const cases = {
    '2026-08-03': '2026-10-30',
    '2026-11-03': '2027-01-29',
    '2026-12-03': '2027-02-26',
    '2027-12-03': '2028-02-25',
    '2026-02-03': '2026-04-24',
  };
  for (const [appt, start] of Object.entries(cases)) {
    assert.equal(iso(startFromAppointment(appt)), start, appt);
  }
});
