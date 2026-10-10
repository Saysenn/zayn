/**
 * Choose what Diane speaks from a reply that is also drawn in full.
 *
 * ===============================
 * * SHE READS EVERYTHING SHE SAYS. His call, 2026-09-17.
 * ===============================
 * This used to truncate. Any reply of four lines or more was cut to its
 * first line, and a first line that looked like a heading was replaced
 * outright with "That one is a long one, lovely, so it is on screen for you
 * to read." So the longer and more detailed her answer, the less of it she
 * would say, and the one sentence she did speak was an apology for not
 * speaking. That is the opposite of what a spoken assistant is for.
 *
 * ANYTHING SHE PUTS ON SCREEN AS HER ANSWER, SHE READS. No length test, no
 * shape test, no opener test. The long money answers already read in full
 * and the provider chunks them safely, so there was never a technical
 * reason for the cap: it was a judgement about what is worth hearing, and
 * that judgement is the admin's, not this function's.
 *
 * IT STAYS A FUNCTION rather than being inlined at the two call sites.
 * What she speaks is one decision with one home, so a future rule (skip a
 * table, say a row count instead) is added here and both callers inherit
 * it. Inlining it is how the two would drift apart.
 *
 * WHAT IS STILL NOT SPOKEN: a card, a list or a form. Those are DRAWN, and
 * each arrives with a sentence of its own that is spoken. Reading twenty
 * cells aloud is a separate decision and nobody has asked for it.
 */
const MONTHS = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', sept: 'September', oct: 'October', nov: 'November', dec: 'December',
};
const MONTH_NUM = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * DATES AS PEOPLE SAY THEM (his call 2026-10-10: "01 Oct – 09 Oct" was read
 * "zero one ok, zero nine ok"). "01 Oct" is "1 October", a range is "to",
 * "2026-10-09" is "9 October 2026". Only what she SAYS; the screen keeps
 * the short form.
 */
export function speakDates(text) {
  const day = (d) => String(Number(d));
  return String(text ?? '')
    // 2026-10-09 → 9 October 2026
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => (MONTH_NUM[Number(mo)] ? `${day(d)} ${MONTH_NUM[Number(mo)]} ${y}` : m))
    // 01 Oct (2026) → 1 October (2026)
    .replace(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\b/gi, (m, d, mon) => `${day(d)} ${MONTHS[mon.toLowerCase()]}`)
    // a range: "1 October – 9 October" → "1 October to 9 October"
    .replace(/(\d{1,2} [A-Z][a-z]+(?: \d{4})?)\s*[–—-]\s*(\d{1,2} [A-Z][a-z]+)/g, '$1 to $2');
}

export function speakableReply(reply) {
  // NEVER A LINK OR A SOURCE MARKER (his call 2026-10-10, HMRC mode): "[2]"
  // and web addresses are for the eye; the sources are drawn under the answer
  return speakDates(String(reply ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s?\[\d+\](?:\[\d+\])*/g, ''))
    // "·" is a pause, never "dot"; "➜" is "to"
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s*➜\s*/g, ' to ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
