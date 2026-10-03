import { byCompany, groupName } from "./money.js";

/**
 * When each assignment started and when it ends.
 *
 * Written here in code for the same reason the figures are: a date the model
 * retypes is a date the model can get wrong, and a wrong end date is the kind
 * of thing somebody plans around.
 *
 * Every line says what the SHEET holds, including when it holds nothing. "No
 * end date recorded" is a real answer and a useful one. Quietly leaving the
 * field out reads as "it runs forever", which we do not know.
 */

/** "1 July 2026", or null where the sheet leaves it blank */
export function humanDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** does this row carry any date at all? */
const hasAnyDate = (a) => Boolean(a.assignedOn || a.paymentStartOn || a.endOn);

/**
 * "appointed 1 March 2026, paying from 1 April 2026, ends 31 March 2027"
 *
 * The appointed date only appears when it differs from the payment start. On
 * most rows they are the same day and saying it twice reads like a form.
 */
function datesOf(a, sayNoEnd) {
  const appointed = humanDate(a.assignedOn);
  const from = humanDate(a.paymentStartOn) ?? appointed;
  const ends = humanDate(a.endOn);

  const parts = [];
  if (appointed && from && appointed !== from)
    parts.push(`appointed ${appointed}`);
  parts.push(from ? `paying from ${from}` : "no start date recorded");
  // when NOTHING has an end date, that gets said once at the top instead of
  // once per line. three identical "no end date recorded" clauses buried the
  // one fact the person actually asked about
  if (ends) parts.push(`ends ${ends}`);
  else if (sayNoEnd) parts.push("no end date recorded");
  return parts.join(", ");
}

/**
 * "Mid 1 (31 days), paying from 4 June 2025, no end date recorded"
 *
 * The days are in here to keep two real assignments apart. One person holds
 * the same role on the same company twice, with different payable days, and
 * with no amounts on this view those two lines came out word for word
 * identical — which reads as the same row printed twice, not as two payments.
 * Deduping them would delete somebody's wages, so they get told apart instead.
 */
const dateLine = (a, sayNoEnd) => {
  /**
   * Days only where days actually drive the figure.
   *
   * Nearly half the sheet is flat payments: no monthly rate, no day count, an
   * amount typed straight in. Printing "(0 days)" against those says something
   * untrue about a row that is being paid perfectly normally.
   */
  const driven = a.monthlyAmount > 0;
  const days = driven
    ? ` (${a.payableDays} ${a.payableDays === 1 ? "day" : "days"})`
    : "";
  return `${a.roleLabel}${days}, ${datesOf(a, sayNoEnd)}`;
};

/**
 * The whole reply.
 *
 * Ends on a note that an end date is what the sheet says today, not a promise.
 * People read a date as settled unless you tell them otherwise, and these get
 * amended.
 */
export function datesByCompany(rows, opts = {}) {
  if (rows.length === 0) return "\u{1F937} You've nothing on file here.";

  const where = opts.group ? ` ${groupName(opts.group)}` : "";

  if (!rows.some(hasAnyDate)) {
    return `\u{1F4C5} I've no dates recorded for the companies you handle${where ? ` in${where}` : ""}, sorry. All the sheet gives me is the role, the days and the amount.`;
  }

  const companies = byCompany(rows);

  /**
   * Nothing on the sheet has an end date.
   *
   * That is the answer to "how long have I got left", and it was being buried:
   * three blocks of start dates with "no end date recorded" tacked onto every
   * line. Say it once, first, then show what there is.
   */
  const anyEnd = rows.some((a) => a.endOn);

  /**
   * "Assignments" is our word, not theirs.
   *
   * Everywhere else a person is told about the COMPANIES they handle, and the
   * total used to say "4 assignments" about the same three companies, because
   * one of them is held twice. One vocabulary, and it is theirs.
   */
  const one = companies.size === 1;
  const where_ = where ? ` in${where}` : "";
  const opening = anyEnd
    ? `\u{1F4C5} Here are the dates for ${one ? "the company" : "the companies"} you handle${where_}.`
    : one
      ? `\u{1F4C5} There's no end date on file${where_}, so I can't tell you how long it runs. Here's what I do have:`
      : `\u{1F4C5} There's no end date on any of the companies you handle${where_}, so I can't tell you how long they run. Here's what I do have:`;

  const blocks = [...companies].map(([company, rs]) =>
    [`*${company}*`, ...rs.map((a) => `  ${dateLine(a, anyEnd)}`)].join("\n"),
  );

  const note = anyEnd
    ? "End dates are what the sheet says today. If an arrangement gets extended or cut short, that date moves with it."
    : null;

  return [opening, "", blocks.join("\n\n"), ...(note ? ["", note] : [])].join(
    "\n",
  );
}

/** one line for the model — no dates, no names, ever */
export function datesSummary(rows) {
  const withDates = rows.filter(hasAnyDate).length;
  return `${rows.length} assignment(s), ${withDates} with dates recorded`;
}
