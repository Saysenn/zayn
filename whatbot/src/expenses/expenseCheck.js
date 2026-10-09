import { redis, withRedisTimeout } from "../system/redis.js";
import { logger } from "../system/logger.js";
import { answerExpenseCheck, startExpenseCheck } from "../system/crmClient.js";
import { REOPEN_INTENT } from "../payday/paydayMessages.js";

/**
 * THE EXPENSES CHECK (his calls 2026-10-08). Expenses are refunded apart
 * from pay, so payday asks about them on their own: "Your expenses: 6 · AED
 * 1,240. Refunded? Reply yes or no."
 *
 * Sent as its own message RIGHT AFTER a person answers their payday check,
 * the same day, never cold. That keeps the never-message-first rule: the
 * payday check stays the only paced unprompted send, and this is a reply.
 * Someone who never answers payday is never asked; their expenses stay
 * unsettled and the CRM flags them for the admin from the 1st.
 *
 * The CRM owns all of it: what to list, the text, what a yes settles. Here
 * is only which question is open on this number, and reading the answer.
 */

// open on this number, for this group: which check (14 days, like payday)
const openKey = (group, phone) => `expcheck:open:${group}:${phone}`;
// the last one answered, for "sorry, that was a mistake" (14 days)
const lastKey = (group, phone) => `expcheck:last:${group}:${phone}`;
const TTL_SECONDS = 60 * 60 * 24 * 14;
// "sorry, I meant no" right after answering it is about THIS question
const RECENT_MS = 24 * 60 * 60 * 1000;

const THANKS = "(?:[,!.\\s]+(?:thanks|thank you|thx|ty|cheers|all good))?";
const YES_WORDS = new RegExp(`^(?:y|ya|ye|yes+|yeah|yea|yep|yup|ok(?:ay)?|sure|correct|sige|oo|haan|ji|refunded|received|got (?:it|them)|all (?:refunded|received)|yes,? (?:refunded|received|all|i (?:did|have)))${THANKS}[.!👍]*$|^👍$`, "i");
const NO_WORDS = new RegExp(`^(?:n|no+|nope|nah|not yet|not refunded|none|nothing|no,? not (?:yet|refunded|received))${THANKS}[.!]*$`, "i");
const PARTIAL_WORDS = /\b(?:partial|partly|some of (?:it|them)|some (?:were|was|of the)|only (?:some|part|a few|one|two|half)|half of (?:it|them)|not all(?: of (?:it|them))?|part of (?:it|them))\b/i;
const MISTAKE = /\b(?:mistake|by mistake|wrong(?:ly)?|i meant|meant (?:to say )?(?:no|yes)|didn'?t mean|sorry,? (?:no|not)|not (?:actually )?refunded|haven'?t been refunded|wasn'?t refunded)\b/i;
const ABOUT_EXPENSES = /\b(?:expenses?|refund(?:ed|s)?|reimburs\w*)\b/i;

/** "yes" / "no" / "partial", or "other" for anything else (a real question). */
export function expenseAnswer(text) {
  const t = String(text ?? "").trim();
  if (!t) return "other";
  if (PARTIAL_WORDS.test(t) && t.length <= 80) return "partial";
  if (YES_WORDS.test(t)) return "yes";
  if (NO_WORDS.test(t)) return "no";
  return "other";
}

/**
 * Asked right after their payday answer: the CRM's question to send next,
 * or null (switch off, nothing to refund, CRM away). Never throws: a payday
 * answer is never lost to this.
 */
export async function expenseCheckAfterPayday(person, group, phone, period) {
  try {
    const got = await startExpenseCheck({ period, personId: person.personId, group, phone, name: person.personName });
    if (!got?.check?.id || !got.text) return null;
    await withRedisTimeout(redis.set(openKey(group, phone), String(got.check.id), "EX", TTL_SECONDS));
    return got.text;
  } catch (err) {
    logger.warn({ err: err.message, group }, "expenses check: could not be asked");
    return null;
  }
}

async function readKey(k) {
  try {
    return await withRedisTimeout(redis.get(k));
  } catch (err) {
    logger.error({ err }, "expenses check lookup failed");
    return null;
  }
}

/**
 * THEIR ANSWER, when one is open: yes / no / partial go to the CRM, which
 * says what to send back. "Sorry, that was a mistake" soon after a yes goes
 * to the admin. Null when this message is not about the check.
 */
export async function answerExpenseCheckIfOpen(group, phone, text) {
  const open = await readKey(openKey(group, phone));
  if (open) {
    const answer = expenseAnswer(text);
    if (answer === "other") return null;
    const out = await answerExpenseCheck({ checkId: Number(open), phone, group, answer, note: answer === "yes" ? null : text });
    if (!out) return "Sorry, I couldn't note that just now. Please reply again in a minute.";
    await withRedisTimeout(
      redis.multi()
        .del(openKey(group, phone))
        .set(lastKey(group, phone), JSON.stringify({ checkId: Number(open), answer, at: Date.now() }), "EX", TTL_SECONDS)
        .exec(),
    );
    logger.info({ group, answer }, "expenses check answered");
    return out.reply ?? "Thanks, noted.";
  }
  // A CHANGE OF MIND after a yes: about the expenses when they say so, or
  // when this was the question they answered last, a moment ago
  const raw = await readKey(lastKey(group, phone));
  if (!raw) return null;
  const last = JSON.parse(raw);
  const recent = Date.now() - Number(last.at ?? 0) < RECENT_MS;
  if (last.answer !== "yes") return null;
  // "sorry, I meant no" just after it, or anything naming the expenses; a
  // pay complaint ("I didn't receive my pay") stays the payday check's
  const aboutThis = (MISTAKE.test(text) && (ABOUT_EXPENSES.test(text) || recent)) || (REOPEN_INTENT.test(text) && ABOUT_EXPENSES.test(text));
  if (!aboutThis) return null;
  const out = await answerExpenseCheck({ checkId: last.checkId, phone, group, answer: "mistake", note: text });
  if (!out) return "Sorry, I couldn't note that just now. Please reply again in a minute.";
  await withRedisTimeout(redis.set(lastKey(group, phone), JSON.stringify({ ...last, answer: "mistake", at: Date.now() }), "EX", TTL_SECONDS));
  logger.info({ group }, "expenses check: a yes taken back, for the admin");
  return out.reply ?? "Thanks, the team will look at it.";
}
