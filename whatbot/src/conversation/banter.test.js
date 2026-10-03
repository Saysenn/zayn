import { describe, expect, it } from "vitest";
import { moodReply, jokeReply, personalReply } from "./banter.js";

/** the four opening refusals, for telling a shrug apart from an actual joke */
const TEASE_RE = /why would I|come on|saving my best|standing ovation/i;

const say = (t) => moodReply(t, "Nathan");

/**
 * The bug this exists to stop.
 *
 * "good, and you?" came back as "Glad to hear it Nathan, what can I get you?"
 * It matched the word "good", ticked the pleasantry off and moved to business
 * without noticing it had been asked a question. That is the most bot thing in
 * the whole codebase.
 */
describe("when they ask back, it answers", () => {
  it.each([
    "good, and you?",
    "yeah good, and yourself?",
    "not bad, how about you",
    "fine thanks, what about you",
    "and you?",
  ])("%s gets an answer, not just a pivot to business", (t) => {
    const out = say(t);
    expect(out).not.toBeNull();
    // it has to say something about itself before asking for work
    expect(out).toMatch(/\bI'?m (good|alright)|Not bad at all/i);
  });

  it("answers even when the mood is bad", () => {
    expect(say("rough day, and you?")).toMatch(
      /I'?m alright thanks for asking/i,
    );
  });

  it("still keeps the plain version short when they did not ask", () => {
    expect(say("yeah good")).toBe("Glad to hear it 😄 What do you need?");
  });

  /**
   * A name belongs in a greeting, not stapled to every reply. Mid-conversation
   * it reads like a mail merge — the one thing this whole module exists to
   * avoid. Greetings still use it; see conversation/greeting.ts.
   */
  it("does not use their name", () => {
    for (const t of [
      "yeah good",
      "rough day",
      "good, and you?",
      "how do I look",
    ]) {
      expect(say(t) ?? "").not.toContain("Nathan");
    }
  });
});

describe("it hears how the day is going", () => {
  it.each(["rough day honestly", "knackered", "stressed", "not great"])(
    "%s is acknowledged first",
    (t) => expect(say(t)).toMatch(/sorry to hear/i),
  );

  it.each(["yeah good", "all good", "grand", "ok thanks", "alright"])(
    "%s is met warmly",
    (t) => expect(say(t)).toMatch(/glad to hear/i),
  );
});

describe("a question with a mood attached is still a question", () => {
  it("leaves the real ask to the agent", () => {
    expect(say("my day was terrible, what am I owed this month")).toBeNull();
  });
});

/**
 * A payroll bot with opinions on how five hundred employees look is a
 * liability with no upside. It deflects, and everything it says is true.
 */
describe("personal questions are deflected, never answered", () => {
  const p = (t) => personalReply(t, "Nathan");

  it.each([
    "am I handsome",
    "am I pretty?",
    "how do I look",
    "do I look good",
    "rate me",
  ])("%s gets no verdict either way", (t) => {
    const out = p(t);
    expect(out).not.toBeNull();
    expect(out).toMatch(/never seen you/i);
    // no compliment and no insult, whichever way it was asked
    expect(out).not.toMatch(
      /\b(handsome|pretty|beautiful|gorgeous|ugly|lovely looking)\b/i,
    );
  });

  it.each(["do you like me", "what do you think of me", "do you love me"])(
    "%s stays friendly without pretending to feel anything",
    (t) => expect(p(t)).toMatch(/say that to everybody/i),
  );

  it.each([
    "how old are you",
    "are you single",
    "where do you live",
    "do you sleep",
  ])("%s is deflected, with no invented biography", (t) => {
    const out = p(t);
    expect(out).toMatch(/keep myself to myself/i);
    // no fabricated age, town, or family
    expect(out).not.toMatch(
      /\b(\d+ years|i live|i'm from|my (wife|husband|family))\b/i,
    );
  });

  it("leaves real questions alone", () => {
    expect(p("what am I owed")).toBeNull();
    expect(p("how many companies am I on")).toBeNull();
  });
});

describe("jokes", () => {
  const ask = (history = []) => jokeReply("tell me a joke", history);

  /** the thread as it looks after n consecutive asks, each one refused */
  const afterAsks = (n, lastReply = "no") =>
    Array.from({ length: n }, (_, i) => [
      { role: "user", content: "tell me a joke" },
      { role: "assistant", content: i === n - 1 ? lastReply : "no" },
    ]).flat();

  it("just tells the joke, no wind-up and no apology after it", () => {
    for (let i = 0; i < 100; i++) {
      const out = ask();
      expect(out).not.toMatch(/I'?ll stick to payroll/i);
      expect(out).not.toMatch(
        /^I (asked|told|tried|would tell) the (accountant|boss)/i,
      );
    }
  });

  it("leaves everything else alone", () => {
    expect(jokeReply("what am I owed", [])).toBeNull();
  });

  /**
   * The thing that made it read like a mail merge. Three jokes numbered 1 2 3
   * is a menu, and a menu is the opposite of a joke.
   */
  it("never sends more than one joke at a time", () => {
    for (let i = 0; i < 300; i++) {
      expect(ask()).not.toMatch(/^\d\. /m);
      expect(ask(afterAsks(4))).not.toMatch(/^\d\. /m);
    }
  });

  it("never tells the same one twice running", () => {
    const isTease = (s) => TEASE_RE.test(s);
    const seen = Array.from({ length: 200 }, () => ask(afterAsks(4))).filter(
      (s) => !isTease(s),
    );
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it("usually refuses the first time, but not always", () => {
    const out = Array.from({ length: 300 }, () => ask());
    expect(out.some((s) => TEASE_RE.test(s))).toBe(true);
    expect(out.some((s) => !TEASE_RE.test(s))).toBe(true);
  });

  /** never two refusals in a row. the second ask always carries a joke. */
  it("gives in on the second ask", () => {
    for (let i = 0; i < 50; i++) {
      const out = ask(afterAsks(1));
      expect(out).toContain("\n\n");
      expect(out.split("\n\n")[1].length).toBeGreaterThan(10);
    }
  });

  it("just tells one from the third ask on", () => {
    for (let i = 0; i < 50; i++) {
      expect(TEASE_RE.test(ask(afterAsks(3)))).toBe(false);
    }
  });

  /** every joke told once before any is told twice, and never back to back */
  it("works through them all before repeating", () => {
    const deep = afterAsks(3);
    const told = Array.from({ length: 30 }, () => ask(deep));
    // not 30 distinct: 30 draws can cross a bag refill, and a joke from the
    // end of one bag can legitimately reappear near the start of the next.
    // What is guaranteed is plenty of variety and never two in a row.
    expect(new Set(told).size).toBeGreaterThan(20);
    for (let i = 1; i < told.length; i++) {
      expect(told[i]).not.toBe(told[i - 1]);
    }
  });

  /**
   * Anything at all counts as their joke — judging whether it was funny is not
   * a thing to attempt in a regex.
   */
  it("pays off when they answer the challenge", () => {
    const history = [
      { role: "user", content: "tell me a joke" },
      { role: "assistant", content: "You tell me one first." },
    ];
    // the challenge is one of the teases, so it is reachable on a first ask
    const out = jokeReply("why did the chicken cross the road", history);
    expect(out).toMatch(/weird|terrible|cannot believe/i);
    expect(out.split("\n\n")).toHaveLength(2);
  });

  /**
   * Going away, asking something real, then coming back is a FRESH ask — the
   * run has to be broken by anything that is not a joke request.
   */
  it("starts the ladder over after a real question", () => {
    const history = [
      { role: "user", content: "tell me a joke" },
      { role: "assistant", content: "no" },
      { role: "user", content: "what am I owed" },
      { role: "assistant", content: "figures" },
    ];
    const out = Array.from({ length: 100 }, () =>
      jokeReply("tell me a joke", history),
    );
    // a fresh ask, so it can tease. what it must never do is open with the
    // second-ask lead-in, which only belongs after a refusal.
    expect(out.every((s) => !s.startsWith("Right. Here we go again."))).toBe(
      true,
    );
  });
});
