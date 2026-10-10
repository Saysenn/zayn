import { redis, withRedisTimeout } from "./redis.js";
import { logger } from "./logger.js";

const KEY = "optout";

/**
 * THE WHOLE MESSAGE, never its first word. Matching "end" at the start of
 * any sentence meant "end date of my contract?" opted them OUT, and "start
 * dates for my companies" opted them back in with a "Welcome back" (found
 * by the payments eval, 2026-10-07). A word or two of politeness is fine.
 */
const TAIL = String.raw`(?:\s+(?:please|pls|now|it|all|messages|texting|texting me|messaging me|again|thanks|thank you))*[.!\s]*$`;
// NOT "cancel" OR "end" (break test 2026-10-10): on WhatsApp they cancel a
// preview or end a chat, and an expense admin's "cancel" opted them out of
// every message, silently. Only words that can only mean "stop messaging me".
const STOP = new RegExp(String.raw`^(stop|unsubscribe|quit|stopall)${TAIL}`, "i");
const START = new RegExp(String.raw`^(start|unstop|resume|subscribe)${TAIL}`, "i");

/** run before anything else, so STOP is never treated as a question */
export function optOutIntent(text) {
  const t = text.trim();
  if (STOP.test(t)) return "stop";
  if (START.test(t)) return "start";
  return null;
}

export async function setOptedOut(phone, out) {
  if (out) await withRedisTimeout(redis.sadd(KEY, phone));
  else await withRedisTimeout(redis.srem(KEY, phone));
  logger.info(
    { phone: `${phone.slice(0, 6)}***`, optedOut: out },
    "opt-out state changed",
  );
}

/**
 * Has this person opted out?
 *
 * If Redis is down we answer YES — we can't prove they didn't opt out, and
 * messaging someone who asked you to stop is what gets a number reported and
 * eventually banned. Silence is the safer way to fail.
 *
 * But silence is also invisible. They get no reply, no error, nothing, and you
 * only find out from the logs. One slow round trip shouldn't cause that, so it
 * retries once first. This is not theoretical — a single Upstash timeout in
 * testing silently binned a perfectly good question.
 */
export async function isOptedOut(phone) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await withRedisTimeout(redis.sismember(KEY, phone))) === 1;
    } catch (err) {
      if (attempt === 0) {
        logger.warn({ err }, "opt-out check timed out — retrying");
        continue;
      }
      logger.error(
        { err },
        "opt-out check failed twice — treating as opted out, message dropped",
      );
    }
  }
  return true;
}

export const OPT_OUT_MESSAGES = {
  /**
   * Says how to come back, in the same breath. Someone who opts out of the
   * monthly check often still wants to ask about their pay later, and if the
   * only route back is "have a word with HR" they simply never return.
   */
  stopped: [
    "No problem, I won't message you again.",
    "",
    "Just type START if you want payday updates back on. You can also have a word with HR.",
  ].join("\n"),
  started:
    "Welcome back \u{1F44B} Ask me anything about your pay whenever you like.",
};
