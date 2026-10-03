import { NO_COMPANY, groupName } from "./money.js";

/**
 * The caller's own breakdown, as a CSV they can open in Excel.
 *
 * Same rule as every other file in here: the figures are built in code and the
 * model never sees them. A file is only a different container for the numbers
 * `breakdownByCompany` already writes — so it has to be as scoped and as
 * literal as the message is. The rows handed in are already filtered to one
 * person and one group by `access.readable`; nothing here widens that.
 *
 * Raw numbers, not "£1,300". A formatted amount lands in Excel as text and
 * cannot be summed, which defeats the only reason to want a file.
 */

/**
 * Quote a field for CSV.
 *
 * Everything is quoted rather than only the fields that need it. Company names
 * carry commas and apostrophes, roles carry spaces, and deciding per-field is
 * how you end up with one row that splits into two columns for one customer.
 */
function cell(value) {
  if (value === null) return '""';
  return `"${String(value).replaceAll('"', '""')}"`;
}

const HEADERS = [
  "Company",
  "Role",
  "Payable days",
  "Monthly amount",
  "Payable amount",
  "Currency",
  "Payment method",
  "Start date",
  "End date",
];

/** what one assignment looks like as a row */
function row(a) {
  return [
    cell(a.company ?? NO_COMPANY),
    cell(a.roleLabel),
    cell(a.payableDays),
    cell(a.monthlyAmount),
    cell(a.payableAmount),
    cell(a.currency),
    cell(a.paymentMethod),
    cell(a.paymentStartOn ?? ""),
    cell(a.endOn ?? ""),
  ].join(",");
}

/**
 * One row per assignment, never merged.
 *
 * `breakdownByCompany` adds two assignments on one company together, because
 * a message is read and a reader does not want the same company twice. A file
 * is the opposite: it is opened to check the working, so every payable line
 * stays separate. Merging them here would hide exactly the case the sheet is
 * most often wrong about — the same role on the same company twice with
 * different payable days.
 */
export function breakdownCsv(rows) {
  // \r\n, because Excel on Windows is where this gets opened
  return [HEADERS.join(","), ...rows.map(row)].join("\r\n");
}

/**
 * What the file is called on their phone.
 *
 * The person's name is deliberately NOT in it. The filename shows in the chat
 * list, in notification previews, and on any device the phone backs up to —
 * putting a name there leaks who the file is about to anyone glancing at the
 * screen, and they already know who they are.
 */
export function breakdownFileName(group, period) {
  const slug = groupName(group)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-");
  return `breakdown-${slug}-${period}.csv`;
}
