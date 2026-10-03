const test = require('node:test');
const assert = require('node:assert/strict');

const { checkRelayed, linesShown } = require('./checkRelayed');
const { confirmFirst } = require('./tools/confirmFirst');

/**
 * ***************************************************
 * * A DEAL SHE LEFT OUT OF THE LIST SHE WAS ASKED TO RELAY
 * ***************************************************
 *
 * `confirmFirst` sends `lines` when a COUNT is not enough to judge by: a
 * mixed act cannot be confirmed from a number, because one wrong line is
 * invisible in it. Its summary says to relay them, and that is a sentence.
 * Observed 2026-09-23: given a three person block she wrote her own.
 */

const LINES = [
  'Quillon Marsh: payable days to "10" (1 row)',
  'Tarn Vessey: payable days to "12" (1 row)',
  'Odile Prang: payable days to "25" (1 row)',
];
const PENDING = [{ pending: true, lines: LINES }];

test('the tool hands the list back structurally', () => {
  // Parsed out of the summary it would pick up the instructions addressed
  // to HER, which is the mistake `confirming` was added to undo.
  const out = confirmFirst(false, {
    act: 'set a DIFFERENT value on each of them', count: 3, lines: LINES,
  });
  assert.deepEqual(out.lines, LINES);
  assert.equal(out.pending, true);
});

test('a confirm with no list hands back null, not an empty array', () => {
  const out = confirmFirst(false, { act: 'stop 2 deals', count: 2 });
  assert.equal(out.lines, null);
  assert.equal(linesShown([out]), null);
});

test('a confirmed call is not pending and carries no list', () => {
  assert.equal(confirmFirst(true, { act: 'anything', count: 1, lines: LINES }), null);
});

/* ===============================
 * * THE FACTS, NOT THE WORDING
 * =============================== */

test('her own words pass, so long as every line is in them', () => {
  // This is the real answer from the run. It IS the list read aloud.
  const hers = "This would set Quillon Marsh's payable days to 10, Tarn Vessey's to 12, and "
    + "Odile Prang's to 25, affecting three deals in total.";
  assert.equal(checkRelayed(hers, PENDING).ok, true);
});

test('a dropped deal is caught, and named', () => {
  const out = checkRelayed('Quillon Marsh to 10 and Tarn Vessey to 12. Shall I?', PENDING);
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing, ['Odile Prang: payable days to "25" (1 row)']);
});

test('a rounded figure is caught', () => {
  const out = checkRelayed('Quillon Marsh to 10, Tarn Vessey to 12, Odile Prang to 20.', PENDING);
  assert.equal(out.ok, false);
});

test('a mixed act cannot be summarised into a count', () => {
  // The case the lines exist for: "3 deals" says nothing about WHICH deal
  // got which answer.
  const mixed = [{
    pending: true,
    lines: ['Reliapay: final this month', 'KP: ended', 'Kryptonia: still running'],
  }];
  assert.equal(checkRelayed('That covers 3 deals. Go ahead?', mixed).ok, false);
  assert.equal(
    checkRelayed('Reliapay is final this month, KP has ended, Kryptonia still runs.', mixed).ok,
    true,
  );
});

test('it is silent when no tool sent a list', () => {
  assert.equal(checkRelayed('anything at all', [{ pending: true }]).ok, true);
  assert.equal(checkRelayed('anything at all', []).ok, true);
});

test('the LAST list is the one she is answering', () => {
  const two = [{ lines: ['Blake Rowntree: to "5"'] }, { lines: ['Sp: to "9"'] }];
  assert.deepEqual(linesShown(two), ['Sp: to "9"']);
});
