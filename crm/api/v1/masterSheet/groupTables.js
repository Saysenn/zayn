/**
 * The two tables that sit beside and beneath a group's deals.
 *
 * The boss's own working file carries both, hand-made, on the tab he sends
 * back: a summary of who runs each live company, and a pivot of what the
 * group costs broken down by how it is paid and where. Rebuilding them by
 * hand every month is the work this replaces.
 *
 * They are DERIVED, never stored. Both are a reading of the same deal rows
 * already on the tab, so neither can disagree with the figures above it.
 */

const { fold } = require('./dealKey');
const { isPeriodEnded } = require('../shared/paymentPeriod.helper');
const { isForMonth } = require('../shared/presetMonth.helper');
const { amountWithRates, ratesFor } = require('../shared/rates.helper');


/** How the sheet spells a role. `role` is folded ('mid'), the label is not. */
const DIRECTOR = 'director';
const MID = 'mid';

// ===============================
// * Workforce is staff, never a client company
// ===============================
// His own Active company list never carries one: 32 entries, 3 files, zero.
// Anchored, so `Pino - Workforce` goes and a longer real name stays.
const INTERNAL_COMPANY = /(^|\s-\s*)workforce$/i;

/** One cell, however many people are in it. Summary, not a roster. */
function joinNames(rows) {
  return [...new Set(rows.map((r) => r.person_name).filter(Boolean))].join(', ');
}

/**
 * ONE ROW PER LIVE COMPANY: who runs it, and what kind of company it is.
 *
 * "Live" is the payment period, the same derivation every page reads, so a
 * company whose last deal finished drops off this table the month it does
 * rather than the next time somebody notices.
 *
 * A company with no director still appears with the cell blank. Leaving it
 * out would make the table quietly disagree with the deals beside it, and
 * a missing director is exactly the thing worth seeing.
 *
 * INTERNAL_COMPANY rows are dropped here and nowhere else: their money
 * still counts in every total and breakdown.
 *
 * @param {object[]} rows one group's deals
 * @param {Map<string,string>} tiers ckey -> tier, from tb_companies
 */
function activeCompanies(rows, tiers = new Map()) {
  const byCompany = new Map();

  for (const r of rows) {
    const name = String(r.company ?? '').trim();
    if (!name || INTERNAL_COMPANY.test(name)) continue;
    // Ended deals do not put a company on this table, but they do not take
    // one off either: one live deal is enough for the company to be live.
    const key = fold(name);
    if (!byCompany.has(key)) byCompany.set(key, { name, rows: [], live: false });
    const entry = byCompany.get(key);
    entry.rows.push(r);
    if (!isPeriodEnded(r)) entry.live = true;
  }

  return [...byCompany.values()]
    .filter((c) => c.live)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      company: c.name,
      director: joinNames(c.rows.filter((r) => r.role === DIRECTOR)),
      mid: joinNames(c.rows.filter((r) => r.role === MID)),
      tier: tiers.get(fold(c.name)) ?? tiers.get(c.name.trim().toLowerCase()) ?? '',
    }));
}

/**
 * THE PAYMENT BREAKDOWN, as the boss pivots it: method, then location,
 * then currency.
 *
 * ALWAYS A CURRENCY LINE, even when the group has only one. He asked for
 * the simple shape where a group is single-currency, and it is the same
 * shape: with one currency the currency lines simply all read GBP. Two
 * layouts, one of them only ever reached by a group that does not exist
 * today, is two things to keep in step for no reader's benefit.
 *
 * ENDED DEALS ARE NOT COUNTED, the same rule the total blocks follow. A
 * finished payment period is not money going out this month, so counting
 * it would overstate the run by exactly what nobody is being paid.
 *
 * @returns {{ methods, grand, currencies }} `currencies` is every currency
 *   that appears, so the caller can say how many without walking it again.
 */
/**
 * ===============================
 * * IT TAKES NO RATES. PASS ROWS THAT ALREADY CARRY THEM.
 * ===============================
 * It accepted `rates` and `cryptoPercent` and USED NEITHER, because the
 * rates are read back off `row.rate_parts` that `withRates` put there. Two
 * callers passed them instead of rating the rows, and both were silently
 * short by every add on and every crypto charge: Diane answered 1,000
 * where the sheet beside her said 1,050, and the Division Sheet export
 * shipped the same gap. Removed 2026-09-16, so a third caller cannot
 * repeat it: the wrong call is now an unknown option, not a quiet zero.
 *
 * The per person lines are still built here, off the row's own resolved
 * rates, because the person is aggregated away by the time a caller sees
 * the result.
 */
function paymentBreakdown(rows, { methodLabels = {}, counts = null } = {}) {
  // WHAT COUNTS IS THE CALLER'S RULE, not a second copy of it here. This
  // filtered on the end date directly and so dropped ten MILKMAN rows and
  // 6,500 from August, money his own sheet pays. Callers pass
  // shared/owedThisMonth's countsTowardTotal, so the breakdown reconciles
  // with the total blocks above it by construction.
  const live = counts ? rows.filter(counts) : rows;

  // method -> location -> currency -> { total, addon, crypto, fee }
  const byMethod = new Map();
  const currencies = new Set();

  for (const r of live) {
    const method = methodLabels[r.payment_method] ?? r.payment_method ?? '(no method)';
    const location = String(r.location ?? '').trim() || '(no location)';
    const currency = r.currency || 'GBP';
    const amount = Number(r.payable_amount) || 0;

    currencies.add(currency);
    if (!byMethod.has(method)) byMethod.set(method, new Map());
    const byLocation = byMethod.get(method);
    if (!byLocation.has(location)) byLocation.set(location, new Map());
    const byCurrency = byLocation.get(location);
    /**
     * ===============================
     * * THE RATES ARE ALREADY IN `amount`. NOTHING IS ADDED HERE.
     * ===============================
     * `withRates` runs once at the top of the build, so `payable_amount`
     * arrives with the add on, the crypto charge and the fee inside it,
     * exactly as his own sheet writes them.
     *
     * The parts are still collected, and only so the transparency block can
     * SAY which rows are higher and why. They are not summed into anything:
     * `cell.total` is the whole of it.
     */
    const parts = r.rate_parts?.payable ?? { addon: 0, crypto: 0, fee: 0 };
    const { addon, crypto, fee } = parts;
    const cell = byCurrency.get(currency)
      ?? { total: 0, addon: 0, crypto: 0, fee: 0, byPerson: new Map() };
    cell.total += amount;
    cell.addon += addon;
    cell.crypto += crypto;
    cell.fee += fee;

    // WHO, AND AT WHAT RATE, so a row can say "Gloria - 5% add on" rather
    // than an aggregated "Fee" nobody can attribute. Keyed by person AND
    // rate: the rates stack, so one person can hold two different effective
    // rates in one bucket and each is its own true line.
    // Off the row's own resolved rates, not recomputed. A row with none
    // carries no parts and contributes no named line.
    const { addon: addonPct, crypto: cryptoPct, fee: feePct } = r.rate_parts?.percent
      ?? { addon: 0, crypto: 0, fee: 0 };
    const name = String(r.person_name ?? '').trim() || 'Unnamed';
    for (const [kind, percent, value] of [
      ['addon', addonPct, addon], ['crypto', cryptoPct, crypto], ['fee', feePct, fee],
    ]) {
      if (!(value > 0)) continue;
      const key = `${name}|${kind}|${percent}`;
      const held = cell.byPerson.get(key) ?? { name, kind, percent, value: 0 };
      held.value += value;
      cell.byPerson.set(key, held);
    }
    byCurrency.set(currency, cell);
  }

  const round = (n) => Math.round(n * 100) / 100;

  const methods = [...byMethod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([method, byLocation]) => {
      const locations = [...byLocation.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([location, byCurrency]) => ({
          location,
          lines: [...byCurrency.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([currency, cell]) => ({
              currency,
              total: round(cell.total),
              addon: round(cell.addon),
              crypto: round(cell.crypto),
              fee: round(cell.fee),
              // Add ons before fees, then by name, so two runs of the same
              // month produce the same file.
              adjustments: [...cell.byPerson.values()]
                .map((a) => ({ ...a, value: round(a.value) }))
                .sort((a, b) => (a.kind === b.kind
                  ? a.name.localeCompare(b.name)
                  : (a.kind === 'addon' ? -1 : 1))),
            })),
        }));

      // A method total per currency, never blended. GBP and AED added
      // together is a number that means nothing.
      //
      // IT IS `line.total` AGAIN, and that is the point of the change. The
      // rates moved onto the Monthly amount, so every line already carries
      // them and re-adding the parts here would charge every rate twice.
      // It summed `total + addon + crypto - fee` while the lines were raw.
      const totals = new Map();
      for (const loc of locations) {
        for (const line of loc.lines) {
          totals.set(line.currency, (totals.get(line.currency) ?? 0) + line.total);
        }
      }
      return {
        method,
        locations,
        totals: [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]))
          .map(([currency, total]) => ({ currency, total: round(total) })),
      };
    });

  const grand = new Map();
  for (const m of methods) {
    for (const t of m.totals) grand.set(t.currency, (grand.get(t.currency) ?? 0) + t.total);
  }

  /**
   * THE SAME ROWS READ CURRENCY FIRST, for a group paid in more than one.
   *
   *   AED
   *     Cash                1,000.00
   *     Bank                  500.00
   *     AED Total           1,500.00
   *   GBP
   *     Cash               30,000.00
   *     GBP Total          30,000.00
   *
   * Currency is the outermost fact about a payment run, because two
   * currencies are two runs and no line ever adds across them. With method
   * on the outside, a group in three currencies read as three interleaved
   * documents and the figure anybody actually wants — what this group costs
   * in GBP — was never on a line of its own.
   *
   * Derived from `methods` rather than walked again: `m.totals` is already
   * this group's money per method per currency, so a second pass over the
   * rows would be a second place for the two readings to disagree.
   *
   * Location is not a level here. The single-currency layout keeps it.
   */
  const byCurrency = new Map();
  for (const m of methods) {
    for (const t of m.totals) {
      if (!byCurrency.has(t.currency)) byCurrency.set(t.currency, []);
      byCurrency.get(t.currency).push({ method: m.method, total: t.total });
    }
  }

  return {
    methods,
    byCurrency: [...byCurrency.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, lines]) => ({
        currency,
        methods: lines.sort((a, b) => a.method.localeCompare(b.method)),
        total: round(lines.reduce((sum, l) => sum + l.total, 0)),
      })),
    grand: [...grand.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, total]) => ({ currency, total: round(total) })),
    currencies: [...currencies].sort(),
  };
}

/**
 * Which groups are paid in more than one currency, and in which.
 *
 * Every live group is, today: INDIGO in three, MILKMAN and MANBAT in two.
 * So this is not an edge case to warn about, it is a fact about the file,
 * and the export modal says it before the file is generated rather than
 * leaving somebody to notice it in the totals.
 */
function currenciesByGroup(rows) {
  const byGroup = new Map();
  for (const r of rows) {
    const g = r.group_name || 'UNKNOWN';
    if (!byGroup.has(g)) byGroup.set(g, new Set());
    byGroup.get(g).add(r.currency || 'GBP');
  }
  return [...byGroup.entries()]
    .map(([group, set]) => ({ group, currencies: [...set].sort() }))
    .sort((a, b) => b.currencies.length - a.currencies.length || a.group.localeCompare(b.group));
}

module.exports = {
  activeCompanies, paymentBreakdown, currenciesByGroup, INTERNAL_COMPANY,
};
