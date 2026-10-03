const test = require('node:test');
const assert = require('node:assert/strict');
const { backfill } = require('./fxRates.helper');

/**
 * ***************************************************
 * * A SAVED RATE FILLS A GAP THE FEED LEFT
 * ***************************************************
 *
 * The feed used to be all or nothing: while it answered, not one saved rate
 * was consulted. A currency it does not quote was reported unconvertible
 * even with a rate sitting in Settings, so an admin could set it, watch it
 * save, and watch every total keep refusing it.
 *
 * The euro was never this case, and the distinction matters: the feed DOES
 * carry EUR. It was timing out at 2.5s against a 2.6s response, so every
 * call fell to the hardcoded three, which have no euro at all.
 */

test('a currency the feed did not return is filled from the saved rates', () => {
  const { perUsd, backfilled } = backfill({ GBP: 0.74, USD: 1 }, { EUR: 0.86, SEK: 10.5 });

  assert.equal(perUsd.EUR, 0.86);
  assert.equal(perUsd.SEK, 10.5);
  assert.deepEqual(backfilled.sort(), ['EUR', 'SEK']);
});

test('A LIVE RATE ALWAYS WINS. Filling is never overwriting', () => {
  const { perUsd, backfilled } = backfill({ GBP: 0.74, EUR: 0.86 }, { GBP: 0.99, EUR: 0.5 });

  assert.equal(perUsd.GBP, 0.74, 'the feed keeps GBP');
  assert.equal(perUsd.EUR, 0.86, 'and EUR');
  assert.deepEqual(backfilled, [], 'nothing was filled, so nothing is reported');
});

// A code present but unusable is the same as absent: a zero or a negative
// rate would divide a total into nonsense.
test('a rate the feed returned as unusable is treated as missing', () => {
  for (const bad of [0, -1, null, undefined, 'abc']) {
    const { perUsd, backfilled } = backfill({ EUR: bad }, { EUR: 0.86 });
    assert.equal(perUsd.EUR, 0.86, `feed EUR of ${String(bad)} should be replaced`);
    assert.deepEqual(backfilled, ['EUR']);
  }
});

test('nothing saved changes nothing, and nothing from the feed still fills', () => {
  assert.deepEqual(backfill({ GBP: 0.74 }, {}), { perUsd: { GBP: 0.74 }, backfilled: [] });
  assert.deepEqual(backfill({}, { EUR: 0.86 }), { perUsd: { EUR: 0.86 }, backfilled: ['EUR'] });
});

test('the feed object is never mutated', () => {
  const feed = { GBP: 0.74 };
  backfill(feed, { EUR: 0.86 });
  assert.deepEqual(feed, { GBP: 0.74 });
});
