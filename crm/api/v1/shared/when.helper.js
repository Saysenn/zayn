// ***************************************************
// * When does it apply? One answer, worked out in code.
// ***************************************************
//
// She passes the words ("next month", "November", "2026-11"); this turns
// them into exact months with the year, in the business timezone. Scheduling
// uses it now and forecasting will reuse it, so the two cannot disagree.

const { currentMonth } = require('./presetMonth.helper');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_WORD = `(?:${MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)`;

function shift(month, by) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthIndex(word) {
  const w = String(word).toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(w));
}

/** One month phrase -> 'YYYY-MM', or 'now', or null when it cannot be read. */
function resolveOne(text, now) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t || /^(now|today|this month|immediately|right now)$/.test(t)) return 'now';
  if (/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/.test(t)) return t.slice(0, 7);
  // "THE END OF NEXT MONTH" lands on the 1st of the month after: it was
  // read as "next month", one month early. 2026-10-04.
  if (END_OF_NEXT.test(t)) return shift(now, 2);
  if (/^next month$/.test(t)) return shift(now, 1);
  // "AT THE END OF THIS MONTH" is the start of the next: this month is still
  // paid in full, and the change lands on the 1st. 2026-10-03.
  if (END_OF_MONTH.test(t)) return shift(now, 1);
  const named = t.match(new RegExp(`^(?:in |from |starting |for )?(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?$`));
  if (named) {
    const idx = monthIndex(named[1]);
    const [y, m] = now.split('-').map(Number);
    if (named[2]) return `${named[2]}-${String(idx + 1).padStart(2, '0')}`;
    // A bare month is the NEXT one of that name; this month means now.
    const year = idx + 1 < m ? y + 1 : y;
    const month = `${year}-${String(idx + 1).padStart(2, '0')}`;
    return month === now ? 'now' : month;
  }
  return null;
}

/**
 * `when` plus an optional `forMonths` count -> { now: true } or
 * { months: ['YYYY-MM', ...] } or { error }.
 */
function resolveWhen(when, forMonths, now = currentMonth()) {
  const first = resolveOne(when, now);
  if (first === null) return { error: `"${when}" is not a month I can read. Ask which month they mean.` };
  if (first === 'now') return { now: true };
  if (first < now) return { error: `${first} is in the past. Ask which month they mean.` };
  const count = Math.max(1, Math.min(12, Number(forMonths) || 1));
  return { months: Array.from({ length: count }, (_, i) => shift(first, i)) };
}

/**
 * Does their sentence put the change in a LATER month? "from next month",
 * "starting November", "in december", "for the next 3 months". The backup
 * check: a plain "set her preset to November" is a value, not a timing.
 */
const NEXT = /\bnext\s+(?:month|\d+\s+months|few months)\b/i;
const END_OF_NEXT = /\b(?:(?:at |by )?(?:the )?end of next month)\b/i;
const END_OF_MONTH = /\b(?:(?:at |by )?(?:the )?end of (?:this |the )?month|month[- ]end)\b/i;
const LATER = new RegExp(
  `\\b(?:from|starting(?: in| from)?|beginning|as of|effective|come|in|for|until)\\s+(?:the\\s+)?(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?`
  // "FEBRUARY, PUT FELIX ORR ON 1500": a month said first, as the when. In auto
  // mode it was saved at once (blind held-out park run 2026-10-22).
  + `|^\\s*(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?\\s*[,:;-]`
  // "BAKERS DEC ONE SHUD BE 2275": a parked change named by its month. It was
  // read as no month and changed the pay at once (blind park run 2026-10-22).
  // "MAKE THAT DECEMBER" too, the month they corrected to.
  + `|\\b(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?\\s+(?:one|change|park|parked|rise|raise|bump|amount|figure)\\b`
  + `|\\bmake\\s+(?:that|it)\\s+(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?`,
  'gi',
);
// "FROM NOVEMBER.. WAIT NO MAKE THAT DECEMBER": the month after the correction wins.
const CORRECTION = /\b(?:wait\s+no|no\s+wait|make\s+(?:that|it)|actually|i\s+mean|scratch\s+that|sorry)\b/gi;
const afterCorrection = (text) => {
  const marks = [...String(text).matchAll(CORRECTION)];
  return marks.length ? String(text).slice(marks[marks.length - 1].index) : null;
};
const AS_VALUE = new RegExp(`\\b(?:to|preset|end date|start date|payment start)\\s+(?:next month|${MONTH_WORD})\\b`, 'gi');

/**
 * THE MONTH THEIR SENTENCE NAMES, as a `when`, or null. Used when she left
 * `when` off a change whose sentence already says it: "close harbor nine
 * at the end of this month" was sent back for a `when`, and she asked the
 * admin which month instead of reading it. 2026-10-03.
 */
function whenIn(said, now = currentMonth()) {
  const text = String(said ?? '').replace(AS_VALUE, ' ');
  if (END_OF_NEXT.test(text)) return shift(now, 2);
  if (END_OF_MONTH.test(text) || /\bnext month\b/i.test(text)) return 'next month';
  const tail = afterCorrection(text);
  if (tail) {
    const bare = tail.match(new RegExp(`\\b(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?`, 'i'));
    const month = bare ? resolveOne(bare[2] ? `${bare[1]} ${bare[2]}` : bare[1], now) : null;
    if (month && month !== 'now' && month > now) return month;
  }
  for (const m of text.matchAll(LATER)) {
    const [word, year] = [m[1] ?? m[3] ?? m[5] ?? m[7], m[2] ?? m[4] ?? m[6] ?? m[8]];
    const month = resolveOne(year ? `${word} ${year}` : word, now);
    if (month && month !== 'now' && month > now) return month;
  }
  return null;
}

/**
 * THE FIGURE ASKED FOR NOW beside a later one: "mara to 1150 straight away and
 * then 1250 from december", "felix 1350 now and 1500 from november". null when
 * none is said for now (fresh park runs 2026-10-22).
 */
const NOW_WORDS = '(?:right\\s+)?now|straight\\s*away|right\\s+away|immediately|today|this\\s+month|as\\s+of\\s+now|asap';
function nowValueIn(said) {
  const text = String(said ?? '').toLowerCase().replace(/,(?=\d{3}\b)/g, '');
  const m = text.match(new RegExp(`\\b(\\d{2,6}(?:\\.\\d+)?)\\s+(?:${NOW_WORDS})\\b`))
    ?? text.match(new RegExp(`\\b(?:${NOW_WORDS})\\b[^.;\\d]{0,12}?(\\d{2,6}(?:\\.\\d+)?)\\b(?![^.;]{0,6}\\bfrom\\b)`));
  return m ? Number(m[1]) : null;
}

function saysLater(said, now = currentMonth()) {
  // "set the preset to November" names a value, so it is cut out first.
  const text = String(said ?? '').replace(AS_VALUE, ' ');
  if (NEXT.test(text) || END_OF_MONTH.test(text) || END_OF_NEXT.test(text)) return true;
  for (const m of text.matchAll(LATER)) {
    const [word, year] = [m[1] ?? m[3] ?? m[5] ?? m[7], m[2] ?? m[4] ?? m[6] ?? m[8]];
    const month = resolveOne(year ? `${word} ${year}` : word, now);
    if (month && month !== 'now' && month > now) return true;
  }
  return false;
}

/** The month named after their last correction ("wait no make that december"), or null. */
function correctedMonthIn(said, now = currentMonth()) {
  const tail = afterCorrection(String(said ?? '').replace(AS_VALUE, ' '));
  const bare = tail?.match(new RegExp(`\\b(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?`, 'i'));
  const month = bare ? resolveOne(bare[2] ? `${bare[1]} ${bare[2]}` : bare[1], now) : null;
  return month && month !== 'now' && month > now ? month : null;
}

/**
 * THE MONTH FOR ONE PART of a sentence naming several: "otto 1600 in nov and
 * felix 1350 in december" parked both for November (blind park run
 * 2026-10-22). The clause holding this change's figure or person decides;
 * otherwise the whole sentence does, as before.
 */
function whenFor(said, hints = [], now = currentMonth()) {
  const text = String(said ?? '');
  const clauses = text.split(/\s*(?:\band\b|\bthen\b|[,;&]|\.\.+)\s*/i).filter(Boolean);
  const dated = clauses.filter((c) => whenIn(c, now));
  if (dated.length < 2) return whenIn(text, now);
  const words = hints.filter((h) => h != null && String(h).trim()).map((h) => String(h).toLowerCase().trim());
  const owns = (c) => words.some((w) => (/^[\d.]+$/.test(w)
    ? new RegExp(`(?<![\\d.])${w.replace('.', '\\.')}(?![\\d.])`).test(c.replace(/,(?=\d{3}\b)/g, ''))
    : new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(c)));
  const mine = clauses.findIndex(owns);
  if (mine < 0) return whenIn(text, now);
  // Its own month, or the next clause's ("otto 1600 and felix 1350 in december").
  for (let i = mine; i < clauses.length; i += 1) {
    const w = whenIn(clauses[i], now);
    if (w) return w;
  }
  return whenIn(text, now);
}

module.exports = {
  nowValueIn, correctedMonthIn, whenFor,
  whenIn, resolveWhen, saysLater, MONTH_WORD };
