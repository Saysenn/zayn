import {
  groupName,
  list,
  money,
  nothingOwedCount,
  plural,
  totalsByCurrency,
} from "./money.js";

const value = (a, m) => (m === "payable" ? a.payableAmount : a.monthlyAmount);

/**
 * Totals and averages, worked out PER CURRENCY.
 *
 * An average across £ and AED is a meaningless number — and it would look
 * completely reasonable printed on a payroll summary. That is the worst kind of
 * wrong: nobody would ever catch it.
 */
export function statsBlock(rows, aggregate, measure, label) {
  if (rows.length === 0) return "Nothing matched that.";

  if (aggregate === "count")
    return `*${plural(rows.length, "assignment")}* ${label}`;

  const byCurrency = new Map();
  for (const a of rows) {
    byCurrency.set(a.currency, [
      ...(byCurrency.get(a.currency) ?? []),
      value(a, measure),
    ]);
  }

  const lines = [...byCurrency]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, values]) => {
      const n = values.length;
      const sum = values.reduce((x, y) => x + y, 0);
      const amount = {
        sum,
        average: sum / n,
        min: Math.min(...values),
        max: Math.max(...values),
      }[aggregate];

      return `${money(amount, currency)} (${plural(n, "assignment")})`;
    });

  return [`*${label}*`, ...lines].join("\n");
}

/**
 * Just the total, said the way a person would say it.
 *
 * Asked "what's my total", listing every company underneath buries the one
 * number they wanted. Per currency, because adding £ to AED gives a figure that
 * means nothing and looks perfectly reasonable on a payroll summary.
 */
export function totalLine(rows, group) {
  // the counting version: this reply lists nothing, so "3 of them" points at
  // a list that was never printed
  const note = nothingOwedCount(rows);
  const opening = `\u{1F4B7} You're owed *${totalsByCurrency(rows)}* from ${groupName(group)} this month.`;
  return note ? `${opening}\n\n${note}` : opening;
}

/**
 * How many, and which — in one sentence.
 *
 * Naming them costs nothing and answers the question they were about to ask
 * next. Safe to name here: this is code, not the model.
 */
export function countLine(rows, group) {
  const companies = [
    ...new Set(rows.map((a) => a.company).filter((c) => c !== null)),
  ].sort();

  if (companies.length === 0) {
    return `\u{1F9FE} You've ${plural(rows.length, "payment")} in ${groupName(group)}, none tied to a company.`;
  }
  return `\u{1F3E2} You're on *${plural(companies.length, "company", "companies")}* in ${groupName(group)}: ${list(companies)}.`;
}
