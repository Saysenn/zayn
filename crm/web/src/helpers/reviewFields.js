/**
 * Which column a review flag is actually about.
 *
 * `needs_review` is a ROW-level flag with a plain-text `review_reason`
 * written by the importer (parseImport.js's reviewReasonFor). Showing it
 * only on the name cell meant the row said "something here is wrong" and
 * made you hunt across thirty columns for what — and the name, the one
 * cell it was attached to, is never the problem.
 *
 * So the text is mapped back to the columns that produced it, and the
 * marker goes on those. The reason string is the contract between the
 * importer and this file: change a phrase there and change it here.
 */

/**
 * What to tell an admin about a deal that lost one of its two sides.
 *
 * These are not "a value is wrong" like the import flags below. The row is
 * INCOMPLETE, on purpose, because somebody deleted the person or the
 * company and the deal was kept rather than destroyed with them. So the
 * message names the options rather than just the fault: the admin is
 * standing in front of a decision (reassign, replace, or delete the deal),
 * not a typo.
 */
export const ORPHAN_GUIDANCE = {
  person: {
    title: 'This deal has no handler',
    body: 'The person who held it was removed, but the deal was kept because the company, the role and the money are still real. Assign somebody by editing the Name on this row, or delete the row if the work is not happening.',
  },
  company: {
    title: 'This deal has no company',
    body: 'The company was removed, but the deal was kept because the handler is still owed for it. Pick a different company by editing the Company on this row, type a new one, or delete the row if it is not happening.',
  },
};

/**
 * Which of the two (or both) a row is missing, ready to render.
 * Empty when the row is whole.
 */
export function orphanNotices(row) {
  const out = [];
  if (row?.orphaned_person) out.push(ORPHAN_GUIDANCE.person);
  if (row?.orphaned_company) out.push(ORPHAN_GUIDANCE.company);
  return out;
}

const RULES = [
  // The two deletion cases, mapped to the column that is now empty, so the
  // marker sits on the blank cell the admin has to fill rather than on the
  // row's name. Same rule the import flags follow.
  {
    match: /the handler was removed/i,
    column: 'person_name',
    detail: ORPHAN_GUIDANCE.person.body,
  },
  {
    match: /the company was removed/i,
    column: 'company',
    detail: ORPHAN_GUIDANCE.company.body,
  },
  {
    match: /no group/i,
    column: 'group_name',
    detail: 'The sheet had no group on this row. It was filed under UNKNOWN.',
  },
  {
    match: /no company/i,
    column: 'company',
    detail: 'The sheet had no company on this row.',
  },
  {
    match: /payment method not recognised/i,
    column: 'payment_method',
    detail:
      "The sheet's payment method wasn't one this system knows (cash, bank or crypto), so it defaulted to cash. Check what it should be before anyone is paid.",
  },
  {
    // Carries the offending text, e.g. payment start reads "AUGUST END
    // FULL", not a date — so the message is built from the match rather
    // than written out here.
    match: /payment start reads "([^"]*)", not a date/i,
    column: 'payment_start_on',
    detail: (m) =>
      `The sheet wrote "${m[1]}" where a date belongs, so the payable amount could not be worked out. The text is kept in Notes.`,
    also: ['payable_amount', 'payable_days'],
  },
  {
    // THE SAME WORDS, BUT THE APPOINTMENT RESCUED THEM. A figure exists and
    // it is a READING of his note, not a fact. Six rows of the live sheet.
    //
    // He has not always meant it: MILKMAN's pair were paid appointment + 90
    // in his own August send, INDIGO's were paid a whole month from the
    // 1st, which is 1,612.90 more than this reading gives. So the row is
    // marked rather than passed through silently.
    match: /payment start reads "([^"]*)", read as appointment \+ (\d+) days/i,
    column: 'payment_start_on',
    detail: (m) =>
      `The sheet wrote "${m[1]}" here instead of a date. It has been read as the column's own formula, appointment date + ${m[2]} days, and the payable amount follows from that. He has not always meant that, so check this row against what was actually paid. The text is kept in Notes.`,
    also: ['payable_amount', 'payable_days'],
  },
  {
    match: /cannot work out the payable amount/i,
    column: 'payable_amount',
    detail:
      'There was not enough on the row to work out what is payable, usually a missing preset date or monthly amount.',
  },
  {
    match: /no currency/i,
    column: 'currency',
    detail: 'The sheet had no currency on this row, so it defaulted to GBP.',
  },
];

/**
 * @param {string} reason  the row's review_reason
 * @returns {Record<string, string>} column name -> why that column is flagged
 */
export function flaggedColumns(reason) {
  const text = String(reason ?? '');
  if (!text.trim()) return {};

  const out = {};
  for (const rule of RULES) {
    const m = text.match(rule.match);
    if (!m) continue;
    const detail = typeof rule.detail === 'function' ? rule.detail(m) : rule.detail;
    out[rule.column] = detail;
    // One cause can leave more than one column unusable — an unreadable
    // payment start is why both the days and the amount are empty, and
    // marking only the date would leave those two looking like real zeros.
    for (const extra of rule.also ?? []) out[extra] = detail;
  }

  // A reason the rules don't recognise still has to surface somewhere
  // rather than vanish, so it falls back to the row's identity cell.
  if (Object.keys(out).length === 0) out.person_name = text;

  return out;
}
