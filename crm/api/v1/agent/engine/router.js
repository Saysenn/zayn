const env = require('../../../configs/env');
const { getClient } = require('../chatClient');

/**
 * ***************************************************
 * * THE FRONT DOOR: what kind of message is this?
 * ***************************************************
 *
 * The admin's call 2026-10-06, the router pattern. One small model call with
 * one narrow job, CLASSIFY, answered from fixed choices, so the answer is
 * always in a shape code can follow. It replaces the keyword guesses that
 * were spread through runAgent (looksMultiStep, lightTurn, isSetInstruction
 * and friends) for the decision of WHICH PATH a message takes:
 *
 *   single_edit   one change to one person  → checked in code, the tool directly
 *   bulk_edit     one change to many         → the plan engine (or her, for a whole group)
 *   multi_step    several changes            → the plan engine
 *   question      something to find or tell  → her, on the light model
 *   undo          put something back         → her undo, which always asks
 *   chat / other  anything else              → her, as before
 *
 * It decides the path, never the change: every value it gives is checked
 * against the sheet before anything is written, and anything it is unsure
 * of goes to her as before.
 */

const KINDS = ['single_edit', 'bulk_edit', 'multi_step', 'question', 'undo', 'chat', 'other'];
const FIELDS = ['', 'monthlyAmount', 'payableAmount', 'payableDays', 'notes', 'label', 'currency', 'paymentMethod', 'presetOn', 'endOn',
  'assignedOn', 'paymentStartOn', 'roleLabel', 'company', 'phone', 'overridePaid'];

const ROUTE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'sure', 'person', 'group', 'everyDeal', 'field', 'op', 'value'],
  properties: {
    kind: { type: 'string', enum: KINDS },
    sure: { type: 'boolean' },
    person: { type: 'string' },
    group: { type: 'string' },
    everyDeal: { type: 'boolean' },
    field: { type: 'string', enum: FIELDS },
    op: { type: 'string', enum: ['', 'set', 'add'] },
    value: { type: 'string' },
  },
};

const PROMPT = [
  'Classify ONE message sent to a payroll CRM assistant. Answer only from the choices.',
  'single_edit: ONE change to ONE named person\'s deal (set a field, add/deduct an amount or days, mark paid).',
  'bulk_edit: one change to several people, a whole group, everyone, or all of one person\'s deals.',
  'multi_step: two or more DIFFERENT changes in one message.',
  'question: they want something found, listed, counted, totalled or explained. Nothing changes.',
  'undo: they want a change put back. chat: greetings, thanks, small talk. other: anything else, or a mix of a change and a question.',
  'For single_edit fill: person (as written), group (only if named), everyDeal (true if they said all/both/every of that person\'s deals),',
  'field, op ("add" when moving BY an amount: add, deduct (negative value), plus, minus; "set" when giving the new value), value',
  '(a plain number for amounts/days; YYYY-MM-DD for dates; "true"/"false" for paid). "add/deduct N" with no field named is monthlyAmount.',
  '"N days" is payableDays. Use "" for anything not given. sure: false if the message is unclear or could mean two things.',
  'A later month ("from next month", "in november") is never single_edit: use other.',
  '"add X and Y" or "X plus Y" with NO amount means add up their totals: question. A change is never asked',
  'without a figure or a value to set. A bare name, group or month on its own is an answer to something earlier: other.',
].join('\n');

/**
 * @param {string} said their message
 * @param {{ lastAnswer?: string, groups?: string[], client?: object, model?: string }} opts
 * @returns {Promise<object|null>} the route, or null when it cannot be asked
 */
async function route(said, { lastAnswer = '', groups = [], client = null, model = null } = {}) {
  const openai = client ?? getClient();
  if (!openai || !String(said ?? '').trim()) return null;
  const res = await openai.chat.completions.create({
    model: model ?? env.openaiModel,
    temperature: 0,
    messages: [
      { role: 'system', content: `${PROMPT}\nGroups: ${groups.join(', ')}.` },
      ...(lastAnswer ? [{ role: 'assistant', content: String(lastAnswer).slice(0, 600) }] : []),
      { role: 'user', content: String(said) },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'route', strict: true, schema: ROUTE } },
  });
  return JSON.parse(res.choices?.[0]?.message?.content ?? 'null');
}

const NUMBER_FIELDS = new Set(['monthlyAmount', 'payableAmount', 'payableDays']);

/**
 * A SINGLE EDIT IT IS SURE OF, as the edit the parser would have read
 * (directEdit.js), so it takes the same road to the tool. Null when any part
 * is missing or not a clean value: then she reads it as before.
 */
function asEdit(r) {
  if (!r || r.kind !== 'single_edit' || !r.sure || !r.person || !r.field || !r.op || r.value === '') return null;
  let value = r.value;
  if (NUMBER_FIELDS.has(r.field)) {
    value = Number(String(r.value).replace(/,/g, ''));
    if (!Number.isFinite(value)) return null;
  } else if (r.field === 'overridePaid') {
    value = /^(?:true|yes|paid)$/i.test(r.value);
  } else if (r.op === 'add') {
    return null;
  }
  return {
    person: r.person, group: r.group || null, allDeals: Boolean(r.everyDeal), field: r.field, op: r.op, value,
  };
}

module.exports = { route, asEdit, KINDS };
