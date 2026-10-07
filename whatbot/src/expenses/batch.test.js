import { describe, expect, it, vi } from "vitest";

const kv = new Map();
const lists = new Map();
vi.mock("../system/redis.js", () => ({
  redis: {
    incr: async (k) => { const v = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(v)); return v; },
    get: async (k) => kv.get(k) ?? null,
    expire: async () => 1,
    rpush: async (k, v) => { lists.set(k, [...(lists.get(k) ?? []), v]); return 1; },
    lrange: async (k) => lists.get(k) ?? [],
    del: async (k) => { lists.delete(k); return 1; },
  },
  withRedisTimeout: (op) => op,
}));

const { arrived, collect } = await import("./batch.js");

describe("a burst of receipts is one turn, answered once", () => {
  it("only the last to arrive answers, with every file in the order sent", async () => {
    const phone = "+447700900001";
    const seqs = [await arrived(phone, "MANBAT"), await arrived(phone, "MANBAT"), await arrived(phone, "MANBAT")];
    const file = (n) => [{ path: `/tmp/${n}.jpg`, mime: "image/jpeg", filename: `${n}.jpg` }];
    // processed out of order, as a worker with several slots would
    const results = await Promise.all([
      collect({ phone, group: "MANBAT", seq: seqs[2], attachments: file(3), text: "", quietMs: 30 }),
      collect({ phone, group: "MANBAT", seq: seqs[0], attachments: file(1), text: "october receipts", quietMs: 30 }),
      collect({ phone, group: "MANBAT", seq: seqs[1], attachments: file(2), text: "", quietMs: 30 }),
    ]);
    expect(results[1]).toBeNull();
    expect(results[2]).toBeNull();
    expect(results[0].count).toBe(3);
    expect(results[0].attachments.map((a) => a.filename)).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
    expect(results[0].text).toBe("october receipts");
  });

  it("one file alone still answers, after the short wait", async () => {
    const seq = await arrived("+447700900002", "INDIGO");
    const out = await collect({ phone: "+447700900002", group: "INDIGO", seq, attachments: [{ path: "/tmp/a.pdf" }], text: "", quietMs: 10 });
    expect(out.count).toBe(1);
  });
});
