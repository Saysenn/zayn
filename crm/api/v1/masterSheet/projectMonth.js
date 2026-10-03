const { payableDaysFor, payableAmountFor } = require('../calculator/computePayable');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function dateOf(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthDate(month) {
  if (!MONTH.test(String(month))) throw new Error(`Not a month: ${month}`);
  return new Date(`${month}-01T00:00:00.000Z`);
}

function projectDeal(row, month) {
  const target = monthDate(month);

  if (!row.preset_on) {
    return {
      ...row,
      payable_amount: payableAmountFor({
        monthlyAmount: row.monthly_amount,
        paymentStartOn: dateOf(row.payment_start_on),
        presetOn: null,
      }),
    };
  }

  const paymentStartOn = dateOf(row.payment_start_on);
  // The appointment travels: a first week deal is owed the whole of its
  // month 3, and a projection over that month must say so too.
  const appointmentOn = dateOf(row.assigned_on);
  return {
    ...row,
    preset_on: `${month}-01`,
    payable_days: payableDaysFor(paymentStartOn, target, { appointmentOn }),
    payable_amount: payableAmountFor({
      monthlyAmount: row.monthly_amount,
      paymentStartOn,
      presetOn: target,
      appointmentOn,
    }),
  };
}

function projectMonth(rows, month) {
  monthDate(month);
  return rows.map((row) => projectDeal(row, month));
}

module.exports = { projectMonth, projectDeal, monthDate };
