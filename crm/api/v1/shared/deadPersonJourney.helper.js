// ***************************************************
// * A dead person's journey: their past deals, company by company
// ***************************************************
//
// A person is on the dead list when every deal they ever held is stopped
// (repos/deadPeople.repo.js). This shapes those deals for their page and
// for Diane, one definition for both.

const { ratedAmount } = require('./rates.helper');
const { countsTowardTotal } = require('./owedThisMonth.helper');
// Numbers, not display text: the page and Diane each format them their own way.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A pg DATE arrives as local midnight: toISOString would move it a day west of UTC.
const pad = (n) => String(n).padStart(2, '0');
function ymd(v) {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).slice(0, 10);
}

/** Whole calendar months from the first to the last day, both counted. */
function monthsBetween(from, to) {
  const a = ymd(from);
  const b = ymd(to);
  if (!a || !b || b < a) return 0;
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}

// A company IN A GROUP is one engagement, as everywhere else (companyKeySql).
const companyKey = (d) => `${String(d.group_name ?? '').trim().toLowerCase()}|${String(d.company ?? '').trim().toLowerCase()}`;

/**
 * One deal as the journey shows it: what it was owed a month, rated, and
 * how long it ran from its payment start to its stop.
 */
function journeyDeal(d, opts = {}) {
  const started = ymd(d.payment_start_on) ?? ymd(d.assigned_on);
  return {
    id: d.id,
    role: d.role_label ?? '',
    currency: d.currency || 'GBP',
    monthlyAmount: Number(d.monthly_amount) || 0,
    owedMonthly: round2(ratedAmount(d.monthly_amount, d, opts)),
    appointedOn: ymd(d.assigned_on),
    startedOn: started,
    stoppedOn: ymd(d.stopped_on),
    stoppedReason: d.stopped_reason ?? null,
    monthsActive: monthsBetween(started, d.stopped_on),
  };
}

/**
 * The deals grouped by company, each with when it started and ended across
 * its deals, oldest first.
 */
function journeyByCompany(deals = [], opts = {}) {
  const byKey = new Map();
  for (const d of deals) {
    const key = companyKey(d);
    if (!byKey.has(key)) byKey.set(key, { company: d.company ?? '', group: d.group_name ?? '', deals: [] });
    byKey.get(key).deals.push(journeyDeal(d, opts));
  }
  const firstOf = (list, k) => list.map((x) => x[k]).filter(Boolean).sort()[0] ?? null;
  const lastOf = (list, k) => list.map((x) => x[k]).filter(Boolean).sort().at(-1) ?? null;
  return [...byKey.values()]
    .map((c) => ({
      ...c,
      roles: [...new Set(c.deals.map((d) => d.role).filter(Boolean))],
      startedOn: firstOf(c.deals, 'startedOn'),
      stoppedOn: lastOf(c.deals, 'stoppedOn'),
    }))
    .sort((a, b) => String(a.startedOn ?? '').localeCompare(String(b.startedOn ?? '')));
}

/**
 * What the month snapshots recorded as owed to them, per currency. The
 * figures are the months as kept, never recomputed from today's rows.
 *
 * @param {{ month: string, row: object }[]} snapshotRows their rows only
 */
function recordedEarnings(snapshotRows = [], { useEndDate = false, cryptoPercent = 0 } = {}) {
  const byCurrency = {};
  const months = new Set();
  for (const { month, row } of snapshotRows) {
    if (!countsTowardTotal(row, { useEndDate, month })) continue;
    const currency = row.currency || 'GBP';
    byCurrency[currency] = (byCurrency[currency] ?? 0) + ratedAmount(row.payable_amount, row, { cryptoPercent });
    months.add(month);
  }
  for (const c of Object.keys(byCurrency)) byCurrency[c] = round2(byCurrency[c]);
  return { byCurrency, months: [...months].sort() };
}

/**
 * The whole record, as the page and Diane both read it.
 *
 * @param {object} row from deadPeople.repo findById
 */
function shapeDeadPerson(row, { useEndDate = false, cryptoPercent = 0 } = {}) {
  const { deals = [], snapshot_rows: snapshotRows = [], live_count: _live, ...person } = row;
  const companies = journeyByCompany(deals, { cryptoPercent });
  const all = companies.flatMap((c) => c.deals);
  // NO COMBINED MONTHLY FIGURE: the deals did not all run at once, so their sum
  // was never owed in any month. Each deal says its own. 2026-09-25.
  return {
    ...person,
    companies,
    companyCount: companies.length,
    firstStarted: all.map((d) => d.startedOn).filter(Boolean).sort()[0] ?? null,
    lastStopped: all.map((d) => d.stoppedOn).filter(Boolean).sort().at(-1) ?? null,
    earnings: recordedEarnings(snapshotRows, { useEndDate, cryptoPercent }),
  };
}

module.exports = {
  monthsBetween, journeyDeal, journeyByCompany, recordedEarnings, companyKey, shapeDeadPerson,
};
