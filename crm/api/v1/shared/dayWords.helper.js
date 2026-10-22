// ***************************************************
// * A DAY SAID IN WORDS, AS A DATE (his call 2026-10-13)
// ***************************************************
//
// "deadline Friday", "end of month", "in 2 weeks", "30 Nov": worked out
// HERE, never by the model, so the date in her preview is a date code chose
// and checked. Anything it cannot read is null, and the tool asks.
//
// UK order for numbers: 30/11 is the 30th of November. A day with no year
// is the next one on or after today.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const valid = (y, m, d) => {
  const t = utc(y, m, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? t : null;
};
const addDays = (d, n) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14 };
const monthOf = (word) => MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());

/**
 * @param {string} said   the words: "Friday", "2026-11-30", "end of next month"
 * @param {string} today  YYYY-MM-DD, the business day (presetMonth.currentDay)
 * @returns {string|null} YYYY-MM-DD, or null when it is not a day it can be sure of
 */
function dayFrom(said, today) {
  const text = String(said ?? '').trim().toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ');
  if (!text) return null;
  const [ty, tm, td] = String(today).split('-').map(Number);
  const now = utc(ty, tm - 1, td);

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) { const d = valid(+m[1], +m[2] - 1, +m[3]); return d ? iso(d) : null; }

  if (text === 'today') return iso(now);
  if (text === 'tomorrow' || text === 'tmrw' || text === 'tmr') return iso(addDays(now, 1));
  // "appointed yday": a log line's day is often the past (held-out run 2026-10-22).
  if (text === 'yesterday' || text === 'yday' || text === 'yest') return iso(addDays(now, -1));

  // "in 2 weeks", "in two weeks", "a week from today", "3 days time", "in a month".
  m = /^(?:in )?(\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|fourteen) (day|days|week|weeks|month|months)(?:'? time| from (?:today|now))?$/.exec(text);
  if (m && (/^in /.test(text) || /time$| from (?:today|now)$/.test(text))) {
    const n = /^\d/.test(m[1]) ? +m[1] : NUMBER_WORDS[m[1]];
    if (m[2].startsWith('month')) {
      const d = valid(now.getUTCFullYear(), now.getUTCMonth() + n, now.getUTCDate())
        ?? utc(now.getUTCFullYear(), now.getUTCMonth() + n + 1, 0);
      return iso(d);
    }
    return iso(addDays(now, n * (m[2].startsWith('week') ? 7 : 1)));
  }

  m = /^(?:the )?end of (?:the )?(this|next) month$|^(?:the )?end of month$|^month end$/.exec(text);
  if (m) {
    const ahead = m[1] === 'next' ? 1 : 0;
    return iso(utc(now.getUTCFullYear(), now.getUTCMonth() + ahead + 1, 0));
  }
  if (/^(?:the )?end of (?:the )?week$|^this week$/.test(text)) {
    const toFri = (5 - now.getUTCDay() + 7) % 7;
    return iso(addDays(now, toFri));
  }

  m = /^(?:(this|next) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(text);
  if (m) {
    // "Friday" is the coming one (today, if it is Friday). "Next Friday" is
    // the one after that: the preview shows the weekday and date, so a
    // reading they did not mean is seen before it is saved.
    let ahead = (DAYS.indexOf(m[2]) - now.getUTCDay() + 7) % 7;
    if (m[1] === 'next') ahead += 7;
    return iso(addDays(now, ahead));
  }

  // 30 nov, 30 november 2026, nov 30, november 30 2026
  m = /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?$/.exec(text)
    || /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(text);
  if (m) {
    const [dayPart, monthPart] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const mo = monthOf(monthPart);
    if (mo < 0) return null;
    let y = m[3] ? +m[3] : ty;
    let d = valid(y, mo, +dayPart);
    if (d && !m[3] && d < now) { y += 1; d = valid(y, mo, +dayPart); }
    return d ? iso(d) : null;
  }

  // 30/11, 30/11/2026, 30-11-26
  m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(text);
  if (m) {
    let y = m[3] ? +m[3] : ty;
    if (y < 100) y += 2000;
    let d = valid(y, +m[2] - 1, +m[1]);
    if (d && !m[3] && d < now) d = valid(y + 1, +m[2] - 1, +m[1]);
    return d ? iso(d) : null;
  }
  return null;
}

/**
 * "Friday 17 October 2026", for a preview line. IN FULL (his call
 * 2026-10-13): "Sun" was read aloud as the word, not the day.
 */
function sayDay(isoDay) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
}

module.exports = { dayFrom, sayDay };
