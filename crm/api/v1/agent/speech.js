const OpenAI = require('openai');
const env = require('../../configs/env');
const logger = require('../../configs/logger');

/**
 * Diane speaking out loud with a real, consistent voice — server-side
 * OpenAI TTS, not the browser's own SpeechSynthesis (which only offers
 * whatever voices happen to be installed on that particular visitor's
 * machine, uncontrollable once this is hosted publicly). See
 * useOpenaiSpeech.js on the frontend for the other half of this.
 *
 * Deliberately a separate client from runAgent.js's chat model — that one
 * is pointed at Groq (env.openaiBaseUrl), which has no /audio/speech
 * endpoint. This always talks to the real OpenAI API directly, using its
 * own key (env.openaiTtsApiKey), so the two can be configured (or left
 * unconfigured) completely independently.
 */
let client = null;
function getClient() {
  if (!env.canSpeak) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: env.openaiTtsApiKey,
      baseURL: env.openaiTtsBaseUrl || undefined,
    });
  }
  return client;
}

// The PROVIDER's own /audio/speech limit, not a policy of ours. It used to
// be 2000 "so a reply is never a wall of text", which silently dropped the
// end of anything longer: the full text is on screen, so nothing shows that
// the ear got less. The client splits at sentence ends and queues the
// parts, so this should never bite.
const MAX_CHARS = 4096;

/**
 * Text -> an mp3 Buffer. Throws AppError-shaped errors are the caller's
 * job to translate (route stays thin) — this just does the one call.
 */
async function synthesizeSpeech(text) {
  const openai = getClient();
  if (!openai) {
    const err = new Error(
      'No speech key is configured. Set AI_PROVIDER=openai with AI_API_KEY, or SPEECH_API_KEY.',
    );
    err.status = 503;
    throw err;
  }

  /**
   * A CAP YOU CANNOT HEAR IS THE BUG. This cut silently, so a reply over
   * the provider's limit lost its tail mid sentence and nothing anywhere
   * said so: on screen it was complete, in the ear it stopped.
   *
   * The caller chunks well under this, so arriving here over the limit is
   * a caller that stopped chunking rather than an admin who typed a lot.
   * Logged as the fault it is, and still spoken rather than refused: most
   * of the answer out loud beats silence.
   */
  const trimmed = text.slice(0, MAX_CHARS);
  if (text.length > MAX_CHARS) {
    logger.warn(
      { length: text.length, max: MAX_CHARS, lost: text.length - MAX_CHARS },
      'diane: speech text arrived over the provider cap and was cut. The caller should chunk.',
    );
  }
  const response = await openai.audio.speech.create({
    model: env.openaiTtsModel,
    voice: env.openaiTtsVoice,
    input: trimmed,
    // Ignored by tts-1, honoured by gpt-4o-mini-tts. Sent unconditionally
    // so switching the model back is an env change and not a code one.
    instructions: env.openaiTtsInstructions,
    response_format: 'mp3',
  });

  return Buffer.from(await response.arrayBuffer());
}

module.exports = { synthesizeSpeech, isConfigured: () => env.canSpeak };
