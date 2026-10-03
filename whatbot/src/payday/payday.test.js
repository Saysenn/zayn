import { describe, expect, it } from "vitest";
import { currentPeriod, periodName } from "../config/payday.js";
import {
  AMOUNT_WRONG,
  CHOICE_NO,
  CHOICE_PARTIAL,
  CHOICE_STOP,
  CHOICE_YES,
  NO_RECEIVED,
  NOTHING_ARRIVED,
  paydayOpening,
  paydayReopened,
  REOPEN_INTENT,
  YES_RECEIVED,
} from "./paydayMessages.js";
import { formatSummary } from "./report.js";
import { subjectId } from "./records.js";

describe("period helpers", () => {
  it("formats the period as YYYY-MM", () => {
    expect(currentPeriod(new Date("2026-07-15T00:00:00Z"))).toBe("2026-07");
    expect(currentPeriod(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(currentPeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("names the month for the opening message", () => {
    expect(periodName("2026-07")).toBe("July");
  });
});

describe("one check per person per group", () => {
  it("keeps a person’s two groups apart", () => {
    // Nathan is asked twice, on two numbers. Confirming Milkman must not close
    // Indigo, so the two records cannot share a key.
    expect(subjectId("MILKMAN", "nathan-okoro")).not.toBe(
      subjectId("INDIGO", "nathan-okoro"),
    );
  });
});

describe("payday answer phrasings", () => {
  it.each(["Yes, received", "yes received", "YES, RECEIVED"])(
    "reads %s as yes",
    (t) => expect(YES_RECEIVED.test(t)).toBe(true),
  );

  it.each(["No, not received", "no not received"])("reads %s as no", (t) =>
    expect(NO_RECEIVED.test(t)).toBe(true),
  );

  it("does not fire on ordinary questions", () => {
    for (const t of [
      "no idea what my pay is",
      "yes what about Nexus",
      "what did I receive",
    ]) {
      expect(YES_RECEIVED.test(t) || NO_RECEIVED.test(t)).toBe(false);
    }
  });
});

// The answer to "has nothing arrived at all, or has the amount come through
// wrong?". Only ever read while that question is outstanding, which is why
// these can be loose without hijacking ordinary conversation.
describe("nothing arrived, or the wrong amount", () => {
  it.each([
    "nothing at all",
    "Nothing has arrived",
    "none of it came",
    "not a penny",
    "it never arrived",
  ])("reads %s as nothing received", (t) =>
    expect(NOTHING_ARRIVED.test(t)).toBe(true),
  );

  it.each([
    "the amount is wrong",
    "only got half",
    "I was paid short",
    "it came through incomplete",
    "less than expected",
    "only part of it arrived",
  ])("reads %s as a short payment", (t) =>
    expect(AMOUNT_WRONG.test(t)).toBe(true),
  );

  it("puts nothing-arrived first when a sentence could read as either", () => {
    // The expensive mistake only runs one way: reading "I got nothing, the
    // amount never came" as a SHORT payment would mark them part paid and
    // switch their Paid toggle on in the CRM. handleMessage tests
    // NOTHING_ARRIVED first for exactly this sentence.
    const both = "I received nothing, the amount never came";
    expect(NOTHING_ARRIVED.test(both)).toBe(true);
    expect(AMOUNT_WRONG.test(both)).toBe(true);
  });

  it("stays out of the way of a real question", () => {
    for (const t of ["who do I speak to about this", "can I see my breakdown"]) {
      expect(NOTHING_ARRIVED.test(t) || AMOUNT_WRONG.test(t)).toBe(false);
    }
  });
});

describe("formatSummary", () => {
  const base = {
    period: "2026-07",
    total: 127,
    confirmed: 103,
    partial: 2,
    notReceived: 12,
    noResponse: 12,
    awaiting: 0,
    problems: [
      {
        personId: "sarah-khan",
        group: "INDIGO",
        name: "Sarah Khan",
        note: "nothing arrived",
        outcome: "not_received",
      },
      { personId: "tom-reid", group: "MILKMAN", name: "Tom Reid", outcome: "not_received" },
      {
        personId: "ana-ruiz",
        group: "INDIGO",
        name: "Ana Ruiz",
        note: "only half came through",
        outcome: "partial",
      },
    ],
    byGroup: {
      INDIGO: { sent: 60, confirmed: 50, problems: 8 },
      MILKMAN: { sent: 67, confirmed: 53, problems: 4 },
    },
  };

  it("leads with the counts payroll needs", () => {
    const out = formatSummary(base);
    expect(out).toContain("July");
    expect(out).toContain("Asked: 127");
    expect(out).toContain("Confirmed: 103");
    // Two different problems, counted apart. "Reported a problem" used to
    // cover both, which hid the difference between a payment that failed
    // and one that arrived short.
    expect(out).toContain("Received only part: 2");
    expect(out).toContain("Nothing received: 12");
    expect(out).toContain("No response: 12");
  });

  it("marks which follow-ups are short payments rather than missing ones", () => {
    const out = formatSummary(base);
    expect(out).toContain("Ana Ruiz (INDIGO) [part paid] — only half came through");
    // The failed ones read exactly as they always did.
    expect(out).toContain("Sarah Khan (INDIGO) — nothing arrived");
  });

  it("breaks the numbers down per group, so one bad number is visible", () => {
    const out = formatSummary(base);
    expect(out).toContain("INDIGO: 50/60 confirmed, 8 problems");
    expect(out).toContain("MILKMAN: 53/67 confirmed, 4 problems");
  });

  it("names everyone needing follow-up, with their group and their words", () => {
    const out = formatSummary(base);
    expect(out).toContain("Sarah Khan (INDIGO) — nothing arrived");
    expect(out).toContain("Tom Reid (MILKMAN)");
  });

  it("omits the follow-up section when nobody has a problem", () => {
    expect(
      formatSummary({ ...base, notReceived: 0, problems: [] }),
    ).not.toContain("Needs payroll follow-up");
  });

  it("mentions outstanding replies only while some are open", () => {
    expect(formatSummary(base)).not.toContain("Still awaiting");
    expect(formatSummary({ ...base, awaiting: 9 })).toContain(
      "Still awaiting reply: 9",
    );
  });
});

describe("the numbered choices", () => {
  it("reads a bare number, however they punctuate it", () => {
    for (const t of ["1", " 1 ", "1.", "1)"])
      expect(CHOICE_YES.test(t)).toBe(true);
    expect(CHOICE_NO.test("2")).toBe(true);
    expect(CHOICE_PARTIAL.test("3")).toBe(true);
    expect(CHOICE_STOP.test("4")).toBe(true);
  });

  /**
   * The one that matters. A number inside a sentence is somebody telling us
   * something, and "1 payment is missing" logged as "yes, I was paid" is a
   * missing-wages report deleted.
   */
  it("ignores a number that is part of a question", () => {
    expect(CHOICE_YES.test("1 payment is missing")).toBe(false);
    expect(CHOICE_NO.test("2 of my companies are wrong")).toBe(false);
    expect(CHOICE_PARTIAL.test("3 days late again")).toBe(false);
    expect(CHOICE_STOP.test("4 companies are missing")).toBe(false);
  });

  it("keeps the four apart", () => {
    expect(CHOICE_YES.test("3")).toBe(false);
    expect(CHOICE_STOP.test("1")).toBe(false);
    // STOP moved from 3 to 4 when "only part of it" was added. Somebody
    // typing 3 from memory now says their pay was short, which is a
    // recoverable mistake — they can reopen. Typing 3 and being silently
    // opted out would not be.
    expect(CHOICE_STOP.test("3")).toBe(false);
    expect(CHOICE_PARTIAL.test("4")).toBe(false);
  });
});

/**
 * Coming back to change an answer already given: confirmed on payday, then
 * the money never cleared. Their record says confirmed and the CRM has
 * their Paid toggle on, so there has to be a way back.
 */
describe("reopening an answered check", () => {
  it.each([
    "I didn't receive my payment",
    "i never got paid",
    "haven't received it",
    "my payment is incomplete",
    "I was underpaid",
    "only got half in the end",
    "the amount is wrong",
    "still waiting for my pay",
    "can I change my answer",
  ])("hears %s as wanting the options back", (t) =>
    expect(REOPEN_INTENT.test(t)).toBe(true),
  );

  it("leaves ordinary questions alone", () => {
    for (const t of [
      "when is payday",
      "can I see my breakdown",
      "who handles Imperium",
      "thanks",
    ]) {
      expect(REOPEN_INTENT.test(t)).toBe(false);
    }
  });
});

describe("paydayReopened", () => {
  const msg = paydayReopened("Simon", "2026-07", "INDIGO");

  it("offers the same three answers, without the opt-out", () => {
    // No STOP here: they came back to fix an answer, and an opt-out option
    // in that moment is an invitation to leave over an admin error.
    expect(msg).toMatch(/1\. Yes/);
    expect(msg).toMatch(/2\. No/);
    expect(msg).toMatch(/3\. Only part of it/);
    expect(msg).not.toContain("STOP");
  });

  it("says plainly that it replaces the old answer", () => {
    expect(msg).toContain("replaces your earlier answer");
    expect(msg).toContain("Simon");
    expect(msg).toContain("July");
  });
});

describe("paydayOpening", () => {
  const msg = paydayOpening("Simon", "2026-07", "INDIGO");

  it("names the person, the month and the group", () => {
    expect(msg).toContain("Simon");
    expect(msg).toContain("July");
    // the twelve people who get two of these need to tell them apart
    expect(msg).toContain("Indigo");
  });

  it("does not shout the group code at them", () => {
    // "INDIGO" mid-sentence reads like a mail merge went wrong
    expect(msg).not.toContain("INDIGO");
  });

  it("offers a way out", () => {
    // Nothing external vets this wording — no template approval. An unexplained
    // message about pay from an unknown number is what gets an account
    // reported, so the opt-out has to be in the first message.
    expect(msg).toMatch(/4\. STOP/);
    expect(msg).toMatch(/Choose 4/);
  });

  it("offers all four options as numbers", () => {
    // the numbers ARE the interface — a linked device has no buttons
    expect(msg).toMatch(/1\. Yes/);
    expect(msg).toMatch(/2\. No/);
    // A short payment is the commonest real problem and had nowhere to go:
    // people picked No, which files a payment that worked as one that failed.
    expect(msg).toMatch(/3\. Only part of it/);
    expect(msg).toMatch(/4\. STOP/);
  });

  it("carries no figures", () => {
    // The opening is sent unprompted. Anything resembling an amount here would
    // be a payslip pushed to a phone the person may not control.
    expect(msg).not.toMatch(/[£€$]\s?\d|\d+\.\d{2}/);
  });
});
