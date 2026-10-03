const test = require('node:test');
const assert = require('node:assert');

const {
  PAYMENT_START_OFFSET_DAYS, startFromAppointment, endFromAppointment,
  stillTheFormulasAnswer,
} = require('./fromAppointment.helper');

/**
 * ***************************************************
 * * THE CASCADE IS A CONTRACT, WRITTEN TWICE
 * ***************************************************
 *
 * `crm/api` and `crm/web` SHARE NO FILE, so the appointment cascade exists
 * on both sides: here, and in `crm/web/src/helpers/fromAppointment.js` for
 * the optimistic row. This file pins THIS half. The web half is pinned by
 * `crm/web/src/helpers/fromAppointment.test.js` against the SAME worked
 * examples, restated there rather than shared.
 *
 * NEVER READ ACROSS. No import, no require, no readFileSync into ../../web,
 * the same arrangement `breakdownPreviews.test.js` and `exportMonth.test.js`
 * already state. crm/api must test on a machine holding only itself.
 *
 * If either side changes, the examples below and the ones over there stop
 * agreeing and one of the two files goes red.
 */

const D = (iso) => new Date(`${iso}T00:00:00.000Z`);
const day = (d) => d.toISOString().slice(0, 10);

test('CONTRACT: the offset is 90 days', () => {
  // His two written documents say 12 weeks and "84 days from
  // incorporation"; master.xlsx says 90 on all 78 of its formula rows, and
  // the money was paid against the spreadsheet. Decided 2026-09-08.
  //
  // The web mirror states the same number as its own named constant. Change
  // one and the shared examples below disagree with the ones there.
  assert.equal(PAYMENT_START_OFFSET_DAYS, 90);
});

test('CONTRACT: appointment 2026-01-20 gives start 2026-04-20, end 2027-01-20', () => {
  // Row 12 of master.xlsx, Thomas Snelling, INDIGO. The web test asserts
  // this same row, and so does appointmentCascade.test.js over there.
  assert.equal(day(startFromAppointment(D('2026-01-20'))), '2026-04-20');
  assert.equal(day(endFromAppointment(D('2026-01-20'))), '2027-01-20');
});

test('CONTRACT: appointment 2026-04-15 gives start 2026-07-14', () => {
  // The mid-month case: 18 payable days of July and 580.65 on 1000.
  assert.equal(day(startFromAppointment(D('2026-04-15'))), '2026-07-14');
});

test('CONTRACT: 29 February rolls to 1 March', () => {
  assert.equal(day(endFromAppointment(D('2028-02-29'))), '2029-03-01');
});

test('CONTRACT: no appointment derives nothing', () => {
  assert.equal(startFromAppointment(null), null);
  assert.equal(endFromAppointment('Ongoing'), null);
});

test('CONTRACT: the guard is the formula test, not the claim array', () => {
  // A stored 2026-08-01 against an appointment of 2026-05-28: the formula
  // would give 2026-08-26, so a human chose this one. The Indigo pair.
  assert.equal(stillTheFormulasAnswer(D('2026-08-01'), D('2026-05-28'), 'start'), false);
  assert.equal(stillTheFormulasAnswer(D('2026-08-26'), D('2026-05-28'), 'start'), true);
  assert.equal(stillTheFormulasAnswer(null, D('2026-05-28'), 'start'), true);
});
