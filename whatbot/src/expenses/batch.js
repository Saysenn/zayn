import { redis, withRedisTimeout } from "../system/redis.js";

/**
 * SEVERAL PHOTOS OR FILES SENT AT ONCE ARE ONE BATCH, ONE REPLY.
 *
 * His call 2026-10-07: WhatsApp delivers ten receipts as ten messages, and
 * the bot answered every one, each asking yes or no. Now each file is
 * numbered as it ARRIVES (receiveMessage), parked here as it is processed,
 * and only the LAST one of a burst answers: it waits a moment for more,
 * then hands every parked file to the CRM in one turn. The others say
 * nothing at all.
 *
 * Arrival order, not processing order: the worker runs several jobs at
 * once, so "the last to arrive" is the only one everybody agrees on.
 */

const QUIET_MS = 6000;
const KEEP_S = 60 * 60;
const seqKey = (phone, group) => `expense-batch-seq:${phone}:${String(group).toUpperCase()}`;
const listKey = (phone, group) => `expense-batch:${phone}:${String(group).toUpperCase()}`;
const ackKey = (phone, group) => `expense-batch-ack:${phone}:${String(group).toUpperCase()}`;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Numbered when it arrives, before the queue: the order the phone sent them. */
export async function arrived(phone, group) {
  const key = seqKey(phone, group);
  const seq = await withRedisTimeout(redis.incr(key));
  await withRedisTimeout(redis.expire(key, KEEP_S));
  return seq;
}

/**
 * THE FIRST FILE OF A BURST SAYS "GOT IT", once (his call 2026-10-07: after
 * sending files the bot sat silent while it read them). True for the first
 * file only; the flag clears when the burst is answered, so the next burst
 * says it again.
 */
export async function firstOfBurst(phone, group) {
  const set = await withRedisTimeout(redis.set(ackKey(phone, group), "1", "EX", 120, "NX"));
  return set === "OK";
}

/**
 * Park this file; answer only if it is the last of the burst.
 * @returns {Promise<null | { attachments: object[], text: string, count: number }>}
 *   null means "another file came after this one: say nothing".
 */
export async function collect({ phone, group, seq, attachments, text, quietMs = QUIET_MS }) {
  const list = listKey(phone, group);
  await withRedisTimeout(redis.rpush(list, JSON.stringify({ seq, attachments, text: text ?? "" })));
  await withRedisTimeout(redis.expire(list, KEEP_S));
  const latest = async () => Number(await withRedisTimeout(redis.get(seqKey(phone, group))));

  if ((await latest()) > seq) return null;
  await sleep(quietMs);
  if ((await latest()) > seq) return null;

  // THE LAST ONE: take the whole burst, in the order it was sent.
  const raw = await withRedisTimeout(redis.lrange(list, 0, -1));
  await withRedisTimeout(redis.del(list, ackKey(phone, group)));
  const parts = raw.map((r) => JSON.parse(r)).sort((a, b) => a.seq - b.seq);
  return {
    attachments: parts.flatMap((p) => p.attachments ?? []),
    // captions kept, in order; the same caption twice is said once
    text: [...new Set(parts.map((p) => p.text.trim()).filter(Boolean))].join("\n"),
    count: parts.length,
  };
}
