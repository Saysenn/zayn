import { redis, withRedisTimeout } from "../system/redis.js";
import { logger } from "../system/logger.js";

/**
 * One record per person PER GROUP per month.
 *
 * Not per person. Somebody holding companies in Milkman and Indigo gets two
 * messages, from two different numbers, and answers them separately — one can
 * be confirmed while the other is still open. A single record per person would
 * let the first reply close both.
 *
 * This is the whole point of the payday check: "1,043 confirmed, 12 problems,
 * 72 no response" is what payroll wants, plus proof everybody was asked.
 */

const key = (period) => `payday:${period}`;

/** the hash field. group first so a person's two checks never collide. */
export const subjectId = (group, personId) => `${group}|${personId}`;

/**
 * Lets an incoming reply find the check it belongs to.
 *
 * Keyed by number AND group, because one phone can have two checks open at
 * once. The group comes from which of our numbers they replied to, so there is
 * never any guessing about which one they mean.
 */
const openKey = (group, phone) => `payday:open:${group}:${phone}`;

/**
 * They said no, and we asked the obvious follow-up: nothing at all, or the
 * wrong amount? This key is what makes their answer to THAT question mean
 * something, instead of arriving as an ordinary sentence with no memory of
 * what it answers.
 *
 * Separate from openKey rather than a state inside it, because the check
 * itself is genuinely answered by then — 'not_received' is already
 * recorded and already sent to the CRM. This only ever upgrades that to
 * 'partial'. If they never answer, the record stands as it is, which is
 * the honest outcome.
 *
 * Three days, not the fourteen openKey gets. The question was asked
 * seconds ago; a reply three weeks later is a new conversation, and
 * reading it as an answer to a forgotten question is how "wrong number"
 * ends up filed as a short payment.
 */
const clarifyKey = (group, phone) => `payday:clarify:${group}:${phone}`;
const CLARIFY_TTL_SECONDS = 60 * 60 * 24 * 3;

/**
 * The last period this number was asked about, for this group.
 *
 * Reopening an answer needs a period, and the person coming back to change
 * one says "I never got paid", not "regarding 2026-07". The current month
 * is the wrong guess for the case that matters most: someone realising on
 * the 2nd that last month's money never cleared.
 *
 * Ninety days, so a couple of months of second thoughts still land, and a
 * number that leaves the company stops answering for a period nobody is
 * looking at any more.
 */
const lastCheckKey = (group, phone) => `payday:last:${group}:${phone}`;
const LAST_CHECK_TTL_SECONDS = 60 * 60 * 24 * 90;
const OPEN_TTL_SECONDS = 60 * 60 * 24 * 14;

/**
 * Claim the right to message this person, in this group, this month.
 * false = someone beat us.
 *
 * HSETNX rather than "check, then write". With check-then-write two workers
 * running the same job both check, both see nothing, both write, and somebody
 * gets messaged twice about their wages. Let Redis pick the winner instead.
 */
export async function claimSend(period, group, personId) {
  const placeholder = JSON.stringify({
    personId,
    group,
    period,
    outcome: "sent",
    claimedAt: new Date().toISOString(),
  });
  return (
    (await withRedisTimeout(
      redis.hsetnx(key(period), subjectId(group, personId), placeholder),
    )) === 1
  );
}

/** hand the claim back after a failed send, so a retry can pick it up */
export async function releaseClaim(period, group, personId) {
  await withRedisTimeout(redis.hdel(key(period), subjectId(group, personId)));
}

/** write the real record once the message actually went out */
export async function recordSent(rec) {
  const full = { ...rec, outcome: "sent", crmSynced: false };
  await withRedisTimeout(
    redis
      .multi()
      .hset(
        key(rec.period),
        subjectId(rec.group, rec.personId),
        JSON.stringify(full),
      )
      // expires by itself, so a forgotten check can't hang around for months
      .set(openKey(rec.group, rec.phone), rec.period, "EX", OPEN_TTL_SECONDS)
      // outlives the open key on purpose: this is what lets somebody
      // reopen an answer weeks after they gave it
      .set(lastCheckKey(rec.group, rec.phone), rec.period, "EX", LAST_CHECK_TTL_SECONDS)
      .exec(),
  );
}

/** which period was this number last asked about, on this group? */
export async function lastCheckFor(group, phone) {
  try {
    return await withRedisTimeout(redis.get(lastCheckKey(group, phone)));
  } catch (err) {
    logger.error({ err }, "last payday check lookup failed");
    return null;
  }
}

/**
 * Make the numbered options count again, for a check already answered.
 *
 * Only ever called because the person asked to change their answer, so it
 * is a reply to them, not us reopening something on our own initiative.
 * Clears any outstanding follow-up: they're starting the answer again, and
 * a stale clarify key would read their next sentence as an answer to a
 * question that has been superseded.
 */
export async function reopenCheck(period, group, phone) {
  await withRedisTimeout(
    redis
      .multi()
      .set(openKey(group, phone), period, "EX", OPEN_TTL_SECONDS)
      .del(clarifyKey(group, phone))
      .exec(),
  );
  logger.info({ group, period }, "payday check reopened at the person's request");
}

/** is there an open check on this number, for this group? which month? */
export async function openCheckFor(group, phone) {
  try {
    return await withRedisTimeout(redis.get(openKey(group, phone)));
  } catch (err) {
    logger.error({ err }, "open payday check lookup failed");
    return null;
  }
}

/** we asked "nothing at all, or the wrong amount?" — expect an answer */
export async function awaitClarify(period, group, phone) {
  await withRedisTimeout(
    redis.set(clarifyKey(group, phone), period, "EX", CLARIFY_TTL_SECONDS),
  );
}

/** is one of those questions outstanding on this number, for this group? */
export async function clarifyOpenFor(group, phone) {
  try {
    return await withRedisTimeout(redis.get(clarifyKey(group, phone)));
  } catch (err) {
    logger.error({ err }, "payday clarify lookup failed");
    return null;
  }
}

/** answered, or they moved on. either way stop reading their messages as one */
export async function clearClarify(group, phone) {
  await withRedisTimeout(redis.del(clarifyKey(group, phone)));
}

export async function recordReply(
  period,
  group,
  personId,
  phone,
  outcome,
  note,
) {
  const field = subjectId(group, personId);
  const raw = await withRedisTimeout(redis.hget(key(period), field));
  const prev = raw ? JSON.parse(raw) : null;
  if (!prev) return;

  // crmSynced false on every new outcome, cleared to true only once the CRM
  // has actually taken it (payday/crmOutbox.js). The CRM push is
  // fire-and-forget by design — it must never delay a reply to somebody
  // waiting — which used to mean a push lost to an outage was lost for good,
  // silently, with the CRM's Confirmed column and Paid toggle simply never
  // learning. This flag is the memory that lets a later run catch up.
  const next = {
    ...prev,
    outcome,
    repliedAt: new Date().toISOString(),
    note,
    crmSynced: false,
  };

  await withRedisTimeout(
    redis
      .multi()
      .hset(key(period), field, JSON.stringify(next))
      .del(openKey(group, phone))
      .exec(),
  );

  logger.info({ personId, group, period, outcome }, "payday check answered");
}

/**
 * The CRM has this outcome now. Stop retrying it.
 *
 * Reads before writing rather than patching blind: the record may have moved
 * on since the push started (they answered again, a clarify landed), and the
 * flag must attach to whatever the outcome is NOW, never resurrect the one
 * that was in flight.
 */
export async function markCrmSynced(period, group, personId, outcome) {
  const field = subjectId(group, personId);
  const raw = await withRedisTimeout(redis.hget(key(period), field));
  if (!raw) return;

  const rec = JSON.parse(raw);
  // Answered again while the push was in flight. Leave it unsynced so the
  // newer answer gets its own push, rather than marking it done on the
  // strength of the older one.
  if (outcome && rec.outcome !== outcome) return;

  await withRedisTimeout(
    redis.hset(key(period), field, JSON.stringify({ ...rec, crmSynced: true })),
  );
}

/**
 * Everything this period the CRM has not taken yet.
 *
 * `crmSynced !== true` rather than `=== false`, so records written before
 * this flag existed are picked up once instead of being invisible forever.
 */
export async function unsyncedRecords(period) {
  return (await allRecords(period)).filter((r) => r.crmSynced !== true);
}

export async function allRecords(period) {
  const rows = await withRedisTimeout(redis.hgetall(key(period)));
  return Object.values(rows).map((r) => JSON.parse(r));
}

/**
 * Anyone still marked 'sent' after the deadline never replied.
 * Run this before the report so the numbers are final.
 *
 * Returns the records it closed, not just how many. The CRM has to be told
 * about each one (its Confirmed column still says "awaiting reply" until
 * somebody says otherwise), and only this function knows which they were —
 * a second pass over allRecords afterwards couldn't tell the ones closed
 * just now from the ones closed last month.
 */
export async function closeStale(period, afterDays) {
  const cutoff = Date.now() - afterDays * 24 * 60 * 60 * 1000;
  const records = await allRecords(period);
  const closed = [];

  for (const r of records) {
    if (r.outcome !== "sent" || new Date(r.sentAt).getTime() > cutoff) continue;
    await withRedisTimeout(
      redis
        .multi()
        .hset(
          key(period),
          subjectId(r.group, r.personId),
          // crmSynced false for the same reason recordReply sets it: this is
          // a new outcome the CRM has not been told about yet, and the
          // outbox has to be able to find it if that telling fails.
          JSON.stringify({ ...r, outcome: "no_response", crmSynced: false }),
        )
        .del(openKey(r.group, r.phone))
        .exec(),
    );
    closed.push(r);
  }

  if (closed.length > 0)
    logger.info(
      { period, closed: closed.length },
      "payday checks closed as no_response",
    );
  return closed;
}
