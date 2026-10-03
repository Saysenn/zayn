import { record } from "../system/audit.js";
import { logger } from "../system/logger.js";
import { createConcern } from "../system/crmClient.js";
import { NEXT_STEPS, REVIEW_STEPS } from "./scripted.js";
import { forMatching } from "./normalize.js";

/**
 * The messages where somebody needs a person, not a lookup.
 *
 * "My payment is wrong." "I can't pay my rent." "You've sent me someone else's
 * breakdown." None of those are questions the tools can answer, and all of them
 * are worse than useless if the reply sounds automated.
 *
 * What actually happens: the message is written to the audit log with a
 * category on it, and a warn line goes to the logger. That is the whole extent
 * of it, so the replies below say exactly that and no more. None of them
 * promise a callback, a timescale, or a name, because nothing here can deliver
 * one — and a payroll bot that invents a promise about somebody's wages is
 * worse than one that admits its limits.
 *
 * NO PHONE NUMBER, NO EMAIL, EVER. blockFakeNumbers exists because a made up
 * contact detail has already been sent to a real person once.
 */

/**
 * Order is priority. The first match wins, so the ones that must never be
 * swallowed by something milder sit at the top.
 *
 * "I can't pay my rent, this is ridiculous" is a person in trouble, not a
 * complaint about tone.
 */
const CATEGORIES = [
  {
    name: "wrong-recipient",
    re: /\b(someone else'?s|somebody else'?s|another person'?s|not my) (breakdown|figures|pay|payslip|details|message|numbers)\b|\b(this|that) (is ?n'?t|is not) (me|mine|my)\b|\bwrong person\b|\bmeant for (someone|somebody) else\b/i,
    urgent: true,
    reply:
      "Thanks for telling me, that really matters. I've raised it as a privacy issue straight away. Please don't forward on what you were sent.",
  },
  {
    name: "distress",
    re: /\b(can'?t|cannot|unable to) (pay|afford|cover)\b|\bi('?m| am) (really |very |so )?(desperate|struggling|skint|broke)\b|\b(need|needed) (this|the|that) money (urgently|badly|now|today)\b|\bno money (for|to|left)\b|\b(rent|mortgage|bills?|food) (is|are) due\b/i,
    urgent: true,
    reply:
      "That sounds really stressful, I'm sorry. I've flagged it as urgent for a person to pick up. I can't move a payment myself.",
    offer: true,
  },
  {
    name: "legal",
    re: /\b(legal action|solicitor|lawyer|tribunal|small claims|sue you|take you to court|report (you|this|them) to|trading standards|ombudsman|hmrc)\b|\b(post|share|put) this (publicly|online|on (twitter|facebook|instagram|linkedin))\b/i,
    urgent: true,
    reply:
      "Understood. I've recorded that and flagged it for payroll. I'm not the right thing to take it further with, but it's on the record.",
  },
  {
    name: "dispute",
    /**
     * Widened after "I was paid less than this" and "this is wrong" both
     * reached the model and got answered with an ordinary lookup. Somebody
     * reporting a shortfall is the single most important message this thing
     * receives, and it was being treated as a question about figures.
     *
     * Every addition needs a comparison or a negative in it. "When will I be
     * paid" must stay out — that is a question, `outOfScope` answers it, and
     * catching it here would tell a curious person their concern is being
     * investigated.
     */
    re: /\b(underpaid|overpaid|short ?changed|shorted)\b|\bmy (pay|payment|amount|total|figure|breakdown|wages?) (is|are|looks?|seems?) (wrong|incorrect|off|short|incomplete|too (low|high|little|much))\b|\b(does ?n'?t|do ?n'?t|does not|do not) add up\b|\bwrong (rate|amount|figure|date|days)\b|\b(i was|you) promised\b|\bmissing (a |an |one )?(company|appointment|payment|month|role)\b|\b(company|appointment|payment|role) (is |are )?missing\b|\bshould ?n'?t be (there|included|on there)\b|\b(i (was|got)|they|you) paid (me )?(less|more)\b|\bi (only )?(got|received|was) (paid |sent )?(less|more)\b|\b(received|got) (less|more) than\b|\b(less|more) than (this|that|what)\b|\b(this|that|it) (is|was|looks|seems)( ?n'?t| not)? (wrong|incorrect|off|short|incomplete)\b|\bthat'?s (wrong|incorrect|not right)\b|\bdoes ?n'?t match\b|\b(have ?n'?t|has ?n'?t|had ?n'?t|did ?n'?t|not) (been |yet )?(paid|received)\b|\bnothing (has )?(arrived|come through|come in|been paid)\b|\bno payment (has )?(arrived|come)\b/i,
    /**
     * Ends with a question, so it carries NO menu.
     *
     * A message that asks "which company is it?" and then lists three options
     * underneath is not waiting for an answer, it is a form with a question on
     * top — the same thing greeting.ts refuses to do. And the answer matters
     * here: payroll cannot look into a shortfall without knowing which company
     * and what they expected, so that reply is the useful one.
     *
     * Nothing is lost by dropping the menu. It is already flagged, a person is
     * already coming, and anything they type next is recorded with it.
     */
    reply:
      "Right, let's get that looked at. I've flagged it for payroll and recorded what you've told me. Which company is it, and what were you expecting?",
  },
  {
    name: "anger",
    re: /\b(you'?ve|you have|youve) (stolen|nicked|taken|robbed)\b|\b(you|this|it|that)('?s| is| are) (a )?(scam|fraud|con|joke|robbery|ridiculous|disgraceful|a disgrace|pathetic|useless|rubbish|nonsense)\b|\bi hate (this|you|the bot)\b|\bstop (sending me )?(automated|robot|bot) \w+/i,
    reply: "Fair enough, and sorry. I've flagged it for a person to look at.",
    offer: true,
  },
  {
    name: "wants-human",
    /**
     * Asking to be called is asking for a person. "I want someone to call me"
     * used to reach the model, which cannot arrange one — and the one thing
     * this must never do is invent a number to call back on.
     *
     * A bare "can you call me?" is deliberately NOT here. That one is asking
     * whether this thing does phone calls, `outOfScope` answers it honestly,
     * and escalate runs first — so catching it would turn a simple no into a
     * flagged complaint. The pattern wants a third party: someone, a person,
     * payroll, my manager.
     */
    re: /\b(speak|talk|chat) to (a |an )?(person|human|someone|somebody|manager|supervisor|advisor|adviser|real person|member of staff)\b|\bgive me a (manager|supervisor|human|person)\b|\bi (don'?t|do not) want to (talk|speak) to a (bot|robot|machine|computer|ai)\b|\b(raise|make) a (complaint|grievance)\b|\bhow do i escalate\b|\bcan (a )?(human|person|someone) (review|look at|check)\b|\b(someone|somebody|anyone|a person|a human|my manager|payroll|hr) (needs to |should |can |could |to |please )?(call|ring|phone|contact) me\b|\b(have|get) (someone|somebody|a person) (to )?(call|ring|phone|contact) me\b|\bi want (someone|somebody|a person|a human)\b|\bhuman review\b/i,
    reply:
      "No problem, I've recorded that you'd rather a person handled this. I've no direct number or email to give you, so it's whoever you'd normally ask about your pay, your manager or payroll.",
    review: true,
  },
  {
    name: "data-request",
    re: /\b(copy of my (data|information|records)|delete my (data|information|records)|erase my|remove my (data|information|details)|correct my (data|details|information)|subject access|gdpr)\b/i,
    reply:
      "I've flagged that for a person, a formal copy or a deletion isn't mine to do.",
    offer: true,
  },
];

/**
 * Which category this message falls into, or null for an ordinary question.
 *
 * Split out from `escalate` so it can be tested without a Redis behind it. The
 * matching is the part worth testing: it is narrow on purpose, and the cost of
 * a false positive is real. Catching an ordinary question here means somebody
 * asking what they are owed gets told their concern has been flagged instead of
 * getting their figures. Every pattern wants an actual complaint, not just an
 * unhappy word.
 */
export function escalationCategory(text) {
  return CATEGORIES.find((c) => c.re.test(forMatching(text)))?.name ?? null;
}

/**
 * The reply itself, with no recording and no Redis.
 *
 * Split out for the same reason escalationCategory is: what somebody actually
 * receives is worth asserting, and it could not be reached without a Redis
 * behind it. Two things get tested through here — that a reply ending in a
 * question carries no menu, and that the categories which need a person offer a
 * way to ask for one.
 */
export function escalationReply(text) {
  const hit = CATEGORIES.find((c) => c.re.test(forMatching(text)));
  if (!hit) return null;

  return {
    category: hit.name,
    text: hit.reply,
    // review gets the compare-and-escalate menu; offer gets the general one
    offer: hit.review ? REVIEW_STEPS : hit.offer ? NEXT_STEPS : undefined,
  };
}

/** A reply if this message needs a person, otherwise null. Records it either way. */
export async function escalate(text, personId, group) {
  // matched on the tidied text, recorded as they actually typed it
  const hit = CATEGORIES.find((c) => c.re.test(forMatching(text)));
  if (!hit) return null;

  logger[hit.urgent ? "warn" : "info"](
    { actor: personId, group, category: hit.name },
    "message escalated for a person to review",
  );

  /**
   * Their own words go in the record. That is the point of capturing it — a
   * dispute with the message paraphrased out of it is not much of a dispute.
   * Capped, because this is a record and not a transcript.
   */
  await record({
    actor: personId,
    tool: "escalation",
    args: { group, message: text.slice(0, 500) },
    subjects: [personId],
    flagged: hit.name,
  });

  // best-effort: the CRM's flagged queue is where an admin actually sees
  // this. Never throws — see crmClient.js — so a CRM outage never blocks
  // the reply the person is waiting on.
  await createConcern(personId, group, hit.name, text);

  return escalationReply(text);
}
