/**
 * WHICH MONTH A DEAL IS FOR, and whether that is the month being paid.
 *
 * The preset date is the boss's own period marker: "this row is for August".
 * It is his to set and nothing in the CRM rewrites it — not the upload, not
 * the export. It comes in as the sheet writes it, it goes out as he left it,
 * and he changes it on the Master Sheet page like any other cell.
 *
 * WHAT THAT MEANS FOR A TOTAL. A payout file is the document money goes out
 * from, so its total answers one question: what does THIS month cost. A row
 * marked for September is a real, correct row that is not part of August's
 * run, so it belongs on the sheet and not in the figure — the same treatment
 * an ended period and a "should be paid: no" already get.
 *
 * BEFORE THIS, the export stamped the run's month onto every row on the way
 * out, so the question could never be asked: every row was always for the
 * month you generated. That is what made Anteep's September 2024 preset
 * invisible on the way out while it silently zeroed the row on the way in.
 *
 * A ROW WITH NO PRESET IS ALWAYS COUNTED. Twelve rows of the live sheet read
 * "NA": the standing internal roster, no pro-rata, owed every month. Absent
 * is not the same as a different month.
 */

/** A stored date column, a Date or a 'YYYY-MM-DD' string -> 'YYYY-MM'. */
function monthOf(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 7);
  }
  const text = String(value);
  // A plain date string first: slicing is exact and has no zone to get
  // wrong. `new Date('2026-08-01')` would be UTC midnight and then get
  // rendered in the server's zone, which is how a date lands a month early
  // on a host behind UTC.
  const iso = text.match(/^(\d{4}-\d{2})-\d{2}/);
  if (iso) return iso[1];
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
}

/**
 * ===============================
 * * THE MONTH IS THE BUSINESS'S, NOT THE SERVER'S
 * ===============================
 *
 * It was `toISOString()`, which is UTC. The admin is on Pacific time, so
 * for the last seven hours of every month the CRM was already in the next
 * one: on 31 August at 5pm their time, every total, every colour and every
 * export said September. Silently, and only ever near a boundary, which is
 * the hardest kind of wrong figure to notice.
 *
 * `TIMEZONE` in the environment, because a host in one region and a
 * business in another is the normal case. Unset, it falls back to the
 * host's own zone rather than to a name written into the code.
 */
const UTC = 'UTC';

/**
 * READ AT CALL TIME, not at import. This helper has no dependencies on
 * purpose, so it can be pulled in before dotenv has run; a zone captured at
 * import would then be the host's and no test would show it.
 *
 * VALIDATED, because an unknown name throws inside `Intl` and a typo in
 * `.env` would take down every figure in the CRM rather than being one
 * wrong setting. It is also interpolated into `SET TIME ZONE` for the
 * database session, so it must be a name and not a fragment.
 */
const formatters = new Map();

function formatterFor(tz) {
  if (formatters.has(tz)) return formatters.get(tz);
  try {
    // en-CA gives YYYY-MM, so there is no order to reassemble.
    formatters.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }));
  } catch {
    formatters.set(tz, null);
  }
  return formatters.get(tz);
}

// The same zone, to the day. Separate map so the month formatter above is
// untouched and neither has to slice the other's output.
const dayFormatters = new Map();

function dayFormatterFor(tz) {
  if (dayFormatters.has(tz)) return dayFormatters.get(tz);
  try {
    dayFormatters.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }));
  } catch {
    dayFormatters.set(tz, null);
  }
  return dayFormatters.get(tz);
}

/** The zone the BUSINESS is in. One definition, read by the db pool too. */
function businessTimezone() {
  const wanted = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || UTC;
  return formatterFor(wanted) ? wanted : UTC;
}

const monthFormat = () => formatterFor(businessTimezone()) ?? formatterFor(UTC);

/** The calendar month we are in now, where the business is, as 'YYYY-MM'. */
function currentMonth(now = new Date()) {
  return monthFormat().format(now).slice(0, 7);
}

/**
 * Today, where the business is, as 'YYYY-MM-DD'.
 *
 * SAME REASON AS currentMonth. A stop dated from `new Date()` on a UTC host
 * is yesterday's date for seven hours a day, and `stopped_on` decides
 * whether this month is paid.
 */
function currentDay(now = new Date()) {
  return (dayFormatterFor(businessTimezone()) ?? dayFormatterFor(UTC)).format(now);
}

/**
 * The last day of a 'YYYY-MM'. Day 0 of the next month is the previous
 * month's last, so the length of February is never written down.
 */
function lastDayOf(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * @param {object} row a tb_mastersheet row
 * @param {string} [month] 'YYYY-MM' the run is for. Defaults to now.
 * @returns {boolean} whether this row's money belongs in that month's total.
 */
function isForMonth(row, month = currentMonth()) {
  const preset = monthOf(row?.preset_on);
  // No preset: the standing roster, owed every month.
  if (preset === null) return true;
  return preset === month;
}

module.exports = {
  monthOf, currentMonth, currentDay, lastDayOf, isForMonth, businessTimezone,
};
