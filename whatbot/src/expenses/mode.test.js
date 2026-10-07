import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Expense mode and payments mode, through the real handleMessage. Redis is
 * a Map, the CRM is a stub, and the employee side is left to say what it
 * always says to a number it does not know.
 */

const store = new Map();
vi.mock("../system/redis.js", () => ({
  redis: {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => store.set(k, v),
    sismember: async () => 0,
    sadd: async () => 1,
    srem: async () => 1,
  },
  withRedisTimeout: (op) => op,
}));
vi.mock("../system/rateLimit.js", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  RATE_LIMIT_MESSAGES: {},
}));
vi.mock("../employee/access.js", () => ({ identify: async () => null }));

const turn = vi.fn();
vi.mock("./expenses.js", () => ({
  isExpenseAdmin: async (phone, group) => phone === "+447700900001" && group === "MANBAT",
  expenseTurn: (...args) => turn(...args),
}));

const { handleMessage } = await import("../conversation/handleMessage.js");
const { UNKNOWN_SENDER } = await import("../agent/prompt.js");

const admin = (text, extra = {}) => handleMessage({ phone: "+447700900001", channelGroup: "MANBAT", text, ...extra });

beforeEach(() => {
  store.clear();
  turn.mockReset();
  turn.mockResolvedValue({ registered: true, reply: "*1 expense for MANBAT* (not saved yet)" });
});

describe("a registered admin chooses the side by one word", () => {
  it("starts in expense mode: messages go to the CRM", async () => {
    expect((await admin("taxi 45")).text).toMatch(/not saved yet/);
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it('"payments" switches to the normal agent, "expense" switches back', async () => {
    expect((await admin("payments")).text).toMatch(/Payments mode/);
    expect((await admin("how much am I getting paid?")).text).toBe(UNKNOWN_SENDER);
    expect(turn).not.toHaveBeenCalled();
    expect((await admin("Expense")).text).toMatch(/Expense mode.*MANBAT/s);
    await admin("taxi 45");
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it("a photo in payments mode goes to expenses, and says it switched", async () => {
    await admin("payments");
    const out = await admin("", { attachments: [{ path: "/tmp/x.jpg", mime: "image/jpeg", filename: "x.jpg" }] });
    expect(out.text).toMatch(/^📒 _Switched to expense mode/);
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it("not about expenses: answered by the normal side this once, and said so", async () => {
    turn.mockResolvedValue({ registered: true, handOff: true });
    const out = await admin("how much am I getting paid?");
    expect(out.text.startsWith(UNKNOWN_SENDER)).toBe(true);
    expect(out.text).toMatch(/isn't an expense, so I answered it as a payments question/);
  });

  it('to an admin in expense mode "cancel" goes to the preview, never the opt-out', async () => {
    turn.mockResolvedValue({ registered: true, reply: "Okay, cancelled. Nothing was saved." });
    expect((await admin("cancel")).text).toBe("Okay, cancelled. Nothing was saved.");
  });
});

describe("everyone else is untouched", () => {
  it('"expense" from someone not registered is an ordinary message', async () => {
    const out = await handleMessage({ phone: "+447700900999", channelGroup: "MANBAT", text: "expense" });
    expect(out.text).toBe(UNKNOWN_SENDER);
    expect(turn).not.toHaveBeenCalled();
  });

  it("the admin on another group's number is not an expense admin there", async () => {
    const out = await handleMessage({ phone: "+447700900001", channelGroup: "INDIGO", text: "taxi 45" });
    expect(out.text).toBe(UNKNOWN_SENDER);
    expect(turn).not.toHaveBeenCalled();
  });
});
