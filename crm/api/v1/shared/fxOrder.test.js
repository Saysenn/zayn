const test = require('node:test');
const assert = require('node:assert/strict');
const { combine, FALLBACK_USD_PER_GBP } = require('./fxRates.helper');

// THE ORDER, PER CURRENCY (his call 2026-10-13): a rate set by hand, then
// today's pulled rate, then the built in three. The pull never outranks him.

const day = { perUsd: { GBP: 0.74, EUR: 0.86, AED: 3.6725, PHP: 58 }, fetchedAt: new Date('2026-10-13T06:00:00Z'), asOf: null, source: 'openexchangerates' };

test('A RATE SET BY HAND WINS over today\'s pull', () => {
  const out = combine({ GBP: 1 / 1.36 }, day);
  assert.equal(out.perUsd.GBP, 1 / 1.36);
  assert.equal(out.sources.GBP, 'saved');
  assert.equal(out.source, 'saved');
  assert.ok(Math.abs(out.usdPerGbp - 1.36) < 1e-12);
});

test('anything not set by hand converts at today\'s pulled rate', () => {
  const out = combine({ GBP: 1 / 1.36 }, day);
  assert.equal(out.perUsd.EUR, 0.86);
  assert.equal(out.sources.EUR, 'daily');
  assert.equal(out.perUsd.PHP, 58);
});

test('with nothing set by hand, GBP is today\'s rate and reads as live', () => {
  const out = combine({}, day);
  assert.equal(out.sources.GBP, 'daily');
  assert.equal(out.source, 'live');
  assert.equal(out.pulledFrom, 'openexchangerates');
});

test('no pull and nothing set: the built in three, and only them', () => {
  const out = combine({}, null);
  assert.equal(out.source, 'fallback');
  assert.equal(out.usdPerGbp, FALLBACK_USD_PER_GBP);
  assert.equal(out.perUsd.EUR, undefined);
  assert.equal(out.sources.AED, 'fallback');
  assert.ok(out.reason);
});

test('a hand set rate fills a currency the pull does not quote', () => {
  const out = combine({ USDT: 1 }, day);
  assert.equal(out.perUsd.USDT, 1);
  assert.equal(out.sources.USDT, 'saved');
});
