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

const KINDS = ['change', 'remove', 'drop', 'split', 'add', 'question', 'confirm', 'cancel', 'undo', 'about_preview', 'chat', 'unclear'];
const CATEGORIES = ['fuel', 'travel', 'food', 'office', 'bills', 'other'];
const CLEARABLE = ['payee', 'spent_by', 'category'];
const nul = (type) => ({ type: [type, 'null'] });

/**
 * A SET BY ITS RULE (his list 2026-10-08: "gloria's taxis this week", "over
 * 500", "everything except the cleaner"): code finds every expense that
 * fits, so a rule never depends on the model copying forty ids right.
 */
const FILTER = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['spent_by', 'category', 'payee', 'words', 'min_amount', 'max_amount', 'from', 'to', 'except'],
      properties: {
        spent_by: nul('string'), category: { type: ['string', 'null'], enum: [...CATEGORIES, null] }, payee: nul('string'), words: nul('string'),
        min_amount: nul('number'), max_amount: nul('number'), from: nul('string'), to: nul('string'), except: nul('string'),
      },
    },
    { type: 'null' },
  ],
};
const PART = {
  type: 'object',
  additionalProperties: false,
  required: ['spent_by', 'amount'],
  properties: { spent_by: nul('string'), amount: nul('number') },
};

const OP = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'ids', 'match', 'filter', 'set', 'clear', 'adjust', 'shift_days', 'shift_months', 'parts', 'text', 'ask'],
  properties: {
    kind: { type: 'string', enum: KINDS },
    ids: { type: 'array', items: { type: 'integer' } },
    match: { type: 'string' },
    filter: FILTER,
    clear: { type: 'array', items: { type: 'string', enum: CLEARABLE } },
    shift_months: nul('integer'),
    parts: { type: 'array', items: PART },
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
  '  clear = fields to EMPTY ("no payee on 2", "remove the category from the taxi"): payee, spent_by, category.',
  '  shift_months moves the date by whole months, keeping the day ("push them to next month" = +1).',
  '  COPY A VALUE from another expense ("3\'s date same as 1", "payee of 4 like 2"): read it from the context and put it in set.',
  '- split: ONE saved expense shared out ("split 3 between gloria and zayn", "half of the taxi is zayn\'s"). ids = that one;',
  '  parts = one per person, in order: spent_by, and amount when they said it (null = an equal share). The first part keeps the',
  '  expense; each other part becomes a new expense. Never split into parts that add up to more than it is.',
  '- remove: delete saved expenses. ids = all of them ("everything from the 6th except the petrol" = those ids, not the petrol).',
  '- drop: take expenses OUT of what is WAITING ("not the cleaner", "leave the taxi out"); ids = those expenses (only ones that wait).',
  '- While something WAITS: "and the X" / "also the X" / "the X too" = the SAME action on X (a removal waits → remove X).',
  '  "actually no, the X" / "I meant the X" = swap: drop the LAST one that waits and do the same action on X.',
  '  "only X" / "just X" / "X only" = KEEP those and drop EVERY OTHER one that waits (one drop op with all the other ids).',
  '  "only gloria\'s", "only the groceries ones", "only the ones from october" pick by what each waiting line is.',
  '  While something WAITS, a number ("only 1-3", "not 2", "make 2 fuel instead") means the WAITING lines P1, P2...,',
  '  EXCEPT a number added to it ("add 7 too", "also 8", "and 9"): that is No. 7 of the NUMBERED LIST, given the same action.',
  '  "swap 3 and 4" while changes wait: give 3 the change 4 has and 4 the change 3 has (two change ops).',
  '- add: a NEW expense (something bought/paid that is not already saved). text = that expense as they said it.',
  '  A message giving an amount and what/where/who was paid ("taxi 45 paid to careem today", "- lunch 30 zuma") is NEW,',
  '  even when a similar one is saved. It is a change ONLY when they say a saved one is wrong or should differ',
  '  ("the taxi was 50", "change", "should be", "actually", "not 45", a number from the list).',
  '- question: they ask about saved expenses (totals, lists, biggest, by category...). text = the question in plain words.',
  '- confirm (yes / save it), cancel (no / leave it), undo (take back what was just done).',
  '- about_preview: the message answers or corrects the PREVIEW OF NEW EXPENSES waiting (not saved ones). text = the message.',
  '- chat: greetings, thanks, small talk. unclear: you cannot tell what they mean; ask = one short question for that part only.',
  '',
  'A SET BY ITS RULE: when they describe expenses by a rule instead of naming each one ("all of gloria\'s", "the taxis this',
  '  week", "everything over 500", "yesterday\'s", "since the 5th", "all except the cleaner and zuma", "the food ones"), give',
  '  filter and leave ids empty: spent_by (a person), category, payee, words (in what it was for), min_amount / max_amount',
  '  (AED; "over 500" = min 500.01), from / to (YYYY-MM-DD; "yesterday\'s" = that day both), except (words for ones to leave',
  '  out, "cleaner, zuma"). Unsaid parts null. No dates said: this month. Code finds every one that fits. filter null otherwise.',
  '  A rule over the NUMBERED LIST only ("the food ones on the list"): ids from the list instead.',
  '',
  'POSITIONS IN THE LIST: "the 2 before that" = the two listed just above the one the bot\'s last message was about;',
  '  "everything after the taxi" = every one listed below the taxi; "the first three", "all but the last", "second and',
  '  fourth", "the ones above 3" = by their No. in the list.',
  '',
  'THE CONVERSATION:',
  '- They correct themselves ("gloria... no wait, zayn", "50, sorry 55"): only the LAST value they said counts.',
  '- "do the same for 5 and 6", "and 4 too", "same for last week\'s" = the LAST CHANGE SAVED (in the context) again, on those.',
  '- "now the rest", "the others to zayn" = the ones LEFT OUT of the last change (in the context).',
  '- "wrong one", "the other taxi", "not that one, the other" = swap: drop the last one that waits, same action on the other',
  '  expense with those words (not the one waiting).',
  '- A short reply ("gloria", "to 50", "the 6th") right after the bot ASKED something answers that question, about the',
  '  expenses that question was about (the bot\'s last message and their message before it are in the context).',
  '- A change with no new value ("update spent by", "change the date of 1-3"): unclear, ask ONLY for that value',
  '  ("Spent by who?", "Which date?"), and still give the ids they meant in a change op with nothing set.',
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
function contextText({ today, group, list = [], month = [], last = [], waiting = null, about = [], talk = null, lastChange = null, leftOut = null }) {
  return [
    `Today: ${today}. Group: ${group === '*' ? 'any (the admin can name one)' : group}.`,
    talk ? `THE CONVERSATION SO FAR (oldest first):\n${talk}` : '',
    about.length ? `The bot's LAST MESSAGE was about:\n${about.map(line).join('\n')}` : '',
    lastChange ? `The LAST CHANGE SAVED: ${lastChange}` : '',
    leftOut ? `LEFT OUT of the last change (still as they were):\n${leftOut}` : '',
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
    || /\b(?:except|but not|apart from|everything|every|all|swap|split|same|rest|others?|wrong|over|under|above|below|since|before|after|copy|like)\b/i.test(t)
    || (t.match(/\b(?:and|also|then|plus|both)\b/gi) ?? []).length >= 2;
}

module.exports = { plan, needsCare, contextText, SCHEMA, SYSTEM, OP, CATEGORIES };
