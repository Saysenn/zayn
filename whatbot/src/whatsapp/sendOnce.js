import { redis, withRedisTimeout } from "../system/redis.js";
import { jobIdOf } from "../system/jobId.js";
import { logger } from "../system/logger.js";

/**
 * ===============================
 * * EACH PART OF A REPLY IS SENT ONCE, EVEN WHEN THE JOB RUNS AGAIN
 * ===============================
 * The inbound job is retried (attempts: 3). Anything that threw AFTER the
 * first bubble went out (WhatsApp dropping mid reply, a Redis timeout in the
 * bookkeeping, a stalled job on a slow PC) re-ran the whole job, and the
 * person got the whole reply again (tb_logs 2026-10-09 02:11–02:13).
 *
 * Every send in one job is numbered in order (the reply is built the same
 * way each time, so part 3 is always part 3). A part is marked sent in
 * Redis only AFTER it went: a retry skips what was marked, and a send that
 * failed is tried again. Kept a day, so the mark outlives any retry.
 *
 * No message id (a payday send, a test) means no mark: sent as before.
 * Redis down means sent as before too: a lost mark costs a duplicate, a
 * wrong one would cost a reply nobody gets.
 */
const DAY = 24 * 60 * 60;

export function sendOnce(messageId, { store = redis, guard = withRedisTimeout } = {}) {
  let part = 0;
  return async function once(send) {
    part += 1;
    if (!messageId) return send();
    const key = `sent:${jobIdOf(messageId, part)}`;
    // withRedisTimeout takes the PROMISE, not a function (a function came back
    // as "already sent" and every reply was skipped, 2026-10-10)
    const done = await guard(store.get(key)).catch(() => null);
    if (done) {
      logger.info({ messageId, part }, "already sent on an earlier try, skipped");
      return undefined;
    }
    const out = await send();
    await guard(store.set(key, "1", "EX", DAY)).catch((err) => logger.warn({ err: err?.message, messageId, part }, "could not mark a part as sent"));
    return out;
  };
}
