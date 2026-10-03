import { describe, expect, it } from "vitest";
import { greetingReply } from "./greeting.js";

const ctx = {
  person: {
    personId: "p1",
    personName: "Sam Okafor",
    phone: "+447100000001",
    assignments: [],
  },
  channelGroup: "MILKMAN",
  scope: new Set(["p1"]),
};

const say = (t, firstContact = false) =>
  greetingReply(t, ctx, { firstContact });

/**
 * The menu is useful exactly once and grating every time after.
 *
 * Three fixed options under every hello, every thanks and every goodbye is the
 * single thing that made the whole thread read like a machine.
 */
describe("the menu appears once, not on everything", () => {
  it("shows it to somebody who has never asked us anything", () => {
    expect(say("hi", true)?.offer?.choices).toHaveLength(3);
  });

  it("does not show it to somebody saying hello again", () => {
    expect(say("hi")?.offer).toBeUndefined();
  });

  it.each(["thanks", "cheers", "bye", "see you", "how are you"])(
    'never shows it after "%s"',
    (t) => expect(say(t, true)?.offer).toBeUndefined(),
  );
});

/**
 * A thank-you is somebody closing the conversation, and it used to reopen it.
 *
 * "cool" and "thanks" were in memory.ts's YES list, so "cool, thank you" read
 * as accepting the last menu offer and re-sent the breakdown they had just
 * thanked us for.
 */
describe("closing the conversation", () => {
  it.each([
    "cool, thank you",
    "cool thanks",
    "nice one",
    "great stuff",
    "sweet, cheers",
    "ok thanks",
    "got it, thanks",
    "all good thanks",
  ])('"%s" is answered and left there', (t) => {
    const out = say(t);
    expect(out).not.toBeNull();
    expect(out?.offer).toBeUndefined();
  });

  it("still lets a real question through when it follows a thank-you", () => {
    // the question is the part that matters, so this must reach the tools
    expect(say("thanks, what am I owed on Imperium?")).toBeNull();
    expect(say("cool, and my total?")).toBeNull();
  });
});

describe("it does not ask a question and hand over a form at the same time", () => {
  /**
   * "How's your day going?" followed by three numbered options is not waiting
   * for an answer, whatever the words say.
   */
  it.each(["how are you", "hi"])(
    "%s either asks or offers, never both",
    (t) => {
      const out = say(t);
      if (out.text.includes("?")) expect(out.offer).toBeUndefined();
    },
  );

  it("the first-contact hello states rather than asks, so the menu fits", () => {
    const out = say("hi", true);
    expect(out.text).not.toContain("?");
    expect(out.offer).toBeDefined();
  });
});

describe("it still gets out of the way of a real question", () => {
  /**
   * A word count used to decide this, and the third one here is exactly six
   * words — so it came back as "Hi Sam, how's your day?" and the question was
   * dropped on the floor.
   */
  it.each([
    "hi what am I owed this month",
    "hello can you show me my breakdown",
    "morning, which company pays me most",
    "hey when does my payment end",
    "thanks, and what about Imperium",
    "bye, one last thing, my total",
  ])("%s belongs to the agent", (t) => expect(say(t)).toBeNull());
});

describe("pleasantries with padding are still pleasantries", () => {
  it.each([
    "are you okay",
    "are you ok?",
    "you alright?",
    "hi there",
    "hey there mate",
    "thanks mate",
    "hello again",
    "good morning",
    "hey how are you",
    "hi, how are you doing?",
  ])("%s is answered here, not by the agent", (t) =>
    expect(say(t)).not.toBeNull(),
  );
});

describe("it still sounds like a person", () => {
  it("uses their first name, not their full name", () => {
    expect(say("hi")?.text).toContain("Sam");
    expect(say("hi")?.text).not.toContain("Okafor");
  });

  it("answers how it is, then asks back", () => {
    expect(say("how are you")?.text).toMatch(/how's your day/i);
  });
});
