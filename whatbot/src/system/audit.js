import { env } from "../config/index.js";
import { redis } from "./redis.js";
import { logger } from "./logger.js";
import { postgresAudit } from "./auditDatabase.js";

const REDIS_KEY = "audit:log";
const MAX_ENTRIES = 50_000;

/**
 * Dev only. Redis is a CACHE — it evicts things, it's capped, it isn't durable.
 * An audit log that quietly deletes itself is not an audit log.
 * Set AUDIT_STORE=postgres before go-live.
 */
const redisAudit = {
  async write(entry) {
    // one round trip, not two. Redis latency is most of the per-message time.
    await redis
      .multi()
      .lpush(REDIS_KEY, JSON.stringify(entry))
      .ltrim(REDIS_KEY, 0, MAX_ENTRIES - 1)
      .exec();
  },
  async recent(limit) {
    const rows = await redis.lrange(REDIS_KEY, 0, limit - 1);
    return rows.map((r) => JSON.parse(r));
  },
};

const store = env.AUDIT_STORE === "postgres" ? postgresAudit : redisAudit;

/**
 * Write down who looked at whose payslip.
 *
 * Needed from day one — payroll access without a trail is a problem waiting to
 * happen. Never throws: a broken audit log shouldn't break someone's question,
 * but it should be very loud in the logs.
 */
export async function record(entry) {
  const full = { at: new Date().toISOString(), ...entry };

  // always log, whatever the store did — this is the backup trail.
  // the saved record keeps every name; the log line truncates. one HR question
  // touches 1,128 people and printing them all buries everything else.
  const MAX_LOGGED = 8;
  logger.info(
    {
      audit: {
        ...full,
        subjects:
          full.subjects.length > MAX_LOGGED
            ? [
                ...full.subjects.slice(0, MAX_LOGGED),
                `…+${full.subjects.length - MAX_LOGGED} more`,
              ]
            : full.subjects,
        subjectCount: full.subjects.length,
      },
    },
    "tool call",
  );

  try {
    await store.write(full);
  } catch (err) {
    logger.error({ err, audit: full }, "AUDIT WRITE FAILED");
  }
}

export const recent = (limit = 50) => store.recent(limit);
