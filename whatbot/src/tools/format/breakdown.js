import { logger } from "../../system/logger.js";
import {
  byCompany,
  groupName,
  money,
  NO_COMPANY,
  plural,
  totalsByCurrency,
} from "./money.js";

/**
 * Every word and every number the user reads is built here, in code.
 *
 * Tools hand these back as `display`, which goes straight to WhatsApp without
 * passing through the LLM. That is the whole point — the LLM cannot get a
 * figure wrong if it never gets to type one.
 *
 * It is written to read like a person, not a report. The model used to write
 * the sentence and code appended a table underneath, which is why replies came
 * out stiff — and why the sentence kept being deleted for containing figures.
 * Since code writes both now, the figure can simply sit in the sentence, which
 * is where anybody would put it.
 */

/**
 * Is every row paid the same way?
 *
 * "paid in cash" on every line is the same three words down the whole message.
 * Said once at the bottom it disappears, which is what you want from something
 * that is only interesting when it differs.
 */
const oneMethod = (rows) => {
  const methods = new Set(rows.map((a) => a.paymentMethod));
  return methods.size === 1 ? [...methods][0] : null;
};

/** "£1,300", or "nothing this month (0 days)". The method only when it varies. */
function amountOf(a, showMethod) {
  if (a.payableDays === 0) return "nothing this month (0 days)";

  const amount = money(a.payableAmount, a.currency);
  return showMethod ? `${amount}, ${a.paymentMethod}` : amount;
}

/**
 * One assignment, one line.
 *
 * The role only appears when the company carries more than one, because that
 * is the only time it tells you anything. Somebody on a single role per company
 * does not need "Mid 1" written four times.
 *
 * The part-month working goes underneath, indented. It is the first thing
 * anybody queries, so it stays, but it is not what they are scanning for.
 */
export function assignmentLine(a, opts = {}) {
  const head = [opts.company, opts.showRole ? a.roleLabel : null]
    .filter(Boolean)
    .join(" \u{00B7} ");

  const line = head
    ? `${head} \u{00B7} ${amountOf(a, opts.showMethod ?? false)}`
    : amountOf(a, opts.showMethod ?? false);

  // show the working on a part month, on its own line so it does not crowd
  if (a.payableDays > 0 && a.payableDays < 31 && a.monthlyAmount > 0) {
    return `${line}\n   ${a.payableDays} of 31 days, ${money(a.monthlyAmount, a.currency)} full month`;
  }
  return line;
}

/** one company and everything the caller holds on it */
export const companyBlock = (company, rows) =>
  rows
    .map((a) => assignmentLine(a, { company, showRole: rows.length > 1 }))
    .join("\n");

/**
 * The whole reply: one line per company, and what it pays.
 *
 * That is the entire question — "what do I earn from each company I handle" —
 * and it had grown a footnote for idle siblings and a closing list of the
 * companies paying nothing. Both were accurate and both made a reader work.
 *
 * Where somebody holds two assignments on one company, the company's lines are
 * ADDED, not dropped. No payment disappears, which is the thing that matters;
 * it simply is not split out unless they ask.
 */
/**
 * Do the parts add up to the whole, and is every row accounted for?
 *
 * The opening figure is summed from `rows`; the lines underneath are summed
 * per company. Those come from the same data, so they can only disagree if
 * grouping loses or duplicates a row — which is exactly the bug nobody would
 * ever spot, because both halves would look perfectly reasonable.
 *
 * Checked per currency, because £ and AED are never added.
 */
function addsUp(rows, companies) {
  const grouped = [...companies.values()].flat();
  if (grouped.length !== rows.length) return false;

  const sum = (xs) => {
    const out = new Map();
    for (const a of xs)
      out.set(a.currency, (out.get(a.currency) ?? 0) + a.payableAmount);
    return out;
  };
  const before = sum(rows);
  const after = sum(grouped);
  if (before.size !== after.size) return false;

  for (const [currency, amount] of before) {
    // a penny of floating point drift is fine, anything more is a lost row
    if (Math.abs((after.get(currency) ?? 0) - amount) > 0.005) return false;
  }
  return true;
}

/**
 * What we say instead of a figure we cannot stand behind.
 *
 * Refusing is the right answer here. A payroll number that is quietly wrong is
 * worse than no number, because nobody checks a number that looks fine.
 */
const CANNOT_VERIFY =
  "\u{26A0}\u{FE0F} Something isn't adding up in your figures, so I'd rather not give you a number I can't stand behind. I've flagged it for payroll to look at.";

export function breakdownByCompany(rows, opts = {}) {
  if (rows.length === 0) return "\u{1F937} You've nothing on file here.";

  const companies = byCompany(rows);

  if (!addsUp(rows, companies)) {
    logger.error(
      { rows: rows.length, grouped: [...companies.values()].flat().length },
      "BREAKDOWN DOES NOT RECONCILE — refusing to show figures",
    );
    return CANNOT_VERIFY;
  }

  const total = totalsByCurrency(rows);
  const across = opts.group
    ? ` across your ${groupName(opts.group)} companies`
    : "";

  const [onlyCompany] = companies.size === 1 ? [...companies.keys()] : [];
  const nothingPays = rows.every((a) => a.payableAmount === 0);

  // the ALL BOOKS and TAKEOFF rows pay against the group and carry no company.
  // "Not tied to a company pays you £1,750" reads as a company called that
  const namedCompany =
    onlyCompany && onlyCompany !== NO_COMPANY ? onlyCompany : null;

  const opening = nothingPays
    ? `\u{1F937} Nothing is payable to you this month${across}.`
    : namedCompany
      ? `\u{1F4B7} ${namedCompany} pays you *${total}* this month.`
      : onlyCompany === NO_COMPANY
        ? `\u{1F4B7} *${total}* this month, not tied to a company.`
        : `\u{1F4B7} *${total}* this month${across}.`;

  const method = oneMethod(rows.filter((a) => a.payableAmount > 0));

  /**
   * When the opening already names the company AND the figure, the body has to
   * add something or say nothing.
   *
   * One assignment: nothing to add, so no body at all — it was printing
   * "£2,600" under "Oaiss Umbrella pays you £2,600 this month".
   * Two or more: split it by role, which is the only new information there is.
   */
  const single = companies.size === 1 && rows.length === 1;
  const splitByRole = Boolean(namedCompany) && rows.length > 1;

  const lines = [...companies].flatMap(([company, rs]) => {
    if (splitByRole) {
      return rs.map(
        (a) =>
          `${a.roleLabel} \u{00B7} ${a.payableAmount === 0 ? "nothing this month" : money(a.payableAmount, a.currency)}`,
      );
    }
    const paid = rs.reduce((sum, a) => sum + a.payableAmount, 0);
    const amount = paid === 0 ? "nothing this month" : totalsByCurrency(rs);
    const line = single
      ? ""
      : onlyCompany
        ? amount
        : `${company} \u{00B7} ${amount}`;

    // the working, only where there is one assignment and it is a part month.
    // two assignments on one company have two different day counts, and a
    // single line cannot honestly describe both
    const [only] = rs.length === 1 ? rs : [];
    if (
      only &&
      only.payableDays > 0 &&
      only.payableDays < 31 &&
      only.monthlyAmount > 0
    ) {
      const working = `${only.payableDays} of 31 days, ${money(only.monthlyAmount, only.currency)} full month`;
      return [line ? `${line}\n   ${working}` : working];
    }
    return [line];
  });

  const footer =
    method && rows.filter((a) => a.payableAmount > 0).length > 1
      ? [`All paid in ${method}.`]
      : [];

  const body = lines.filter(Boolean).join("\n");

  return [
    opening,
    ...(body ? ["", body] : []),
    ...(footer.length > 0 ? ["", ...footer] : []),
  ].join("\n");
}

/** one line for the model — no names, no amounts, ever */
export function breakdownSummary(rows) {
  const companies = new Set(rows.map((a) => a.company).filter(Boolean)).size;
  return `${plural(rows.length, "assignment")} across ${plural(companies, "company", "companies")}`;
}
