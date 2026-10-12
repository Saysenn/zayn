const test = require('node:test');
const assert = require('node:assert');
const { isOwedThisMonth } = require('./owedThisMonth.helper');
const { paymentPeriodSql } = require('./paymentPeriod.helper');

test('MONTH 3 OF A WEEK ONE APPOINTMENT IS OWED IN FULL, whatever the payment start (his call 2026-10-10)', () => {
  // appointed 5 Aug (on or before August's first Friday, the 7th): October is month 3
  assert.equal(isOwedThisMonth({ preset_on: '2026-10-01', payment_start_on: '2026-11-03', assigned_on: '2026-08-05' }), true);
  // appointed after the first week: October is not paid until the start
  assert.equal(isOwedThisMonth({ preset_on: '2026-10-01', payment_start_on: '2026-11-03', assigned_on: '2026-08-20' }), false);
  // a week one appointment, but the row is for another month: the start still rules
  assert.equal(isOwedThisMonth({ preset_on: '2026-09-01', payment_start_on: '2026-11-03', assigned_on: '2026-08-05' }), false);
  // a stop still wins over it
  assert.equal(isOwedThisMonth({ preset_on: '2026-10-01', payment_start_on: '2026-11-03', assigned_on: '2026-08-05', stopped_on: '2026-09-15' }), false);
  // the SQL twin carries the same branch
  assert.match(paymentPeriodSql('d'), /interval '2 months'/);
});
