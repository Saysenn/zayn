import { redis } from "../system/redis.js";
import { openaiConfig, sessionConfig } from "../config/index.js";

const stateKey = (phone) => `conv:state:${phone}`;
const historyKey = (phone) => `conv:history:${phone}`;
const pendingKey = (phone) => `conv:pending:${phone}`;

/**
 * Where we are in the conversation. Tracked in code, not by the LLM.
 *
 * The "are you satisfied?" step is a state machine here on purpose. An LLM
 * deciding whether its own answer was approved will eventually decide yes when
 * the user said no.
 */
export async function getState(phone) {
  return (await redis.get(stateKey(phone))) ?? "idle";
}

export async function setState(phone, state) {
  if (state === "idle") {
    await redis.del(stateKey(phone));
    return;
  }
  await redis.set(
    stateKey(phone),
    state,
    "EX",
    sessionConfig.conversationTtlSeconds,
  );
}

/**
 * What the numbered choices on the last message mean.
 *
 * When a reply ends with "Want your full Milkman breakdown?", we store the
 * question that offer stands for. Otherwise "yes" reaches the model as a
 * question on its own, and it answers "what else can I help with" — which is
 * exactly as useless as it sounds, and makes the offer look like a fake button.
 *
 * Stored rather than inferred: a model asked "did they accept my offer, and
 * what was it" will eventually get one of those two wrong.
 */
export async function setPendingOffer(phone, choices) {
  await redis.set(
    pendingKey(phone),
    JSON.stringify(choices),
    "EX",
    sessionConfig.conversationTtlSeconds,
  );
}

export async function takePendingOffer(phone) {
  const raw = await redis.get(pendingKey(phone));
  // one shot — an offer taken twice would answer a question nobody asked
  if (raw) await redis.del(pendingKey(phone));
  return raw ? JSON.parse(raw) : null;
}

const ORDINALS = {
  one: 1,
  first: 1,
  "1st": 1,
  two: 2,
  second: 2,
  "2nd": 2,
  three: 3,
  third: 3,
  "3rd": 3,
};

/**
 * Which numbered choice did they pick?
 *
 * People answer a menu with "2", "2.", "number 2", "second one", or by typing
 * the label back. All of those are obvious to a human and none of them are
 * obvious to a model, so they are read here.
 *
 * Returns a 1-based index, or null if this is not a choice at all.
 */
export function classifyChoice(text, labels) {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^(number|option|no\.?)\s+/, "");

  const digit = /^([123])\b/.exec(t);
  if (digit) return Number(digit[1]);

  const word = /^([a-z0-9]+)/.exec(t);
  if (word?.[1] && ORDINALS[word[1]] !== undefined) return ORDINALS[word[1]];

  // they typed the option back at us
  const byLabel = labels.findIndex((l) => l.toLowerCase() === t);
  if (byLabel !== -1) return byLabel + 1;

  return null;
}

export async function clearPendingOffer(phone) {
  await redis.del(pendingKey(phone));
}

export async function appendTurn(phone, turn) {
  await redis.lpush(historyKey(phone), JSON.stringify(turn));
  // each exchange is 2 entries (theirs + ours), so keep double the turn count
  await redis.ltrim(historyKey(phone), 0, openaiConfig.historyTurns * 2 - 1);
  await redis.expire(historyKey(phone), sessionConfig.conversationTtlSeconds);
}

/** oldest first, which is the order the OpenAI messages array wants */
export async function getHistory(phone) {
  const rows = await redis.lrange(
    historyKey(phone),
    0,
    openaiConfig.historyTurns * 2 - 1,
  );
  return rows.reverse().map((r) => JSON.parse(r));
}

export async function clearConversation(phone) {
  await redis.del(stateKey(phone), historyKey(phone), pendingKey(phone));
}

/**
 * Yes, including the ways people say it without saying it.
 *
 * A real exchange: the bot said "I can show you what you're owed", and the
 * reply was "okay enlighten me", then "tell me now". Both are plainly yes, both
 * were treated as brand new questions, and the bot repeated the same offer
 * twice. Nothing annoys somebody faster than being asked again for a yes they
 * already gave.
 */
/**
 * Words that accept the offer that was just made.
 *
 * Gratitude used to be in here — "thanks", "cheers", "cool", "lovely",
 * "perfect". It is not acceptance, it is the opposite: somebody closing the
 * conversation. "cool, thank you" was matching, the thanks was stripped as
 * filler, and the empty remainder took the FIRST menu choice — so saying thank
 * you for a breakdown got you the breakdown again. Those words live in
 * greeting.ts now, which answers them and stops.
 *
 * "ok" and "sure" stay. After "Want your full breakdown?" they plainly mean yes.
 */
const YES =
  /^(y|yes|yeah|yep|yeh|aye|ok|okay|sure|go on|go ahead|please do|do it|show me|tell me|let'?s see|enlighten me|hit me|why not|of course|definitely)\b/i;
const NO = /^(n|no|nope|nah|not really|not quite|wrong|incorrect)\b/i;

/**
 * Words people tack on the end that carry no request of their own.
 *
 * "tell me now" is a bare yes with an urgency word on it. Left in, "now"
 * becomes the question, goes to the model, and gets answered with the same
 * refusal that prompted it — which is exactly what happened.
 */
const FILLER =
  /^(now|then|please|pls|plz|mate|man|bro|sir|thanks|thank you|ta|cheers|ok|okay|go|already|asap|quick|quickly|for me|to me)\b[\s,.!]*$/i;

/**
 * Work out yes / no / something else — in code, no LLM involved.
 *
 * We keep whatever they tacked on the end, because people answer and ask in one
 * breath: "no, show me their deductions". Throwing away the second half makes
 * the bot look like it ignored them.
 */
export function classifyReply(text) {
  const t = text.trim();

  for (const [verdict, re] of [
    ["yes", YES],
    ["no", NO],
  ]) {
    const m = re.exec(t);
    if (!m) continue;
    let rest = t
      .slice(m[0].length)
      .replace(/^[\s,.:;!\-–—]+/, "")
      .trim();

    /**
     * Keep stripping. People stack these: "okay enlighten me", "yeah go on
     * then". Strip once and the leftover ("enlighten me") looks like a fresh
     * question, gets sent to the model, and earns the same reply they were
     * trying to get past.
     */
    for (;;) {
      if (FILLER.test(rest)) {
        rest = "";
        break;
      }
      const again = re.exec(rest) ?? YES.exec(rest);
      if (!again || again.index !== 0) break;
      rest = rest
        .slice(again[0].length)
        .replace(/^[\s,.:;!\-–—]+/, "")
        .trim();
    }

    return { verdict, rest };
  }

  return { verdict: "other", rest: t };
}

/**
 * What a bare "yes" or "2" actually means.
 *
 * The last reply may have ended with an offer — "Want your full Milkman
 * breakdown?". A bare "yes" means nothing to a model: it sees the word, has no
 * idea what was accepted, and answers "what else can I help with", which makes
 * the offer look like a button that does not work.
 *
 * So the offer stored the question it stands for, and picking it becomes that
 * question. From here on it is an ordinary request and the tool runs.
 *
 * `declined` is the one case the caller handles differently: they said no, and
 * offered nothing in its place.
 */

export async function resolveOffer(phone, text) {
  const pending = await takePendingOffer(phone);
  if (!pending || pending.length === 0) return { question: text };

  // "2", "second", or the option typed back
  const picked = classifyChoice(
    text,
    pending.map((c) => c.label),
  );
  if (picked && pending[picked - 1])
    return { question: pending[picked - 1].ask };

  const { verdict, rest } = classifyReply(text);

  // a plain yes takes the first choice — it is the obvious one
  if (verdict === "yes") return { question: rest || pending[0].ask };
  if (verdict === "no") return rest ? { question: rest } : { declined: true };

  // anything else is a new question and the offer simply lapses
  return { question: text };
}
