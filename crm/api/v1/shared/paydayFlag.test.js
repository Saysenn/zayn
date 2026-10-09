const test = require('node:test');
const assert = require('node:assert/strict');
const { paydayFlag, keepingPayday } = require('./paydayFlag.helper');
const { personPayStateSql } = require('./personPayState.helper');

/**
 * ***************************************************
 * * WHICH PAYDAY ANSWERS WAIT FOR AN ADMIN, AND WHAT CLEARS THEM
 * ***************************************************
 * His calls 2026-10-08: a portion is flagged, an answer changed after the
 * fact is flagged, and only setting Payment received clears it. An upload
 * is not an answer.
 */

test('A PORTION IS FLAGGED, said once', () => {
  assert.match(paydayFlag('sent', 'partial'), /only part of the pay arrived/);
  assert.match(paydayFlag(null, 'partial'), /only part/);
  assert.equal(paydayFlag('partial', 'partial'), null, 'a repeat is not news');
});

test('NO, THEN "THE AMOUNT WAS SHORT" IS A PORTION, not a changed mind', () => {
  // whatbot's own follow up to a no turns not_received into partial.
  assert.match(paydayFlag('not_received', 'partial'), /only part/);
});

test('A REAL ANSWER CHANGED IS FLAGGED, with both sides named', () => {
  assert.equal(paydayFlag('confirmed', 'not_received'), 'payday answer changed from Paid to Unpaid');
  assert.equal(paydayFlag('partial', 'confirmed'), 'payday answer changed from Portion to Paid');
});

test('AN ORDINARY ANSWER IS NOT FLAGGED', () => {
  assert.equal(paydayFlag('sent', 'confirmed'), null);
  assert.equal(paydayFlag(null, 'not_received'), null);
  assert.equal(paydayFlag('confirmed', 'confirmed'), null);
  assert.equal(paydayFlag('confirmed', 'no_response'), null, 'silence changes nothing');
});

test('THE REASON HOLDS NO COMMA: review_reason is a comma list', () => {
  for (const [was, now] of [['sent', 'partial'], ['confirmed', 'not_received']]) {
    assert.doesNotMatch(paydayFlag(was, now), /,/);
  }
});

test('AN UPLOAD CARRIES THE PAYDAY FLAG OVER', () => {
  const old = { review_reason: 'no currency, payday says only part of the pay arrived' };
  assert.equal(keepingPayday('needs_review', false, old), true);
  assert.equal(keepingPayday('review_reason', '', old), 'payday says only part of the pay arrived');
  assert.equal(keepingPayday('review_reason', 'no group', old), 'no group, payday says only part of the pay arrived');
  assert.equal(keepingPayday('monthly_amount', 500, old), 500, 'every other column passes through');
});

test('AND LEAVES A ROW WITH NO PAYDAY FLAG ALONE', () => {
  const old = { review_reason: 'no currency' };
  assert.equal(keepingPayday('needs_review', false, old), false);
  assert.equal(keepingPayday('review_reason', '', old), '');
  assert.equal(keepingPayday('needs_review', false, null), false, 'a new row has no old one');
});

test('A PERSON READS THEIR LIVE DEALS: three states and the default', () => {
  const sql = personPayStateSql('d');
  // Undecided deals read as the switch's default, as every switch renders.
  assert.match(sql, /COALESCE\(d\.override_should_be_paid, true\)/);
  assert.match(sql, /COALESCE\(d\.override_paid, false\)/);
  for (const word of ["'yes'", "'no'", "'mixed'", "'paid'", "'unpaid'", "'portion'", "'awaiting'"]) {
    assert.ok(sql.includes(word), `${word} is one of the answers`);
  }
});
