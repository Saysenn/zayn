import { describe, expect, it, vi } from "vitest";

vi.mock("../system/redis.js", () => ({ redis: {}, withRedisTimeout: (op) => op }));
const { readQuick } = await import("./quick.js");
const { optOutIntent } = await import("../system/optOut.js");

const ctx = {
  channelGroup: "INDIGO",
  person: { personId: "neo", personName: "Neo", assignments: [
    { group: "INDIGO", company: "Acqua Resourcing" },
    { group: "INDIGO", company: "Social Work First PR" },
    { group: "MILKMAN", company: "Reliapay" },
  ] },
};
const tool = (q) => readQuick(q, ctx)?.name ?? null;

describe("everyday pay questions are answered in code", () => {
  it("picks the tool the model would have", () => {
    expect(tool("whats my total")).toBe("get_my_total");
    expect(tool("show me my breakdown")).toBe("get_my_breakdown");
    expect(tool("how much am I getting this month?")).toBe("get_my_breakdown");
    expect(tool("am i getting paid this month")).toBe("get_my_breakdown");
    expect(tool("which companies am I on")).toBe("count_my_companies");
    expect(tool("which company pays me the most")).toBe("rank_my_companies");
    expect(tool("when did I start")).toBe("get_my_dates");
  });
  it("names only THEIR companies on THIS number", () => {
    expect(readQuick("acqua resourcing how much", ctx)).toEqual({ name: "get_my_company", args: { company: "Acqua Resourcing" } });
    expect(readQuick("how long left on acqua", ctx)).toEqual({ name: "get_my_dates", args: { company: "Acqua Resourcing" } });
    expect(tool("how much does reliapay pay me")).not.toBe("get_my_company");
  });
  it("leaves another month, two questions and unknown wording to the model", () => {
    expect(tool("what was my total last month")).toBeNull();
    expect(tool("breakdown for september")).toBeNull();
    expect(tool("how much is acqua paying me and when did it start")).toBeNull();
    expect(tool("magkano sahod ko")).toBeNull();
  });
});

describe("stop and start are the whole message, never its first word", () => {
  it("opts out and in on the word alone", () => {
    expect(optOutIntent("stop")).toBe("stop");
    expect(optOutIntent("STOP please")).toBe("stop");
    expect(optOutIntent("start again")).toBe("start");
  });
  it("a question that begins with the word is a question", () => {
    expect(optOutIntent("end date of my contract?")).toBeNull();
    expect(optOutIntent("start dates for all my companies")).toBeNull();
    expect(optOutIntent("stop paying acqua?")).toBeNull();
  });
});
