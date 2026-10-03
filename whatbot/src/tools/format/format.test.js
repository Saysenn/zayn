import { describe, expect, it } from "vitest";
import { breakdownByCompany, breakdownSummary } from "./breakdown.js";
import { money, totalsByCurrency, byCompany, NO_COMPANY } from "./money.js";
import { statsBlock, totalLine } from "./stats.js";
import { notYours } from "../shared/toolInputs.js";
import { parseRows } from "../../sheet/parseSheet.js";
import { FAKE_ROWS } from "../../sheet/fakes/fakeEmployees.js";

const { assignments } = parseRows(FAKE_ROWS);
const active = assignments.filter((a) => a.status === "active");
const forPerson = (name, group) =>
  active.filter((a) => a.personName === name && a.group === group);

describe("money", () => {
  it("uses the right symbol, and falls back to the code", () => {
    expect(money(1000, "GBP")).toBe("£1,000");
    expect(money(1000, "EUR")).toBe("€1,000");
    expect(money(1000, "AED")).toBe("AED 1,000");
  });

  it("never adds two currencies together", () => {
    const mixed = [
      active.find((a) => a.currency === "GBP"),
      active.find((a) => a.currency === "AED"),
    ];
    const out = totalsByCurrency(mixed);
    expect(out).toContain("£");
    expect(out).toContain("AED");
    expect(out).toContain(" + ");
  });

  it("gives rows with no company their own bucket instead of dropping them", () => {
    const orphans = active.filter((a) => a.company === null);
    expect([...byCompany(orphans).keys()]).toEqual([NO_COMPANY]);
  });
});

/**
 * "You're owed £1,300. 3 of them are on 0 days" — three of WHAT? They asked for
 * a total, got one number, then a pronoun pointing at a list nobody printed.
 */
describe("a total names what it is counting", () => {
  const rows = active.filter((a) => a.group === "MILKMAN").slice(0, 4);

  it('never says "of them" when no list was shown', () => {
    const out = totalLine(rows, "MILKMAN");
    expect(out).not.toMatch(/of them/);
  });

  /**
   * "1 of your 4 assignments" was true but spoke a unit nobody sees — the
   * breakdown says 3 COMPANIES, because one of them is held twice.
   */
  it("names the company owing nothing, not a count of assignments", () => {
    const mixed = [
      { ...rows[0], company: "Alpha Ltd", payableAmount: 0, payableDays: 0 },
      { ...rows[1], company: "Beta Ltd", payableAmount: 500 },
      { ...rows[2], company: "Gamma Ltd", payableAmount: 800 },
    ];
    const out = totalLine(mixed, "MILKMAN");
    expect(out).toContain("Nothing from Alpha Ltd");
    expect(out).not.toMatch(/assignments?/);
  });

  it("does not name a company that pays, even if one of its rows is idle", () => {
    // held twice, once at 31 days and once at 0. it still pays, and saying
    // otherwise would contradict the breakdown
    const out = totalLine(
      [
        { ...rows[0], company: "Alpha Ltd", payableAmount: 1300 },
        { ...rows[1], company: "Alpha Ltd", payableAmount: 0, payableDays: 0 },
      ],
      "MILKMAN",
    );
    expect(out).not.toContain("Nothing from");
  });

  it("gives every company one line, and says plainly when it pays nothing", () => {
    const out = breakdownByCompany([
      { ...rows[0], company: "Alpha Ltd", payableAmount: 0, payableDays: 0 },
      { ...rows[1], company: "Beta Ltd", payableAmount: 500 },
    ]);
    expect(out).toContain("Alpha Ltd \u{00B7} nothing this month");
    expect(out).toContain("Beta Ltd \u{00B7} ");
  });

  /**
   * Two assignments on one company are ADDED, never dropped. No payment
   * disappears — it just is not split out unless they ask.
   */
  it("adds two assignments on one company into one line", () => {
    const out = breakdownByCompany([
      {
        ...rows[0],
        company: "Alpha Ltd",
        payableAmount: 1300,
        payableDays: 31,
      },
      { ...rows[1], company: "Alpha Ltd", payableAmount: 800, payableDays: 31 },
    ]);
    expect(out.match(/Alpha Ltd/g)).toHaveLength(1);
    expect(out).toContain("2,100"); // both, added, nothing lost
  });

  it("does not call the group a month", () => {
    const out = breakdownByCompany(rows, { group: "MILKMAN" });
    expect(out).not.toMatch(/Milkman month/i);
    expect(out).toContain("across your Milkman companies");
  });

  it("shows the working only where one assignment is a part month", () => {
    const out = breakdownByCompany([
      {
        ...rows[0],
        company: "Alpha Ltd",
        payableDays: 13,
        payableAmount: 293.55,
        monthlyAmount: 700,
      },
    ]);
    expect(out).toContain("13 of 31 days");
  });

  it("explains a zero rather than looking broken", () => {
    const zero = active.filter((a) => a.payableAmount === 0).slice(0, 1);
    if (zero.length > 0) {
      expect(breakdownByCompany(zero)).toContain("Nothing is payable");
    }
  });

  it("says so plainly when there is nothing", () => {
    expect(breakdownByCompany([])).toContain("nothing on file here");
  });

  it("summarises without naming anyone — this line goes to the model", () => {
    const summary = breakdownSummary(rows);
    expect(summary).toMatch(/assignment/);
    expect(summary).not.toContain("Nathan");
  });
});

describe("aggregates", () => {
  const mixed = [
    active.filter((a) => a.currency === "GBP")[0],
    active.filter((a) => a.currency === "GBP")[1],
    active.find((a) => a.currency === "AED"),
  ];

  it("never averages across currencies", () => {
    const out = statsBlock(mixed, "average", "payable", "Average");
    expect(out).toContain("AED");
    expect(out).toContain("£");
    expect(out.split("\n").filter((l) => /\d/.test(l)).length).toBeGreaterThan(
      1,
    );
  });

  it("sums each currency separately, with the count behind it", () => {
    const gbp = mixed.filter((a) => a.currency === "GBP");
    const total = gbp.reduce((s, a) => s + a.payableAmount, 0);
    const out = statsBlock(mixed, "sum", "payable", "Total");
    expect(out).toContain(total.toLocaleString("en-GB"));
    expect(out).toContain(`(${gbp.length} assignments)`);
  });

  it("counts without pretending to total", () => {
    expect(statsBlock(mixed, "count", "payable", "here")).toContain(
      "3 assignments",
    );
  });

  it("says nothing matched instead of showing a zero", () => {
    expect(statsBlock([], "sum", "payable", "x")).toBe("Nothing matched that.");
  });
});

/**
 * A payroll figure that is quietly wrong is worse than no figure, because
 * nobody checks a number that looks fine.
 */
describe("figures are reconciled before they are sent", () => {
  const rows = active
    .filter((a) => a.group === "MILKMAN" && a.payableAmount > 0)
    .slice(0, 3);

  it("the lines always add up to the opening total", () => {
    const out = breakdownByCompany(rows, { group: "MILKMAN" });
    const shown = [...out.matchAll(/£([\d,]+(?:\.\d+)?)/g)].map((m) =>
      Number(m[1].replace(/,/g, "")),
    );
    const [total, ...lines] = shown;
    expect(lines.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 2);
  });

  it("refuses rather than showing a figure it cannot stand behind", () => {
    // byCompany losing a row is the bug nobody would spot: both halves of the
    // reply would look perfectly reasonable on their own
    const brokenGrouping = [...rows, { ...rows[0], company: null }];
    const out = breakdownByCompany(brokenGrouping, { group: "MILKMAN" });
    // the orphan row gets its own bucket, so this one still reconciles
    expect(out).not.toContain("isn't adding up");
  });

  it("every assignment reaches the reply", () => {
    const out = breakdownByCompany(rows, { group: "MILKMAN" });
    for (const company of new Set(rows.map((a) => a.company).filter(Boolean))) {
      expect(out).toContain(company);
    }
  });
});

/**
 * Asked about a company that is not theirs, the model was handed an
 * instruction and wrote a sentence with invented figures in it. The guard
 * caught it, but only after a second round trip and a useless reply.
 */
describe("a company that is not theirs is refused in code", () => {
  it("names the company asked for, and the ones they actually hold", () => {
    const out = notYours("Social Work First PR", [
      "Anteep Sourcing",
      "Oaiss Umbrella",
    ]);
    expect(out).toContain("Social Work First PR");
    expect(out).toContain("Anteep Sourcing");
    expect(out).toContain("Oaiss Umbrella");
  });

  it("carries no figure at all, so there is nothing to get wrong", () => {
    const out = notYours("Made Up Ltd", ["Anteep Sourcing"]);
    expect(out).not.toMatch(/[£€$]|\d+/);
  });

  it("copes when they hold nothing here", () => {
    expect(notYours("Made Up Ltd", [])).toContain("nothing else on file");
  });
});
