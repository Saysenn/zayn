// ***************************************************
// * One way to write an amount
// ***************************************************
//
// It was written four times: twice identically on the two detail pages,
// once differently on the master sheet, and once inline in Settings. The
// two shapes disagreed, so the same 1,000 read as "£1,000.00" on one page
// and "1,000.00 GBP" on another.

/** Every amount that has no value. One em dash, the CRM's own placeholder. */
export const NO_VALUE = '—';

// ===============================
// * `$`, NOT `US$`
// ===============================
// en-GB disambiguates the dollar by default, so every figure on a
// USD dashboard carried two redundant letters. narrowSymbol drops them and
// changes nothing for GBP, EUR or AED, which have no ambiguity to resolve.
const SYMBOL = { currencyDisplay: 'narrowSymbol' };

/**
 * `£1,000.00`, or `1,000.00 XYZ` when the code is not one Intl knows.
 *
 * The catch is not defensive padding: the sheet carries `EURO`, which is
 * not an ISO code, and Intl throws on it rather than returning anything.
 */
export function formatMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return NO_VALUE;
  const n = Number(amount);
  if (!Number.isFinite(n)) return NO_VALUE;

  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP', ...SYMBOL }).format(n);
  } catch {
    // ===============================
    // * THE CODE LEADS, THE WAY EVERY SYMBOL DOES
    // ===============================
    // The sheet's own `EURO` is not an ISO code, so Intl throws and lands
    // here. Trailing, it came out "3,510.00 EURO" stacked under
    // "AED 54,342.50" and "£80,850.00": one line in three reading backwards.
    return `${currency ?? ''} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
  }
}

/**
 * ===============================
 * * NOTHING IS ABBREVIATED
 * ===============================
 * `US$24,600`, for an axis tick or a label above a bar. This replaced a
 * compact `US$24.6K`: the user reads these figures against the sheet, and
 * a rounded magnitude is not a figure you can check. The only thing this
 * drops is the pence, and only where a label has no room for them.
 */
export function formatMoneyWhole(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return NO_VALUE;
  const n = Number(amount);
  if (!Number.isFinite(n)) return NO_VALUE;

  const options = { maximumFractionDigits: 0 };
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP', ...SYMBOL, ...options }).format(n);
  } catch {
    return `${currency ?? ''} ${n.toLocaleString('en-GB', options)}`.trim();
  }
}

/**
 * ===============================
 * * `GBP 80,850.00`, FOR A STACK
 * ===============================
 * Intl gives GBP a symbol and AED a code, so three currencies one under the
 * other came out "AED 54,342.50 / EURO 3,510.00 / £80,850.00": two lines
 * naming their currency and one not, which reads as three different kinds
 * of thing. Where currencies are STACKED they all name themselves the same
 * way. A single amount keeps its symbol, which is what `formatMoney` is for.
 */
export function formatMoneyCode(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return NO_VALUE;
  const n = Number(amount);
  if (!Number.isFinite(n)) return NO_VALUE;
  return `${currency ?? ''} ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

/** A plain figure, no symbol. For a rate, a percentage or a bare total. */
export function formatNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NO_VALUE;
  return n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * `{ GBP: 1000, AED: 500 }` as one line.
 *
 * A person or a company is paid in more than one currency and the two are
 * never added: that is the same rule the export's totals follow.
 */
export function formatTotals(map) {
  const entries = Object.entries(map || {});
  if (entries.length === 0) return NO_VALUE;
  return entries.map(([currency, amount]) => formatMoney(amount, currency)).join('  ·  ');
}

/**
 * ===============================
 * * THE SAME MAP, AS A LIST, WHOLE, AND IN A STABLE ORDER
 * ===============================
 * The People and Companies pages each had their own copy of this, identical
 * and both dropping the pence, so `formatTotals` above was a third spelling
 * of one idea. A list rather than a string, because a card shows the first
 * and puts the rest behind an icon while a table prints them all.
 *
 * SORTED BY CODE. The map's own order is whatever Postgres aggregated it
 * in, so an unsorted list could put a different currency at the front of
 * the same card between two loads.
 */
export function totalsList(map) {
  return Object.entries(map || {})
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([currency, amount]) => ({ currency, text: formatMoneyWhole(amount, currency) }));
}

/** Every currency on one line, for a column with room for them. */
export function formatTotalsWhole(map) {
  const list = totalsList(map);
  return list.length === 0 ? NO_VALUE : list.map((entry) => entry.text).join(' · ');
}

/**
 * A set of deals as the same `{ GBP: 1234 }` map the server sends, so a
 * partial selection prints through `formatTotals` exactly like a whole
 * company does. Two doors were about to sum this by hand.
 *
 * PER CURRENCY, never one number. One company can hold GBP and EUR deals,
 * and adding them is the bug this shape exists to prevent.
 */
export function totalsOf(deals) {
  const map = {};
  for (const deal of deals ?? []) {
    const currency = deal.currency ?? 'GBP';
    map[currency] = (map[currency] ?? 0) + Number(deal.monthly_amount ?? 0);
  }
  return map;
}
