import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PAYDAY REPLY TABLE, through the real handleMessage (plan item 25,
 * 2026-10-08). Each row: what they type, with what is open, and what must
 * come of it: the outcome recorded, and the outcome sent to the CRM (which
 * then sets Payment received, the Paid switch and any review flag; see the
 * CRM's shared/paydayFlag.helper.js and its tests).
 *
 * Redis is a Map, the records and the CRM push are spies, and the model is
 * never reached: a reply that is not an answer must send nothing at all.
 */

const store = new Map();
vi.mock("../system/redis.js", () => ({
  redis: {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => store.set(k, v),
    del: async (k) => store.delete(k),
    sismember: async (k, v) => (store.get(k)?.has?.(v) ? 1 : 0),
    sadd: async (k, v) => { const s = store.get(k) ?? new Set(); s.add(v); store.set(k, s); return 1; },
    srem: async (k, v) => { store.get(k)?.delete?.(v); return 1; },
    lrange: async () => [],
    rpush: async () => 1,
    lpush: async () => 1,
    ltrim: async () => "OK",
    expire: async () => 1,
  },
  withRedisTimeout: (op) => op,
}));
vi.mock("../system/rateLimit.js", () => ({ checkRateLimit: async () => ({ allowed: true }), RATE_LIMIT_MESSAGES: {} }));
vi.mock("../expenses/expenses.js", () => ({
  isExpenseAdmin: async () => false, expenseTurn: async () => ({}), openPreviewSize: async () => 0, unreadableReply: () => "",
}));
vi.mock("../expenses/expenseCheck.js", () => ({
  answerExpenseCheckIfOpen: async () => null, expenseCheckAfterPayday: async () => null,
}));
// A sentence that is not an answer is never read by the model in these rows.
vi.mock("./readAnswer.js", () => ({ readPaydayAnswer: async () => null }));
vi.mock("../agent/askModel.js", () => ({
  LlmUnavailableError: class extends Error {},
  runAgent: async () => ({ text: "An ordinary answer." }),
}));

const PERIOD = "2026-10";
const PERSON = {
  personId: "dana-reed",
  personName: "Dana Reed",
  assignments: [{ group: "MILKMAN", paymentMethod: "bank", assignmentId: "a1" }],
};
vi.mock("../employee/access.js", () => ({ identify: async () => ({ person: PERSON }) }));

// The payday records: what is open, and every answer written.
const open = { check: null, clarify: null, last: null };
const recorded = vi.fn();
vi.mock("./records.js", () => ({
  openCheckFor: async () => open.check,
  clarifyOpenFor: async () => open.clarify,
  lastCheckFor: async () => open.last,
  recordReply: async (period, group, personId, phone, outcome, note) => {
    recorded(outcome, note);
    open.check = null;
  },
  awaitClarify: async (period) => { open.clarify = period; },
  clearClarify: async () => { open.clarify = null; },
  reopenCheck: async (period) => { open.check = period; },
}));
const pushed = vi.fn();
vi.mock("./crmOutbox.js", () => ({ pushOutcome: (person, group, period, outcome, note) => pushed(outcome, group, period, note) }));

const { handleMessage } = await import("../conversation/handleMessage.js");
const say = (text) => handleMessage({ phone: "+447700900555", channelGroup: "MILKMAN", text });

beforeEach(() => {
  store.clear();
  recorded.mockReset();
  pushed.mockReset();
  Object.assign(open, { check: PERIOD, clarify: null, last: PERIOD });
});

/** [what they type, the outcome recorded and sent to the CRM] while a check is open. */
const OPEN_CHECK = [
  ["1", "confirmed"],
  ["yes", "confirmed"],
  ["Yes, received", "confirmed"],
  ["2", "not_received"],
  ["no", "not_received"],
  ["3", "partial"],
  ["only got half", "partial"],
  ["yes but only half of it", "partial"],
];

describe("an open check: each reply records one outcome and sends the same one to the CRM", () => {
  for (const [text, outcome] of OPEN_CHECK) {
    it(`"${text}" is ${outcome}`, async () => {
      await say(text);
      expect(recorded).toHaveBeenCalledTimes(1);
      expect(recorded.mock.calls[0][0]).toBe(outcome);
      expect(pushed).toHaveBeenCalledTimes(1);
      expect(pushed.mock.calls[0].slice(0, 2)).toEqual([outcome, "MILKMAN"]);
    });
  }

  it('"4" opts them out and tells the CRM nothing', async () => {
    const out = await say("4");
    expect(out.text).toMatch(/stop|won'?t|no more|opted/i);
    expect(recorded).not.toHaveBeenCalled();
    expect(pushed).not.toHaveBeenCalled();
  });

  it("a question is not an answer: nothing recorded, nothing sent", async () => {
    await say("how much was it?");
    expect(recorded).not.toHaveBeenCalled();
    expect(pushed).not.toHaveBeenCalled();
  });
});

/** After a "no": [what they say next, the outcome it settles on]. */
const AFTER_NO = [
  ["nothing at all", "not_received"],
  ["the amount is wrong", "partial"],
  // Matches both readings: the cautious one wins, nothing arrived.
  ["I received nothing, the amount never came", "not_received"],
];

describe('the follow up to a "no" narrows it, and the CRM is told the narrower answer', () => {
  for (const [text, outcome] of AFTER_NO) {
    it(`"no", then "${text}", ends on ${outcome}`, async () => {
      await say("no");
      await say(text);
      expect(pushed.mock.calls.map((c) => c[0])).toEqual(["not_received", outcome]);
    });
  }
});

describe("changing an answer already given", () => {
  it('"can I change my answer" reopens it, and the new answer goes to the CRM', async () => {
    open.check = null;
    const out = await say("can I change my answer");
    expect(out.text).toMatch(/replaces your earlier answer/i);
    expect(pushed).not.toHaveBeenCalled();
    await say("2");
    expect(pushed.mock.calls.map((c) => c[0])).toEqual(["not_received"]);
  });
});
