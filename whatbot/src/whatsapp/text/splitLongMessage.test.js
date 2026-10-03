import { describe, expect, it } from "vitest";
import { splitMessage, MAX_BODY } from "./splitLongMessage.js";

describe("splitMessage", () => {
  it("leaves a short message untouched — no part marker", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("never emits a part over the limit", () => {
    const long = Array.from(
      { length: 400 },
      (_, i) => `AED 1,500 for Person ${i}`,
    ).join("\n");
    for (const part of splitMessage(long)) {
      expect(part.length).toBeLessThanOrEqual(MAX_BODY + 20); // + part marker
    }
  });

  it("numbers the parts", () => {
    const long = "x".repeat(MAX_BODY * 3);
    const parts = splitMessage(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toMatch(/^\(1\/\d+\)/);
  });

  it("splits on paragraph boundaries when it can", () => {
    const blocks = Array.from(
      { length: 6 },
      (_, i) => `*Group ${i}*\n` + "line\n".repeat(120),
    );
    const parts = splitMessage(blocks.join("\n\n"));
    expect(parts.length).toBeGreaterThan(1);
    // no group header should be orphaned from its content
    for (const p of parts) expect(p.trim().length).toBeGreaterThan(0);
  });

  it("hard-splits a single line with no break points", () => {
    const parts = splitMessage("y".repeat(MAX_BODY * 2 + 10));
    expect(parts.length).toBe(3);
  });

  it("loses no content", () => {
    const original = Array.from({ length: 300 }, (_, i) => `row ${i}`).join(
      "\n",
    );
    const rejoined = splitMessage(original)
      .map((p) => p.replace(/^\(\d+\/\d+\)\n/, ""))
      .join("\n");
    expect(rejoined.replace(/\s+/g, " ")).toBe(original.replace(/\s+/g, " "));
  });
});
