import { describe, expect, it } from "vitest";
import { findTables, parseRows } from "./parseSheet.js";

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
];
const row = (id, name, company, group = "MILKMAN") => [
  id,
  "Mid 1",
  group,
  name,
  company,
  "31",
  "1000",
  "1000",
  "GBP",
];
const blank = (n = 12) => Array(n).fill("");

/**
 * The two shapes that used to read as nothing at all, and said so nowhere.
 */
describe("tables anywhere on the sheet", () => {
  it("finds a table that starts well below row 10", () => {
    const rows = [
      ["Payroll master", "", ""],
      ...Array.from({ length: 14 }, () => blank()),
      HEAD,
      row("EMP-001", "Nathan", "Oaiss Umbrella"),
      row("EMP-002", "Gloria", "Workforce"),
    ];
    const { assignments, rejected } = parseRows(rows);
    expect(rejected).toHaveLength(0);
    expect(assignments).toHaveLength(2);
    expect(assignments.map((a) => a.personName)).toEqual(["Nathan", "Gloria"]);
  });

  it("finds two tables stacked down one sheet", () => {
    const rows = [
      HEAD,
      row("EMP-001", "Nathan", "Oaiss Umbrella"),
      blank(),
      blank(),
      ["Second half", "", ""],
      HEAD,
      row("EMP-002", "Gloria", "Workforce", "INDIGO"),
      row("EMP-003", "Juan", "A J Rayson", "INDIGO"),
    ];
    const { assignments } = parseRows(rows);
    expect(assignments).toHaveLength(3);
    expect(assignments.filter((a) => a.group === "INDIGO")).toHaveLength(2);
  });

  it("finds two tables sat side by side", () => {
    // two blank columns between them, which is what separates a table from
    // the spacer column the master sheet already has inside one
    const side = (l, r) => [...l, "", "", ...r];
    const rows = [
      side(HEAD, HEAD),
      side(
        row("EMP-001", "Nathan", "Oaiss Umbrella"),
        row("EMP-002", "Gloria", "Workforce", "INDIGO"),
      ),
      side(
        row("EMP-003", "Juan", "A J Rayson"),
        row("EMP-004", "Abe", "Monument", "INDIGO"),
      ),
    ];
    const tables = findTables(rows);
    expect(tables).toHaveLength(2);

    const { assignments } = parseRows(rows);
    expect(assignments).toHaveLength(4);
    expect(assignments.filter((a) => a.group === "MILKMAN")).toHaveLength(2);
    expect(assignments.filter((a) => a.group === "INDIGO")).toHaveLength(2);
    // side-by-side rows must not collide on one id
    expect(new Set(assignments.map((a) => a.assignmentId)).size).toBe(4);
  });

  it("keeps a single blank column inside one table", () => {
    // the master sheet has exactly this between Location: and the working columns
    const rows = [
      [...HEAD.slice(0, 5), "", ...HEAD.slice(5)],
      [
        ...row("EMP-001", "Nathan", "Oaiss Umbrella").slice(0, 5),
        "",
        ...row("EMP-001", "Nathan", "Oaiss Umbrella").slice(5),
      ],
    ];
    expect(findTables(rows)).toHaveLength(1);
    expect(parseRows(rows).assignments).toHaveLength(1);
  });

  it("says so out loud when a sheet has no table at all", () => {
    const { assignments, rejected } = parseRows([
      ["Notes"],
      ["nothing here"],
      [""],
    ]);
    expect(assignments).toHaveLength(0);
    // it used to return success with zero rows and no explanation
    expect(rejected[0].reason).toMatch(/no table found/i);
  });
});
