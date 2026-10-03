import { aboutReply } from "./about.js";
import { escalate } from "./escalate.js";
import { outOfScopeReply } from "./outOfScope.js";
import { blockBypass } from "./blockBypass.js";
import { greetingReply } from "./greeting.js";
import { jokeReply, moodReply, personalReply } from "./banter.js";

/**
 * Everything answered in code, before the model is called.
 *
 * ORDER IS THE WHOLE FILE. Each handler is narrow, but they overlap at the
 * edges, and which one wins decides whether somebody in trouble gets help or
 * gets a joke. `routing.test.ts` asserts this order — change it there too.
 *
 * Returns null when nothing claimed the message, which means the model answers.
 */

export async function scriptedReply(text, c) {
  const { ctx, firstName, firstContact } = c;
  const { personId } = ctx.person;

  /**
   * 1. Somebody who needs a person, not a lookup.
   *
   * FIRST, because these are the messages where being answered by the wrong
   * thing does the most damage. "I can't pay my rent" must never be met with a
   * joke, a menu, or a cheerful line about their breakdown.
   */
  const escalation = await escalate(text, personId, ctx.channelGroup);
  if (escalation) return escalation;

  /**
   * 2. "Who are you?", "is this a scam?", "who can see my pay?"
   *
   * Before blockBypass on purpose. "Will you ever ask me for my password?" is a
   * careful person doing the right thing, and blockBypass sees the word
   * password and treats them as an attacker. Nothing here reveals anything
   * either way: every reply is fixed text with no data in it.
   */
  const about = aboutReply(text, personId, ctx.channelGroup);
  if (about) return about;

  /**
   * 3. Somebody trying to talk their way past the rules.
   *
   * Answered before the model gets it — not because the model would leak
   * anything (it cannot; scope is computed before this runs, and the tools only
   * ever read this caller's rows) but because playing along looks broken, and
   * because an attempt is worth a log line.
   */
  const blocked = blockBypass(text, personId);
  if (blocked) return { text: blocked, plain: true };

  // 4. Jokes before greetings — "hey, tell me a joke" is a joke request, not a hello
  const joke = jokeReply(text, c.history ?? []);
  if (joke) return { text: joke, plain: true };

  // 5. A greeting is not a question. Instant, uses their name, and the one
  //    place the menu earns its keep — on a thread with no history
  const hello = greetingReply(text, ctx, { firstContact });
  if (hello) return hello;

  // 6. Then how their day is going — after greetings, since "good morning"
  //    contains "good" and is a hello, not a mood
  const mood = moodReply(text, firstName);
  if (mood) return { text: mood, plain: true };

  /**
   * 7. "Am I handsome?", "do you like me?", "how old are you?"
   *
   * Deflected rather than left to the model. A payroll bot offering opinions on
   * an employee's looks is a liability with no upside, and exactly the kind of
   * reply that ends up in a screenshot.
   */
  const personal = personalReply(text, firstName);
  if (personal) return { text: personal, plain: true };

  /**
   * 8. Things this bot genuinely cannot do: bank details, tax, payslips, when
   *    the money lands.
   *
   * LAST, because these are the broadest patterns here and the likeliest to
   * catch something they shouldn't, so everything more specific gets first
   * refusal. Still ahead of the model, because a no that comes back differently
   * worded every time reads as though nobody is quite sure.
   */
  const cannotDo = outOfScopeReply(text, personId);
  if (cannotDo) return cannotDo;

  return null;
}
