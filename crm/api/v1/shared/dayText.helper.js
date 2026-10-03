/**
 * ***************************************************
 * * A DAY, AS WORDS, WITHOUT LOSING A DAY TO A TIMEZONE
 * ***************************************************
 *
 * THE BUG THIS REPLACES, 2026-09-17. Two tools printed a date with
 * `String(value).slice(0, 10)`. Postgres hands a `date` column back as a
 * Date OBJECT, so that took the first ten characters of
 *
 *     "Wed Dec 31 2025 16:00:00 GMT-0800 (Pacific Standard Time)"
 *
 * and produced "Wed Dec 31". The YEAR was gone and the DAY was wrong: a
 * deal ending 2026-01-01 read as ending 31 December, because the host is
 * behind UTC. Diane read those dates aloud beside money.
 *
 * `toISOString()` IS NOT THE FIX. It converts to UTC, which is the same
 * shift in the other direction, and it is what `fromAppointment.helper`
 * already does for a different purpose.
 *
 * SO NEITHER PATH BUILDS A DATE OUT OF A DATE:
 *   a STRING is read as characters, never parsed
 *   a DATE uses its LOCAL parts, which is where pg put midnight
 */

// ONE LIST, SPELLED OUT. These are read aloud, and a voice says "Jan" as a
// cut syllable rather than as January. His call 2026-09-21.
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * '1 March 2026'. Null for anything that is not a day.
 *
 * NEVER ABBREVIATED. It is read aloud. The day of the WEEK is still left
 * off: that is noise in a list of thirty, the month name is not.
 */
function dayText(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const hit = ISO.exec(value.trim());
    // NOT PARSED. A string that already says the day is read as characters:
    // handing it to `new Date` is what introduces a zone at all.
    if (hit) return `${Number(hit[3])} ${MONTHS[Number(hit[2]) - 1]} ${hit[1]}`;
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // LOCAL parts. node-postgres parses a `date` to local midnight, so the
    // local getters are the ones that agree with what the column says.
    return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
  }

  return null;
}

/** 'September 2026' from 'YYYY-MM'. For a heading, where width is cheap. */
function monthText(period) {
  const [year, month] = String(period ?? '').split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${year}`;
}

module.exports = { dayText, monthText };
