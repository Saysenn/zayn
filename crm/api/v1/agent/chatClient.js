const OpenAI = require('openai');
const env = require('../../configs/env');

// ***************************************************
// * Diane's model client, one for every caller
// ***************************************************
//
// Null when no key is set: every caller treats that as "she cannot think".

let client = null;

function getClient() {
  if (!env.openaiApiKey) return null;
  if (!client) {
    client = new OpenAI({ apiKey: env.openaiApiKey, baseURL: env.openaiBaseUrl || undefined });
  }
  return client;
}

module.exports = { getClient };
