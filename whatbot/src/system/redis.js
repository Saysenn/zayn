import { Redis } from "ioredis";
import { env, readinessTimeoutMs } from "../config/index.js";
import { logger } from "./logger.js";

// maxRetriesPerRequest MUST be null or BullMQ breaks — it uses blocking
// commands that ioredis would otherwise give up on
//
// UPSTASH DROPS QUIET SOCKETS (read ECONNRESET, 2026-10-08), and a job whose
// lock could not be renewed through the drop was failed as "stalled". A TCP
// keep-alive every 10s keeps the line warm; no ready check, as Upstash
// advises for BullMQ, so a reconnect is one round trip shorter.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  keepAlive: 10_000,
});

redis.on("error", (err) => logger.error({ err: err.message }, "redis error"));
redis.on("connect", () => logger.info("redis connected"));

/**
 * Wrap EVERY Redis call on a live path in this.
 *
 * Here's the trap: when Redis is down, ioredis doesn't throw an error. It
 * quietly queues your command and waits — forever. So the call never fails, it
 * just never comes back, and whatever was waiting on it hangs too.
 *
 * This turns "hangs forever" into "fails in 2 seconds", which you can handle.
 */
export async function withRedisTimeout(op, timeoutMs = readinessTimeoutMs) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("redis operation timed out")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([op, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function pingRedis(timeoutMs = readinessTimeoutMs) {
  try {
    await withRedisTimeout(redis.ping(), timeoutMs);
    return true;
  } catch {
    return false;
  }
}
