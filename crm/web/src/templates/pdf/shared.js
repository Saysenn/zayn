/**
 * The formatting every PDF template needs, in one place.
 *
 * Moved out of ExportPrintPage when the second template arrived: a summary
 * that rounded money differently from the breakdown would have two totals
 * for one payout, and the reader would have no way to tell which was
 * right.
 */

export function money(amount, currency) {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(amount);
  } catch {
    // The sheet's own currency spellings are not always ISO codes.
    return `${Number(amount).toLocaleString('en-GB')} ${currency ?? ''}`.trim();
  }
}

/**
 * The figure alone, no symbol and no code.
 *
 * For a total block that already names its currency in its own column.
 * `money` there would print it twice: "GBP  £29,048.39", and worse,
 * "EURO  1,000 EURO".
 */
export function amount(value) {
  return Number(value ?? 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// One value when every deal agrees, a joined list when they don't. A
// person's bank details legitimately differ between their deals, and
// picking the first would be a quiet lie on a document somebody pays from.
/** The word for nothing held. Not a dash: the house style has no dashes. */
export const NOT_HELD = 'not held';

export function distinct(rows, key) {
  const set = [...new Set(rows.map((r) => String(r[key] ?? '').trim()).filter(Boolean))];
  return set.length === 0 ? NOT_HELD : set.join(' · ');
}

// UTC throughout. A date column read in a negative-offset zone rolls back
// to the previous month and silently changes the denominator.
export function daysInPresetMonth(presetOn) {
  if (!presetOn) return '—';
  const d = new Date(presetOn);
  if (Number.isNaN(d.getTime())) return '—';
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export const METHOD_LABELS = { bank: 'Bank Transfer', cash: 'Cash', crypto: 'Crypto' };

/**
 * A date as "07 Jul 2026". UTC, so a date column read in a negative-offset
 * zone does not print the day before.
 */
export function shortDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * The date, or dates, a person's deals finished.
 *
 * Named rather than just flagged: "period ended" makes the reader hunt for
 * when, and on a payment sheet the when is the whole question. Several
 * dates on one person is unusual but real — their companies can end on
 * different days — so all of them are listed.
 */
export function endedOn(deals) {
  const dates = [...new Set(
    deals.filter((d) => d.period_ended && d.end_on).map((d) => shortDate(d.end_on)).filter(Boolean),
  )];
  return dates.length === 0 ? 'date unknown' : dates.join(', ');
}

/**
 * Totals per currency, NEVER blended. The roster is paid in GBP, AED and
 * EURO; one added-up number across the three means nothing.
 *
 * `skipEnded` leaves out deals whose payment period has finished, which is
 * what a month's sheet needs: it is generated to pay from, and a finished
 * arrangement is not money owed. Off by default, because the earnings
 * breakdown answers "what have I earned" and there the ended months still
 * count.
 */
export function totalsByCurrency(rows, { skipEnded = false } = {}) {
  const totals = new Map();
  for (const r of rows) {
    if (skipEnded && r.period_ended) continue;
    const c = r.currency || 'GBP';
    totals.set(c, (totals.get(c) ?? 0) + Number(r.payable_amount || 0));
  }
  // Rounded once at the end, so a column of subtotals adds up to the total
  // printed under it rather than drifting a penny.
  return [...totals.entries()].map(([c, v]) => [c, Math.round(v * 100) / 100]);
}
