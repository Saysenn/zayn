import { describe, expect, it, vi } from "vitest";

vi.mock("../system/redis.js", () => ({ redis: {}, withRedisTimeout: (op) => op() }));
vi.mock("../system/logger.js", () => ({ logger: { info: () => {}, warn: () => {} } }));

const { sendOnce } = await import("./sendOnce.js");

const memory = () => {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); return "OK"; }, m };
};
const guard = (op) => op();

describe("sendOnce: a retried job never sends a part twice", () => {
  it("a retry skips the parts already sent and sends the rest", async () => {
    const store = memory();
    const sent = [];
    // first try: part 1 goes, part 2 throws (WhatsApp dropped)
    const first = sendOnce("MSG1", { store, guard });
    await first(async () => sent.push("picture"));
    await expect(first(async () => { throw new Error("not connected"); })).rejects.toThrow();
    // the retry: same parts in the same order
    const retry = sendOnce("MSG1", { store, guard });
    await retry(async () => sent.push("picture"));
    await retry(async () => sent.push("notes"));
    expect(sent).toEqual(["picture", "notes"]);
  });

  it("a part that failed is tried again, never marked as sent", async () => {
    const store = memory();
    const once = sendOnce("MSG2", { store, guard });
    await expect(once(async () => { throw new Error("boom"); })).rejects.toThrow();
    expect(store.m.size).toBe(0);
  });

  it("no message id: always sent, nothing marked", async () => {
    const store = memory();
    const sent = [];
    const once = sendOnce(undefined, { store, guard });
    await once(async () => sent.push(1));
    await sendOnce(undefined, { store, guard })(async () => sent.push(2));
    expect(sent).toEqual([1, 2]);
    expect(store.m.size).toBe(0);
  });

  it("Redis down: still sent (a lost mark costs a duplicate, never a lost reply)", async () => {
    const down = { get: async () => { throw new Error("timeout"); }, set: async () => { throw new Error("timeout"); } };
    const sent = [];
    await sendOnce("MSG3", { store: down, guard })(async () => sent.push("text"));
    expect(sent).toEqual(["text"]);
  });

  it("the key has no colon from the message id (BullMQ / jobIdOf)", async () => {
    const store = memory();
    await sendOnce("a:b", { store, guard })(async () => {});
    expect([...store.m.keys()]).toEqual(["sent:a-b-1"]);
  });
});
