import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerMyExpenses, asksExpenses, someoneElse } from "./myExpenses.js";
import { resetAdminCache } from "./expenses.js";
import { crmConfig } from "../config/index.js";

/**
 * MY EXPENSES, read only (his calls 2026-10-07): their own, this month,
 * this group, only while his switch is on. The CRM checks the person again
 * (crm/api/v1/expenseBot.js /mine); this is WhatBot's half.
 */

const ctx = { person: { personId: "zayn", personName: "Zayn Test", assignments: [] }, channelGroup: "MILKMAN" };
const PHONE = "+351967818386";
const ROWS = [
  { id: 1, spent_on: "2026-10-04", description: "Groceries", payee: "Carrefour", currency: "AED", raw_amount: "139.91", aed_amount: "139.91", category: "food" },
  { id: 2, spent_on: "2026-10-05", description: "Train", payee: "Trainline", currency: "GBP", raw_amount: "19.00", aed_amount: "92.15", category: "travel" },
];

/** The CRM: the admin list (with his switch) and /mine. */
function crm({ on = true, rows = ROWS } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    calls.push(String(url));
    if (String(url).includes("/expenses/admins")) return { ok: true, json: async () => ({ admins: [], employeeView: on }) };
    if (!on) return { ok: false, status: 403, json: async () => ({ off: true }) };
    return { ok: true, status: 200, json: async () => ({ month: "2026-10", rows }) };
  }));
  return calls;
}

beforeEach(() => {
  resetAdminCache();
  crmConfig.apiUrl = "http://crm.test";
  crmConfig.apiKey = "test-key";
});
afterEach(() => vi.unstubAllGlobals());

describe("what counts as an expenses question", () => {
  it("their own, in their words", () => {
    for (const t of ["my expenses", "expenses for this month", "what did I spend this month", "gastos ko", "what's my expenses"]) {
      expect(asksExpenses(t), t).toBe(true);
      expect(someoneElse(t), t).toBe(false);
    }
  });
  it("never a pay question", () => {
    for (const t of ["my total pay", "when do i get paid", "breakdown"]) expect(asksExpenses(t), t).toBe(false);
  });
  it("someone else's is seen as someone else's", () => {
    for (const t of ["Ahmed's expenses", "expenses of Sara", "his expenses", "everyone's expenses"]) expect(someoneElse(t), t).toBe(true);
  });
});

describe("the answer", () => {
  it("OFF: nothing at all, as if the feature did not exist", async () => {
    const calls = crm({ on: false });
    expect(await answerMyExpenses(ctx, PHONE, "my expenses")).toBeNull();
    expect(calls.some((u) => u.includes("/expenses/mine"))).toBe(false);
  });

  it("ON: their list, by their verified phone and person id, never a name", async () => {
    const calls = crm();
    const out = await answerMyExpenses(ctx, PHONE, "my expenses");
    const mine = calls.find((u) => u.includes("/expenses/mine"));
    expect(mine).toContain("personId=zayn");
    expect(mine).toContain(`phone=${encodeURIComponent(PHONE)}`);
    expect(mine).toContain("group=MILKMAN");
    expect(out.text).toMatch(/Your October expenses · Milkman/);
    expect(out.text).toMatch(/1\. 04 Oct · Groceries · Carrefour · \*AED 139.91\*/);
    expect(out.text).toMatch(/\*Total:\* AED 139.91 \+ £19 \(about AED 232.06\)/);
    expect(out.image?.mime).toBe("image/png");
  });

  it("someone else's or another month: a polite no, and the CRM is never asked", async () => {
    const calls = crm();
    expect((await answerMyExpenses(ctx, PHONE, "Ahmed's expenses")).text).toMatch(/your own/);
    expect((await answerMyExpenses(ctx, PHONE, "my expenses last month")).text).toMatch(/this month's/);
    expect(calls.some((u) => u.includes("/expenses/mine"))).toBe(false);
  });

  it("none yet: says so, plainly", async () => {
    crm({ rows: [] });
    expect((await answerMyExpenses(ctx, PHONE, "my expenses")).text).toMatch(/Nothing is saved as spent by you in \*Milkman\* for October yet/);
  });

  it("not an expenses question: left for the pay side", async () => {
    crm();
    expect(await answerMyExpenses(ctx, PHONE, "how much am I owed")).toBeNull();
  });
});

describe("the first hello's menu", () => {
  it("offers My expenses only while the switch is on", async () => {
    const { scriptedReply } = await import("../conversation/scriptedReply.js");
    const c = { ctx: { ...ctx, person: { ...ctx.person, personName: "Zayn Test" } }, firstContact: true };
    crm({ on: true });
    const on = await scriptedReply("hi", c);
    resetAdminCache();
    crm({ on: false });
    const off = await scriptedReply("hi", c);
    expect(on?.offer?.choices.map((x) => x.label)).toContain("My expenses this month");
    expect(off?.offer?.choices.map((x) => x.label)).not.toContain("My expenses this month");
  });
});
