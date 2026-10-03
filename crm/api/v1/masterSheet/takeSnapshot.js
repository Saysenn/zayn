const rowsRepo = require('../repos/masterSheetRows.repo');
const settingsRepo = require('../repos/settings.repo');
const peopleRepo = require('../repos/people.repo');
const snapshots = require('../repos/monthSnapshots.repo');
const fxRates = require('../shared/fxRates.helper');
const { isForMonth, currentMonth } = require('../shared/presetMonth.helper');
const { isOwedThisMonth } = require('../shared/owedThisMonth.helper');
const { amountWithRates } = require('../shared/rates.helper');

/**
 * ***************************************************
 * * Taking the month, before it stops being true
 * ***************************************************
 *
 * THE ROW EXACTLY AS THE TABLE HELD IT. No renaming, no rounding, no
 * narrowing to the columns forecasting is expected to want. The questions
 * are not known yet, and a column left out in September cannot be added
 * back in December.
 *
 * THE FIGURES ARE COMPUTED ONCE, HERE, AND STORED. Every reader afterwards
 * quotes them rather than recomputing: recomputing September under
 * whatever the rules are in March answers a different question, and would
 * answer it differently again the next time a rule moved.
 *
 * IT USES THE LIVE PREDICATE, exactly once. `isOwedThisMonth` and
 * `isForMonth` are the same two the total, the colour and the badge read,
 * so the stored figure is the figure that was on screen the day it was
 * taken. That is the whole claim a snapshot makes.
 *
 * TAKE IT BEFORE THE ROLL. A snapshot taken after the presets move is a
 * copy of the new month wearing the old month's name.
 */

const pence = (n) => Math.round(Number(n) * 100) / 100;
const SNAPSHOT_FORMULA_VERSION = 1;

/** Per group, per currency, plus the grand totals and the rate used. */
function figuresFor(rows, month, {
  useEndDate, rates, cryptoPercent, fx, localLocations = null,
}) {
  const grand = {};
  const addon = {};
  const fee = {};
  const crypto = {};
  const net = {};
  const byGroup = {};
  const deals = [];
  let counted = 0;

  const add = (into, key, n) => { into[key] = pence((into[key] ?? 0) + n); };

  for (const row of rows) {
    // Both conditions, the same way every live reader applies them.
    if (!isOwedThisMonth(row, { useEndDate }) || !isForMonth(row, month)) continue;
    counted += 1;

    const currency = row.currency || 'GBP';
    const parts = amountWithRates(row, rates, { cryptoPercent });
    if (!Number.isFinite(parts.amount)) continue;

    add(grand, currency, parts.amount);
    if (parts.addon > 0) add(addon, currency, parts.addon);
    if (parts.fee > 0) add(fee, currency, parts.fee);
    if (parts.crypto > 0) add(crypto, currency, parts.crypto);
    add(net, currency, parts.net);

    const group = row.group_name || 'UNKNOWN';
    byGroup[group] = byGroup[group] ?? {
      rows: 0,
      byCurrency: {},
      addonByCurrency: {},
      cryptoByCurrency: {},
      feeByCurrency: {},
      netByCurrency: {},
    };
    byGroup[group].rows += 1;
    add(byGroup[group].byCurrency, currency, parts.amount);
    if (parts.addon > 0) add(byGroup[group].addonByCurrency, currency, parts.addon);
    if (parts.crypto > 0) add(byGroup[group].cryptoByCurrency, currency, parts.crypto);
    if (parts.fee > 0) add(byGroup[group].feeByCurrency, currency, parts.fee);
    add(byGroup[group].netByCurrency, currency, parts.net);

    deals.push({
      id: row.id,
      personId: row.person_id ?? null,
      personName: row.person_name ?? null,
      company: row.company ?? null,
      group,
      role: row.role_label ?? null,
      currency,
      amount: pence(parts.amount),
      addon: pence(parts.addon),
      crypto: pence(parts.crypto),
      fee: pence(parts.fee),
      net: pence(parts.net),
    });
  }

  return {
    month,
    rows: rows.length,
    counted,
    // NAMED SEPARATELY, never folded together: an add on is what a person
    // costs and a crypto charge is what the rail costs.
    grand,
    addon,
    fee,
    crypto,
    net,
    byGroup,
    deals,
    // WHAT THE RULES WERE. Without these the figures cannot be explained a
    // year later, only repeated.
    settings: {
      useEndDate,
      cryptoPercent,
      formulaVersion: SNAPSHOT_FORMULA_VERSION,
      // The workbook's UK/away split depends on this list. Saving only the
      // totals meant a later settings edit could rewrite the meaning of an
      // old month without changing its raw money.
      ...(Array.isArray(localLocations) ? { localLocations: [...localLocations] } : {}),
    },
    // The rate is part of the record: a converted figure with no rate
    // cannot be checked afterwards.
    fx: fx ? {
      usdPerGbp: fx.usdPerGbp,
      perUsd: fx.perUsd ?? {},
      source: fx.source,
      asOf: fx.asOf ?? null,
    } : null,
  };
}

/**
 * @param {string} [month] 'YYYY-MM'. Defaults to the business month.
 * @returns {{ month, taken_at, row_count, existed }} `existed` true when a
 *   snapshot was already there and nothing was written.
 */
async function takeSnapshot(month = currentMonth()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
    throw new Error(`Not a month: ${month}`);
  }

  const [rows, settings, rates] = await Promise.all([
    rowsRepo.findAllRows(),
    settingsRepo.get(),
    peopleRepo.rateMap(),
  ]);

  // A rate the feed cannot give is not a reason to lose the month.
  const fx = await fxRates.usdPerGbp().catch(() => null);

  const totals = figuresFor(rows, month, {
    useEndDate: Boolean(settings?.color_uses_end_date),
    cryptoPercent: Number(settings?.crypto_percent ?? 0),
    localLocations: settings?.local_locations,
    rates,
    fx,
  });

  return snapshots.take(month, rows, totals);
}

module.exports = { takeSnapshot, figuresFor, SNAPSHOT_FORMULA_VERSION };
