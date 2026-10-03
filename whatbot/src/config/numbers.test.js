import { describe, expect, it } from "vitest";
import { fromJid, groupForNumber, numberForGroup, toJid } from "./numbers.js";

/**
 * The E.164 ↔ JID boundary. Everything above it speaks E.164 and everything
 * below speaks JID, so a bug here misroutes a reply or misidentifies a sender —
 * and misidentifying a sender is how someone sees another person's pay.
 */
describe("toJid", () => {
  it("drops the plus", () => {
    expect(toJid("+447700900123")).toBe("447700900123@s.whatsapp.net");
  });

  it("accepts a number that already has no plus", () => {
    expect(toJid("447700900123")).toBe("447700900123@s.whatsapp.net");
  });
});

describe("fromJid", () => {
  it("restores the plus", () => {
    expect(fromJid("447700900123@s.whatsapp.net")).toBe("+447700900123");
  });

  it("strips the multi-device suffix", () => {
    // The same person messaging from their phone and their laptop arrives with
    // different suffixes. Keeping them would make one employee look like two
    // senders — one of whom matches no employee record at all.
    expect(fromJid("447700900123:12@s.whatsapp.net")).toBe("+447700900123");
  });

  it("round-trips", () => {
    expect(fromJid(toJid("+447700900123"))).toBe("+447700900123");
  });
});

describe("group lookup", () => {
  it("maps a configured number to its group", () => {
    expect(groupForNumber("+14155238886")).toBe("test");
  });

  it("returns undefined for a number we do not own", () => {
    expect(groupForNumber("+447700900999")).toBeUndefined();
  });

  it("maps back from group to number", () => {
    expect(numberForGroup("test")).toBe("+14155238886");
  });

  it("round-trips both ways", () => {
    expect(groupForNumber(numberForGroup("test"))).toBe("test");
  });
});
