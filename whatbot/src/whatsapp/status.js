import { redis, withRedisTimeout } from "../system/redis.js";
import { logger } from "../system/logger.js";

/**
 * Which numbers are connected right now.
 *
 * The sockets live in the worker, but /ready is served by the web process —
 * different processes, so the answer has to go through Redis.
 *
 * Without this, a number that's been unlinked for a week looks exactly like a
 * working one, and you find out when an employee mentions the bot went quiet.
 */
const KEY = "whatsapp:connected";

/**
 * The key expires by itself.
 * A dead worker can't tell us it's dead, so instead it just stops refreshing
 * and this ages out. Otherwise the last "everything's fine" it wrote would sit
 * there reassuring us forever.
 */
const TTL_SECONDS = 120;

export async function publishStatus(groupId, connected) {
  try {
    await withRedisTimeout(
      redis
        .multi()
        .hset(KEY, groupId, connected ? "1" : "0")
        .expire(KEY, TTL_SECONDS)
        .exec(),
    );
  } catch (err) {
    // never let the status check break the thing it's checking
    logger.debug({ err, groupId }, "could not publish whatsapp status");
  }
}

/** nothing recorded = the worker hasn't reported lately = treat it as down */
export async function readStatus() {
  try {
    const raw = await withRedisTimeout(redis.hgetall(KEY));
    return Object.fromEntries(
      Object.entries(raw ?? {}).map(([g, v]) => [g, v === "1"]),
    );
  } catch {
    return {};
  }
}
