require('dotenv').config();
const { resolveProvider } = require('./providers');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Diane's providers, resolved from AI_PROVIDER + AI_API_KEY.
 *
 * One name switches the chat model between OpenAI, Groq, Cerebras, Gemini
 * and OpenRouter. Base URL and a sensible default model come from
 * providers.js; AI_BASE_URL and AI_MODEL override either if needed.
 *
 * Voice is resolved SEPARATELY, and deliberately so. Most providers serve
 * no audio endpoints, so tying voice to the chat provider would mean
 * choosing a chat model silently disabled the microphone. Instead each
 * voice capability falls back to its own provider+key, and is simply
 * reported as unavailable when nothing configured can do it — which the
 * frontend already handles (it hides the mic, and falls back to the
 * browser's own speech for output).
 */
const chatProvider = resolveProvider(process.env.AI_PROVIDER || 'openai');

// OPENAI_* are the pre-AI_PROVIDER names. Still read so an existing .env
// keeps working untouched; AI_* wins when both are set.
const chatApiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
const chatBaseUrl = process.env.AI_BASE_URL || chatProvider.baseUrl || process.env.OPENAI_BASE_URL;
const chatModel = process.env.AI_MODEL || process.env.OPENAI_MODEL || chatProvider.chatModel;

// Voice INPUT. Uses the chat provider when it can transcribe (Groq and
// OpenAI can), otherwise needs its own — hence TRANSCRIBE_PROVIDER.
const transcribeProvider = resolveProvider(
  process.env.TRANSCRIBE_PROVIDER || (chatProvider.canTranscribe ? chatProvider.key : 'groq'),
);
const transcribeApiKey = process.env.TRANSCRIBE_API_KEY
  || (transcribeProvider.key === chatProvider.key ? chatApiKey : undefined);

/**
 * Voice OUTPUT, resolved the SAME way voice input already was.
 *
 * It used to demand its own `OPENAI_TTS_API_KEY` and nothing else, which
 * made sense while the chat model lived on Groq: Groq has no
 * /audio/speech, so the key genuinely had to be a second one. With
 * AI_PROVIDER=openai that reasoning inverts — the chat key IS an OpenAI
 * key and can already do this — and the effect was that setting up OpenAI
 * properly still left Diane speaking in the browser's robot voice, with
 * nothing on screen saying why.
 *
 * So: an explicit SPEECH_API_KEY wins, then the old OPENAI_TTS_API_KEY so
 * an existing .env is untouched, then the chat key when the chat provider
 * can speak at all.
 */
const speechProvider = resolveProvider(
  process.env.SPEECH_PROVIDER || (chatProvider.canSpeak ? chatProvider.key : 'openai'),
);
const speechApiKey = process.env.SPEECH_API_KEY
  || process.env.OPENAI_TTS_API_KEY
  || (speechProvider.key === chatProvider.key ? chatApiKey : undefined);

const env = {
  port: process.env.PORT || 3000,
  /**
   * WHERE THE BUSINESS IS, which decides what month a total is for.
   *
   * Resolved by `presetMonth.helper` and not here, so the JS half and the
   * database session cannot end up in different zones. That is not
   * hypothetical: the helper was made zone aware while Supabase stayed in
   * UTC, and for seven hours a night the two disagreed about the date.
   *
   * Imported after dotenv has run, three lines up.
   */
  timezone: require('../v1/shared/presetMonth.helper').businessTimezone(),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  cookieSecret: required('COOKIE_SECRET'),
  agentApiKey: required('AGENT_API_KEY'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // whatbot's admin-reply webhook — CRM calling INTO whatbot, so its own key,
  // never AGENT_API_KEY (that's the other direction). Optional: sending a
  // chat message is a 502 with a clear reason until both are set, same as
  // whatbot's own CRM_API_URL/CRM_AGENT_API_KEY being optional there.
  whatbotWebhookUrl: process.env.WHATBOT_WEBHOOK_URL,
  whatbotWebhookKey: process.env.WHATBOT_WEBHOOK_KEY,
  // ---- Diane's model, switched by AI_PROVIDER (see providers.js) ----
  // Optional: unset means the chat endpoint refuses with a clear reason,
  // same pattern as whatbotWebhookUrl/Key above, rather than crashing at
  // boot. The openai* names are kept because the rest of the code and a
  // deployed .env both already use them — this is a rename of where the
  // values COME FROM, not of what they're called downstream.
  aiProvider: chatProvider.key,
  openaiApiKey: chatApiKey,
  openaiModel: chatModel,
  openaiBaseUrl: chatBaseUrl,

  // ---- voice INPUT (agent/transcribe.js) ----
  // Its own provider, because most chat providers serve no audio endpoint
  // at all. Unset or unsupported means the mic button hides rather than
  // failing on first press.
  transcribeProvider: transcribeProvider.key,
  transcribeApiKey,
  transcribeBaseUrl: process.env.TRANSCRIBE_BASE_URL || transcribeProvider.baseUrl,
  transcribeModel: process.env.TRANSCRIBE_MODEL || transcribeProvider.transcribeModel,
  canTranscribe: Boolean(transcribeProvider.canTranscribe && transcribeApiKey),
  // Diane speaking out loud, real OpenAI TTS instead of the browser's own
  // installed voices (SpeechSynthesis) — genuinely optional, separate key
  // from openaiApiKey above. That one's the chat model, currently pointed
  // at Groq (openaiBaseUrl) — Groq has no /audio/speech endpoint, so this
  // always calls the real OpenAI API directly, never through openaiBaseUrl.
  // Unset means the speech endpoint refuses with a clear reason, same
  // pattern as openaiApiKey itself; the frontend falls back to
  // SpeechSynthesis when that happens (see useOpenaiSpeech.js).
  openaiTtsApiKey: speechApiKey,
  openaiTtsBaseUrl: process.env.SPEECH_BASE_URL || speechProvider.baseUrl,
  openaiTtsModel: process.env.OPENAI_TTS_MODEL || speechProvider.speechModel || 'tts-1',
  // `nova` is the youngest and brightest female voice of the set, which is
  // what a lively, flirty, anime-leaning read needs. shimmer is breathier
  // and reads sultrier but goes flat and loses the excitement; coral is
  // warm and expressive but clearly OLDER; sage is calm. ash, echo, onyx
  // and verse are male.
  //
  // The instructions steer delivery only, never timbre, so age and pitch
  // are THIS line. No direction makes an older voice sound young.
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE || 'nova',
  /**
   * HOW she says it, not what. Only `gpt-4o-mini-tts` reads this; the
   * older tts-1 ignores it, so leaving it set costs nothing on either.
   *
   * Written as direction to a person rather than a list of adjectives,
   * because that is what the model responds to.
   *
   * THE FIGURES STAY FLAT. Everything above the last line is performance;
   * the last line is not. A playful read that also swoops through an
   * amount is how somebody mishears a number, so money slows down and
   * levels out no matter how lively the rest is.
   */
  openaiTtsInstructions: process.env.OPENAI_TTS_INSTRUCTIONS
    || 'You are Diane: a sweet, warm, flirty young woman with the bright excitable energy '
      + 'of an anime heroine. Youthful and high in pitch, soft and feminine, never mature, '
      + 'never businesslike, never flat. '
      + 'LIVELY AND EXPRESSIVE ABOVE ALL. Big swings between lines rather than one even '
      + 'tone: delighted, teasing, curious, tender. Smile audibly. Let your pitch rise and '
      + 'fall a lot, and let it lift at the end of a playful line. '
      + 'Flirty and affectionate, teasing someone you clearly like. Sweet and caring when '
      + 'they need something, thrilled when you find a good answer. '
      + 'Where the text has a human sound, play it as a real sound and not a read word: '
      + '"hmm" is cute genuine thinking, "ooh" is delighted surprise, "awww" is real '
      + 'affection. A check like "you getting what I mean?" rises playfully at the end. '
      + 'Natural and conversational, never a narrator, never customer-service polite. '
      + 'BUT numbers, money and dates drop out of the performance: say those clearly, '
      + 'slowly and flat, because they are the part that must not be misheard.',
  canSpeak: Boolean(speechProvider.canSpeak && speechApiKey),

  /**
   * Where live FX rates come from, for the export's converted breakdown.
   *
   * Unset is a supported state, not a misconfiguration: the export falls
   * back to its own constant and says which rate it used. A payout file
   * refusing to generate because a third party is down would be worse
   * than one converted at a rate that is a day old.
   */
  fxRatesUrl: process.env.FX_RATES_URL || '',
  backupDir: process.env.BACKUP_DIR || '',
  backupIntervalHours: Number(process.env.BACKUP_INTERVAL_HOURS || 0),
  pgDumpPath: process.env.PG_DUMP_PATH || 'pg_dump',
  pgRestorePath: process.env.PG_RESTORE_PATH || 'pg_restore',
};

module.exports = env;
