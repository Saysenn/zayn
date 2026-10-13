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
 * ORDER (changed 2026-10-13, see THE ORDER, PER CURRENCY below): a rate
 * set by hand, then today's pulled rate, then the hardcoded three.
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
 *
 * SUPERSEDED 2026-10-13 by combine() below, where a hand set rate wins.
 * Kept, with its tests, for the old order's record; nothing calls it.
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

// ***************************************************
// * THE ORDER, PER CURRENCY (his call 2026-10-13)
// ***************************************************
//
//   1. A RATE SET BY HAND in Settings. Always wins: the pull never touches
//      it, and a live feed no longer outranks it (it used to, which made a
//      typed rate a standby the boss could not rely on).
//   2. TODAY'S PULLED RATE, fetched once a day into tb_fx_rates_daily from
//      Open Exchange Rates (OPENEXCHANGERATES_APP_ID), or open.er-api
//      (FX_RATES_URL) when that is unset or down.
//   3. The built in three (GBP, the AED peg, USD), and nothing else.
//
// Read from the database, memoised for a minute so a page of conversions
// is one read, not one per row.
const MEMO_MS = 60 * 1000;
// How old the day's pull may get before it is fetched again.
const DAILY_MS = 23 * 60 * 60 * 1000;
// How often the server checks whether today's pull is due.
const CHECK_MS = 60 * 60 * 1000;

let memo = null; // { at, value }

/** What converts each currency, and where each rate came from. */
function combine(manual, day) {
  const base = fallback(day ? undefined : 'no daily rates pulled yet');
  const perUsd = { ...base.perUsd, ...(day?.perUsd ?? {}), ...manual };
  const sources = {};
  for (const code of Object.keys(perUsd)) {
    sources[code] = code in manual ? 'saved' : (day?.perUsd && code in day.perUsd ? 'daily' : 'fallback');
  }
  // `source` is the GBP rate's, the one the export prints beside its
  // figure. A pulled rate is today's, so it reads as live.
  const source = sources.GBP === 'daily' ? 'live' : sources.GBP;
  return {
    usdPerGbp: perUsd.GBP > 0 ? 1 / perUsd.GBP : base.usdPerGbp,
    perUsd,
    sources,
    // Kept for old readers: codes running on a hand set rate while a pulled one exists.
    backfilled: Object.keys(manual).filter((c) => day?.perUsd && c in day.perUsd),
    source,
    asOf: day ? (day.asOf ?? day.fetchedAt)?.toISOString?.() ?? String(day.asOf ?? day.fetchedAt) : null,
    pulledAt: day?.fetchedAt ?? null,
    pulledFrom: day?.source ?? null,
    ...(day ? {} : { reason: base.reason }),
  };
}

/**
 * The rates every conversion uses, and where each came from.
 *
 * @returns {Promise<{usdPerGbp:number, perUsd:object, sources:object, source:'saved'|'live'|'fallback', asOf:string|null, reason?:string}>}
 *   Never rejects: an unreadable table is the built in three.
 */
async function usdPerGbp() {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.value;
  // eslint-disable-next-line global-require
  const repo = require('../repos/fxRates.repo');
  const [manual, day] = await Promise.all([
    repo.perUsd().catch(() => ({})),
    repo.daily().catch(() => null),
  ]);
  const value = combine(manual, day);
  memo = { at: Date.now(), value };
  return value;
}

// ***************************************************
// * THE DAILY PULL
// ***************************************************

async function fromOpenExchangeRates() {
  const key = process.env.OPENEXCHANGERATES_APP_ID;
  if (!key) return null;
  const res = await fetch(`https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`openexchangerates returned ${res.status}`);
  const body = await res.json();
  if (!(Number(body?.rates?.GBP) > 0)) throw new Error('openexchangerates sent no usable GBP rate');
  return { rates: body.rates, source: 'openexchangerates', asOf: body.timestamp ? new Date(body.timestamp * 1000) : null };
}

async function fromOpenErApi() {
  if (!env.fxRatesUrl) return null;
  const res = await fetch(env.fxRatesUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`rates endpoint returned ${res.status}`);
  const body = await res.json();
  if (!(Number(body?.rates?.GBP) > 0)) throw new Error('no usable GBP rate in the response');
  const asOf = body?.time_last_update_utc ? new Date(body.time_last_update_utc) : null;
  return { rates: body.rates, source: 'open.er-api', asOf: Number.isNaN(asOf?.getTime()) ? null : asOf };
}

let pulling = null;

/**
 * Fetches today's rates into tb_fx_rates_daily, unless they are under a
 * day old (or `force`). Never touches a rate set by hand. Never throws.
 * @returns {Promise<{pulled:boolean, source?:string, codes?:number, reason?:string}>}
 */
function pullDaily({ force = false } = {}) {
  if (pulling) return pulling;
  pulling = (async () => {
    // eslint-disable-next-line global-require
    const repo = require('../repos/fxRates.repo');
    // eslint-disable-next-line global-require
    const logger = require('../../configs/logger');
    try {
      const day = await repo.daily().catch(() => null);
      if (!force && day && Date.now() - new Date(day.fetchedAt).getTime() < DAILY_MS) {
        return { pulled: false, reason: 'today\'s rates are already in' };
      }
      for (const source of [fromOpenExchangeRates, fromOpenErApi]) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const got = await source();
          if (!got) continue;
          // eslint-disable-next-line no-await-in-loop
          const codes = await repo.saveDaily(got.rates, { source: got.source, asOf: got.asOf });
          memo = null;
          logger.info({ source: got.source, codes }, 'fx: today\'s rates pulled');
          return { pulled: true, source: got.source, codes };
        } catch (err) {
          logger.warn({ err: err.message, source: source.name }, 'fx: a rate source failed, trying the next');
        }
      }
      logger.warn('fx: no rate source answered; hand set rates and the last pull stay in use');
      return { pulled: false, reason: 'no rate source answered' };
    } catch (err) {
      logger.warn({ err: err.message }, 'fx: daily pull failed');
      return { pulled: false, reason: err.message };
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

let timer = null;
/** At boot, then hourly: pulls when the day's rates are a day old. */
function startDailyPull() {
  if (timer) return;
  void pullDaily();
  timer = setInterval(() => { void pullDaily(); }, CHECK_MS);
  timer.unref?.();
}

/** Testing only, so one case cannot leak its rate into the next. */
function resetCache() {
  memo = null;
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
    startDailyPull();
    await pulling;
    const rates = await usdPerGbp();
    const codes = Object.keys(rates.perUsd ?? {}).length;
    if (rates.pulledAt) {
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
  usdPerGbp, resetCache, warmUp, backfill, combine, pullDaily, startDailyPull, FALLBACK_USD_PER_GBP,
};
