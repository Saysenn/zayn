import { describe, expect, it } from "vitest";
import { datesByCompany, datesSummary, humanDate } from "./dates.js";
import { parseRows } from "../../sheet/parseSheet.js";
import { FAKE_ROWS } from "../../sheet/fakes/fakeEmployees.js";

const { assignments } = parseRows(FAKE_ROWS);
const active = assignments.filter((a) => a.status === "active");

/** one real row, with the dates bent to whatever the test is about */
const withDates = (dates) => ({
  ...active[0],
  assignedOn: null,
  paymentStartOn: null,
  endOn: null,
  ...dates,
});

describe("humanDate", () => {
  it("writes a date the way a person would", () => {
    expect(humanDate("2026-07-01")).toBe("1 July 2026");
    expect(humanDate("2027-12-31")).toBe("31 December 2027");
  });

  it("gives back null rather than inventing one", () => {
    expect(humanDate(null)).toBeNull();
  });
});

describe("the dates a person actually receives", () => {
  /**
   * Nothing in the sheet has an end date today, and "how long have I got left"
   * was answered with three blocks of start dates and "no end date recorded"
   * on every line. The one fact they asked for was the hardest to find.
   */
  it("leads with the missing end date instead of burying it", () => {
    const out = datesByCompany([withDates({ paymentStartOn: "2026-04-01" })]);
    expect(out.split("\n")[0]).toMatch(/no end date on file/i);
    expect(out.split("\n")[0]).toMatch(/can't tell you how long it runs/i);
    expect(out).toContain("paying from 1 April 2026");
    // said once at the top now, not tacked onto every line
    expect(out).not.toContain("no end date recorded");
  });

  it("speaks of companies, not assignments — that word is ours, not theirs", () => {
    const out = datesByCompany([
      withDates({ company: "Alpha Ltd", paymentStartOn: "2026-04-01" }),
      withDates({ company: "Beta Ltd", paymentStartOn: "2026-04-01" }),
    ]);
    expect(out.split("\n")[0]).toMatch(
      /no end date on any of the companies you handle/i,
    );
    expect(out).not.toMatch(/\bassignments?\b/);
  });

  it("still marks the odd one out when some DO have an end date", () => {
    const out = datesByCompany([
      withDates({ paymentStartOn: "2026-04-01", endOn: "2027-06-30" }),
      withDates({ paymentStartOn: "2026-04-01" }),
    ]);
    expect(out).toContain("ends 30 June 2027");
    expect(out).toContain("no end date recorded");
  });

  it("does not say the appointed date twice when it is the start date", () => {
    const out = datesByCompany([
      withDates({ assignedOn: "2026-04-01", paymentStartOn: "2026-04-01" }),
    ]);
    expect(out).not.toContain("appointed");
    expect(out).toContain("paying from 1 April 2026");
  });

  it("shows the appointed date when payment started later", () => {
    const out = datesByCompany([
      withDates({ assignedOn: "2026-03-01", paymentStartOn: "2026-04-01" }),
    ]);
    expect(out).toContain("appointed 1 March 2026");
    expect(out).toContain("paying from 1 April 2026");
  });

  it("never calls an end date settled", () => {
    const out = datesByCompany([withDates({ endOn: "2027-06-30" })]);
    expect(out).toContain("30 June 2027");
    expect(out).toMatch(/what the sheet says today/);
  });

  it("admits it holds nothing rather than printing empty lines", () => {
    const out = datesByCompany([withDates({})], { group: "MILKMAN" });
    expect(out).toContain("no dates recorded");
    expect(out).not.toContain("paying from");
  });

  /**
   * Two real assignments, same role, same company. With no amounts on this
   * view the lines were identical, which reads as one row printed twice.
   */
  it("tells two assignments on one company apart", () => {
    const out = datesByCompany([
      withDates({ paymentStartOn: "2026-04-01", payableDays: 31 }),
      withDates({ paymentStartOn: "2026-04-01", payableDays: 12 }),
    ]);
    expect(out).toContain("(31 days)");
    expect(out).toContain("(12 days)");
  });

  it("carries no dates and no names back to the model", () => {
    const rows = [
      withDates({ paymentStartOn: "2026-04-01", endOn: "2027-06-30" }),
    ];
    const summary = datesSummary(rows);
    expect(summary).not.toMatch(/2026|2027|April|June/);
    expect(summary).not.toContain(rows[0].personName);
  });
});
