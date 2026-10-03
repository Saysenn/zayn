import { describe, expect, it } from "vitest";
import { escalationReply } from "./escalate.js";

const reply = (t) => escalationReply(t);

describe("a reply that asks a question does not also show a form", () => {
  /**
   * "Which company is it, and what were you expecting?" followed by three
   * numbered options is not waiting for an answer — it is a form with a
   * question on top, the same thing greeting.ts refuses to do.
   *
   * The answer is the useful part here: payroll cannot look into a shortfall
   * without knowing which company. Nothing is lost by dropping the menu, since
   * it is already flagged and a person is already coming.
   */
  it("the dispute reply asks, and offers nothing", () => {
    const out = reply("I was paid less than this");
    expect(out.category).toBe("dispute");
    expect(out.text).toMatch(/which company/i);
    expect(out.offer).toBeUndefined();
  });
});

describe("asking for a person offers a way to get one", () => {
  it("wants-human shows the review options", () => {
    const out = reply("I want someone to call me");
    expect(out.category).toBe("wants-human");
    expect(
      out.offer?.choices.some((c) => /person look at it/i.test(c.label)),
    ).toBe(true);
  });

  /** it must never invent a way to be contacted. there is not one to give */
  it.each([
    "I want someone to call me",
    "can a person review this",
    "my pay is wrong",
  ])('no phone number or email in the reply to "%s"', (t) => {
    const out = reply(t);
    expect(out.text).not.toMatch(/\+?\d[\d\s()-]{7,}/);
    expect(out.text).not.toMatch(/@|\bhttps?:\/\//);
  });
});

describe("the urgent ones are not left at a dead end", () => {
  it("distress is acknowledged and offers something that runs", () => {
    const out = reply("I can't pay my rent");
    expect(out.category).toBe("distress");
    expect(out.offer?.choices.length).toBeGreaterThan(0);
  });

  /** a privacy leak must not be followed by a cheerful menu of their figures */
  it("a wrong-recipient report shows no menu", () => {
    const out = reply("this is someone else's breakdown");
    expect(out.category).toBe("wrong-recipient");
    expect(out.offer).toBeUndefined();
  });
});
