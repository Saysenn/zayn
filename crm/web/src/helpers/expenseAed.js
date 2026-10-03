// ***************************************************
// * CONTRACT: what an expense comes to in AED
// ***************************************************
//
// A DELIBERATE MIRROR of the generated column in
// api/v1/migrations/055_expenses.sql:
//
//     aed_amount GENERATED ALWAYS AS (round(raw_amount * exchange_rate, 2))
//
// The database's answer is the one that sticks. This half exists only to
// close the gap between typing and the refetch landing: the add form's live
// preview, and the optimistic repaint in useExpenses.
//
// IT OWNS ROUNDING AND NULL, not the multiplication. Two sides multiplying
// an 8dp rate by a 2dp amount in a float disagree at the second decimal,
// and the row visibly corrects itself on refetch, which is the exact lag
// optimistic writes exist to remove.
//
// NULL IN, NULL OUT. A missing rate is not a rate of 1, and a row without
// one shows nothing rather than its raw amount wearing an AED label.

const DECIMALS = 2;

const FACTOR = 10 ** DECIMALS;

function asNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function aedAmount(rawAmount, exchangeRate) {
  const amount = asNumber(rawAmount);
  const rate = asNumber(exchangeRate);
  if (amount === null || rate === null) return null;
  // EPSILON first: 8.185 * 100 is 818.4999999999999 in a float, which
  // rounds down and disagrees with Postgres by a penny.
  return Math.round((amount * rate + Number.EPSILON) * FACTOR) / FACTOR;
}

export default aedAmount;
