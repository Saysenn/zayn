import { describe, expect, it } from "vitest";
import { cellToString } from "./excel.js";

/**
 * Excel hands back a different shape depending on how the cell was typed. Miss
 * one and the value becomes "[object Object]" — which parses as a name, and
 * pays somebody nothing.
 */
describe("cellToString", () => {
  it("reads plain values", () => {
    expect(cellToString("Nathan")).toBe("Nathan");
    expect(cellToString(1300)).toBe("1300");
    expect(cellToString(0)).toBe("0");
  });

  it("reads a date as YYYY-MM-DD", () => {
    expect(cellToString(new Date("2026-07-01T00:00:00Z"))).toBe("2026-07-01");
  });

  it("reads the RESULT of a formula, not the formula", () => {
    // Payable amount is a formula in the real sheet. Taking `.formula` here
    // would put "=K2*I2/31" where the money goes.
    expect(cellToString({ formula: "K2*I2/31", result: 461.29 })).toBe(
      "461.29",
    );
  });

  it("flattens styled text into one string", () => {
    expect(
      cellToString({ richText: [{ text: "Social " }, { text: "Work First" }] }),
    ).toBe("Social Work First");
  });

  it("reads the text of a hyperlink, not the URL", () => {
    expect(cellToString({ text: "A J Rayson", hyperlink: "http://x" })).toBe(
      "A J Rayson",
    );
  });

  it("treats a formula error as no value rather than as text", () => {
    // "#REF!" would sail through as a company name and total against nothing.
    expect(cellToString({ error: "#REF!" })).toBe("");
  });

  it("treats blank and missing as empty", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString(undefined)).toBe("");
  });

  it("never returns [object Object]", () => {
    for (const shape of [{}, { weird: 1 }, { formula: "A1" }]) {
      expect(cellToString(shape)).not.toContain("object Object");
    }
  });
});
