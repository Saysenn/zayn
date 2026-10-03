const { payableFromDays } = require('../calculator/computePayable');
const { countsTowardTotal } = require('./owedThisMonth.helper');
const { currentMonth } = require('./presetMonth.helper');
const { ratedAmount } = require('./rates.helper');

/** Turn the stored date shape into the Date expected by the calculator. */
function asDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The detail card's current-month payable total, grouped by currency.
 *
 * Recompute from the source values instead of trusting payable_amount. That
 * stored field can be stale after a preset or day edit, while this view needs
 * to answer the same money question as the monthly payout calculation.
 */
function detailMonthlyTotals(rows, { month = currentMonth(), useEndDate = false, cryptoPercent = 0 } = {}) {
  const totals = {};

  for (const row of rows ?? []) {
    if (!countsTowardTotal(row, { month, useEndDate })) continue;
    if (row.monthly_amount == null || row.monthly_amount === '') continue;

    const presetOn = asDate(row.preset_on);
    if (presetOn && (row.payable_days == null || row.payable_days === '')) continue;

    // A PAYABLE SET BY HAND is the figure, as it is in Diane's total and the
    // export: "add 500 to Suki's payable" read 3,000 here. 2026-09-25.
    const handSet = (row.manually_overridden_fields ?? []).includes('payable_amount');
    const amount = handSet
      ? Number(row.payable_amount)
      : payableFromDays({
        monthlyAmount: row.monthly_amount,
        presetOn,
        payableDays: row.payable_days,
      });
    if (!Number.isFinite(amount)) continue;
    // RATED, both levels and the rail, as Diane's total and the sheet are.
    const owed = ratedAmount(amount, row, { cryptoPercent });

    const currency = row.currency || 'GBP';
    totals[currency] = Math.round(((totals[currency] ?? 0) + owed) * 100) / 100;
  }

  return totals;
}

module.exports = { detailMonthlyTotals };
