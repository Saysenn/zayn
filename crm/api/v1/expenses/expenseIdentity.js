// ***************************************************
// * What makes two expense rows LOOK like the same one
// ***************************************************
//
// A CANDIDATE, NEVER A VERDICT. Two identical taxi fares on the same day
// are two real expenses, so this never merges anything: the import shows
// both rows on a tab and a human answers. See docs/expense.md.
//
// `fold` is the master sheet's own, not a copy: one comparison rule per
// codebase or the two drift.

const { fold } = require('../masterSheet/dealKey');

// The five fields that make one spend recognisable as another.
const PARTS = ['spentOn', 'payee', 'rawAmount', 'currency', 'description'];

/** A date, a Date or nothing, as `YYYY-MM-DD`. */
function dayOf(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

function expenseKey(expense = {}) {
  const raw = {
    ...expense,
    spentOn: dayOf(expense.spentOn ?? expense.spent_on),
    payee: expense.payee,
    rawAmount: expense.rawAmount ?? expense.raw_amount,
    currency: expense.currency,
    description: expense.description,
  };
  return PARTS.map((p) => fold(raw[p])).join('|');
}

module.exports = { expenseKey, PARTS };
