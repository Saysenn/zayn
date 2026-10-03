// ***************************************************
// * WHY A MONTH MOVED, AND IT HAS TO BALANCE
// ***************************************************

/**
 * "Why is Nicola bigger this September than last month" is not a question
 * about a cause, it is an ACCOUNT. Every pound of the difference named, and
 * anything left over shown rather than absorbed.
 *
 * ---- the five buckets, and they are NOT the same thing ----
 *   added        a deal that was not there last month
 *   removed      the row is gone from the sheet entirely
 *   ended        still on the sheet, stopped or past its end date
 *   notCounted   still live, but this month is not its month
 *   changed      the same deal, a different figure
 *
 * `snapshotDrivers` had three, and everything missing from the later month
 * landed in `ended`. So a live deal with an October preset was reported as
 * ENDED, on the dashboard and to anybody who asked her. Three different
 * facts wearing one word is the fault this file exists to fix.
 *
 * ---- the balance is the whole point ----
 * A list of events is not an answer. The buckets must ADD UP to the
 * difference, per currency, and `residual` carries whatever does not. It
 * should always be zero: a non-zero residual is a BUG in here, and showing
 * it is how anybody finds out. Never round it away, never hide it.
 *
 * ---- one definition, not a second opinion ----
 * Whether a row counts is `isOwedThisMonth` and `isForMonth`, the same two
 * the total, the colour and the snapshot use. This file only asks WHICH of
 * them said no; it never decides for itself.
 */

const { isOwedThisMonth } = require('./owedThisMonth.helper');
const { isForMonth } = require('./presetMonth.helper');

const pence = (n) => Math.round(Number(n || 0) * 100) / 100;

// A cent of drift over hundreds of rows is float noise, not a missing deal.
// Anything above it is a real hole and is reported as one.
const RESIDUAL_TOLERANCE = 0.01;

// net = amount + addon + crypto - fee, so a change in net decomposes into
// exactly these four with nothing left over. The sign is the direction each
// one moves the net, which is what makes the parts sum to the delta.
const NET_PARTS = Object.freeze({
  amount: 1, addon: 1, crypto: 1, fee: -1,
});

// Why a row that is still on the sheet is not in this month's figures.
// ENDED and NOT COUNTED are different answers and must not be folded: one
// is over, the other is simply somebody else's month.
const ENDED = 'ended';
const NOT_COUNTED = 'notCounted';

function netOf(deal) {
  return pence(deal?.net ?? deal?.amount ?? 0);
}

/**
 * ONE DEAL ACROSS TWO MONTHS IS ONE KEY. `sync_key` survives a re-upload,
 * so a row the sheet rewrote is the same deal rather than one ended and one
 * started. Falls back to the id when a row carries no sync key.
 */
function dealKeyFor(deal, rowsById) {
  const row = rowsById.get(String(deal.id));
  if (row?.sync_key) return `sync:${row.sync_key}`;
  return deal.id != null ? `id:${deal.id}` : null;
}

function rowsByIdOf(side) {
  return new Map((side.rows ?? []).map((row) => [String(row.id), row]));
}

function summarize(deal) {
  return {
    key: deal.key,
    id: deal.id ?? null,
    personId: deal.personId ?? null,
    personName: deal.personName ?? null,
    company: deal.company ?? null,
    group: deal.group ?? null,
    role: deal.role ?? null,
    currency: deal.currency || 'GBP',
    net: netOf(deal),
  };
}

/**
 * Build the keyed map of what a month COUNTED.
 *
 * Returns null when two deals share a key, because then nothing below can
 * be trusted: a row with no group duplicates itself through `dealKey`, and
 * silently picking one of the pair would report a phantom ended deal. The
 * caller says it is unavailable rather than guessing.
 */
function countedMap(side, matches) {
  const rowsById = rowsByIdOf(side);
  const out = new Map();
  for (const deal of side.deals ?? []) {
    const row = rowsById.get(String(deal.id));
    if (!matches(deal, row)) continue;
    const key = dealKeyFor(deal, rowsById);
    if (!key || out.has(key)) return null;
    out.set(key, { key, ...deal });
  }
  return out;
}

/**
 * Every row still ON the sheet in the later month, keyed the same way, so a
 * deal missing from the figures can be told apart from a deal missing from
 * the business.
 */
function rowMap(side, matches) {
  const rowsById = rowsByIdOf(side);
  const out = new Map();
  for (const row of side.rows ?? []) {
    if (!matches(null, row)) continue;
    const key = row.sync_key ? `sync:${row.sync_key}` : (row.id != null ? `id:${row.id}` : null);
    if (!key) continue;
    // A duplicate here is harmless: this map only answers "is it still
    // there", so the first one settles it.
    if (!out.has(key)) out.set(key, row);
  }
  return out;
}

/**
 * WHICH OF THE TWO CONDITIONS SAID NO, asked of the row itself.
 *
 * Not re-derived: `isOwedThisMonth` owns the payment period and `isForMonth`
 * owns the preset, and this reads their answers in that order because a
 * stopped deal is over whatever its preset says.
 */
function whyNotCounted(row, month, useEndDate) {
  if (!isOwedThisMonth(row, { useEndDate })) {
    if (row.stopped_on) return { bucket: ENDED, reason: `stopped ${String(row.stopped_on).slice(0, 10)}` };
    if (row.end_on && useEndDate) return { bucket: ENDED, reason: `end date ${String(row.end_on).slice(0, 10)}` };
    if (row.payment_start_on) {
      return { bucket: NOT_COUNTED, reason: `payment starts ${String(row.payment_start_on).slice(0, 10)}` };
    }
    return { bucket: ENDED, reason: 'its payment period is over' };
  }
  if (!isForMonth(row, month)) {
    const preset = row.preset_on ? String(row.preset_on).slice(0, 7) : null;
    return { bucket: NOT_COUNTED, reason: preset ? `preset is ${preset}` : 'marked for another month' };
  }
  // Both conditions pass and it is still not in the figures. Says so rather
  // than inventing a reason: this is the shape of a real bug elsewhere.
  return { bucket: NOT_COUNTED, reason: 'on the sheet and counted by neither rule, which should not happen' };
}

// The four components of a net change, each named, only where it moved.
function changeParts(before, after) {
  const parts = {};
  for (const name of Object.keys(NET_PARTS)) {
    const delta = pence(Number(after[name] ?? 0) - Number(before[name] ?? 0));
    if (delta !== 0) parts[name] = delta;
  }
  return parts;
}

function emptyLedger() {
  return {
    from: 0, to: 0, delta: 0, accounted: 0, residual: 0, balances: true,
  };
}

/**
 * @param {{month, rows, deals}} before the earlier month
 * @param {{month, rows, deals}} after  the later month
 * @param {{matches?: function, useEndDate?: boolean}} options
 *   `matches(deal, row)` narrows to a person, group or company. It is given
 *   the deal when there is one and the row otherwise, so one predicate
 *   serves both maps.
 */
function reconcileMonths(before, after, { matches = () => true, useEndDate = false } = {}) {
  if (!before || !after) {
    return { available: false, reason: 'One of the two months has no saved figures' };
  }
  const beforeCounted = countedMap(before, matches);
  const afterCounted = countedMap(after, matches);
  if (!beforeCounted || !afterCounted) {
    return { available: false, reason: 'Two deals share one identity in these months, so nothing here can be trusted' };
  }
  const afterRows = rowMap(after, matches);

  const added = [];
  const removed = [];
  const ended = [];
  const notCounted = [];
  const changed = [];

  for (const [key, deal] of afterCounted) {
    const was = beforeCounted.get(key);
    if (!was) {
      added.push(summarize(deal));
      continue;
    }
    const delta = pence(netOf(deal) - netOf(was));
    if (delta === 0) continue;
    changed.push({
      ...summarize(deal),
      was: netOf(was),
      now: netOf(deal),
      delta,
      parts: changeParts(was, deal),
    });
  }

  for (const [key, deal] of beforeCounted) {
    if (afterCounted.has(key)) continue;
    const row = afterRows.get(key);
    if (!row) {
      /**
       * STILL ON THE SHEET, JUST NOT IN THIS SCOPE. Live 2026-09-30: two
       * MILKMAN deals moved to INDIGO read "removed from the sheet, the
       * row is no longer on the sheet". The same row, by id, answers it.
       */
      // By id, or by sync key: a saved month keys its deals "workbook:<key>",
      // which the live row carries as its sync_key, never as its id.
      const syncKey = rowsByIdOf(before).get(String(deal.id))?.sync_key;
      const moved = (after.allRows ?? after.rows ?? []).find((r) => (deal.id != null && String(r.id) === String(deal.id))
        || (syncKey && r.sync_key === syncKey));
      if (moved?.stopped_on) {
        const on = moved.stopped_on instanceof Date
          ? `${moved.stopped_on.getFullYear()}-${String(moved.stopped_on.getMonth() + 1).padStart(2, '0')}-${String(moved.stopped_on.getDate()).padStart(2, '0')}`
          : String(moved.stopped_on).slice(0, 10);
        ended.push({ ...summarize(deal), reason: `stopped on ${on}, in the Archive` });
        continue;
      }
      if (moved) {
        const to = [moved.group_name, moved.company].filter(Boolean).join(', ');
        notCounted.push({ ...summarize(deal), reason: `moved to ${to}, still on the sheet` });
        continue;
      }
      removed.push({ ...summarize(deal), reason: 'the row is no longer on the sheet' });
      continue;
    }
    const { bucket, reason } = whyNotCounted(row, after.month, useEndDate);
    (bucket === ENDED ? ended : notCounted).push({ ...summarize(deal), reason });
  }

  return {
    available: true,
    fromMonth: before.month,
    toMonth: after.month,
    added,
    removed,
    ended,
    notCounted,
    changed,
    currencies: ledgers({
      beforeCounted, afterCounted, added, removed, ended, notCounted, changed,
    }),
  };
}

/**
 * THE ARITHMETIC, PER CURRENCY, AND IT MUST COME OUT EVEN.
 *
 * Never one figure across currencies: a GBP rise cancelling an AED fall is
 * a number that describes nothing. Each currency is its own account.
 */
function ledgers({
  beforeCounted, afterCounted, added, removed, ended, notCounted, changed,
}) {
  const out = {};
  const at = (currency) => {
    out[currency] = out[currency] ?? emptyLedger();
    return out[currency];
  };

  for (const deal of beforeCounted.values()) at(deal.currency || 'GBP').from += netOf(deal);
  for (const deal of afterCounted.values()) at(deal.currency || 'GBP').to += netOf(deal);

  for (const entry of added) at(entry.currency).accounted += entry.net;
  for (const entry of [...removed, ...ended, ...notCounted]) at(entry.currency).accounted -= entry.net;
  for (const entry of changed) at(entry.currency).accounted += entry.delta;

  for (const ledger of Object.values(out)) {
    ledger.from = pence(ledger.from);
    ledger.to = pence(ledger.to);
    ledger.accounted = pence(ledger.accounted);
    ledger.delta = pence(ledger.to - ledger.from);
    ledger.residual = pence(ledger.delta - ledger.accounted);
    ledger.balances = Math.abs(ledger.residual) <= RESIDUAL_TOLERANCE;
  }
  return out;
}

module.exports = {
  reconcileMonths,
  whyNotCounted,
  changeParts,
  RESIDUAL_TOLERANCE,
  NET_PARTS,
};
