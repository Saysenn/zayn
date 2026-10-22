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
 * ===============================
 * * MONEY SAID AS MONEY
 * ===============================
 * "AED 8,400" was read out as dollars (his screenshot 2026-10-22): the voice
 * guesses a currency code, and guesses wrong. Every code and symbol becomes
 * its word before it is spoken, the amount first, as a person says it. The
 * screen keeps the code.
 */
const CURRENCY_WORDS = {
  AED: ['dirham', 'dirhams'], GBP: ['pound', 'pounds'], USD: ['dollar', 'dollars'], EUR: ['euro', 'euros'],
  USDT: ['tether', 'tether'], PHP: ['peso', 'pesos'], INR: ['rupee', 'rupees'],
};
const SYMBOLS = { '£': 'GBP', $: 'USD', '€': 'EUR' };
const AMOUNT = '(-?\\d[\\d,]*(?:\\.\\d+)?)(\\s?(?:k|m|million|thousand)\\b)?';
function sayMoney(text) {
  const word = (code, amount) => {
    const [one, many] = CURRENCY_WORDS[code];
    return /^-?1(?:\.0+)?$/.test(amount.replace(/,/g, '')) ? one : many;
  };
  const codes = Object.keys(CURRENCY_WORDS).join('|');
  return String(text ?? '')
    // "AED 8,400", "GBP 2,900.00"
    .replace(new RegExp(`\\b(${codes})\\s?${AMOUNT}`, 'g'), (m, code, n, unit = '') => `${n}${unit} ${word(code, n)}`)
    // "8,400 AED"
    .replace(new RegExp(`${AMOUNT}\\s?(${codes})\\b`, 'g'), (m, n, unit = '', code) => `${n}${unit} ${word(code, n)}`)
    // "£500", "$1,200", "€30"
    .replace(new RegExp(`([£$€])\\s?${AMOUNT}`, 'g'), (m, sym, n, unit = '') => `${n}${unit} ${word(SYMBOLS[sym], n)}`)
    // A code alone ("paid in AED"): its word.
    .replace(new RegExp(`\\b(${codes})\\b`, 'g'), (m, code) => CURRENCY_WORDS[code][1]);
}

/**
 * Text -> an mp3 Buffer. Throws AppError-shaped errors are the caller's
 * job to translate (route stays thin) — this just does the one call.
 */
/** @param {{ persona?: 'lawyer' | null }} [opts] the lawyer's own voice in lawyer mode */
async function synthesizeSpeech(text, { persona = null } = {}) {
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
  const trimmed = sayMoney(text).slice(0, MAX_CHARS);
  if (text.length > MAX_CHARS) {
    logger.warn(
      { length: text.length, max: MAX_CHARS, lost: text.length - MAX_CHARS },
      'diane: speech text arrived over the provider cap and was cut. The caller should chunk.',
    );
  }
  const response = await openai.audio.speech.create({
    model: env.openaiTtsModel,
    voice: persona === 'lawyer' ? env.openaiTtsLawyerVoice : env.openaiTtsVoice,
    input: trimmed,
    // Ignored by tts-1, honoured by gpt-4o-mini-tts. Sent unconditionally
    // so switching the model back is an env change and not a code one.
    instructions: persona === 'lawyer' ? env.openaiTtsLawyerInstructions : env.openaiTtsInstructions,
    response_format: 'mp3',
  });

  return Buffer.from(await response.arrayBuffer());
}

module.exports = { synthesizeSpeech, sayMoney, isConfigured: () => env.canSpeak };
