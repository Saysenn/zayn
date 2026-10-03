import { periodName } from "../config/index.js";
import { groupName } from "../tools/format/index.js";

/**
 * The message that starts the monthly check.
 *
 * Plain text, not an approved template — a linked device sends ordinary
 * messages, so there is nothing to submit and no 24-hour window to work within.
 * The trade is that nothing external vets it: this wording is the only thing
 * standing between us and everybody receiving something confusing.
 *
 * It names the group and offers a way out, because an unexplained message about
 * pay from an unknown number is what gets an account reported. Naming the group
 * also matters for the twelve people who get two of these from two different
 * numbers — without it, the second one looks like a duplicate.
 *
 * "Milkman", not "MILKMAN". A shouted system code in the middle of a sentence
 * reads like a mail merge went wrong, on the one message that most needs to
 * read as though a person sent it.
 *
 * Four numbered options rather than a paragraph. There are no buttons on a
 * linked device, so the numbers are the interface — and opting out is one of
 * them, not a footnote. paydayAnswer accepts 1 to 4 while the check is
 * open; change one and you must change the other.
 *
 * "Only part of it" is its own option rather than something to be dug out of
 * a follow-up. A short payment is the commonest real problem and it used to
 * have nowhere to go: people picked No, which reads as "nothing arrived" and
 * puts a payment that actually worked in the same bucket as one that failed.
 *
 * STOP moved from 3 to 4 when that option was added. The WORD stop is
 * unaffected and always has been (optOut runs before any of this), so the
 * only person the renumber can catch is somebody typing the bare digit from
 * memory rather than reading the message in front of them.
 */
export function paydayOpening(firstName, period, group) {
  return [
    `Hi ${firstName}, quick check from payroll.`,
    "",
    `Did you receive your ${periodName(period)} pay for your ${groupName(group)} companies?`,
    "",
    "1. Yes",
    "2. No",
    "3. Only part of it",
    // the word, not a paraphrase — STOP is what everybody already knows how to
    // type, and the number is only a shortcut to it
    "4. STOP",
    "",
    "Choose 4 to stop receiving these updates.",
    "You can ask about your breakdown anytime.",
  ].join("\n");
}

/**
 * Sent when somebody comes back to change an answer they already gave.
 *
 * The whole menu again, not a bare "which is it?", because by then the
 * original message is hours or days up their chat history and the numbers
 * are the interface. Says plainly that the old answer is being replaced,
 * so nobody thinks they are being asked twice by mistake.
 */
export function paydayReopened(firstName, period, group) {
  return [
    `No problem ${firstName}, let's put that right.`,
    "",
    `For your ${periodName(period)} ${groupName(group)} pay, which is it now?`,
    "",
    "1. Yes, received in full",
    "2. No, nothing arrived",
    "3. Only part of it",
    "",
    "Whichever you pick replaces your earlier answer.",
  ].join("\n");
}

/**
 * Free-form replies, sent once they answer.
 *
 * Deliberately plain. Somebody who has not been paid does not want warmth.
 */
export const paydayReplies = {
  confirmed:
    "Thanks for confirming. If anything looks wrong later, just message me.",

  notReceived(paymentMethod, period, group) {
    return [
      `Sorry to hear that. Our records show your ${periodName(period)} ${group} pay was sent by ${paymentMethod}.`,
      "",
      "Has nothing arrived at all, or has the amount come through wrong?",
    ].join("\n");
  },

  /**
   * Their answer to the question above, which until now was asked and then
   * thrown away — the check was already closed by the time it arrived, so
   * it reached the model like any other sentence and nothing recorded it.
   *
   * The two answers are genuinely different problems: nothing arrived is a
   * payment that failed, a short amount is a payment that worked and was
   * wrong. Payroll chases them differently, so they're recorded
   * differently ('not_received' vs 'partial').
   */
  nothingArrived:
    "Understood, nothing at all. I've flagged it with payroll and someone will be in touch.",

  /** they told us what did arrive, after picking "only part of it" */
  detailNoted:
    "Thanks, I've added that to the note for payroll.",

  partial: [
    "Understood, so some of it came through but not all. I've flagged the shortfall with payroll and someone will be in touch.",
    "",
    "If you know how much did arrive, tell me and I'll pass it on.",
  ].join("\n"),

  escalated:
    "I've flagged this with payroll and someone will be in touch. Would you like to see your breakdown in the meantime?",
};

/**
 * The two answers phrased in full.
 *
 * A linked device sends plain text, so there are no buttons to tap — the
 * opening message asks for YES or NO and most people send exactly that, which
 * classifyReply already handles. These catch the ones who echo the question
 * back ("yes, received"), where classifyReply would see the trailing word as a
 * separate request and treat the whole thing as not-an-answer.
 */
export const YES_RECEIVED = /^yes,? received/i;
export const NO_RECEIVED = /^no,? not received/i;

/**
 * The numbered options from the opening message, as replies.
 *
 * Bare digit only. "1" is the answer; "1 company is missing" is a question and
 * must reach the model, or somebody reporting a problem gets logged as having
 * confirmed their pay.
 *
 * These count ONLY while that person has a check open on that group — see
 * handleMessage. A stray "3" in ordinary conversation must never opt anybody
 * out of anything.
 */
export const CHOICE_YES = /^\s*1[\s.)]*$/;
export const CHOICE_NO = /^\s*2[\s.)]*$/;
export const CHOICE_PARTIAL = /^\s*3[\s.)]*$/;
export const CHOICE_STOP = /^\s*4[\s.)]*$/;

/**
 * Coming back to change an answer already given.
 *
 * Someone confirms on payday, then finds the money never cleared, or that
 * it was short. Their record says confirmed and the CRM has their Paid
 * toggle switched on, and until now there was no way back: the check was
 * closed and anything they said reached the model, which cannot record an
 * outcome.
 *
 * Matched only when no check is open, so it can never override an answer
 * they are in the middle of giving. Deliberately generous — the cost of a
 * false positive is the menu appearing when it wasn't wanted, and the cost
 * of a miss is somebody's missing wages going unrecorded.
 */
export const REOPEN_INTENT = new RegExp(
  [
    // "didn't receive", "never got", "haven't arrived"
    /\b(?:didn'?t|did not|haven'?t|have not|never)\s+(?:receive[d]?|get|got|arrive[d]?)\b/,
    // the plain statements of the same thing
    /\b(?:not received|not paid|unpaid|still waiting|nothing arrived|nothing came|incomplete|underpaid|short paid|paid short)\b/,
    // the amount, said either way round
    /\b(?:wrong amount|amount (?:is |was |came through )?wrong)\b/,
    /\bonly (?:got|received|half|part)\b/,
    /\bmissing (?:my )?(?:pay|payment|wages|money)\b/,
    // asking for the check itself again, in so many words
    /\b(?:payday|pay ?check)\b.*\b(?:again|update|change|wrong|reopen)\b/,
    /\b(?:change|update|correct)\b.*\b(?:my )?(?:answer|reply|response)\b/,
  ]
    .map((r) => r.source)
    .join("|"),
  "i",
);

/**
 * Sorting the answer to "nothing at all, or the amount come through wrong?"
 *
 * NOTHING is tested FIRST and that ordering is load-bearing: "I received
 * nothing, the amount never came" contains the word amount, and reading
 * that as a short payment would record somebody who got zero as partly
 * paid — and then turn their Paid toggle ON in the CRM. The expensive
 * mistake only runs one way, so the cautious branch goes first.
 *
 * Neither matching is the normal case for a real question ("who do I speak
 * to?"), which must stay unclassified and reach the model. This only ever
 * runs while their own unanswered follow-up is outstanding, never in
 * ordinary conversation.
 */
export const NOTHING_ARRIVED =
  /\b(nothing|none|nowt|no money|not a penny|zero|never (arrived|came|received|got))\b/i;

export const AMOUNT_WRONG =
  /\b(amount|short|shortfall|less|half|partial|partly|part of it|incomplete|underpaid|missing some|not the full|wrong)\b/i;
