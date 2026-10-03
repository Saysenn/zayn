/**
 * ***************************************************
 * * Every date on screen, in one place.
 * ***************************************************
 *
 * "September 30, 2026". The long month is deliberate: 30/09 and 09/30 are
 * the same eight characters and mean different days, and this is read by
 * people paying other people.
 *
 * IN UTC, ALWAYS. A `date` column has no time and no zone, so rendering it
 * in the reader's zone prints the day before for anybody behind UTC: an
 * appointment of 11 Mar showed as 10 Mar, an end date of 30 Sept as 29
 * Sept, and every other date on the page with them.
 *
 * Matches DATE_FMT in api/v1/shared/sheetFormats.js, so a date reads the
 * same on the page and in the exported file.
 */
const OPTIONS = {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
};

/**
 * @param {string|Date|null} value
 * @returns {string} the em dash for empty, and the ORIGINAL TEXT for
 *   anything unparseable: the sheet's own end date column is frequently
 *   the literal word "Ongoing", and printing that as "Invalid Date" would
 *   be worse than showing what the sheet actually says.
 */
export function formatDate(value) {
  if (!value) return '—';
  // A bare YYYY-MM-DD parses as UTC midnight already; anything else is
  // pinned so a date-only string cannot drift a day.
  const d = value instanceof Date ? value : new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00Z` : value,
  );
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', OPTIONS);
}

/**
 * Today as the API writes a date, `YYYY-MM-DD`.
 *
 * THE BROWSER'S DAY, not the business clock. The server dates its own
 * writes from `TIMEZONE` and the two can differ by a day, so this is for
 * SEEDING A FORM or painting optimistically: the server's answer lands on
 * the refetch and is the one that sticks.
 */
export function today(now = new Date()) {
  // LOCAL parts, not toISOString(), which is the UTC day.
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
