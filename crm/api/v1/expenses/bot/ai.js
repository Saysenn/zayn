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
// a prompt prefix OpenAI already has cached is billed at a quarter (gpt-4.1 family)
const CACHED_SHARE = 0.25;

const meter = { calls: 0, dollars: 0 };

function cost(model, usage) {
  // newer models are priced from AI_PRICE_IN / AI_PRICE_OUT ($ per 1M) until listed
  const [i, o] = PRICE[model] ?? (process.env.AI_PRICE_IN ? [Number(process.env.AI_PRICE_IN), Number(process.env.AI_PRICE_OUT ?? 0)] : PRICE['gpt-4.1']);
  const input = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const cached = Math.min(input, usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0);
  return ((input - cached) * i + cached * i * CACHED_SHARE + (usage?.completion_tokens ?? usage?.output_tokens ?? 0) * o) / 1e6;
}

/**
 * ***************************************************
 * * V2: A CURRENT MODEL THROUGH THE RESPONSES API (2026-10-09)
 * ***************************************************
 * Off unless EXPENSE_V2=1, scored against v1 on the expense harness first.
 * The same strict schema and the same prompts: what changes is the model
 * (gpt-4.1 → EXPENSE_V2_MODEL, gpt-5.4; light gpt-4.1-mini →
 * EXPENSE_V2_LIGHT, gpt-5.4-mini) and the API, the one newer models answer
 * on with reasoning (EXPENSE_V2_EFFORT, low). No temperature: reasoning
 * models take none. A test's fake client without `responses` stays on v1.
 */
const V2 = process.env.EXPENSE_V2 === '1';
const V2_FULL = process.env.EXPENSE_V2_MODEL || 'gpt-5.4';
const V2_LIGHT = process.env.EXPENSE_V2_LIGHT || 'gpt-5.4-mini';
const V2_EFFORT = process.env.EXPENSE_V2_EFFORT || 'low';

/** Chat Completions content parts → the Responses API's */
const asInput = (user) => (typeof user === 'string' ? user : user.map((p) => (
  p.type === 'text' ? { type: 'input_text', text: p.text }
    : p.type === 'image_url' ? { type: 'input_image', image_url: p.image_url.url, detail: p.image_url.detail ?? 'auto' }
      : p.type === 'file' ? { type: 'input_file', filename: p.file.filename, file_data: p.file.file_data }
        : p)));

async function askV2(openai, { light, system, user, schema, name }) {
  const model = light ? V2_LIGHT : V2_FULL;
  const res = await openai.responses.create({
    model,
    instructions: system,
    input: [{ role: 'user', content: asInput(user) }],
    reasoning: { effort: V2_EFFORT },
    text: { format: { type: 'json_schema', name, strict: true, schema } },
  });
  const spent = cost(model, res.usage);
  meter.calls += 1;
  meter.dollars += spent;
  logger.info({ model, call: name, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens, usd: Number(spent.toFixed(5)), usdTotal: Number(meter.dollars.toFixed(4)) }, 'expense bot: model call (v2)');
  return JSON.parse(res.output_text || '{}');
}

/**
 * @param {{ light?: boolean, system: string, user: string|object[], schema: object, name: string, client?: object }} req
 * @returns {Promise<object>} the parsed answer
 */
async function ask({ light = false, system, user, schema, name, client = null }) {
  const openai = client ?? getClient();
  if (!openai) throw Object.assign(new Error('no AI key'), { code: 'NO_AI' });
  if (V2 && openai.responses?.create) return askV2(openai, { light, system, user, schema, name });
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

/**
 * ONE ROUND OF THE EXPENSE AGENT (EXPENSE_AGENT=on): the full model, the
 * conversation so far, and its tools. Counted on the same meter.
 * @returns {Promise<object>} the assistant message (content and/or tool_calls)
 */
async function askTools({ messages, tools, client = null, light = false }) {
  const openai = client ?? getClient();
  if (!openai) throw Object.assign(new Error('no AI key'), { code: 'NO_AI' });
  const model = light ? LIGHT : FULL;
  const res = await openai.chat.completions.create({ model, temperature: 0, messages, tools, tool_choice: 'auto', parallel_tool_calls: true });
  const spent = cost(model, res.usage);
  meter.calls += 1;
  meter.dollars += spent;
  logger.info({ model, call: 'agent', tokensIn: res.usage?.prompt_tokens, cached: res.usage?.prompt_tokens_details?.cached_tokens ?? 0, tokensOut: res.usage?.completion_tokens, usd: Number(spent.toFixed(5)), usdTotal: Number(meter.dollars.toFixed(4)) }, 'expense bot: model call');
  return res.choices?.[0]?.message ?? { content: '' };
}

module.exports = { ask, askTools, meter, FULL, LIGHT };
