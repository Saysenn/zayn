const { getClient } = require('./chatClient');
const { noteAiFailure } = require('./aiStatus');
const env = require('../../configs/env');
const logger = require('../../configs/logger');

/**
 * ONE PARAGRAPH ABOUT WHAT A CONVERSATION DECIDED.
 *
 * This is the step that makes recall worth having. Searching raw chat
 * mostly retrieves greetings and "one moment, dear"; searching a paragraph
 * about what was settled retrieves decisions.
 *
 * WRITTEN IN THE SAME REQUEST AS THE SAVE, because the conversation is
 * only stored when it ends, so there is exactly one moment to do it and no
 * background sweep to run.
 *
 * A FAILURE HERE MUST NEVER LOSE THE CONVERSATION. The caller saves the
 * transcript either way and the summary is filled in on a later attempt.
 * Returning null is a normal outcome, not an error.
 */

// Enough to summarise from without paying for a whole long transcript.
// The tail, not the head: the end of a conversation is where the decisions
// are, and the opening is where the greeting is.
const MAX_CHARS = 12000;
const SUMMARY_MAX_TOKENS = 400;

const SUMMARY_VERSION = 2;

const PROMPT = `Summarise this conversation between an admin and Diane, the CRM assistant.

Write it for somebody searching it back in six months who was not there.

Return JSON with exactly these fields:
{"text":"one short searchable paragraph","topics":[],"decisions":[],"corrections":[],"preferences":[],"unresolved":[]}

Keep every array short and use plain sentences. Record only what the admin confirmed or asked to keep.
Do not include greetings, pleasantries, or mechanical descriptions.
Do not state figures as current facts. Say what was discussed or changed because the live sheet owns current values.
If nothing was decided or changed, say so in text and leave the arrays empty.
Return JSON only.`;

const list = (value) => (Array.isArray(value)
  ? value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 12)
  : []);

function parseMemory(content) {
  const raw = String(content ?? '').trim();
  if (!raw) return null;

  try {
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(clean);
    const text = String(parsed?.text ?? '').trim();
    if (!text) return null;
    return {
      text,
      topics: list(parsed.topics),
      decisions: list(parsed.decisions),
      corrections: list(parsed.corrections),
      preferences: list(parsed.preferences),
      unresolved: list(parsed.unresolved),
      version: SUMMARY_VERSION,
    };
  } catch {
    return {
      text: raw,
      topics: [], decisions: [], corrections: [], preferences: [], unresolved: [],
      version: SUMMARY_VERSION,
    };
  }
}

function transcriptOf(messages) {
  const text = messages
    .map((m) => `${m.role === 'user' ? 'Admin' : 'Diane'}: ${m.content}`)
    .join('\n');
  // The TAIL. See MAX_CHARS above.
  return text.length > MAX_CHARS ? text.slice(-MAX_CHARS) : text;
}

/**
 * @returns {Promise<object|null>} the memory, or null if it could not be
 *   written. Never throws: the caller has a transcript to save regardless.
 */
async function summarise(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const openai = getClient();
  if (!openai) return null;

  try {
    const res = await openai.chat.completions.create({
      model: env.openaiModel,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: transcriptOf(messages) },
      ],
      // Short on purpose. A summary that runs to a page is a second
      // transcript, and the thing it exists to avoid is reading the first.
      max_tokens: SUMMARY_MAX_TOKENS,
      temperature: 0.2,
    });
    return parseMemory(res.choices?.[0]?.message?.content);
  } catch (err) {
    logger.error({ err }, 'diane: summarising a conversation failed');
    noteAiFailure(err);
    return null;
  }
}

module.exports = { summarise, parseMemory, SUMMARY_VERSION };
