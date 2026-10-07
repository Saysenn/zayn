import { describe, expect, it, vi } from "vitest";

vi.mock("./style.js", () => ({ pictureStyle: async () => "sheet" }));
const { breakdownPicture } = await import("./breakdown.js");

describe("the pay breakdown as a picture", () => {
  it("draws every deal and a one line caption with the code-made total", async () => {
    const rows = [
      { company: "Acqua Resourcing", roleLabel: "Mid 1", payableDays: 31, monthlyAmount: 500, payableAmount: 500, currency: "GBP" },
      { company: "Social Work First PR", roleLabel: "Mid 1", payableDays: 15, monthlyAmount: 1000, payableAmount: 483.87, currency: "GBP" },
    ];
    const pic = await breakdownPicture(rows, { channelGroup: "INDIGO", person: { personName: "Neo Test" } });
    expect(Buffer.from(pic.base64, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(pic.caption).toMatch(/Indigo breakdown: \*£983\.87\*$/);
    expect(pic.feature).toBe("payImages");
  });
});
