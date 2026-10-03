import test from 'node:test';
import assert from 'node:assert/strict';

import { flaggedColumns } from './reviewFields.js';

/**
 * ***************************************************
 * * The reason string is a CONTRACT, and it had no test
 * ***************************************************
 *
 * `review_reason` is plain text written by the importer,
 * `crm/api/v1/masterSheet/parseImport.js` reviewReasonFor, and mapped back
 * to columns here. The file has always said so in a comment: "change a
 * phrase there and change it here". Nothing checked it, so a reworded
 * reason would have quietly stopped marking any column at all.
 *
 * WRITTEN TWICE, NEVER READ ACROSS. These strings are restated here rather
 * than imported: crm/web and crm/api share no file. The api half is pinned
 * by its own tests against the real master.xlsx.
 *
 * Every string below was taken from the live parser's output on
 * docs/boss/references/master.xlsx, not invented.
 */

test('prose the appointment rescued marks the date AND the two figures', () => {
  // The six `END FULL` rows. A figure exists, but it is a reading of his
  // note: appointment + 90. He has not always meant that.
  const out = flaggedColumns(
    'payment start reads "AUGUST END FULL", read as appointment + 90 days',
  );
  assert.ok(out.payment_start_on, 'the flag belongs on the column that caused it');
  assert.match(out.payment_start_on, /AUGUST END FULL/);
  assert.match(out.payment_start_on, /appointment date \+ 90 days/);
  // Both figures follow from that date, so both carry the same caveat.
  assert.equal(out.payable_amount, out.payment_start_on);
  assert.equal(out.payable_days, out.payment_start_on);
});

test('prose nothing could rescue is a different message', () => {
  const out = flaggedColumns('payment start reads "TBC", not a date');
  assert.match(out.payment_start_on, /could not be worked out/);
  assert.ok(!/appointment date \+/.test(out.payment_start_on));
});

test('the two prose reasons do not match each other', () => {
  // They share a prefix. If the "not a date" rule also matched the rescued
  // one, the row would say the amount could not be worked out when it was.
  const rescued = flaggedColumns(
    'payment start reads "AUGUST END FULL", read as appointment + 90 days',
  );
  assert.ok(!/could not be worked out/.test(rescued.payment_start_on));
});

test('the offset in the message comes from the reason, not from here', () => {
  // If the decision ever moves from 90 to 84, the API says so and this
  // repeats it rather than carrying its own copy of the number.
  const out = flaggedColumns('payment start reads "X", read as appointment + 84 days');
  assert.match(out.payment_start_on, /appointment date \+ 84 days/);
});

test('the deletion reasons mark the empty half, not the name', () => {
  assert.ok(flaggedColumns('the handler was removed').person_name);
  assert.ok(flaggedColumns('the company was removed').company);
});

test('the other importer reasons still map', () => {
  assert.ok(flaggedColumns('no group').group_name);
  assert.ok(flaggedColumns('payment method not recognised').payment_method);
  assert.ok(flaggedColumns('cannot work out the payable amount').payable_amount);
  assert.ok(flaggedColumns('no currency').currency);
});

test('several reasons in one string all map', () => {
  // reviewReasonFor joins with ", ".
  const out = flaggedColumns('no group, no currency');
  assert.ok(out.group_name);
  assert.ok(out.currency);
});

test('an empty reason marks nothing', () => {
  assert.deepEqual(flaggedColumns(''), {});
  assert.deepEqual(flaggedColumns(null), {});
});
