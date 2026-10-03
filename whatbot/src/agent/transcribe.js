import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { openaiConfig, voiceConfig } from "../config/index.js";
import { logger } from "../system/logger.js";

/**
 * Voice note -> words.
 *
 * The same OpenAI-compatible endpoint the chat model uses, so switching
 * provider is still one env var. Groq and OpenAI both serve Whisper here.
 *
 * This is the only place audio is sent anywhere. What leaves the building is a
 * recording of somebody asking about their own pay — no more than the typed
 * question would be, but it is their voice, so it is worth knowing that this
 * one function is the whole of it.
 */

const client = new OpenAI({
  apiKey: openaiConfig.apiKey,
  baseURL: openaiConfig.baseURL,
  timeout: openaiConfig.requestTimeoutMs,
});

/**
 * Returns the words, or null if it could not.
 *
 * Null covers both "the model was unreachable" and "there was nothing on the
 * tape". The caller says the same thing either way — which is the point: a
 * person holding their phone up in a warehouse does not need to know which.
 */
export async function transcribe(audio) {
  try {
    const result = await client.audio.transcriptions.create({
      // .ogg because that is what WhatsApp records. Whisper picks the decoder
      // off the filename, and gets it wrong when there isn't one.
      file: await toFile(audio, "voice.ogg", { type: "audio/ogg" }),
      model: voiceConfig.model,
      // English. Left to guess, Whisper decides the language from the first
      // second of audio and will happily transcribe a British accent as
      // Welsh, returning fluent nonsense rather than an error.
      language: "en",
      // Whisper invents "Thank you." or "Thanks for watching!" when a clip is
      // short, quiet or starts mid-word. Temperature 0 makes that far rarer.
      temperature: 0,
    });

    const text = result.text.trim();
    if (!text) {
      logger.info({ bytes: audio.length }, "voice note transcribed to nothing");
      return null;
    }

    // Length at info, never the words: a transcript IS the question, and
    // questions about pay do not belong in a log.
    logger.info({ chars: text.length, bytes: audio.length }, "voice note transcribed");

    // The words, at debug only. On in development, off in production.
    // Without this there is no way to tell "it misheard me" from "the model
    // refused", because both look identical from the outside.
    logger.debug({ transcript: text }, "voice transcript");

    return text;
  } catch (err) {
    logger.error({ err }, "transcription failed");
    return null;
  }
}
