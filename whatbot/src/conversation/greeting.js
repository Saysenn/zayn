import { groupName } from "../tools/format/index.js";
import { forMatching } from "./normalize.js";

/**
 * "hello", "how are you", "cheers" — answered here, not by the model.
 *
 * Three reasons this is code:
 *
 *  - It is instant. A greeting that takes four seconds reads like a machine
 *    looking something up, because that is exactly what it was doing.
 *  - It uses their name and their group, which the model would have to be
 *    trusted to get right every time.
 *  - It ends with choices that actually run. The model's version offered things
 *    and then had no way to follow through, so "tell me now" got the same
 *    non-answer twice.
 */

const GREETING =
  /^(hi|hey+|hello+|helo|yo+|oi|hiya|howdy|good (morning|afternoon|evening)|morning|afternoon|evening|salam|salaam|hola)\b/i;

const HOW_ARE_YOU =
  /\b(how are you|how're you|how r u|how are u|how you doing|how's it going|hows it going|how is it going|you (ok|okay|alright|good|well)|what'?s up|whats up|sup)\b/i;

/**
 * Closing the conversation, not asking for anything.
 *
 * The acknowledgement words — cool, nice, sweet, great, ace — are in here
 * rather than in memory.ts's YES list, which is where they used to be. There,
 * "cool, thank you" counted as accepting the last menu offer and re-sent the
 * breakdown somebody had just thanked us for. Here it gets "Any time" and the
 * conversation ends, which is what they meant.
 *
 * Anchored, but socialOnly strips repeatedly, so a stacked "cool, thanks" is
 * matched a word at a time. Anything with a real question still attached fails
 * socialOnly and never reaches this.
 */
const THANKS =
  /^(thanks|thank you|thx|ty|ta|cheers|nice one|appreciate it|lovely|perfect|brilliant|great stuff|cool|nice|sweet|great|grand|fab|ace|awesome|spot on|no worries|all good|got it|understood)\b/i;

const BYE =
  /^(bye|goodbye|see ya|see you|later|good night|goodnight|nite|ciao|adios)\b/i;

/** "ok thanks", "right, cheers" — the acknowledgement is not the message */
const ACK_BEFORE_THANKS =
  /^(ok(ay)?|alright|right|yeah|yep|fine|good)[\s,.!]+(?=thanks|thank you|thx|ty|ta|cheers|nice one|appreciate it)/i;

/** words that carry no question: "hi there", "thanks mate", "hello again" */
const FILLER =
  /\b(there|mate|pal|buddy|guys?|folks|all|again|bot|please|just|so|doing|going|today|tonight|are|is|it|u)\b/gi;

const SOCIAL = [HOW_ARE_YOU, GREETING, THANKS, BYE];

/**
 * Is this message ONLY pleasantries?
 *
 * A word count used to decide this, and "morning, which company pays me most"
 * is exactly six words — so it was answered with "Hi Sam, how's your day?" and
 * the actual question was thrown away. Length was never the thing that
 * mattered. What matters is whether anything is left once the hellos are
 * taken out.
 */
function socialOnly(text) {
  let left = text;

  for (let pass = 0; pass < SOCIAL.length; pass++) {
    for (const re of SOCIAL) {
      left = left.replace(re, " ").replace(/^[\s,.!?]+/, "");
    }
  }

  return left.replace(FILLER, " ").replace(/[^a-z0-9]/gi, "") === "";
}

/**
 * The three things anybody actually wants. Same every time on purpose — a menu
 * that reshuffles is a menu you have to read twice.
 *
 * Shown ONCE, on the first message of a thread, and never again. It is genuinely
 * useful to somebody who has never used this before and has no idea what to ask.
 * Stapled to the bottom of every hello, every thanks and every goodbye, it is
 * the single thing that makes the whole conversation read like a machine.
 */
function menu() {
  return {
    prompt: "What do you need?",
    choices: [
      { label: "What I'm owed this month", ask: "show me my full breakdown" },
      { label: "Just my total", ask: "what is my total this month?" },
      { label: "Which companies I'm on", ask: "how many companies am I on?" },
    ],
  };
}

/**
 * A reply, or null if this is a real question the agent should handle.
 *
 * Deliberately narrow. "hi, what am I owed?" is a question with a greeting on
 * the front and belongs to the agent — answering that with "hello!" and nothing
 * else is exactly what makes people give up on a bot.
 *
 * `firstContact` is whether this thread has any history yet. Somebody saying
 * hello for the tenth time this month does not need the menu again, and getting
 * it anyway is what makes a bot feel like a bot.
 */
export function greetingReply(text, ctx, opts = { firstContact: false }) {
  /**
   * "ok thanks" is a thank-you with a throat-clear in front of it.
   *
   * Stripped rather than added to THANKS, because a bare "ok" is not a closer —
   * after "Want your full breakdown?" it means yes, and memory.ts must keep it.
   * Only the acknowledgement immediately before a thanks word goes.
   */
  const t = forMatching(text).replace(ACK_BEFORE_THANKS, "");

  // a hello with a real question attached belongs to the agent. answering
  // "hi, what am I owed?" with "hello!" is what makes people give up on a bot
  if (!socialOnly(t)) return null;

  const firstName =
    ctx.person.personName.split(" ")[0] ?? ctx.person.personName;

  /**
   * None of these carry a menu.
   *
   * Two of them ask the other person a question, and a message that asks
   * "how's your day?" and then lists three options in the same breath is not
   * waiting for an answer. It is a form with a greeting on top.
   */
  if (BYE.test(t)) {
    return { text: `Take care \u{1F44B} I'm here whenever you need me.` };
  }

  if (THANKS.test(t)) {
    return { text: `Any time \u{1F642}` };
  }

  // asked BEFORE the plain greeting, so "hey how are you" gets the warmer one
  if (HOW_ARE_YOU.test(t)) {
    return {
      text: `Not bad at all thanks for asking \u{1F60A} how's your day going?`,
    };
  }

  if (GREETING.test(t)) {
    // the one place the menu earns its keep: they have never asked us anything
    if (opts.firstContact) {
      // it introduces itself by the group whose number they messaged
      return {
        text: `Hi ${firstName} \u{1F44B} ${groupName(ctx.channelGroup)} here.`,
        offer: menu(),
      };
    }
    return { text: `Hi ${firstName} \u{1F44B} how's your day?` };
  }

  return null;
}
