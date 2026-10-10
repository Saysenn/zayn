import { describe, expect, it } from "vitest";
import { optOutIntent } from "./optOut.js";

describe("optOutIntent", () => {
  it.each([
    "STOP",
    "stop",
    "Stop please",
    "unsubscribe",
    "quit",
  ])("treats %s as opting out", (t) => expect(optOutIntent(t)).toBe("stop"));

  // 2026-10-10: an expense admin's "cancel" (of a preview) opted them out of every message
  it.each(["cancel", "CANCEL", "end", "cancel that"])("never opts out on %s", (t) =>
    expect(optOutIntent(t)).toBeNull(),
  );

  it.each(["START", "start", "unstop", "resume", "Subscribe"])(
    "treats %s as opting back in",
    (t) => expect(optOutIntent(t)).toBe("start"),
  );

  it.each([
    "what is my pay",
    "stopped working last month",
    "can you cancel my overtime query",
    "how many people do I handle",
  ])("leaves %s as a normal question", (t) =>
    expect(optOutIntent(t)).toBeNull(),
  );
});
