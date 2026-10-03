import { logger } from "../system/logger.js";
import { groupName } from "../tools/format/index.js";
import { NEXT_STEPS } from "./scripted.js";
import { forMatching } from "./normalize.js";

/**
 * "Who are you?", "is this a scam?", "who can see my pay?"
 *
 * Questions about the bot itself and about what it does with somebody's data.
 * Written down here for the same reason the figures are written down in code:
 * these answers are effectively policy, and a model improvising policy will
 * eventually improvise a promise nobody can keep.
 *
 * Run BEFORE blockBypass, deliberately. "Will you ever ask me for my password?"
 * is a sensible question from a careful person, and blockBypass sees the word
 * password and answers "I can only ever show your own figures" — a non-answer
 * that also files them as an attacker. Nothing here reveals anything: every
 * reply is fixed text with no data in it, so answering early costs nothing.
 */

/**
 * A few ways of saying the same thing, picked at random.
 *
 * The identity answers are the ones people ask more than once, usually while
 * messing about. The same sentence word for word every time is what makes it
 * feel like a machine, and this is the one place where varying it costs
 * nothing — there is no figure in any of them.
 */
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

const TOPICS = [
  /**
   * "Who are you?" and "are you a bot?" are different questions and used to
   * share an answer.
   *
   * Somebody asking who they are talking to wants a name. Answering that with
   * "I'm software rather than a person" is cold, volunteers something nobody
   * asked, and is the reason this thing read as a machine before it had said
   * anything at all. It introduces itself by name now, like anyone would.
   *
   * The direct question below still gets a straight answer. It never claims to
   * be a colleague, and never invents a life it does not have: it warns people
   * that anything asking for their PIN in its name is not it, and that warning
   * is worth nothing coming from something that lies about what it is.
   */
  {
    name: "who-are-you",
    re: /\b(who are you|who am i (talking|speaking) (to|with)|what should i call you|what'?s your name)\b/i,
    reply: (name) =>
      pick([
        `You've forgotten me already? 😔 It's ${name}. I sort out your pay on this number.`,
        `${name} 🙂 The one who tells you what you're owed. What do you need?`,
        `Still me, ${name} 👋 Pay on this number is my whole job.`,
        `${name}. Pay questions on this number, and not a lot else 😄`,
        `Same as yesterday, ${name} 🙂 Need a hand with anything?`,
      ]),
  },
  {
    name: "are-you-real",
    re: /\b(are you (a |an )?(bot|robot|human|person|real person|real|ai|machine|computer)|are you automated|is this (a |an )?(bot|robot|human|person|ai|automated)|am i (talking|speaking) to (a |an )?(bot|robot|human|person|real person|machine|ai))\b/i,
    reply: (name) =>
      pick([
        `${name}, your pay contact on this number 🙂 What do you need?`,
        `Charming 😄 I'm ${name}, and I do the pay on this number. What do you need?`,
        `${name} 🙂 Ask me anything about your own pay and you'll see.`,
      ]),
    offer: true,
  },
  {
    name: "legitimacy",
    re: /\b(is (this|it|that) (a |an )?(scam|con|fraud|fake|legit|legitimate|genuine|real)|how do i know (this|you|it)('?s| is| are)|can you prove|how can i (be sure|trust)|should i trust)\b/i,
    reply: (name) =>
      `Genuine, yes 🙂 I only ever talk to you about your own pay. I'll never ask for a password, PIN, card details or a payment, so anything that does isn't me.`,
    offer: true,
  },
  {
    name: "never-ask",
    re: /\b(will|would|do|does|are) you (ever |going to |need to )?(ask|want|need|request)\b[^?]{0,25}\b(password|pin|passcode|bank details|card|card details|otp|one time code|security code)\b/i,
    reply: () =>
      "Never. No passwords, no PINs, no card or bank details. Anything asking you for those isn't me.",
    offer: true,
  },
  /**
   * "You sure?" / "is that right?" — doubt about a figure we just gave.
   *
   * Answered here because the alternative is what actually happened: it went to
   * the model, the model is told never to answer factually from the
   * conversation, so it ran the tool again and sent the identical breakdown a
   * second time. Repeating a figure louder is not evidence, and it reads as
   * though nobody heard the question.
   *
   * So say where the number came from, and offer the one thing that can
   * actually settle it: a person. No figure is repeated and no tool runs.
   *
   * Anything stronger than doubt — "that's wrong", "I was paid less" — is a
   * dispute and escalate has already claimed it, since escalate runs first.
   */
  {
    name: "are-you-sure",
    re: /\b(are|r) (you|u) (sure|certain|positive)\b|\byou sure\b|\bis that (right|correct|it)\b|\bare (you|u) (sure|certain)\b|\breally\?|\bseriously\?|\bthat can'?t be right\b/i,
    reply: () =>
      pick([
        "That's straight off the payroll sheet as it stands today, so it's what I've got 🙂 If it still looks off, tell me which company and I'll pass it to payroll.",
        "It's what the sheet says at the moment, and I don't work anything out myself 🙂 If you think a figure is wrong, say which company and I'll get it looked at.",
        "Those come from the payroll sheet, not from me, so that's what's recorded 🙂 If something doesn't match what you expected, tell me the company and I'll flag it.",
      ]),
  },
  {
    name: "where-from",
    re: /\b(where did you get my|how did you get my|who gave you my)\b[^?]{0,20}\b(number|details|data|info|information)\b|\bwhy (are you|do you keep) (messaging|contacting|texting|writing to) me\b/i,
    reply: () =>
      "You're on the payroll sheet with your companies, so I recognise your number. That's how I know which figures are yours.",
    offer: true,
  },
  {
    name: "what-you-hold",
    re: /\b(what (information|info|data|details|records) (do|have) you (have|hold|keep|store|got)|what do you know about me|what have you got on me|what'?s on file (for|about) me)\b/i,
    reply: () =>
      "Your name, this number, and the companies you're on here with the days and amounts. Nothing about your bank, tax or contract. Want to see it?",
    offer: true,
  },
  {
    name: "who-can-see",
    re: /\b(who (else )?can see|can (anyone|anybody|someone|others|other people|colleagues|the group|everyone|they|he|she) (else )?see)\b[^?]{0,25}\b(my|this|mine|figures|pay|data|information|breakdown)\b|\bis (my|this) (pay|data|information|breakdown) (private|confidential|secure)\b/i,
    reply: () =>
      "Only you. I can't show your figures to anyone else, or show you theirs. Payroll see the sheet itself, nobody you work with does.",
    offer: true,
  },
  {
    name: "storage",
    re: /\b(are|do) (you|these|my|our) ?(store|save|keep|record|messages|chats|conversations)\b[^?]{0,25}\b(stored|saved|kept|recorded|messages|chats|conversations)\b|\bhow long (do you|are (my|these))\b[^?]{0,20}\b(keep|kept|stored|held)\b|\b(is|are) (the )?ai (training|learning|trained)\b/i,
    reply: () =>
      "Only long enough to follow the conversation, plus a record of what was looked up, which payroll has to keep. Nothing is used for training.",
    offer: true,
  },
  {
    name: "stop-contact",
    re: /\b(can you|please|could you) (stop|quit) (messaging|contacting|texting|bothering)\b|\bstop (messaging|contacting|texting) me\b|\bhow do i (opt out|unsubscribe|stop these)\b|\bi (don'?t|do not) want (these|any more|anymore|your) messages\b/i,
    reply: () =>
      "Course. Send STOP on its own and I'll leave you be. START whenever you want me back 🙂",
  },
];

/**
 * A reply if this is a question about the bot or about their data, otherwise null.
 *
 * Every hit is logged. Somebody asking what we hold on them is worth knowing
 * about, and it is the trail that used to come from blockBypass catching the
 * same words for the wrong reason.
 */
export function aboutReply(text, personId, group) {
  const hit = TOPICS.find((t) => t.re.test(forMatching(text)));
  if (!hit) return null;

  logger.info(
    { actor: personId, topic: hit.name },
    "answered a question about the assistant",
  );

  // it goes by the group whose number they messaged: "Milkman", "All Books"
  return {
    text: hit.reply(groupName(group)),
    offer: hit.offer ? NEXT_STEPS : undefined,
  };
}
