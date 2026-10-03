import { describe, expect, it } from "vitest";
import { breakdownCsv, breakdownFileName } from "./csv.js";

const row = (over = {}) => ({
  assignmentId: "a1",
  personId: "p1",
  personName: "Test Person",
  phone: "",
  role: "mid",
  seat: null,
  roleLabel: "Mid 1",
  group: "MILKMAN",
  company: "Oaiss Umbrella",
  assignedOn: null,
  paymentStartOn: "2026-01-01",
  presetOn: null,
  endOn: null,
  payableDays: 31,
  monthlyAmount: 1300,
  payableAmount: 1300,
  currency: "GBP",
  paymentMethod: "cash",
  location: "",
  status: "active",
  ...over,
});

describe("breakdownCsv", () => {
  it("writes a header and one line per assignment", () => {
    const csv = breakdownCsv([row(), row({ company: "Second Ltd" })]);
    const lines = csv.split("\r\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Company");
    expect(lines[0]).toContain("Payable amount");
  });

  /**
   * The rule the display formatter deliberately breaks and this one must not.
   * Two assignments on one company are two real payments with different
   * payable days — merged, the sheet's most common error becomes invisible.
   */
  it("never merges two assignments on the same company", () => {
    const csv = breakdownCsv([
      row({ payableDays: 31, payableAmount: 1300 }),
      row({ payableDays: 10, payableAmount: 419.35 }),
    ]);

    const lines = csv.split("\r\n").slice(1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("1300");
    expect(lines[1]).toContain("419.35");
  });

  it("writes raw numbers, not formatted money", () => {
    const csv = breakdownCsv([
      row({ monthlyAmount: 1300, payableAmount: 1300 }),
    ]);

    expect(csv).toContain('"1300"');
    expect(csv).not.toContain("£");
    expect(csv).not.toContain("1,300");
  });

  it("survives a company name containing a comma and a quote", () => {
    const csv = breakdownCsv([row({ company: 'Smith, Jones "and" Co' })]);
    const cells = csv.split("\r\n")[1].split('","');

    // one row, still nine columns — the comma did not split it
    expect(cells).toHaveLength(9);
    expect(csv).toContain('Smith, Jones ""and"" Co');
  });

  it("writes the group placeholder where a row has no company", () => {
    const csv = breakdownCsv([row({ company: null })]);
    expect(csv).toContain("Not tied to a company");
  });

  it("has a header even when there are no rows", () => {
    const csv = breakdownCsv([]);
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).toBe(
      "Company,Role,Payable days,Monthly amount,Payable amount,Currency,Payment method,Start date,End date",
    );
  });
});

describe("breakdownFileName", () => {
  it("names the group and the period", () => {
    expect(breakdownFileName("MILKMAN", "2026-08")).toBe(
      "breakdown-milkman-2026-08.csv",
    );
  });

  it("slugifies a group with a space", () => {
    expect(breakdownFileName("ALL BOOKS", "2026-08")).toBe(
      "breakdown-all-books-2026-08.csv",
    );
  });

  /**
   * The filename shows in the chat list, in notification previews, and on
   * whatever the phone backs up to. A name there tells anyone glancing at the
   * screen who the file is about.
   */
  it("never carries the person name", () => {
    expect(breakdownFileName("MILKMAN", "2026-08")).not.toMatch(/[A-Z]/);
  });
});
