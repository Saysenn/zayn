const { ask } = require('./ai');

// ***************************************************
// * THE EXPENSE PLANNER: WHAT THEY WANT, AS A LIST OF OPERATIONS
// ***************************************************
//
// His call 2026-10-07: "it should know and analyze the request properly and
// understand whatever request we give it". The router read ONE kind from ONE
// message with nothing on screen; patterns filled the gaps and broke on the
// next wording. This is the router pattern grown up:
//
//   - it SEES what the admin sees: the numbered list just shown, this
//     month's expenses (with ids), the last ones saved, and what is waiting;
//   - it returns a LIST of operations in a strict shape (change, remove,
//     add, question, confirm, cancel, undo), any number, any mix;
//   - it decides only WHAT they want. Code checks every operation (guard.js)
//     and does the work; nothing is saved without the preview and a yes.
//
// The fast model reads short, simple messages; a list, several operations or
// a long message goes to the full model, which reads it more carefully.

const KINDS = ['change', 'remove', 'drop', 'add', 'question', 'confirm', 'cancel', 'undo', 'about_preview', 'chat', 'unclear'];
const CATEGORIES = ['fuel', 'travel', 'food', 'office', 'bills', 'other'];
const nul = (type) => ({ type: [type, 'null'] });

const OP = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'ids', 'match', 'set', 'adjust', 'shift_days', 'text', 'ask'],
  properties: {
    kind: { type: 'string', enum: KINDS },
    ids: { type: 'array', items: { type: 'integer' } },
    match: { type: 'string' },
    set: {
      type: 'object',
      additionalProperties: false,
      required: ['amount', 'currency', 'date', 'payee', 'description', 'spent_by', 'category'],
      properties: {
        amount: nul('number'), currency: nul('string'), date: nul('string'), payee: nul('string'),
        description: nul('string'), spent_by: nul('string'), category: { type: ['string', 'null'], enum: [...CATEGORIES, null] },
      },
    },
    adjust: {
      type: 'object',
      additionalProperties: false,
      required: ['by', 'percent', 'times'],
      properties: { by: nul('number'), percent: nul('number'), times: nul('number') },
    },
    shift_days: nul('integer'),
    text: { type: 'string' },
    ask: { type: 'string' },
  },
};
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ops', 'sure'],
  properties: { ops: { type: 'array', items: OP }, sure: { type: 'boolean' } },
};

const SYSTEM = [
  'You read ONE WhatsApp message from a company admin to an EXPENSES bot and say what they want as a list of operations.',
  'You never change anything yourself: code checks each operation, shows a preview and waits for their yes.',
  '',
  'CONTEXT you are given: today, the group, the NUMBERED LIST the bot just showed (if any), the expenses saved this month',
  '(each with its id), the ones saved last, and anything WAITING for their yes (a preview of new expenses, or changes/removals).',
  '',
  'OPERATIONS (one per thing they ask; a message can hold many, of any kinds):',
  '- change: an expense ALREADY SAVED gets new values. ids = the expense ids it means (from the context).',
  '  set = new absolute values (only what they changed; null for the rest). amount is a plain number; date is YYYY-MM-DD;',
  '  currency a 3-letter code; category one of fuel, travel, food, office, bills, other.',
  '  adjust = a change RELATIVE to the current amount: by (+80 / -40), percent (+10 / -20), times (0.5 for half). Never',
  '  work it out yourself; give the adjustment and code applies it. shift_days moves the date (+1 = a day later).',
  '  Several expenses with the same change: one op with all their ids. Different values: one op each.',
  '  "Swap the amounts of A and B": two ops, A set to B\'s amount and B to A\'s (read them from the context).',
  '- remove: delete saved expenses. ids = all of them ("everything from the 6th except the petrol" = those ids, not the petrol).',
  '- drop: take expenses OUT of what is WAITING ("not the cleaner", "leave the taxi out"); ids = those expenses (only ones that wait).',
  '- While something WAITS: "and the X" / "also the X" / "the X too" = the SAME action on X (a removal waits → remove X).',
  '  "actually no, the X" / "I meant the X" = swap: drop the LAST one that waits and do the same action on X.',
  '- add: a NEW expense (something bought/paid that is not already saved). text = that expense as they said it.',
  '  A message giving an amount and what/where/who was paid ("taxi 45 paid to careem today", "- lunch 30 zuma") is NEW,',
  '  even when a similar one is saved. It is a change ONLY when they say a saved one is wrong or should differ',
  '  ("the taxi was 50", "change", "should be", "actually", "not 45", a number from the list).',
  '- question: they ask about saved expenses (totals, lists, biggest, by category...). text = the question in plain words.',
  '- confirm (yes / save it), cancel (no / leave it), undo (take back what was just done).',
  '- about_preview: the message answers or corrects the PREVIEW OF NEW EXPENSES waiting (not saved ones). text = the message.',
  '- chat: greetings, thanks, small talk. unclear: you cannot tell what they mean; ask = one short question for that part only.',
  '',
  'HOW TO FIND THE EXPENSE THEY MEAN:',
  '- A line tagged "No. N (id X, a SAVED one):" is about expense X only: "add 80" / "deduct 40" there is adjust, never a new expense.',
  '- A number refers to the NUMBERED LIST just shown ("2", "No. 4", "the third one", "first and last"). Without a list, a',
  '  number is an amount ("the 45 one").',
  '- "it", "that", "that one" = what the bot\'s LAST MESSAGE was about (given in the context), else the last saved, else what waits.',
  '- Names, payees, amounts and dates pick from this month\'s expenses. "the one I added last" = the last saved.',
  '- If two or more fit and nothing tells them apart, do NOT pick: put all the candidate ids and add an unclear op asking which.',
  '- Never invent an id. If none fits, leave ids empty.',
  '- ALWAYS put the words they used to name it in match ("the lunch", "the petrol", "No. 3"), even when you give ids.',
  '- An amount change is EITHER set.amount (a new total) OR adjust (relative), never both. A date change is EITHER set.date',
  '  OR shift_days, never both.',
  '',
  'sure = false if any part is a guess. Keep every op exactly to what they said; never add changes they did not ask for.',
].join('\n');

// compact: every token here is paid for on every planner call
const line = (r) => `id ${r.id}|${r.spentOn.slice(5)}|${r.description}|${r.payee || '?'}|${r.currency} ${Number(r.rawAmount)}|${r.category || '-'}|${r.spentBy || '?'}${r.groupName ? `|${r.groupName}` : ''}`;

/** The context, as compact text. */
function contextText({ today, group, list = [], month = [], last = [], waiting = null, about = [] }) {
  return [
    `Today: ${today}. Group: ${group === '*' ? 'any (the admin can name one)' : group}.`,
    about.length ? `The bot's LAST MESSAGE was about:\n${about.map(line).join('\n')}` : '',
    list.length ? `NUMBERED LIST just shown (No. N is what they call N):\n${list.map((r, i) => `No. ${i + 1} → ${line(r)}`).join('\n')}` : 'No numbered list is on screen.',
    last.length ? `The one ADDED LAST: ${line(last[0])}${last.length > 1 ? `\nAdded before it: ${last.slice(1).map(line).join(' ; ')}` : ''}` : '',
    waiting ? `WAITING for their yes:\n${waiting}` : 'Nothing is waiting for a yes.',
    `Saved expenses, latest first (id|MM-DD|what|paid to|amount|category|spent by):\n${month.length ? month.map(line).join('\n') : '(none)'}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * @returns {Promise<{ ops: object[], sure: boolean, strong: boolean }>}
 */
async function plan(said, context, { client = null, strong = false, note = '' } = {}) {
  const user = `${contextText(context)}\n\nTHEIR MESSAGE:\n${String(said).slice(0, 1500)}${note ? `\n\n(Your last reading was rejected: ${note}. Read it again carefully.)` : ''}`;
  const out = await ask({ light: !strong, name: 'plan', system: SYSTEM, user, schema: SCHEMA, client });
  return { ops: Array.isArray(out.ops) ? out.ops : [], sure: Boolean(out.sure), strong };
}

/** Worth the careful model from the start: a list, several asks, or a long message. */
function needsCare(said) {
  const t = String(said ?? '');
  return /\n/.test(t.trim()) || t.length > 110 || (t.match(/\d+(?:\.\d+)?/g) ?? []).length >= 3
    || /\b(?:except|but not|apart from|everything|every|all|swap)\b/i.test(t)
    || (t.match(/\b(?:and|also|then|plus|both)\b/gi) ?? []).length >= 2;
}

module.exports = { plan, needsCare, contextText, SCHEMA, CATEGORIES };
