import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { voiceConfig } from "../config/index.js";
import { logger } from "../system/logger.js";

/**
 * Voice notes, on the way in.
 *
 * Two jobs that belong together because neither is useful alone: spotting that
 * a message is a voice note, and fetching its audio.
 *
 * Downloading happens here, on the socket side, because the media key that
 * unlocks the file lives on the Baileys message and does not survive the queue.
 * TRANSCRIBING does not happen here — that costs money, and a charge has to sit
 * behind the job ID dedupe or a Baileys redelivery pays for the same recording
 * twice. See `agent/transcribe.ts`, called from the worker.
 */

/** what a voice note looks like once we have it */

/**
 * Is this a voice note?
 *
 * `ptt` — push to talk — is the flag WhatsApp sets on something recorded by
 * holding the microphone, as opposed to a music file someone forwarded. We
 * answer the first and ignore the second: a forwarded song is not a question,
 * and transcribing one is money spent on nothing.
 */
export function isVoiceNote(message) {
  return message?.audioMessage?.ptt === true;
}

/** how long it is, in seconds, as WhatsApp recorded it */
export const voiceSeconds = (message) => message?.audioMessage?.seconds ?? 0;

/**
 * Fetch the audio.
 *
 * Returns null rather than throwing — a voice note we cannot download is one
 * unanswered message, and it must not take the other four numbers' messages
 * down with it.
 */
export async function downloadVoiceNote(message) {
  const seconds = voiceSeconds(message.message);

  if (seconds > voiceConfig.maxSeconds) {
    logger.info(
      { seconds, max: voiceConfig.maxSeconds },
      "voice note too long — not downloading",
    );
    return null;
  }

  try {
    const audio = await downloadMediaMessage(message, "buffer", {});
    return { audio: audio, seconds };
  } catch (err) {
    logger.warn({ err, seconds }, "could not download voice note");
    return null;
  }
}
