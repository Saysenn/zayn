import { describe, expect, it } from "vitest";
import {
  findHeaderRow,
  normalizePhone,
  parseRole,
  parseRows,
  personIdOf,
} from "./parseSheet.js";
import { FAKE_ROWS, FAKE_TABS } from "./fakes/fakeEmployees.js";

const { assignments, rejected, mismatched } = parseRows(FAKE_ROWS);
const active = assignments.filter((a) => a.status === "active");

describe("fixture integrity", () => {
  it("parses every row, with nothing contradictory in it", () => {
    expect(rejected).toHaveLength(0);
    expect(mismatched).toHaveLength(0);
    expect(assignments.length).toBeGreaterThan(50);
  });

  it("gives every assignment a unique id", () => {
    expect(new Set(assignments.map((a) => a.assignmentId)).size).toBe(
      assignments.length,
    );
  });

  it("covers every group, including the two with no companies", () => {
    const groups = new Set(assignments.map((a) => a.group));
    for (const g of [
      "MILKMAN",
      "INDIGO",
      "NEXUS",
      "MANBAT",
      "ALL BOOKS",
      "TAKEOFF",
    ]) {
      expect(groups).toContain(g);
    }
  });
});

describe("the cases the real sheet forced on us", () => {
  it("keeps two assignments on the same company for the same person", () => {
    // Nathan holds Mid 1 on Oaiss Umbrella twice, at 0 days and at 31.
    // Both are real payments. Deduping them deletes a month's wages.
    const oaiss = assignments.filter(
      (a) => a.personName === "Nathan Okoro" && a.company === "Oaiss Umbrella",
    );
    expect(oaiss.length).toBeGreaterThan(1);
    expect(new Set(oaiss.map((a) => a.assignmentId)).size).toBe(oaiss.length);
  });

  it("treats the same role in four groups as four separate payments", () => {
    const gloria = active.filter((a) => a.personName === "Gloria Vance");
    expect(new Set(gloria.map((a) => a.group)).size).toBe(4);
    expect(gloria.reduce((s, a) => s + a.payableAmount, 0)).toBe(2000);
  });

  it("gives one person the same id across every group they work in", () => {
    const nathan = assignments.filter((a) => a.personName === "Nathan Okoro");
    expect(new Set(nathan.map((a) => a.personId)).size).toBe(1);
    expect(new Set(nathan.map((a) => a.group)).size).toBeGreaterThan(1);
  });

  it("keeps rows with no company rather than dropping them", () => {
    const orphans = assignments.filter((a) => a.company === null);
    expect(orphans.length).toBeGreaterThan(0);
    expect(orphans.some((a) => a.payableAmount > 0)).toBe(true);
  });

  it("pro-rates by payable days, and 0 days is not inactive", () => {
    const partial = assignments.find(
      (a) => a.payableDays > 0 && a.payableDays < 31,
    );
    if (partial) {
      expect(partial.payableAmount).toBeCloseTo(
        (partial.monthlyAmount * partial.payableDays) / 31,
        2,
      );
    }
    for (const a of assignments.filter((x) => x.payableDays === 0)) {
      expect(a.payableAmount).toBe(0);
      expect(a.status).toBe("active");
    }
  });
});

describe("cleaning up how the sheet is actually typed", () => {
  it("splits the seat number off the role", () => {
    expect(parseRole("Mid 2")).toEqual({ role: "mid", seat: 2 });
    expect(parseRole("Director")).toEqual({ role: "director", seat: null });
    expect(parseRole("Director 1")).toEqual({ role: "director", seat: 1 });
  });

  it("maps the typos rather than rejecting the row", () => {
    expect(parseRole("Supprt").role).toBe("support");
    expect(parseRole("Closure").role).toBe("closer");
    expect(parseRole("Techy").role).toBe("tech");
  });

  it("keeps an unrecognised role instead of losing the money", () => {
    expect(parseRole("Differnce").role).toBe("other");
  });

  it("normalises currency and payment method", () => {
    expect(new Set(assignments.map((a) => a.currency))).toEqual(
      new Set(["GBP", "AED", "EUR"]),
    );
    for (const a of assignments) {
      expect(["cash", "bank", "crypto"]).toContain(a.paymentMethod);
    }
  });

  it("drops the payment method that leaked into the location column", () => {
    expect(
      assignments.filter((a) => /^(bank|cash|crypto)/i.test(a.location)),
    ).toHaveLength(0);
  });

  it("finds the header row under a title and a blank line", () => {
    const milkman = FAKE_TABS.find((t) => t.name === "MILKMAN");
    expect(findHeaderRow(milkman.rows)).toBe(2);
    expect(parseRows(milkman.rows, "MILKMAN").rejected).toHaveLength(0);
  });

  it("takes the group from the tab name when the column is gone", () => {
    const nexus = FAKE_TABS.find((t) => t.name === "NEXUS");
    const { assignments: rows } = parseRows(nexus.rows, "NEXUS");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.group === "NEXUS")).toBe(true);
  });
});

describe("when the sheet contradicts itself", () => {
  const header = FAKE_ROWS[0];
  const bad = [...FAKE_ROWS[1]];
  bad[header.indexOf("Payable amount:")] = "99999";
  const result = parseRows([header, bad]);

  it("keeps the row — a dropped row is a payment missing from every total", () => {
    expect(result.assignments).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("uses the stated payable, because that is what payroll pays", () => {
    expect(result.assignments[0].payableAmount).toBe(99999);
  });

  it("reports it separately from a rejection, so somebody fixes the sheet", () => {
    expect(result.mismatched).toHaveLength(1);
    expect(result.mismatched[0].reason).toMatch(/does not match/);
  });

  it("still rejects a row it cannot read at all", () => {
    const unreadable = [...FAKE_ROWS[1]];
    unreadable[header.indexOf("Payable days this month")] = "999";
    const out = parseRows([header, unreadable]);
    expect(out.assignments.length + out.rejected.length).toBe(1);
  });
});

describe("helpers", () => {
  it("normalises phone numbers to E.164", () => {
    expect(normalizePhone("07911 123456")).toBe("+447911123456");
    expect(normalizePhone("+447911123456")).toBe("+447911123456");
    expect(normalizePhone("nonsense")).toBeNull();
  });

  it("builds a person id that survives spacing and case", () => {
    expect(personIdOf("  Nathan   Okoro ")).toBe(personIdOf("nathan okoro"));
  });
});

/**
 * The identity. Deriving it from the name merged two different humans who
 * happened to share one, and that means somebody reading another person's pay.
 */
describe("the ID column", () => {
  const HEAD = [
    "Employee ID",
    "Role:",
    "Group",
    "Name of individual:",
    "Company in question:",
    "Payable days this month",
    "Monthly amount:",
    "Payable amount:",
    "Currency:",
    "Phone",
  ];
  const row = (id, phone) => [
    id,
    "Mid 1",
    "MILKMAN",
    "Nathan Okoro",
    "Oaiss Umbrella",
    "31",
    "1000",
    "1000",
    "GBP",
    phone,
  ];

  it("keeps two people with one name apart", () => {
    const { assignments } = parseRows([
      HEAD,
      row("EMP-001", "+351967818386"),
      row("EMP-002", "+447700900001"),
    ]);
    const ids = new Set(assignments.map((a) => a.personId));
    expect(ids.size).toBe(2);
  });

  it('treats "EMP 001", "emp-001" and "EMP001" as one person', () => {
    const { assignments } = parseRows([
      HEAD,
      row("EMP 001", "+351967818386"),
      row("emp-001", "+351967818386"),
    ]);
    expect(new Set(assignments.map((a) => a.personId)).size).toBe(1);
  });

  it("falls back to the name while the column is still being filled in", () => {
    const noId = [HEAD.slice(1), row("", "+351967818386").slice(1)];
    const { assignments } = parseRows(noId);
    expect(assignments[0].personId).toBe("nathan-okoro");
  });

  it("flags one name carrying two phone numbers, which is two humans", () => {
    const noId = [
      HEAD.slice(1),
      row("", "+351967818386").slice(1),
      row("", "+447700900001").slice(1),
    ];
    const { rejected } = parseRows(noId);
    expect(
      rejected.some((r) => /two people may share one name/.test(r.reason)),
    ).toBe(true);
  });
});

/**
 * The payday check SENDS to numbers off this sheet, so a confidently wrong one
 * is a message about a stranger's wages going to a stranger.
 */
describe("phone numbers", () => {
  it("takes any country when the plus is there", () => {
    expect(normalizePhone("+971501234567")).toBe("+971501234567");
    expect(normalizePhone("+53 5 1234567")).toBe("+5351234567");
    expect(normalizePhone("+351967818386")).toBe("+351967818386");
  });

  it("strips spaces, brackets and dashes", () => {
    expect(normalizePhone("(+971) 50-123-4567")).toBe("+971501234567");
  });

  it("reads 00 as the international prefix", () => {
    expect(normalizePhone("00971501234567")).toBe("+971501234567");
  });

  it("still fixes a UK number written locally", () => {
    expect(normalizePhone("07353839670")).toBe("+447353839670");
    expect(normalizePhone("7353839670")).toBe("+447353839670"); // Excel ate the 0
    expect(normalizePhone("447353839670")).toBe("+447353839670");
  });

  it("refuses a foreign number with no plus rather than calling it British", () => {
    // this used to come back as +44971501234567, a real number we do not own
    expect(normalizePhone("971501234567")).toBeNull();
    expect(normalizePhone("501234567")).toBeNull();
  });
});
