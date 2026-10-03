import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The rule these guard: every path out of `heardFromVoice` produces something
 * to send. A voice note that gets silence reads as "it got it", and then they
 * wait for an answer that is never coming.
 */

const transcribe = vi.fn();
const features = { voice: true, documents: false };

vi.mock("../agent/transcribe.js", () => ({ transcribe: (b) => transcribe(b) }));
vi.mock("../config/index.js", () => ({
  features,
  voiceConfig: { model: "whisper-large-v3", maxSeconds: 120 },
  // the logger is built from config at import — mock the whole module and it
  // has to come with one, or nothing in the chain can import
  loggerConfig: { level: "silent" },
}));

const { heardFromVoice } = await import("./fromVoice.js");

const someAudio = Buffer.from("pretend this is opus").toString("base64");

beforeEach(() => {
  transcribe.mockReset();
  features.voice = true;
});

describe("heardFromVoice", () => {
  it("gives back what they said", async () => {
    transcribe.mockResolvedValue("what am I owed this month");

    const heard = await heardFromVoice({ audioBase64: someAudio, seconds: 4 });

    expect(heard).toEqual({ ok: true, text: "what am I owed this month" });
  });

  it("says we cannot listen when the feature is off, and never transcribes", async () => {
    features.voice = false;

    const heard = await heardFromVoice({ audioBase64: someAudio, seconds: 4 });

    expect(heard.ok).toBe(false);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("explains the length when the note was too long to fetch", async () => {
    const heard = await heardFromVoice({ seconds: 300 });

    expect(heard.ok).toBe(false);
    if (!heard.ok) expect(heard.reply).toMatch(/long/i);
  });

  it("asks them to try again when the download failed", async () => {
    const heard = await heardFromVoice({ seconds: 4 });

    expect(heard.ok).toBe(false);
    if (!heard.ok) expect(heard.reply).toMatch(/couldn't make that out/i);
  });

  it("asks them to try again when transcription came back empty", async () => {
    transcribe.mockResolvedValue(null);

    const heard = await heardFromVoice({ audioBase64: someAudio, seconds: 4 });

    expect(heard.ok).toBe(false);
    if (!heard.ok) expect(heard.reply).toMatch(/couldn't make that out/i);
  });

  it("always has something to say", async () => {
    transcribe.mockResolvedValue(null);

    const cases = [
      { audioBase64: someAudio, seconds: 4 },
      { seconds: 4 },
      { seconds: 999 },
    ];

    for (const c of cases) {
      const heard = await heardFromVoice(c);
      const said = heard.ok ? heard.text : heard.reply;
      expect(said.length, JSON.stringify(c)).toBeGreaterThan(0);
    }
  });
});
