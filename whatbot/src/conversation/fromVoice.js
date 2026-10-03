import { transcribe } from "../agent/transcribe.js";
import { features, voiceConfig } from "../config/index.js";
import { logger } from "../system/logger.js";

/**
 * A voice note in, a question out — or the honest reason we have none.
 *
 * Answered in code, before the model, like every other policy answer in this
 * folder: the same situation gets the same sentence every time. Someone who
 * sends a voice note and hears nothing back assumes we got it, so every path
 * out of here produces something to say.
 *
 * We listen; we never speak. Replies are always text, because every figure is
 * formatted in code to read exactly as written — spoken aloud it becomes
 * whatever a text-to-speech engine makes of it, and a wage is something people
 * re-read.
 */

/** FEATURE_VOICE is off. No hint that it might work later — it might not. */
// Commas and full stops only, like every other sentence we send. A dash is what
// makes text look generated, and people type commas.
const CANNOT_HEAR =
  "I can't listen to voice notes, sorry. Could you type it instead?";

/** we had audio but got no words out of it, or the model was unreachable */
const COULD_NOT_HEAR =
  "Sorry, I couldn't make that out. Could you send it again, or type it?";

/** longer than VOICE_MAX_SECONDS, so it was never downloaded */
const TOO_LONG =
  "That one's a bit long for me to listen to. A shorter note, or just type it?";

/** either the words they said, or what to send them instead */

export async function heardFromVoice(voice) {
  if (!features.voice) return { ok: false, reply: CANNOT_HEAR };

  if (!voice.audioBase64) {
    // no audio and the feature is on: either too long to fetch, or the download
    // failed. Length is the one we can explain, so explain it.
    const tooLong = voice.seconds > voiceConfig.maxSeconds;
    logger.info(
      { seconds: voice.seconds, tooLong },
      "voice note arrived without audio",
    );
    return { ok: false, reply: tooLong ? TOO_LONG : COULD_NOT_HEAR };
  }

  const text = await transcribe(Buffer.from(voice.audioBase64, "base64"));
  if (!text) return { ok: false, reply: COULD_NOT_HEAR };

  return { ok: true, text };
}
