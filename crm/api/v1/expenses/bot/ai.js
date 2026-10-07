const env = require('../../../configs/env');
const { getClient } = require('../../agent/chatClient');
const logger = require('../../../configs/logger');

// ***************************************************
// * EVERY MODEL CALL THE EXPENSE BOT MAKES, AND WHAT IT COST
// ***************************************************
//
// One door, so every call answers in a strict JSON schema (code can always
// follow it) and every token is counted. The full model reads receipts and
// messy text; the light one only sorts a message into a kind.

const FULL = env.openaiModel || 'gpt-4.1';
const LIGHT = (process.env.AI_MODEL_LIGHT ?? 'gpt-4.1-mini').trim() === 'off' ? FULL : (process.env.AI_MODEL_LIGHT ?? 'gpt-4.1-mini').trim();

// US$ per million tokens, input / output.
const PRICE = { 'gpt-4.1': [2, 8], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4] };

const meter = { calls: 0, dollars: 0 };

function cost(model, usage) {
  const [i, o] = PRICE[model] ?? PRICE['gpt-4.1'];
  return ((usage?.prompt_tokens ?? 0) * i + (usage?.completion_tokens ?? 0) * o) / 1e6;
}

/**
 * @param {{ light?: boolean, system: string, user: string|object[], schema: object, name: string, client?: object }} req
 * @returns {Promise<object>} the parsed answer
 */
async function ask({ light = false, system, user, schema, name, client = null }) {
  const openai = client ?? getClient();
  if (!openai) throw Object.assign(new Error('no AI key'), { code: 'NO_AI' });
  const model = light ? LIGHT : FULL;
  const res = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
  });
  const spent = cost(model, res.usage);
  meter.calls += 1;
  meter.dollars += spent;
  logger.info({ model, call: name, tokensIn: res.usage?.prompt_tokens, tokensOut: res.usage?.completion_tokens, usd: Number(spent.toFixed(5)), usdTotal: Number(meter.dollars.toFixed(4)) }, 'expense bot: model call');
  return JSON.parse(res.choices?.[0]?.message?.content ?? '{}');
}

module.exports = { ask, meter, FULL, LIGHT };
