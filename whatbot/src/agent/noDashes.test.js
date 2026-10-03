import { describe, expect, it } from "vitest";
import { noDashes } from "./noDashes.js";

describe("noDashes", () => {
  it("turns a dash between words into a comma", () => {
    expect(
      noDashes("No record of that one, sorry — try your Indigo number."),
    ).toBe("No record of that one, sorry, try your Indigo number.");
  });

  it("handles all three dashes people type", () => {
    for (const dash of ["—", "–", "-"]) {
      expect(noDashes(`one ${dash} two`)).toBe("one, two");
    }
  });

  it("catches an em or en dash even with no spaces around it", () => {
    // the model's other common style — "you—just", not "you — just" — used
    // to slip straight through and reach WhatsApp as a raw unicode character
    for (const dash of ["—", "–"]) {
      expect(noDashes(`for you${dash}just let me know`)).toBe(
        "for you, just let me know",
      );
    }
  });

  it("leaves hyphens inside words alone", () => {
    expect(noDashes("That is a part-time assignment.")).toBe(
      "That is a part-time assignment.",
    );
  });

  it("leaves a hyphenated company name alone", () => {
    expect(
      noDashes("I have no record of Anteep-Sourcing on this number."),
    ).toBe("I have no record of Anteep-Sourcing on this number.");
  });

  it("strips a dash used as a bullet point", () => {
    expect(noDashes("Two things:\n- one\n- two")).toBe("Two things:\none\ntwo");
  });

  it("does not leave a double comma behind", () => {
    expect(noDashes("Sorry, — try again")).toBe("Sorry, try again");
  });

  it("leaves ordinary sentences untouched", () => {
    const plain =
      "I can't listen to voice notes, sorry. Could you type it instead?";
    expect(noDashes(plain)).toBe(plain);
  });
});
