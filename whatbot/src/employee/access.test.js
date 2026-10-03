import { describe, expect, it } from "vitest";
import { groupsOf, matchCompany, resolveScope } from "./access.js";
import { classifyReply } from "../conversation/memory.js";
import { personFrom } from "./storage.js";
import { parseRows } from "../sheet/parseSheet.js";
import { FAKE_ROWS } from "../sheet/fakes/fakeEmployees.js";

const { assignments } = parseRows(FAKE_ROWS);
const person = (name) =>
  personFrom(
    assignments,
    assignments.find((a) => a.personName === name).personId,
  );

/** the same filtering `readable` does, without needing Redis */
function readableFrom(rows, ctx) {
  return rows.filter(
    (a) =>
      ctx.scope.has(a.personId) &&
      a.group === ctx.channelGroup &&
      a.status === "active",
  );
}

const ctxFor = (name, group) => {
  const p = person(name);
  return { person: p, channelGroup: group, scope: resolveScope(p) };
};

describe("scope", () => {
  it("contains the caller and nobody else", () => {
    const p = person("Nathan Okoro");
    expect([...resolveScope(p)]).toEqual([p.personId]);
  });

  it("never returns another person’s rows", () => {
    const ctx = ctxFor("Nathan Okoro", "INDIGO");
    const rows = readableFrom(assignments, ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.personId))).toEqual(
      new Set([ctx.person.personId]),
    );
  });
});

describe("the group is an access boundary, not just branding", () => {
  const indigo = ctxFor("Nathan Okoro", "INDIGO");
  const milkman = ctxFor("Nathan Okoro", "MILKMAN");

  it("shows only this thread’s companies", () => {
    const onIndigo = readableFrom(assignments, indigo);
    const onMilkman = readableFrom(assignments, milkman);

    expect(onIndigo.every((a) => a.group === "INDIGO")).toBe(true);
    expect(onMilkman.every((a) => a.group === "MILKMAN")).toBe(true);
  });

  it("never leaks a company from the other number", () => {
    const indigoCompanies = new Set(
      readableFrom(assignments, indigo).map((a) => a.company),
    );
    const milkmanCompanies = new Set(
      readableFrom(assignments, milkman).map((a) => a.company),
    );
    for (const c of indigoCompanies)
      expect(milkmanCompanies.has(c)).toBe(false);
  });

  it("totals the two threads separately", () => {
    const sum = (rows) => rows.reduce((s, a) => s + a.payableAmount, 0);
    const a = sum(readableFrom(assignments, indigo));
    const b = sum(readableFrom(assignments, milkman));
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("gives nothing at all on a number where they hold nothing", () => {
    expect(
      readableFrom(assignments, ctxFor("Nathan Okoro", "MANBAT")),
    ).toHaveLength(0);
  });

  it("knows every group a person needs messaging on", () => {
    expect(groupsOf(person("Gloria Vance").assignments)).toEqual([
      "INDIGO",
      "MANBAT",
      "MILKMAN",
      "NEXUS",
    ]);
  });
});

describe("matchCompany", () => {
  const available = [
    "Imperium Resourcing PR",
    "Social Work First PR",
    "Acqua Resourcing",
  ];

  it("matches exactly, ignoring case and punctuation", () => {
    expect(matchCompany(available, "imperium resourcing pr")).toBe(
      "Imperium Resourcing PR",
    );
  });

  it("matches a unique partial", () => {
    expect(matchCompany(available, "imperium")).toBe("Imperium Resourcing PR");
  });

  it("refuses an ambiguous one rather than guessing", () => {
    expect(matchCompany(available, "resourcing")).toBeNull();
  });

  it("refuses one that is not there", () => {
    expect(matchCompany(available, "kryptonia")).toBeNull();
  });
});

describe("classifyReply", () => {
  it("reads a bare yes and no", () => {
    expect(classifyReply("yes").verdict).toBe("yes");
    expect(classifyReply("no").verdict).toBe("no");
  });

  it('pulls the real question out of "no, show me X"', () => {
    const { verdict, rest } = classifyReply("no, show me Imperium");
    expect(verdict).toBe("no");
    expect(rest).toBeTruthy();
  });
});
