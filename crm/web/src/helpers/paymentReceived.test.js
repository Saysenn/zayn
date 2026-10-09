import test from 'node:test';
import assert from 'node:assert/strict';
import { dealReceived, DEAL_RECEIVED_OPTIONS } from './paymentReceived.js';

// His call 2026-10-08: a deal is Paid or Unpaid, a portion reads Unpaid
// (flagged) until an admin marks it, and asked-but-silent is Awaiting.
test('EVERY PAYDAY OUTCOME HAS ITS TAG', () => {
  assert.equal(dealReceived('confirmed'), 'paid');
  assert.equal(dealReceived('not_received'), 'unpaid');
  assert.equal(dealReceived('partial'), 'unpaid');
  assert.equal(dealReceived('sent'), 'awaiting');
  assert.equal(dealReceived('no_response'), 'awaiting');
  assert.equal(dealReceived(null), null, 'never asked is a dash');
});

test('AN ADMIN SETS PAID OR UNPAID, nothing else', () => {
  assert.deepEqual(DEAL_RECEIVED_OPTIONS.map((o) => o.label), ['Paid', 'Unpaid']);
  assert.deepEqual(DEAL_RECEIVED_OPTIONS.map((o) => dealReceived(o.value)), ['paid', 'unpaid']);
});
