const { ask } = require('./ai');

// ***************************************************
// * THE ROUTER, AND THE ANSWER THE CODE COULD NOT READ
// ***************************************************
//
// The router pattern, as Diane's (engine/router.js): ONE small model call
// that only CLASSIFIES the message from fixed choices, and pulls out what
// code needs to act on it. It decides the path, never the change: every
// value is checked by code before anything is written.

const KINDS = ['add', 'edit', 'remove', 'question', 'undo', 'answer', 'chat', 'other'];
const FIELDS = ['groupName', 'spentOn', 'description', 'payee', 'rawAmount', 'currency', 'spentBy'];

const TARGET = {
  type: 'object',
  additionalProperties: false,
  required: ['words', 'amount', 'date', 'from', 'to', 'last', 'all'],
  properties: {
    words: { type: 'string' },
    amount: { type: 'string' },
    date: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    last: { type: 'boolean' },
    all: { type: 'boolean' },
  },
};
const ROUTE = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'sure', 'target', 'changes', 'query'],
  properties: {
    kind: { type: 'string', enum: KINDS },
    sure: { type: 'boolean' },
    target: TARGET,
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value'],
        properties: { field: { type: 'string', enum: FIELDS }, value: { type: 'string' } },
      },
    },
    query: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to', 'groupBy', 'measure', 'words', 'group'],
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        group: { type: 'string' },
        groupBy: { type: 'string', enum: ['', 'group', 'payee', 'spentBy', 'day', 'currency', 'description', 'category'] },
        measure: { type: 'string', enum: ['list', 'total', 'count', 'biggest'] },
        words: { type: 'string' },
      },
    },
  },
};

function routePrompt(today, pending, groups = []) {
  return [
    ...(groups.length ? [`Company groups: ${groups.join(', ')}. query.group = one of them if the question names it, else "".`] : ['query.group: always "".']),
    'Classify ONE WhatsApp message sent by a company admin to an EXPENSES bot. Answer only from the choices.',
    `Today is ${today}. Dates as YYYY-MM-DD.`,
    'add: they give NEW expenses to save (something bought/paid with an amount): "taxi 45", "paid 300 to DEWA".',
    'edit: change an expense ALREADY SAVED: "change the taxi to 50", "yesterday\'s lunch was 120 not 100".',
    'remove: delete an expense already saved: "remove the taxi", "delete yesterday\'s lunch".',
    'question: they ask about saved expenses: totals, lists, biggest, by payee/person/day. Nothing changes.',
    'undo: put back what the bot just did. chat: greetings, thanks, "what can you do".',
    'other: anything NOT about the business\'s expenses, above all the admin\'s OWN pay, salary, payday, payment or',
    'breakdown ("how much am I getting paid?", "when is payday?", "did my salary go through?").',
    pending ? 'answer: the message answers or corrects the PREVIEW the bot just showed (numbered expenses NOT SAVED YET), or adds to it: "actually it was 18", "the lunch was yesterday", "make it 50". With a preview open, a correction is an answer, not an edit.' : 'answer: never (no preview is open).',
    'target (edit/remove): words = what it was for or who was paid ("taxi", "lunch at Zuma"), amount = its amount if said,',
    'date = its date if one day is said (YYYY-MM-DD); from/to = a range if they said one ("this week" = Monday to today,',
    '"in october", "since the 1st"), else "". last = true if they mean the last one they sent, all = true if they say all/every of them.',
    'changes (edit only): each field and its NEW value. rawAmount as a plain number; spentOn as YYYY-MM-DD.',
    'query (question only): from/to = the dates asked about (this month = first of the month to today; "" if none),',
    'groupBy = how to split it ("by category" is category), measure = list | total | count | biggest, words = a filter on what it was for or who was paid, or "". A category word (fuel, travel, food, office, bills) goes in words: "how much on fuel" is words "fuel".',
    'A NEW FULL QUESTION ("spending by category this month", "how much did we spend") starts fresh: words "" unless it names them.',
    'A FOLLOW-UP QUESTION ("and august?", "what about sara?") keeps everything from the bot\'s last answer it does not change:',
    'the same group, words, measure and split, with only the new part swapped in.',
    'Use "" and false for anything not given. sure: false if unclear or it could mean two things.',
  ].join('\n');
}

async function route(text, { today, pending = false, lastReply = '', client, groups = [] } = {}) {
  const user = lastReply ? `The bot's last message:\n${String(lastReply).slice(0, 400)}\n\nTheir message:\n${text}` : String(text);
  return ask({ light: true, name: 'route', system: routePrompt(today, pending, groups), user, schema: ROUTE, client });
}

// ---- an answer to the preview that code could not read ----

const LINE = require('./extract').LINE_SCHEMA;
const REVISE = {
  type: 'object',
  additionalProperties: false,
  required: ['updates', 'skip', 'ok', 'confirm', 'cancel', 'newExpenses', 'unclear'],
  properties: {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'field', 'value'],
        properties: { n: { type: 'integer' }, field: { type: 'string', enum: FIELDS }, value: { type: 'string' } },
      },
    },
    skip: { type: 'array', items: { type: 'integer' } },
    ok: { type: 'array', items: { type: 'integer' } },
    confirm: { type: 'boolean' },
    cancel: { type: 'boolean' },
    newExpenses: { type: 'array', items: LINE },
    unclear: { type: 'string' },
  },
};

/** Their answer to the open preview, as changes code then checks. */
async function revise(text, items, { today, client, groups = [] } = {}) {
  /**
   * COMPACT: one short line per expense, not its whole record (his call
   * 2026-10-07: a 145 expense preview sent everything with every reply).
   * The numbers they say are all the reader needs to point at.
   */
  const shown = items.filter((x) => !x.skipped).map((x) => `${x.n}. ${x.spentOn ?? '?'} | ${x.description ?? ''} | ${x.payee ?? '?'} | ${x.currency ?? ''} ${x.rawAmount ?? '?'}${x.groupName ? ` | ${x.groupName}` : ''}${x.spentBy ? ` | by ${x.spentBy}` : ''}`).join('\n');
  return ask({
    name: 'revise',
    system: [
      'A bot showed an admin numbered expenses NOT SAVED YET. Turn their reply into changes. Output JSON only.',
      `Today is ${today}. Dates YYYY-MM-DD, day-first (06/10 is 6 October). Amounts as plain numbers.`,
      'updates: a field set to a new value for expense n ("the printer was on the 5th" → spentOn of that one).',
      'skip: numbers to leave out. ok: numbers whose doubt they say is fine. confirm: true only if they also say to save.',
      'cancel: true if they drop the whole thing. newExpenses: extra expenses they add now (same fields as the rest,',
      '"" for anything not given; source "message"). unclear: a short question if you cannot tell what they mean, else "".',
      'Never invent a value. Only change what they said.',
      ...(groups.length ? [`groupName is one of: ${groups.join(', ')}.`] : []),
    ].join('\n'),
    user: `The expenses shown (no. date | what | paid to | amount | group | by):\n${shown}\n\nTheir reply:\n${text}`,
    schema: REVISE,
    client,
  });
}

module.exports = { route, revise, KINDS, FIELDS };
