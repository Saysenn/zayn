import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// THE REAL ONES. The hook pulls in React and the query client, so anything
// written inside it can only be read as text; this lives in helpers/ so the
// cascade is exercised rather than restated.
import { patchedDeals, columnsOnly, CLOSURE_STOP, INSTRUCTIONS } from './companyCascade.js';
import { today } from './formatDate.js';

/**
 * ***************************************************
 * * A STATUS CHANGE PAINTS ITS DEALS, NOT JUST ITS WORD
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-21. `reviewMonthlyDealIds` and `stopDealIds` are
 * INSTRUCTIONS, and they were being spread onto the cached company row.
 * Two junk keys nothing renders, while the deals underneath sat on the
 * server's last answer: a closure repainted "Closed" instantly and left
 * every deal it had just stopped reading Active until the refetch.
 */

const LIVE = { id: 1, stopped_on: null, stopped_reason: null, payment_period: 'active' };
const deal = (over = {}) => ({ ...LIVE, ...over });

// ===============================
// * The instructions are not columns
// ===============================

test('THE TWO ID LISTS NEVER REACH THE COMPANY ROW', () => {
  const out = columnsOnly({
    status: 'closed', notes: 'gone', stopDealIds: [1], reviewMonthlyDealIds: [2],
  });
  assert.deepEqual(out, { status: 'closed', notes: 'gone' });
});

test('AND THE LIST OF THEM IS THE ONE DEFINITION', () => {
  // A third instruction added to the PATCH body and not to this list is the
  // same bug again, so the two are read from one place.
  assert.deepEqual([...INSTRUCTIONS], ['reviewMonthlyDealIds', 'stopDealIds']);

  // COMMENTS STRIPPED FIRST. The hook's own banner names both keys while
  // explaining that it must not handle them, so the guard matched the prose
  // it was written from. Target the code shape, never the sentence about it.
  const hook = readFileSync(new URL('../hooks/useCompanies.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(hook, /columnsOnly\(fields\)/, 'the hook must strip them through the helper');
  assert.doesNotMatch(hook, /stopDealIds/, 'the hook must not handle them itself');
});

// ===============================
// * Which deals are reviewed monthly
// ===============================

test('TICKING SETS AND UNTICKING CLEARS, in the same pass', () => {
  // Mirrors setReviewMonthlyForCompany. A patch that only ever set would
  // make the checklist one-way and nobody could undo a mistake.
  const out = patchedDeals(
    [deal({ id: 1, review_monthly: true }), deal({ id: 2, review_monthly: false })],
    { reviewMonthlyDealIds: [2] },
  );
  assert.equal(out[0].review_monthly, false);
  assert.equal(out[1].review_monthly, true);
});

test('NO LIST LEAVES THE FLAG ALONE', () => {
  // `undefined` means the question was never asked. An empty array is a
  // real answer meaning none of them.
  const untouched = patchedDeals([deal({ review_monthly: true })], { notes: 'x' });
  assert.equal(untouched[0].review_monthly, true);
  const none = patchedDeals([deal({ review_monthly: true })], { reviewMonthlyDealIds: [] });
  assert.equal(none[0].review_monthly, false);
});

// ===============================
// * Which deals a closure stops
// ===============================

test('CLOSING STOPS EVERY LIVE DEAL WHEN NO LIST IS SENT', () => {
  // Absent is not empty. Diane has no checklist and sends nothing.
  const out = patchedDeals([deal({ id: 1 }), deal({ id: 2 })], { status: 'closed' });
  assert.equal(out[0].stopped_on, today());
  assert.equal(out[1].stopped_on, today());
  assert.equal(out[0].stopped_reason, CLOSURE_STOP);
});

test('AND ONLY THE TICKED ONES WHEN A LIST IS', () => {
  const out = patchedDeals([deal({ id: 1 }), deal({ id: 2 })], {
    status: 'dissolved', stopDealIds: [2],
  });
  assert.equal(out[0].stopped_on, null, 'unticked, still running');
  assert.equal(out[1].stopped_on, today());
});

test('AN EMPTY LIST STOPS NONE OF THEM', () => {
  const out = patchedDeals([deal({ id: 1 })], { status: 'closed', stopDealIds: [] });
  assert.equal(out[0].stopped_on, null);
});

test('A DEAL ALREADY STOPPED IS NOT RE-STAMPED', () => {
  // Its stop was a separate decision, on a different day, and re-dating it
  // would move a row the closure never touched.
  const byHand = deal({ stopped_on: '2026-01-05', stopped_reason: 'stopped_by_hand' });
  const out = patchedDeals([byHand], { status: 'closed' });
  assert.equal(out[0].stopped_on, '2026-01-05');
  assert.equal(out[0].stopped_reason, 'stopped_by_hand');
});

test('THE BADGE MOVES WITH THE STOP, because it is DERIVED', () => {
  // Copying stopped_on alone left payment_period on the server's last
  // answer: Active beside a deal that had just ended.
  const ended = deal({ preset_on: '2026-09-01', payment_start_on: '2025-01-01' });
  const out = patchedDeals([ended], { status: 'closed' });
  assert.notEqual(out[0].payment_period, undefined);
  assert.equal(typeof out[0].payment_period, 'string');
});

// ===============================
// * And the reopen
// ===============================

test('REOPENING PUTS BACK ONLY WHAT THE CLOSURE STOPPED', () => {
  const byClosure = deal({ id: 1, stopped_on: '2026-09-01', stopped_reason: CLOSURE_STOP });
  const byHand = deal({ id: 2, stopped_on: '2026-08-01', stopped_reason: 'stopped_by_hand' });
  const out = patchedDeals([byClosure, byHand], { status: 'active' });
  assert.equal(out[0].stopped_on, null);
  assert.equal(out[1].stopped_on, '2026-08-01', 'a hand stop was its own decision');
});

test('LIQUIDATION AND GOING CONCERN STOP NOTHING. They are still paying', () => {
  for (const status of ['liquidation', 'going_concern']) {
    const out = patchedDeals([deal()], { status });
    assert.equal(out[0].stopped_on, null, status);
  }
});

test('A NOTES EDIT TOUCHES NO DEAL AT ALL', () => {
  // `status` undefined is the status not being mentioned, which must not
  // read as a reopen and clear a closure's stops.
  const stopped = deal({ stopped_on: '2026-09-01', stopped_reason: CLOSURE_STOP });
  const out = patchedDeals([stopped], { notes: 'gone in June' });
  assert.equal(out[0].stopped_on, '2026-09-01');
});

test('AND A COMPANY WITH NO DEALS LOADED IS LEFT AS IT IS', () => {
  assert.equal(patchedDeals(undefined, { status: 'closed' }), undefined);
  assert.deepEqual(patchedDeals([], { status: 'closed' }), []);
});
