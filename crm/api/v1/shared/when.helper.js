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
  if (/^next month$/.test(t)) return shift(now, 1);
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
const LATER = new RegExp(
  `\\b(?:from|starting(?: in| from)?|beginning|as of|effective|come|in|for|until)\\s+(?:the\\s+)?(${MONTH_WORD})\\b(?:\\s+(\\d{4}))?`,
  'gi',
);
const AS_VALUE = new RegExp(`\\b(?:to|preset|end date|start date|payment start)\\s+(?:next month|${MONTH_WORD})\\b`, 'gi');

function saysLater(said, now = currentMonth()) {
  // "set the preset to November" names a value, so it is cut out first.
  const text = String(said ?? '').replace(AS_VALUE, ' ');
  if (NEXT.test(text)) return true;
  for (const m of text.matchAll(LATER)) {
    const month = resolveOne(m[2] ? `${m[1]} ${m[2]}` : m[1], now);
    if (month && month !== 'now' && month > now) return true;
  }
  return false;
}

module.exports = { resolveWhen, saysLater, MONTH_WORD };
