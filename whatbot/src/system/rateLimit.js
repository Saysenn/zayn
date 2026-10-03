import { env } from "../config/index.js";
import { redis, withRedisTimeout } from "./redis.js";
import { logger } from "./logger.js";

/**
 * Count how many messages someone has sent this minute / today.
 *
 * Every message costs two OpenAI calls, so someone hammering the bot is a bill.
 *
 * Fixed windows rather than a proper sliding window — simpler, cheaper, and the
 * only downside (a burst landing right on a window boundary) doesn't matter for
 * a payroll bot.
 */
async function bump(key, ttlSeconds) {
  const [incr] = await withRedisTimeout(
    redis.multi().incr(key).expire(key, ttlSeconds, "NX").exec(),
  );

  return incr?.[1] ?? 0;
}

export async function checkRateLimit(phone) {
  try {
    const minuteKey = `rl:min:${phone}:${Math.floor(Date.now() / 60_000)}`;
    const dayKey = `rl:day:${phone}:${new Date().toISOString().slice(0, 10)}`;

    const perMinute = await bump(minuteKey, 120);
    if (perMinute > env.RATE_LIMIT_PER_MINUTE) {
      return { allowed: false, reason: "minute" };
    }

    const perDay = await bump(dayKey, 60 * 60 * 26);
    if (perDay > env.RATE_LIMIT_PER_DAY) {
      return { allowed: false, reason: "day" };
    }

    return { allowed: true };
  } catch (err) {
    // Redis down: allow rather than lock everyone out. The message will fail
    // later anyway if Redis is genuinely unavailable.
    logger.error({ err }, "rate limit check failed — allowing");
    return { allowed: true };
  }
}

/**
 * Forget this number's recent messages.
 *
 * For scripted runs only — `npm run smoke` asks one person nine questions in
 * under a minute, which is exactly what the per-minute limit exists to stop.
 * Without this the last few cases come back as a rate-limit message and look
 * like the bot failing.
 *
 * Never called from the message path.
 */
export async function clearRateLimit(phone) {
  const minuteKey = `rl:min:${phone}:${Math.floor(Date.now() / 60_000)}`;
  const dayKey = `rl:day:${phone}:${new Date().toISOString().slice(0, 10)}`;
  await redis.del(minuteKey, dayKey);
}

export const RATE_LIMIT_MESSAGES = {
  minute: "Steady on, I can't keep up! Give me a minute and ask me again.",
  day: "That's all I can manage today, sorry. I'll be back to normal tomorrow, or speak to HR if it's urgent.",
};
