const env = require('../../configs/env');

/**
 * LIVE FX RATES, AND WHY THIS FILE IS MOSTLY ABOUT NOT FAILING.
 *
 * The export's converted breakdown needs a USD rate. Fetching one puts a
 * third party in the path of a payout file, which is the wrong trade if it
 * is ever load bearing: a file that will not generate because open-er-api
 * is down is worse than one converted at yesterday's rate. So EVERY
 * failure path here returns a rate, and the caller is told which one it
 * got so the sheet can say so.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 * - It does not retry. A rate is a nice-to-have on a document that has to
 *   come out now, and a retry loop turns a 2 second timeout into 6.
 *
 * TWO THINGS IT USED TO SAY IT DID NOT DO, AND NOW DOES:
 *
 * - It reads SAVED rates, from `tb_fx_rates`. This file used to argue that
 *   a rates table would be "a second record of the same fact with nothing
 *   reading it". That was true while the only fallback was hardcoded. It
 *   stopped being true when the feed timed out for weeks and the sheet's
 *   EURO rows went unconverted with no way to fix it from the CRM.
 * - It lets AED be SET. It is still a peg, fixed at 3.6725 since 1997, and
 *   that constant is still the last resort. But a peg is a decision
 *   somebody made and can unmake, and the admin asked to own it.
 *
 * ORDER: live feed, then cache, then saved rates, then the hardcoded
 * three. A saved rate never beats a live one.
 *
 * Cached for the day because the source itself is daily: the response
 * carries time_next_update_utc, roughly 24 hours out. Polling faster than
 * the data changes is just load on somebody's free endpoint.
 */

// The mid-market rate is not what a bank gives you. This is a fallback for
// a document, not a quote, and a rate typed into the export beats it.
const FALLBACK_USD_PER_GBP = 1.362553;
// ===============================
// * 2500 WAS UNDER THE ENDPOINT'S OWN LATENCY
// ===============================
// Measured: open.er-api.com answers in ~2.6s from here, so every call
// timed out, every call fell back, and the fallback carries no EUR. The
// sheet's 6 EURO rows had a rate available in all 166 the response
// carries and were reported unconvertible anyway. Still bounded, and the
// result is cached for six hours, so this is paid four times a day.
const TIMEOUT_MS = 6000;
const CACHE_MS = 6 * 60 * 60 * 1000;

let cache = null; // { usdPerGbp, perUsd, source, fetchedAt, asOf }

/**
 * WHAT THE FALLBACK CAN AND CANNOT DO.
 *
 * It carries GBP, because that is the one rate this business runs on and a
 * hardcoded stale number beats no payout file. It carries AED because that
 * is a peg, not a rate. It carries NOTHING ELSE: inventing a EUR number
 * from memory would put a figure on a payout document that nobody can
 * source. Those rows are left blank and named instead.
 */
function fallback(reason) {
  return {
    usdPerGbp: FALLBACK_USD_PER_GBP,
    perUsd: { GBP: 1 / FALLBACK_USD_PER_GBP, USD: 1, AED: 3.6725 },
    source: 'fallback',
    asOf: null,
    reason,
  };
}

/**
 * ===============================
 * * THE RATES AN ADMIN SET, BETWEEN THE FEED AND THE FALLBACK
 * ===============================
 *
 * The hardcoded fallback carries GBP, USD and AED and nothing else, on the
 * deliberate principle that a EUR number invented from memory has no
 * provenance. That principle stands. A rate an ADMIN typed and can see in
 * Settings is not invented from memory: it has an author and a date, which
 * is exactly the provenance the fallback lacks.
 *
 * So the order is feed, then saved, then named as unconvertible. A saved
 * rate never overrides a live one: the feed is the better answer whenever
 * it answers.
 *
 * FAILURE IS THE FALLBACK, NEVER A THROW. A payout file must not refuse to
 * generate because a settings table is unreachable.
 */
/** The saved rates as units per dollar, or `{}` if we cannot read them. */
async function manualRates() {
  try {
    // eslint-disable-next-line global-require
    return await require('../repos/fxRates.repo').perUsd();
  } catch {
    return {};
  }
}

/**
 * ===============================
 * * A SAVED RATE FILLS A GAP THE FEED LEFT
 * ===============================
 *
 * The feed used to be all or nothing: while it answered, not one saved rate
 * was consulted, so a currency it does not quote was reported unconvertible
 * even with a rate sitting in Settings. An admin would set it, see it
 * saved, and watch every total keep refusing it.
 *
 * A LIVE RATE STILL ALWAYS WINS. This only fills a code the feed did not
 * return, or returned as something unusable. It never overwrites one.
 */
function backfill(feed, manual) {
  const out = { ...feed };
  const filled = [];
  for (const [code, rate] of Object.entries(manual)) {
    const have = Number(out[code]);
    if (!Number.isFinite(have) || have <= 0) {
      out[code] = rate;
      filled.push(code);
    }
  }
  return { perUsd: out, backfilled: filled };
}

async function saved(reason) {
  const base = fallback(reason);
  try {
    // eslint-disable-next-line global-require
    const repo = require('../repos/fxRates.repo');
    const manual = await repo.perUsd();
    if (Object.keys(manual).length === 0) return base;
    // Saved rates WIN over the fallback's three, because the admin set
    // them on purpose and the fallback is a guess with a date on it.
    const perUsd = { ...base.perUsd, ...manual };
    return {
      ...base,
      perUsd,
      // GBP travels separately as well, so the one the converter reaches
      // for first cannot disagree with the one in the table.
      usdPerGbp: perUsd.GBP > 0 ? 1 / perUsd.GBP : base.usdPerGbp,
      source: 'saved',
      reason,
    };
  } catch {
    return base;
  }
}

/**
 * The current USD per GBP, and where it came from.
 *
 * @returns {Promise<{usdPerGbp:number, source:'live'|'cache'|'fallback', asOf:string|null, reason?:string}>}
 *   Never rejects. `source` is what the export prints beside the figure.
 */
async function usdPerGbp() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
    return {
      usdPerGbp: cache.usdPerGbp,
      perUsd: cache.perUsd,
      backfilled: cache.backfilled ?? [],
      source: 'cache',
      asOf: cache.asOf,
    };
  }
  if (!env.fxRatesUrl) return saved('FX_RATES_URL is not set');

  try {
    // AbortSignal.timeout rather than a manual race: it actually cancels
    // the socket, where a race leaves the request running and the process
    // holding it open.
    const res = await fetch(env.fxRatesUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return saved(`rates endpoint returned ${res.status}`);

    const body = await res.json();
    // USD base, so GBP comes back as pounds per dollar and has to be
    // inverted. Guarded rather than assumed: a shape change upstream
    // should degrade to the fallback, not divide by undefined.
    const gbpPerUsd = Number(body?.rates?.GBP);
    if (!Number.isFinite(gbpPerUsd) || gbpPerUsd <= 0) {
      return saved('no usable GBP rate in the response');
    }

    const rate = 1 / gbpPerUsd;
    // THE WHOLE TABLE, not just GBP. The sheet carries EURO as well, and a
    // converter that knows three currencies by name leaves every other one
    // blank forever. About 160 come back in the same response that was
    // already being fetched, so this costs nothing. Anything it still does
    // not quote is filled from the rates an admin set.
    const { perUsd, backfilled } = backfill(body.rates, await manualRates());
    cache = {
      usdPerGbp: rate,
      perUsd,
      backfilled,
      source: 'live',
      fetchedAt: Date.now(),
      asOf: body?.time_last_update_utc ?? null,
    };
    return {
      usdPerGbp: rate, perUsd, backfilled, source: 'live', asOf: cache.asOf,
    };
  } catch (err) {
    // Offline, DNS, timeout, bad JSON. All the same from here: no rate.
    return saved(err.name === 'TimeoutError' ? 'rates endpoint timed out' : err.message);
  }
}

/** Testing only, so one case cannot leak its rate into the next. */
function resetCache() {
  cache = null;
}

/**
 * ===============================
 * * FETCHED AT BOOT, NOT ON WHOEVER ASKS FIRST
 * ===============================
 *
 * The endpoint answers in about 2.6 seconds. Lazily, that lands on the
 * first person to open the dashboard, and if it misses the timeout their
 * figures are the ones that come back short. Worse, it is SILENT: a bad
 * fetch is only visible later, as a currency mysteriously unconverted.
 *
 * Same shape as `pool.warmUp`: fire and forget, never awaited, and the
 * server must still come up if the feed is down. The log line is the
 * point, because it turns an invisible degradation into a boot message.
 */
async function warmUp() {
  const started = Date.now();
  // eslint-disable-next-line global-require
  const logger = require('../../configs/logger');
  try {
    const rates = await usdPerGbp();
    const codes = Object.keys(rates.perUsd ?? {}).length;
    if (rates.source === 'live' || rates.source === 'cache') {
      logger.info({
        ms: Date.now() - started, source: rates.source, codes, backfilled: rates.backfilled ?? [],
      }, 'fx: rates ready');
    } else {
      // NOT a warning about nothing: this is the state where a currency
      // nobody has set a rate for will be reported unconvertible.
      logger.warn({
        ms: Date.now() - started, source: rates.source, reason: rates.reason, codes,
      }, 'fx: no live rates, using saved or built in');
    }
  } catch (err) {
    logger.warn({ err }, 'fx: warm up failed, the first request will fetch instead');
  }
}

module.exports = {
  usdPerGbp, resetCache, warmUp, backfill, FALLBACK_USD_PER_GBP,
};
