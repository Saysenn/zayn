/**
 * The bot's lighter side: jokes, and the small talk that isn't a greeting.
 *
 * Kept here, in code, rather than left to the model — for once not because of
 * accuracy, but because an unsupervised model telling jokes to five hundred
 * staff about their wages is a risk nobody needs. These are written, read, and
 * safe.
 *
 * Payroll-flavoured on purpose. A generic joke reads like a chatbot; one about
 * getting paid reads like a colleague.
 */

import { forMatching } from "./normalize.js";

/**
 * One line each. No wind-up, no sign-off.
 *
 * They used to open "I asked the accountant..." and close with "I'll stick to
 * payroll, shall I" — a story with a joke buried in it, then an apology for
 * the joke. Nobody tells a joke like that.
 *
 * Payroll-flavoured on purpose. A generic joke reads like a chatbot; one about
 * getting paid reads like a colleague. British and plain English only — a
 * reference somebody has to be from the right place to get is a joke that
 * lands for some of the workforce and confuses the rest.
 */
const JOKES = [
  // payroll and the sheet — the ones that sound like a colleague
  "I am not skint, I am between paydays.",
  "Payday is my overdraft having a lie down.",
  "I have an emergency fund. It is called Thursday.",
  "I checked my balance, then the weather. Hard to say which was worse.",
  "I am saving up. Currently at the thinking about it stage.",
  "My savings account is a bus stop. Money waits there briefly, then leaves.",
  "I have got champagne taste and a pro rata budget.",
  "Payday and I are in a long distance relationship.",
  'Pro rata is Latin for "you were on holiday, weren\'t you".',
  "A zero day assignment. All of the paperwork, none of the money.",
  "Nothing sobers you up like the gap between the gross and the net.",
  "Cash, bank or crypto. Three different ways to still be waiting.",
  "31 days in the month, 31 reasons to check the sheet.",
  "Spreadsheets never lie. They just wait until Friday to tell you.",
  "The best thing about month end is that it ends.",
  "I would round it up for you, but the sheet is watching.",
  "Every month somebody types over a formula and every month it is nobody.",
  "The sheet has one column for what you earn and one for what you get. They are not friends.",
  "Payroll runs on two things: a spreadsheet, and the hope that nobody opens it.",
  "Your monthly rate is a rumour. Your payable days are the fact.",
  "A director on paper, a rounding error on the sheet.",
  "Somebody somewhere is on 0 payable days and finding out about it right now.",
  "Two rows, same company, same role, different days. Both real. Nobody knows why.",
  "The sheet does not care what you were promised. The sheet cares what is in the sheet.",
  "Half of umbrella payroll is umbrellas and the other half is standing in the rain.",

  // at your expense, gently. asking a payroll bot for jokes earns you this
  "You are asking a spreadsheet for material. That is the joke.",
  "You have got a whole company of people and you came to me. Bleak.",
  "I do payroll and comedy. I am better at one of them and you will never guess which.",
  "It is a Tuesday and you are flirting with a payroll bot. No notes.",
  "You could be working. You are not working.",
  "Somebody is paying you by the day for this conversation, you know.",
];

/**
 * Sometimes it makes them ask twice.
 *
 * A joke machine that fires on demand every single time is a vending machine.
 * Making them work for it now and again is the difference between something
 * with a bit of character and something with a button.
 */
/** the one tease that invites a reply. Answer it with anything and you get
 *  the payoff below, so it is a door rather than a wall. */
const CHALLENGE = "You tell me one first.";

const TEASES = [
  "And why would I? You might fall in love with me if I do 😄",
  "Oh come on. If I do that you'll be laughing all day, and then who does the payroll?",
  "I'm saving my best one. Ask me again and you might get it 😏",
  "Careful what you wish for. My last joke got a standing ovation, from me.",
  CHALLENGE,
];

/**
 * The lead-in for the second ask. It comes WITH a joke, not instead of one.
 *
 * It used to be a two-rung ladder that refused twice more, so getting a joke
 * could take four messages. That is not a gag, it is a broken feature.
 * One tease is the whole joke now.
 */
const GIVING_IN = [
  "Right. Here we go again.",
  "Fine, you have worn me down.",
  "You are not going to stop, are you.",
];

/** if they tell US one first, unprompted. short and a bit rude, or it reads
 *  as a bot congratulating you, which is worse than no joke at all. */
const YOUR_TURN_REPLIES = [
  "haha you are weird. Go on then, my turn:",
  "That was terrible. I respect it. Mine:",
  "I cannot believe that worked. Fine:",
];

/** "tell me a joke", "make me laugh", "got any jokes" */
// jokes? — the plural used to fall through to the model, because \bjoke\b does
// not match "jokes". A voice note says "got any jokes" more often than not.
const WANTS_JOKE =
  /\b(jokes?|something funny|make me laugh|cheer me up|be funny|say something funny|entertain me)\b/i;

/** how they answer "how's your day?" — worth acknowledging rather than ignoring */
const HAVING_A_BAD_DAY =
  /\b(rubbish|terrible|awful|rough|tired|knackered|exhausted|stressed|busy|long day|not great|bad day|could be better|meh)\b/i;

const HAVING_A_GOOD_DAY =
  /\b(good|great|fine|grand|ok|okay|alright|not bad|all good|lovely|brilliant|fantastic|can'?t complain|pretty good|yeah good)\b/i;

/**
 * "and you?", "how about you", "yourself?"
 *
 * They asked a question back. Answering it with a bare "what do you need?" is the
 * single most bot thing in this whole codebase: it hears a pleasantry, ticks it
 * off, and moves to business without noticing it was asked something.
 *
 * A person answers, briefly, and then gets on with it.
 */
const ASKS_BACK =
  /\b(and (you|yourself)|how about you|what about you|you\?|yourself\?|hbu|wbu)\b/i;

/**
 * "Am I handsome?", "do you like me?", "how old are you?"
 *
 * Left to the model these went wherever the model felt like going, and a
 * payroll bot handing out opinions on five hundred employees' looks is a
 * liability with no upside whatsoever. Worse, it is exactly the sort of reply
 * that gets screenshotted.
 *
 * So it deflects warmly and truthfully — it genuinely has never seen them, and
 * it genuinely holds no opinions — then gets back to the job.
 */
const ABOUT_THEM =
  /\b(am i (handsome|pretty|beautiful|good ?looking|attractive|ugly|fat|old)|how do i look|do i look (good|nice|ok|fat|old)|what do i look like|rate me|am i your (favourite|favorite|best))\b/i;

const FEELINGS =
  /\b(do you (like|love|fancy|hate|miss) me|what do you think (of|about) me|are we friends|do you care)\b/i;

const BOT_PERSONAL =
  /\b(how old are you|what'?s your age|are you (single|married|a man|a woman|male|female)|do you have a (girlfriend|boyfriend|family|wife|husband)|where do you live|where are you (from|based)|do you (sleep|eat|dream|get (tired|bored)))\b/i;

/** one at random from a list */
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Every joke gets told once before any of them is told twice.
 *
 * A bag, not a random pick. Random gave the same joke twice running about one
 * time in thirty, and gave you three of the same five all week — which reads
 * as a bot with five jokes rather than thirty.
 *
 * The bag is shared by everyone on every number. That is on purpose: the thing
 * worth preventing is one person hearing a repeat, and they only ever hear
 * their own. It also means the whole workforce is not told the same joke on
 * the same morning.
 */
let bag = [];
let lastToldJoke = null;

function nextJoke() {
  if (bag.length === 0) {
    // refill and shuffle, but never let the new bag open with the joke the
    // old one just closed on
    bag = [...JOKES].sort(() => Math.random() - 0.5);
    if (bag.at(-1) === lastToldJoke) bag.unshift(bag.pop());
  }
  lastToldJoke = bag.pop();
  return lastToldJoke;
}

/**
 * "tell me a joke" — before greetings, so "hey tell me a joke" lands right.
 *
 * Ask once: usually a joke, sometimes a tease. Ask twice: always a joke.
 * Never more than one refusal in a row.
 *
 * Counted off the conversation history, not a module counter — a counter is
 * shared by everyone on every number, so two people would climb each other's.
 */
export function jokeReply(text, history = []) {
  const lastSaid =
    [...history].reverse().find((t) => t.role === "assistant")?.content ?? "";

  // They answered our challenge. Checked BEFORE the joke pattern, because
  // their attempt almost never contains the word "joke". Anything counts:
  // judging whether it was funny is not a job for a regex.
  if (lastSaid === CHALLENGE) {
    const payoff =
      YOUR_TURN_REPLIES[Math.floor(Math.random() * YOUR_TURN_REPLIES.length)];
    return `${payoff}\n\n${nextJoke()}`;
  }

  if (!WANTS_JOKE.test(forMatching(text))) return null;

  // How many times in a row. A real question in between breaks the run, so
  // coming back later is a fresh ask.
  let asks = 1;
  for (const turn of [...history].reverse()) {
    if (turn.role !== "user") continue;
    if (!WANTS_JOKE.test(forMatching(turn.content))) break;
    asks++;
  }

  // First ask: usually just tell them one. A tease now and again is
  // character; a tease most of the time is a vending machine that is broken.
  if (asks === 1) {
    if (Math.random() < 0.3) return pick(TEASES);
    return nextJoke();
  }

  // Second ask: give in, with a lead-in. Every ask after this is just a joke.
  if (asks === 2) return `${pick(GIVING_IN)}\n\n${nextJoke()}`;

  return nextJoke();
}

/**
 * How they answered "how's your day?".
 *
 * Checked AFTER greetings, because "good morning" contains "good" and is very
 * much a hello rather than a report on their morning.
 *
 * Only fires on short messages: "my day was terrible, what am I owed" is a
 * question with a mood attached, and the question is the part that matters.
 */
/** "are you ok?" is a question about US, not a report on their day */
const ABOUT_US =
  /\b(are|r) (you|u)\b|\byou (ok|okay|alright|good|well)\b|\byourself\b/i;

export function moodReply(text, firstName) {
  const t = forMatching(text);
  if (t.split(/\s+/).length > 8) return null;

  /**
   * "Are you okay?" was coming back as "Glad to hear it Nathan".
   *
   * The good-day words include "ok" and "okay", and a question aimed at us
   * contains one. Greeting handles these properly; anything it misses is
   * better off with the model than with a cheerful non-sequitur.
   */
  if (ABOUT_US.test(t) && !ASKS_BACK.test(t)) return null;

  /** they asked back. answer it before anything else, the way a person would */
  const asksBack = ASKS_BACK.test(t);

  if (HAVING_A_BAD_DAY.test(t)) {
    return asksBack
      ? `Ah, sorry to hear that 😔 I'm alright thanks for asking. Let's make this bit easy at least, what do you need?`
      : `Ah, sorry to hear that 😔 Let's make this bit easy at least. What do you need?`;
  }
  if (HAVING_A_GOOD_DAY.test(t)) {
    return asksBack
      ? `Glad to hear it 😄 I'm good thanks, all numbers over here, which suits me fine. Need a hand with anything?`
      : `Glad to hear it 😄 What do you need?`;
  }
  if (asksBack) {
    return `Not bad at all thanks for asking 😊 What do you need?`;
  }
  return null;
}

/**
 * The personal ones. Deflected, never answered.
 *
 * No compliment, no judgement, no invented biography. Every reply is true: it
 * has never seen them, it holds no opinions, and it has no age. Being honest
 * about that is friendlier than playing along, and a great deal safer.
 */
export function personalReply(text, firstName) {
  const t = forMatching(text);
  if (t.split(/\s+/).length > 10) return null;

  if (ABOUT_THEM.test(t)) {
    return `Ha, I've genuinely no idea, I've never seen you 😄 All I get is spreadsheets. Ask someone with eyes and I'll stick to what you're owed.`;
  }
  if (FEELINGS.test(t)) {
    return `You're alright by me 😄 Though in fairness I say that to everybody. What do you need?`;
  }
  if (BOT_PERSONAL.test(t)) {
    // deflects rather than answering. it does not invent a life, and it does
    // not lecture them about what it is either — neither is what they asked
    return `Ha, I keep myself to myself 😄 What do you need?`;
  }
  return null;
}
