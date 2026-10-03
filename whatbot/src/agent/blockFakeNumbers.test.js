import { describe, expect, it } from "vitest";
import {
  containsFigures,
  containsNameList,
  stripFigures,
} from "./blockFakeNumbers.js";

describe("containsFigures", () => {
  it.each([
    "£1,560",
    "AED 1,270",
    "€99",
    "Combined net pay: £19,670.",
    "total 19,670",
  ])("flags %s", (t) => expect(containsFigures(t)).toBe(true));

  it.each([
    "Here is your pay for this month:",
    "You manage 12 people.",
    "That works out at 25% margin.",
    "I can show your pay breakdown if that helps.",
  ])("leaves %s alone", (t) => expect(containsFigures(t)).toBe(false));
});

describe("stripFigures", () => {
  it("drops the invented list the model wrote above the real one", () => {
    const bad = [
      "Here's the net pay for each of your team members:",
      "Kieran Dixon – £1,560",
      "Demi Gibson – £1,620",
      "Combined net pay: £19,670.",
    ].join("\n");

    const out = stripFigures(bad);
    expect(out).not.toContain("1,560");
    expect(out).not.toContain("19,670");
    expect(out).toContain("net pay for each of your team members");
  });

  it("falls back to a neutral lead-in when nothing survives", () => {
    expect(stripFigures("£1,560\n£1,620")).toBe("Here you go:");
  });

  it("passes clean prose through untouched", () => {
    const ok = "Here is your pay for this month:";
    expect(stripFigures(ok)).toBe(ok);
  });
});

describe("stripFigures — list wreckage", () => {
  it("discards a name list once its amounts are removed", () => {
    // The real failure: names on their own lines survived the strip and sat
    // above the real table as an orphaned column.
    const namesOnSeparateLines = [
      "*AVAGAN — 12 people*",
      "Abbie Bell (EMP0277, employee)",
      "£1,825",
      "Demi Gibson (EMP0275, employee)",
      "£1,720",
    ].join("\n");

    expect(stripFigures(namesOnSeparateLines)).toBe("Here you go:");
  });

  it("keeps the lead-in when the figures were all on their own lines", () => {
    const list = [
      "Here are the take-home figures:",
      "Abbie Bell — £1,825",
      "Demi Gibson — £1,720",
    ].join("\n");

    // One clean sentence survives — that is the intent, not wreckage.
    expect(stripFigures(list)).toBe("Here are the take-home figures:");
  });

  it("keeps a single clean sentence when only a trailing figure was removed", () => {
    const out = stripFigures("Here is the pay for your team.\nTotal: £15,015");
    expect(out).toBe("Here is the pay for your team.");
  });
});

describe("invented names", () => {
  it("catches a roster the model made up", () => {
    const bad =
      "Your cash-paid team members are: James Taylor, Priya Singh and Liam O’Connor.";
    expect(containsNameList(bad)).toBe(true);
    expect(stripFigures(bad)).toBe("Here you go:");
  });

  it("catches a comma-only list", () => {
    expect(containsNameList("Grace Wood, Nadia Holmes, Oliver Clarke")).toBe(
      true,
    );
  });

  it("leaves ordinary sentences alone", () => {
    for (const ok of [
      "Here is the pay for your team.",
      "Here is your pay for this month:",
      "You manage 12 people.",
      "I can show your pay breakdown if that helps.",
      "That covers Milk Man and Sprite.",
    ]) {
      expect(containsNameList(ok)).toBe(false);
      expect(stripFigures(ok)).toBe(ok);
    }
  });

  it("leaves a single name alone — only lists are the problem", () => {
    const one = "Here is the payslip for Grace Wood:";
    expect(containsNameList(one)).toBe(false);
    expect(stripFigures(one)).toBe(one);
  });
});

describe("bulleted rosters", () => {
  it("catches one name per bullet — the model's favourite dodge", () => {
    const bad = [
      "The cash-paid members of your team are:",
      "- Grace Wood",
      "- Nadia Holmes",
      "- Oliver Clarke",
    ].join("\n");
    expect(containsNameList(bad)).toBe(true);
    expect(stripFigures(bad)).toBe("Here you go:");
  });

  it("catches bolded names in a bulleted list", () => {
    const bad = [
      "Here are the cash-paid team members:",
      "- **Grace Wood** – basic, overtime, bonus shown.",
      "- **Nadia Holmes** – basic, overtime, bonus shown.",
    ].join("\n");
    expect(containsNameList(bad)).toBe(true);
    expect(stripFigures(bad)).toBe("Here you go:");
  });

  it("still allows a single name", () => {
    const ok = "Here is the payslip for Grace Wood:";
    expect(containsNameList(ok)).toBe(false);
    expect(stripFigures(ok)).toBe(ok);
  });

  it("does not trip on group names or ordinary sentences", () => {
    for (const ok of [
      "Here is the pay for your team.",
      "That covers Milk Man and Sprite.",
      "You manage 12 people.",
      "Here are the deduction items for the cash-paid members of your team.",
      "I don’t have a June breakdown, but I can share your latest pay details.",
    ]) {
      expect(containsNameList(ok)).toBe(false);
    }
  });
});

describe("spelled-out counts", () => {
  it("catches a count written as a word", () => {
    // "You are on five companies" was wrong AND slipped through, because it has
    // no digits and no currency symbol.
    expect(containsFigures("You are on five companies.")).toBe(true);
    expect(containsFigures("You hold three assignments.")).toBe(true);
  });

  it("catches a count written as a digit", () => {
    expect(containsFigures("You are on 3 companies.")).toBe(true);
  });

  it("leaves ordinary sentences alone", () => {
    for (const ok of [
      "One moment while I check.",
      "Here is what you are owed this month.",
      "There are two ways to read that question.",
    ]) {
      expect(containsFigures(ok)).toBe(false);
    }
  });
});
