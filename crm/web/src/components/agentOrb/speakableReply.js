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
export function speakableReply(reply) {
  // NEVER A LINK OR A SOURCE MARKER (his call 2026-10-10, HMRC mode): "[2]"
  // and web addresses are for the eye; the sources are drawn under the answer
  return String(reply ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s?\[\d+\](?:\[\d+\])*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
