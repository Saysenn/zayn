/**
 * Which AI provider Diane runs on, and what each one can actually do.
 *
 * All of these speak the OpenAI wire format, so switching is a base URL, a
 * key and a model name — no code changes. That's the point of this file:
 * `AI_PROVIDER=groq` instead of remembering that Groq's base URL ends in
 * `/openai/v1` while Cerebras's doesn't.
 *
 * The capability flags are NOT decoration. Diane uses three separate
 * endpoints and almost no provider serves all three:
 *
 *   chat        /chat/completions      every provider here
 *   transcribe  /audio/transcriptions  voice INPUT — Groq and OpenAI only
 *   speech      /audio/speech          voice OUTPUT — OpenAI only
 *
 * So "switch to Cerebras" cannot mean "send everything to Cerebras" — it
 * has no audio endpoints at all, and voice input would stop working with
 * a 404 that looks like a bug rather than a missing feature. env.js reads
 * these flags and keeps each capability on a provider that has it.
 */

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    baseUrl: undefined, // the SDK's own default
    chatModel: 'gpt-4.1-mini',
    transcribeModel: 'whisper-1',
    // gpt-4o-mini-tts, not tts-1: it is the only one that takes an
    // `instructions` string, which is what turns a correct-but-flat
    // reading into something with a person behind it. Same speed tier.
    speechModel: 'gpt-4o-mini-tts',
    canTranscribe: true,
    canSpeak: true,
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatModel: 'openai/gpt-oss-120b',
    transcribeModel: 'whisper-large-v3',
    canTranscribe: true,
    canSpeak: false, // no /audio/speech
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    // Checked against the live /models list, not from memory — this
    // account serves only gemma-4-31b and gpt-oss-120b, and a wrong name
    // fails as a bare 404 with no body, which reads like a broken URL
    // rather than a bad model.
    chatModel: 'gpt-oss-120b',
    transcribeModel: null,
    canTranscribe: false,
    canSpeak: false,
  },
  gemini: {
    label: 'Google Gemini',
    // Google's own OpenAI-compatibility layer, so the same SDK works.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    chatModel: 'gemini-2.5-flash',
    transcribeModel: null,
    canTranscribe: false,
    canSpeak: false,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    // OpenRouter namespaces every model by its original vendor.
    chatModel: 'openai/gpt-4.1-mini',
    transcribeModel: null,
    canTranscribe: false,
    canSpeak: false,
  },
};

function resolveProvider(name) {
  const key = String(name || 'openai').trim().toLowerCase();
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(
      `Unknown AI_PROVIDER "${name}". Options: ${Object.keys(PROVIDERS).join(', ')}.`,
    );
  }
  return { key, ...provider };
}

module.exports = { PROVIDERS, resolveProvider };
