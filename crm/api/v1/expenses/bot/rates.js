const logger = require('../../../configs/logger');

// ***************************************************
// * TODAY'S RATE TO AED, FOR AN EXPENSE IN ANOTHER CURRENCY
// ***************************************************
//
// His call 2026-10-07: a GBP, EUR or USD expense needs its rate to AED, or
// its AED amount (and every total) is blank. Fetched, not asked:
//   1. Open Exchange Rates, hourly, with OPENEXCHANGERATES_APP_ID;
//   2. open.er-api.com, daily, no key, when the first is unset or down;
//   3. nothing: the bot asks "1 GBP to AED is?".
// The rate is SAVED ON THE EXPENSE, so a later rate never moves an old AED
// figure (expenses never read tb_fx_rates; see docs/expense.md).

const HOUR = 60 * 60 * 1000;
const cache = new Map(); // currency -> { rate, source, at, ttl }

const round = (n) => Math.round(n * 10000) / 10000;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

async function fromOpenExchangeRates(code) {
  const key = process.env.OPENEXCHANGERATES_APP_ID;
  if (!key) return null;
  const d = await getJson(`https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(key)}&symbols=AED,${code}`);
  const aed = Number(d?.rates?.AED);
  const per = Number(d?.rates?.[code]);
  if (!(aed > 0 && per > 0)) return null;
  // Rates are per US dollar: AED per 1 of the currency is AED ÷ that.
  return { rate: round(aed / per), source: 'hourly market rate', ttl: HOUR };
}

async function fromOpenErApi(code) {
  const d = await getJson(`https://open.er-api.com/v6/latest/${code}`);
  const aed = Number(d?.rates?.AED);
  return aed > 0 ? { rate: round(aed), source: "today's market rate", ttl: 6 * HOUR } : null;
}

/**
 * AED per 1 of `code`, or null when no source answered.
 * @returns {Promise<null | { rate: number, source: string }>}
 */
async function liveRate(code) {
  const c = String(code ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  if (c === 'AED') return { rate: 1, source: 'AED' };
  const hit = cache.get(c);
  if (hit && Date.now() - hit.at < hit.ttl) return { rate: hit.rate, source: hit.source };
  for (const source of [fromOpenExchangeRates, fromOpenErApi]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const got = await source(c);
      if (got) {
        cache.set(c, { ...got, at: Date.now() });
        return { rate: got.rate, source: got.source };
      }
    } catch (err) {
      logger.warn({ currency: c, err: err.message, source: source.name }, 'expense bot: rate source failed, trying the next');
    }
  }
  return null;
}

/** Every currency in the list, fetched once each. */
async function liveRates(codes) {
  const out = {};
  for (const c of [...new Set(codes.map((x) => String(x ?? '').toUpperCase()))].filter((x) => x && x !== 'AED')) {
    // eslint-disable-next-line no-await-in-loop
    const got = await liveRate(c);
    if (got) out[c] = got;
  }
  return out;
}

module.exports = { liveRate, liveRates, _cache: cache };
