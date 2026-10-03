// ***************************************************
// * Did she pick that year, or did they?
// ***************************************************
//
// A bare month has no year in it, so somebody has to supply one, and the
// model is the one party that must not guess. Asked to "update all the
// presets to September" she wrote 2024-09-01 on 96 rows and the sheet owed
// NOTHING, silently. Asked to "combine two people for september" she
// answered "owed nothing for September 2024, marked for another month":
// every word true, and the question was about money.
//
// ONE DEFINITION, in shared/, because every tool that takes a month needs
// it and the first copy to drift would be the one deciding a figure. It
// lived in masterSheet.js and exportSheet.js had to import it from there,
// which made a require cycle: a cycle means this function can be
// `undefined` at call time depending on load order, and an undefined guard
// is no guard.
//
// FORECASTING NEEDS THIS MOST. "What did we pay in March" over twelve
// stored months is exactly where a guessed year stops being checkable.

const { currentMonth } = require('./presetMonth.helper');

// How far from the business month is still an ordinary ask. Last month and
// next quarter are normal; a year away is a different question.
const MONTHS_EITHER_SIDE = 13;

/** Whole months between 'YYYY-MM[-DD]' and the business month, signed. */
function monthsFromNow(iso, now = currentMonth()) {
  const [y, m] = String(iso).split('-').map(Number);
  const [ny, nm] = String(now).split('-').map(Number);
  if (!y || !m || !ny || !nm) return 0;
  return (y - ny) * 12 + (m - nm);
}

/**
 * @param iso  'YYYY-MM' or 'YYYY-MM-DD'
 * @param said the admin's OWN words this turn, injected by runAgent and
 *   never written by the model. That is the whole point: she cannot satisfy
 *   this by putting the year in her own arguments.
 * @returns {boolean} true when the month is far off AND they never said
 *   that year, which together mean she chose it.
 */
function farOffMonth(iso, said, now = currentMonth()) {
  if (!iso) return false;
  if (Math.abs(monthsFromNow(iso, now)) <= MONTHS_EITHER_SIDE) return false;
  return !String(said ?? '').includes(String(iso).slice(0, 4));
}

// ===============================
// * A BARE MONTH HAS A RIGHT ANSWER, so repair it rather than drop it
// ===============================
//
// Dropping was half a fix. Asked "nicola total for august" she passed
// 2024-08, the guard dropped it, and the reply answered SEPTEMBER and then
// asked "did you mean August 2024?". The admin said August and got another
// month plus a question about a year nobody had mentioned.
//
// A month word with no year means the NEAREST one, and on a total that is
// almost always the one just gone. So: same month name, closest to the
// business month, ties going to the PAST.
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function shiftedMonth(now, amount) {
  const [year, month] = String(now).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function namedMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function nearestNamedMonth(month, now) {
  const [year, current] = String(now).split('-').map(Number);
  const choices = [year - 1, year, year + 1]
    .map((candidate) => ({ candidate, away: (candidate - year) * 12 + month - current }))
    .sort((a, b) => Math.abs(a.away) - Math.abs(b.away) || a.away - b.away);
  return namedMonth(choices[0].candidate, month);
}

function monthsInQuestion(said, now = currentMonth()) {
  const text = String(said ?? '').toLowerCase();
  const found = new Set();
  const [year, current] = String(now).split('-').map(Number);

  if (/\blast month\b/.test(text)) found.add(shiftedMonth(now, -1));
  if (/\bthis month\b/.test(text)) found.add(now);

  MONTH_NAMES.forEach((name, index) => {
    const month = index + 1;
    const match = new RegExp(`\\b(last|this)?\\s*${name}(?:\\s+(20\\d{2}))?\\b`).exec(text);
    if (!match) return;

    if (match[2]) {
      found.add(namedMonth(Number(match[2]), month));
      return;
    }
    if (match[1] === 'last') {
      found.add(namedMonth(month < current ? year : year - 1, month));
      return;
    }
    if (match[1] === 'this') {
      found.add(namedMonth(year, month));
      return;
    }
    found.add(nearestNamedMonth(month, now));
  });

  return [...found].sort();
}

/** The month name they actually said, 1-12, or null. Ignores a said year. */
function monthNamed(said) {
  const text = String(said ?? '').toLowerCase();
  const hit = MONTH_NAMES.findIndex((m) => new RegExp(`\\b${m}\\b`).test(text));
  return hit === -1 ? null : hit + 1;
}

/**
 * The month they meant, when she guessed the year and they named the month.
 *
 * @returns {string|null} 'YYYY-MM', or null when there is nothing to repair
 *   (no month word, or they said a year themselves).
 */
function repairMonth(iso, said, now = currentMonth()) {
  if (!farOffMonth(iso, said, now)) return null;
  const wanted = monthNamed(said);
  if (!wanted) return null;

  const [ny, nm] = String(now).split('-').map(Number);
  if (!ny || !nm) return null;

  // The same month name in the year before, of, and after the business
  // month. Nearest wins; a tie goes to the past, because a total is asked
  // about a month that has happened.
  const options = [ny - 1, ny, ny + 1].map((y) => ({ y, away: (y - ny) * 12 + (wanted - nm) }));
  options.sort((a, b) => Math.abs(a.away) - Math.abs(b.away) || a.away - b.away);

  return `${options[0].y}-${String(wanted).padStart(2, '0')}`;
}

/**
 * The month a READ should actually use.
 *
 * Theirs when they chose it, REPAIRED when she guessed the year over a
 * month they named, and dropped only when there is nothing to repair to.
 * Reads only: a WRITE with a guessed year still refuses and asks, because
 * a repaired preset silently rewrites what a row is owed.
 */
function monthForRead(iso, said, now = currentMonth()) {
  if (!iso) return undefined;
  return repairMonth(iso, said, now) ?? (farOffMonth(iso, said, now) ? undefined : iso);
}

module.exports = {
  farOffMonth, monthsFromNow, repairMonth, monthForRead, monthNamed, monthsInQuestion,
  MONTHS_EITHER_SIDE,
};
