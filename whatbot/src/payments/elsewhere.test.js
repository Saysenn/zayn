import { describe, expect, it, vi } from "vitest";

vi.mock("../config/index.js", () => ({ numberForGroup: (g) => ({ INDIGO: "+447700900123" })[g] }));
const { otherGroups, noteText, otherGroupIn } = await import("./elsewhere.js");

const ctx = {
  channelGroup: "MILKMAN",
  person: { assignments: [{ group: "MILKMAN" }, { group: "INDIGO" }, { group: "NEXUS" }, { group: "MILKMAN" }] },
};

describe("where the rest of their pay is", () => {
  it("lists their OTHER groups by name, with the number that answers for each", () => {
    expect(otherGroups(ctx)).toEqual([{ group: "INDIGO", number: "+447700900123" }, { group: "NEXUS", number: null }]);
  });
  it("says it in text too: names and numbers, never a company or a figure", () => {
    const t = noteText(ctx);
    expect(t).toMatch(/\*Indigo\*: message the Indigo number, \+44 7700 900123/);
    expect(t).toMatch(/\*Nexus\*: not on WhatsApp, ask payroll/);
    expect(t).not.toMatch(/£|AED|\d{3,},/);
  });
  it("knows when they ask about one of them here", () => {
    expect(otherGroupIn("how much do i get from indigo?", ctx)?.group).toBe("INDIGO");
    expect(otherGroupIn("how much do i get?", ctx)).toBeNull();
  });
  it("nothing to say for someone in one group", () => {
    expect(noteText({ channelGroup: "MILKMAN", person: { assignments: [{ group: "MILKMAN" }] } })).toBe("");
  });
});
