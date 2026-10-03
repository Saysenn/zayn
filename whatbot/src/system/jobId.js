/**
 * Builds a job ID BullMQ will actually accept.
 *
 * BullMQ throws `Custom Id cannot contain :` — it builds its own Redis keys
 * with colons and a colon in the ID would collide with them. The payday send
 * used `payday:<period>:<group>:<person>` and threw on the first real send;
 * dry runs return before the enqueue, so nothing caught it for months.
 *
 * Every dedupe key in this codebase goes through here. The parts are joined
 * with `-`, which is safe, and any colon inside a part becomes `-` too — that
 * matters for WhatsApp message IDs, which we don't control.
 *
 * Same inputs must always give the same ID: that identity IS the idempotency.
 * Do not add anything time-varying to a call.
 */
export function jobIdOf(...parts) {
  return parts.map((p) => String(p).replace(/:/g, "-")).join("-");
}
