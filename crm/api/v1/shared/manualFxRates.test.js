const test = require('node:test');
const assert = require('node:assert/strict');
const { toUsd, totalInUsd, normalizeRates, AED_PER_USD } = require('./toUsd.helper');

/**
 * ***************************************************
 * * A RATE AN ADMIN SET IS THE ONE THAT GETS USED
 * ***************************************************
 *
 * The hardcoded fallback carries GBP, USD and AED and nothing else, which
 * is why the sheet's EURO rows went unconverted for weeks with no way to
 * fix it from the CRM. Saved rates fill that gap, and they only mean
 * anything if the converter actually reaches for them.
 */

test('a saved rate converts a currency the fallback never carried', () => {
  // EURO folds to EUR, which the fallback has no entry for at all.
  assert.equal(toUsd(100, 'EURO', 1.36, {}), null, 'no rate is null, never a par conversion');
  assert.equal(toUsd(100, 'EURO', 1.36, { EUR: 0.86 }), 100 / 0.86);
});

// ===============================
// * THE PEG IS THE LAST RESORT, NOT THE FIRST
// ===============================
// AED returned the peg BEFORE the table was consulted, so a rate an admin
// set in Settings was stored, shown back to them, and then ignored by every
// conversion that mattered.
test('a saved AED rate beats the peg, and the peg still catches an empty table', () => {
  assert.equal(toUsd(3.6725, 'AED', 1.36, {}), 1, 'with nothing saved, the peg still applies');
  assert.equal(toUsd(4, 'AED', 1.36, { AED: 4 }), 1, 'a saved rate wins');
  assert.notEqual(toUsd(4, 'AED', 1.36, { AED: 4 }), 4 / AED_PER_USD);
});

test('GBP still comes from the rate the run was given, not the table', () => {
  // A rate typed into an export is about THAT run and beats everything.
  assert.equal(toUsd(100, 'GBP', 1.5, { GBP: 0.77 }), 150);
});

test('USD is never converted, whatever the table says', () => {
  assert.equal(toUsd(100, 'USD', 1.36, { USD: 99 }), 100);
});

// ===============================
// * BOTH SIDES OF THE LOOKUP GO THROUGH THE ALIASES
// ===============================
// August 2026's snapshot froze its euro rate under the sheet's own `EURO`.
// Only the AMOUNT's currency was normalized, so the lookup asked for `EUR`,
// missed, and the month reported "no exchange rate is available" while
// holding the rate all along.
test('a rate map keyed the sheet way is still found', () => {
  assert.equal(toUsd(100, 'EURO', 1.36, { EURO: 0.86 }), 100 / 0.86);
  assert.equal(toUsd(100, 'EUR', 1.36, { EURO: 0.86 }), 100 / 0.86);

  // The real snapshot's map, and the real amount on it.
  const frozen = { AED: 3.6725, GBP: 0.7378678945697231, EURO: 0.86135611907387 };
  const { unconvertible } = totalInUsd(new Map([['EURO', 3510], ['GBP', 80850]]), 1.3552559536394044, frozen);
  assert.deepEqual(unconvertible, [], 'the month held a euro rate the whole time');
});

test('an exact ISO key wins over an aliased one, so a map with both resolves the same way', () => {
  assert.deepEqual(normalizeRates({ EURO: 0.86, EUR: 0.9 }), { EUR: 0.9 });
  assert.deepEqual(normalizeRates({ EUR: 0.9, EURO: 0.86 }), { EUR: 0.9 });
});

test('a rate that is zero, negative or nonsense is no rate at all', () => {
  for (const bad of [0, -1, 'abc', null, undefined, Infinity]) {
    assert.equal(toUsd(100, 'SEK', 1.36, { SEK: bad }), null, `SEK at ${String(bad)}`);
  }
});
