const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const env = require('../../configs/env');

/**
 * Voice INPUT — an audio clip recorded in the browser, transcribed to text
 * server-side.
 *
 * ---- why this exists ----
 * The browser's own SpeechRecognition (useSpeechRecognition.js) works by
 * streaming audio to Google's servers. That's outside our control and it
 * genuinely fails on some machines with a bare `network` error — nothing
 * to do with microphone permission, which is why a site like YouTube can
 * record fine on a machine where Diane cannot hear a word. This replaces
 * it with a transcription we actually own the path to.
 *
 * ---- its own provider, not the chat one ----
 * Only Groq and OpenAI serve /audio/transcriptions. Cerebras, Gemini and
 * OpenRouter don't, so tying this to AI_PROVIDER would mean switching
 * chat models silently broke the microphone — with a 404 that reads like
 * a bug rather than a missing feature.
 *
 * So env.js resolves this separately: it reuses the chat provider's key
 * when that provider can transcribe, and otherwise takes
 * TRANSCRIBE_PROVIDER/TRANSCRIBE_API_KEY. Unconfigured means the mic
 * button hides, not that pressing it fails.
 */

let client = null;
function getClient() {
  if (!env.canTranscribe) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: env.transcribeApiKey,
      baseURL: env.transcribeBaseUrl || undefined,
    });
  }
  return client;
}

/**
 * An audio Buffer -> the words in it.
 *
 * `filename` matters more than it looks: both providers pick the decoder
 * from the extension, and an unrecognised one is rejected outright even
 * when the bytes are fine. The browser tells us what it actually recorded
 * (MediaRecorder's chosen mimeType), and the route maps that to an
 * extension rather than assuming everyone produces webm.
 */
async function transcribeAudio(buffer, filename = 'speech.webm') {
  const openai = getClient();
  if (!openai) {
    const err = new Error(
      "My hearing isn't set up at the moment, dear. Type to me instead and I'll manage just fine.",
    );
    err.status = 503;
    throw err;
  }

  const result = await openai.audio.transcriptions.create({
    file: await toFile(buffer, filename),
    model: env.transcribeModel,
    // Diane's world is UK business admin. Left as a hint, not a hard
    // constraint — it stops "MILKMAN" and "GBP" being transcribed as
    // something phonetically close but wrong.
    language: 'en',
    response_format: 'text',
  });

  // response_format 'text' returns a bare string on both providers, but
  // the SDK types it loosely enough that a JSON-shaped response is worth
  // handling rather than returning "[object Object]" to the chat.
  const text = typeof result === 'string' ? result : result?.text ?? '';
  return stripHallucinations(text.trim());
}

/**
 * Whisper's silence hallucinations, removed.
 *
 * Whisper does not return an empty string for silence. Trained heavily on
 * captioned video, it fills quiet audio with whatever phrase was most
 * common in that data — overwhelmingly "Thank you.", "Thanks for
 * watching!", "you" and "Bye."
 *
 * Here that isn't an occasional oddity, it's guaranteed. Recording stops
 * 1.5 seconds AFTER the admin stops talking (SILENCE_HANG_MS in
 * useVoiceInput.js, three seconds when this was written), so every clip
 * still ends in near-silence and this still has to run. A shorter tail
 * means less of it, not none of it: half a second of room tone is enough
 * for Whisper to produce "Thank you." At three seconds every single
 * transcript came back with it stapled to the end of whatever was
 * actually said, and Diane then answered the thanks.
 *
 * Stripped from the END rather than only matching the whole string,
 * because the damaging case is the one appended to real speech. Anchored
 * and looped so several stacked ("you. Thank you.") all come off.
 */
const HALLUCINATIONS = [
  'thank you', 'thanks for watching', 'thanks', 'thank you very much',
  'bye', 'goodbye', 'you', 'okay', 'ok', 'so', 'uh', 'um',
  'please subscribe', 'subscribe to my channel',
  'thanks for watching!', "i'll see you next time", 'see you next time',
];

function stripHallucinations(text) {
  let out = text;

  // Loop: silence often produces two or three of these in a row.
  for (let pass = 0; pass < 4; pass++) {
    const before = out;
    for (const phrase of HALLUCINATIONS) {
      // Anchored to the end, tolerating trailing punctuation and case.
      const pattern = new RegExp(`[\\s,.!?]*\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s,.!?]*$`, 'i');
      out = out.replace(pattern, '').trim();
    }
    if (out === before) break;
  }

  // Whatever remains has to look like real speech. If stripping consumed
  // everything, the clip WAS silence — return empty, and the frontend
  // sends nothing rather than posting a message the admin never said.
  return out.length >= 2 ? out : '';
}

module.exports = {
  transcribeAudio,
  isConfigured: () => env.canTranscribe,
};
