const { askTools } = require('./ai');
const planner = require('./planner');
const find = require('./find');
const format = require('./format');
const store = require('./store');
const logger = require('../../../configs/logger');

// ***************************************************
// * THE EXPENSE AGENT (EXPENSE_AGENT=on): DIANE'S WAY, FOR EXPENSES
// ***************************************************
//
// His call 2026-10-09: "expenses is very critical. this one should be super
// smart", built the way Diane's master sheet mode is, which works for him:
//
//   - the FULL model reads every real request, never the light one;
//   - it sees the conversation (the last turns, both sides), the list on
//     screen, what waits for a yes, this month's expenses and what was done;
//   - it can LOOK THINGS UP before it acts ("the most expensive food one"),
//     then acts through a few tools;
//   - the tools are the code that already checks and does the work: the same
//     guard, the same one preview, one yes and one undo. It never saves.
//
// Code still answers the instant replies (yes, no, a number, hi) before it,
// in brain.js. The old reader stays, and is what runs with the switch off.

const ROUNDS = 5;
// the conversation it reads (cost, 2026-10-10: 6 turns kept every test right)
const HISTORY_TURNS = 6;
// tools that SHOW the admin something: once a round only used these, the
// reply is ready, and a second model call to say nothing more is skipped
// (not decide: "save it AND remove the cleaner" needs the round after the save)
const SHOWING = new Set(['act', 'answer', 'show_expenses', 'show_list', 'undo', 'preview_answer']);

const SYSTEM = [
  'You are the EXPENSES assistant a company admin talks to on WhatsApp (or in the CRM). UK English, short and warm.',
  'You understand what they want, look things up when you need to, and act through your tools. Code checks every action,',
  'shows the admin a preview and waits for their yes; you never save anything yourself and never invent an expense id.',
  '',
  'HOW TO WORK',
  '- Read the WHOLE conversation: their message often only makes sense with what the bot said just before',
  '  (a list it showed, a question it asked, what it just did). "it", "that one", "the cheapest one", "the rest" are about that.',
  '- look_up ONE thing at a time (one payee, one category per call: "careem and enoc" = two calls). Never say none exist',
  '  until you have looked up each one.',
  '- When the expense they mean depends on a rule you cannot see in the context ("the most expensive food one", "all of',
  '  last week\'s taxis", "anything Gary paid over 100"), call look_up FIRST, then act on the ids it returns.',
  '- Everything they ask in one message is done in one go: changes, removals and new ones together in ONE act call',
  '  (a numbered list of lines = one op per line, all in that ONE call),',
  '  a question with answer. Never drop a part of what they said.',
  '- An explicit verb wins: "delete/remove the groceries" is a remove op on the saved groceries, ALWAYS, whether or not',
  '  anything about it waits (a waiting change to it is replaced by the removal). Never ask first, the preview asks.',
  '  "leave X as it was" / "not X" / "keep X" while it waits = drop X.',
  '- "update/change/fix X\'s expenses" or "delete some" with nothing more = show_list, so they can pick by number.',
  '- A CORRECTION to what waits ("no wait, make it 471", "actually 55") REPLACES that change: a change op with the new',
  '  value (never drop it). "put the X back" / "keep X" while its removal waits = drop the removal of X only.',
  '  "actually just X" / "only X" / "just X" while several wait = keep X, drop EVERY other one that waits.',
  '  "actually no, the X" / "I meant the X" / "wrong one, the X" = SWAP: drop only the one ADDED LAST, same action on X.',
  '- "save it and …" / "yes and …" while a preview of NEW expenses waits: decide(save) FIRST, then act on the rest.',
  '- A DATE THAT ONLY SAYS WHICH ONES ("the bills for october", "october\'s taxis") never changes their date.',
  '  "delete anything from 1st oct" = the ones DATED 1 Oct; "since / after / onwards / from … to …" = a range.',
  '- "how much / what\'s left / total / how many" is a QUESTION (answer), even when it sits in the same message as a change.',
  '  answer.question = their question as they asked it: never add an expense name they did not say ("the new total for',
  '  this month" is every expense this month, not the one just changed).',
  '- Removing 4 or more by a rule: look_up first, and if the rule is loose, list them and ask before acting.',
  '- Undo: they can take back the whole of something done, or only part of it ("undo the cleaner only"): use undo with',
  '  the action and the line numbers of the parts to put back (RECENT ACTIONS lists each line).',
  '- While a preview of NEW expenses waits, answers about it ("1 me", "the coffee is food", "date is yesterday", "skip 2")',
  '  go to preview_answer with their FINAL intent in clean words ("1 spent by me"), never their whole message with its',
  '  retractions; if they also agree, then decide(save). A NEW expense while it waits ("add another, £60 train") = act add.',
  '- SHOWING EXPENSES: never write a list of expenses yourself and never show an id, a "|" or "No. 1 (id …)". Use',
  '  show_expenses with the ids (it draws the numbered list they can pick from), or answer for totals.',
  '- YOUR OWN QUESTION, ANSWERED: when your last message asked for a value ("who spent it?", "which date?", "1 or 2?") and',
  '  they reply with just that (a name like "abe", a number, a date), that IS the answer: act on it at once, never ask again.',
  '  Any name is fine for spent_by; code warns if it is not on the master sheet.',
  '- When a preview WAITS and they agree in any words ("yeh do it", "yes cheers", "go on then"), call decide(save=true).',
  '  Never act again to re-show the same preview.',
  '- NEVER SAY SOMETHING WAS DONE (saved, changed, undone, removed) unless a tool did it in THIS turn. Nothing to do = say',
  '  plainly that nothing changed.',
  '- "The last taxi", "that last one" = the most recent one (latest date, or the one saved last), not an older one.',
  '- FIELDS: there is NO payment method field (cash, card, bank): say so in one line if they ask. spent_by is a PERSON.',
  '- While a preview of NEW expenses waits, words about THOSE new ones (their payee, amount, "the other one", "add another")',
  '  are about the preview (preview_answer / act add). Change a SAVED one only when they clearly name it (its name or date).',
  '- FIELDS: "rate" is the exchange rate to AED (for GBP, EUR, USD…), set like "1 gbp to aed is 4.85". VAT is not stored:',
  '  say so in one line, once, and do not keep asking.',
  '- A NEGATIVE amount ("-£10 coffee"): ask in one line whether it is money back (a refund) or £10 spent, before adding.',
  '  A REFUND is not saved as an expense (amounts cannot be negative). Say so ONCE, and offer the one thing that helps: take',
  '  it off the expense it came back for (look_up, then a change or a removal). Never ask them to confirm a refund twice.',
  '- Mention VAT only when they do.',
  '- EVERY WORD THEY GIVE MUST FIT: "the lunch from 1 Oct" is an expense that is a lunch AND on 1 Oct. If none fits all of it,',
  '  say so and show the closest; never pick one by the date (or any one word) alone.',
  '- WHO THE ADMINS ARE: the ADMINS line in the context (names only, never their numbers).',
  '- WHO CAN SEE THEM: this group\'s registered expense admins (on this WhatsApp number and in the CRM), and the CRM admin,',
  '  who sees every group. A worker sees only their OWN expenses, and only if that is switched on in the CRM. Say only this.',
  '- DATES: use the weekday given with today and with each expense. "Last Friday" = the most recent Friday before today.',
  '- If it is truly unclear which expense or what value, ask ONE short question (number the options). Never guess money.',
  '  A TIE is unclear: "the oldest", "the cheapest", "the biggest" when two or more share it → ask which (or both).',
  '- When a tool has shown the admin something, do not repeat it, and never add "shall I go ahead?" or "save this?": the',
  '  preview already asks for their yes. Your own final words are only for a real question about something unclear, or a',
  '  one-line reply (chat, nothing to do). Never write a wall of text.',
  '',
  'THE ACTIONS (the act tool) follow these rules:',
  planner.SYSTEM.split('\n').slice(planner.SYSTEM.split('\n').findIndex((l) => l.startsWith('OPERATIONS'))).join('\n'),
].join('\n');

const LOOK_UP = {
  type: 'function',
  function: {
    name: 'look_up',
    description: 'Find saved expenses by a rule, for you to read (the admin does not see this). Returns ids and details.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: ['string', 'null'], description: 'YYYY-MM-DD, default the 1st of this month' },
        to: { type: ['string', 'null'], description: 'YYYY-MM-DD, default today' },
        category: { type: ['string', 'null'], enum: [...planner.CATEGORIES, null] },
        spent_by: { type: ['string', 'null'] },
        payee: { type: ['string', 'null'] },
        words: { type: ['string', 'null'], description: 'words in what it was for' },
        min_amount: { type: ['number', 'null'], description: 'AED' },
        max_amount: { type: ['number', 'null'], description: 'AED' },
        sort: { type: ['string', 'null'], enum: ['amount_desc', 'amount_asc', 'date_desc', 'date_asc', null] },
        limit: { type: ['integer', 'null'] },
      },
      required: ['from', 'to', 'category', 'spent_by', 'payee', 'words', 'min_amount', 'max_amount', 'sort', 'limit'],
    },
  },
};
const ACT = {
  type: 'function',
  function: {
    name: 'act',
    strict: true,
    description: 'Change, split, remove, drop from what waits, or add expenses. All of one message in ONE call. Code shows one preview.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { ops: { type: 'array', items: { ...planner.OP, properties: { ...planner.OP.properties, kind: { type: 'string', enum: ['change', 'split', 'remove', 'drop', 'add'] } } } } },
      required: ['ops'],
    },
  },
};
/**
 * A QUESTION, IN ITS PARTS (break test 2026-10-10: "total for June so far"
 * searched for the word "June"; "the new food total" searched "new food").
 * The model fills the parts; code counts.
 */
const ANSWER = {
  type: 'function',
  function: {
    name: 'answer',
    description: 'Answer a question about saved expenses: a total, a count, the biggest, a list, or split by category/person/payee/day. Shown to the admin.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD; "this month" = the 1st to today; a month name = that whole month (this year unless said)' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        measure: { type: 'string', enum: ['total', 'count', 'biggest', 'list'] },
        group_by: { type: 'string', enum: ['', 'category', 'spentBy', 'payee', 'day', 'currency'] },
        words: { type: 'string', description: 'ONLY words that filter what it was for or who was paid ("food", "careem", "gloria"); "" for none. Never "new", "total", "so far", a month or a date.' },
      },
      required: ['from', 'to', 'measure', 'group_by', 'words'],
    },
  },
};
const UNDO = {
  type: 'function',
  function: {
    name: 'undo',
    description: 'Offer to take back something done (an action from RECENT ACTIONS). The admin confirms it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { action_id: { type: 'integer' }, also: { type: ['array', 'null'], items: { type: 'integer' }, description: 'more whole actions to take back with it ("the last 2 things")' }, lines: { type: ['array', 'null'], items: { type: 'integer' }, description: 'only these line numbers of it; null = all of it' } },
      required: ['action_id', 'also', 'lines'],
    },
  },
};
const PREVIEW_ANSWER = {
  type: 'function',
  function: {
    name: 'preview_answer',
    description: 'Answer or correct the PREVIEW OF NEW EXPENSES that waits (missing details, fixes, skip one, add one more to it).',
    parameters: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
  },
};
const DECIDE = {
  type: 'function',
  function: {
    name: 'decide',
    description: 'Save what waits (yes) or cancel it (no). Only when they clearly said so.',
    parameters: { type: 'object', additionalProperties: false, properties: { save: { type: 'boolean' } }, required: ['save'] },
  },
};

const SHOW_EXPENSES = {
  type: 'function',
  function: {
    name: 'show_expenses',
    description: 'Show the admin these saved expenses as the proper numbered list (they can then say "change 2", "remove 1-3").',
    parameters: { type: 'object', additionalProperties: false, properties: { ids: { type: 'array', items: { type: 'integer' } }, title: { type: 'string' } }, required: ['ids', 'title'] },
  },
};
const SHOW_LIST = {
  type: 'function',
  function: {
    name: 'show_list',
    description: 'Show the admin a numbered list of recent expenses to pick from, to change or to remove.',
    parameters: { type: 'object', additionalProperties: false, properties: { purpose: { type: 'string', enum: ['change', 'remove'] }, spent_by: { type: ['string', 'null'] } }, required: ['purpose', 'spent_by'] },
  },
};

const cut = (t, n) => String(t ?? '').replace(/\n{2,}/g, '\n').slice(0, n);

/** The conversation, both sides, as the admin saw it. */
function talk(state) {
  return (state.history ?? []).slice(-HISTORY_TURNS).flatMap((h) => [
    { role: 'user', content: cut(h.said, 1000) || '(sent a file)' },
    { role: 'assistant', content: cut(typeof h.reply === 'string' ? h.reply : '', 600) || '(no reply)' },
  ]);
}

/** Recent actions, each line numbered as its ✅ message numbered it. */
async function recentText(ctx) {
  const recent = await store.recentActions(ctx.phone, ctx.group, 6);
  if (!recent.length) return 'RECENT ACTIONS: none';
  return `RECENT ACTIONS (newest first):\n${recent.map((a) => {
    const open = (a.changes ?? []).filter((c) => !c.created);
    const lines = open.map((c, i) => `  ${i + 1}. ${c.undone ? '(already undone) ' : ''}${c.removed || a.kind === 'remove' ? 'removed' : a.kind === 'add' ? 'added' : 'changed'} ${c.before?.description ?? c.after?.description ?? `id ${c.id}`}`);
    return `action ${a.id} (${a.kind}): ${a.summary}\n${lines.join('\n')}`;
  }).join('\n')}`;
}

const WEEKDAY = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const rowLine = (r) => `id ${r.id}|${r.spentOn} ${WEEKDAY(r.spentOn)}|${r.description}|${r.payee || '?'}|${r.currency} ${Number(r.rawAmount)}${r.currency !== 'AED' && r.aed ? ` (AED ${r.aed})` : ''}|${r.category || '-'}|${r.spentBy || '?'}${r.settled ? '|REFUNDED, locked' : ''}`;

/**
 * @param {string} said
 * @param {object} ctx  brain.js's turn context
 * @param {object} b    brain.js's own helpers (applyPlan, onReply, …)
 * @returns {Promise<string|null>} the reply, or null to let the old reader answer
 */
async function agentTurn(said, ctx, b) {
  const context = await b.plannerContext(ctx);
  // THE LATEST 30, not 45: look_up finds any other (cost, 2026-10-10)
  context.view = { ...context.view, month: (context.view.month ?? []).slice(0, 30) };
  const view = planner.contextText(context.view);
  const admins = ctx.channel === 'diane' ? [] : (await store.listAdmins().catch(() => [])).filter((a) => a.group_name === ctx.group && a.active).map((a) => a.name);
  const situation = [...(admins.length ? [`ADMINS of ${ctx.group}: ${[...new Set(admins)].join(', ')}.`] : []), `Today: ${ctx.today} (${new Date(`${ctx.today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}).`, `Admin: ${ctx.admin?.name ?? '?'} (${ctx.channel === 'diane' ? 'in the CRM, every group' : `WhatsApp, group ${ctx.group}`}). "me" = them.`, view, await recentText(ctx)].join('\n\n');
  const messages = [
    { role: 'system', content: SYSTEM },
    ...talk(ctx.state),
    { role: 'user', content: `${situation}\n\nTHEIR MESSAGE:\n${cut(said, 2000)}` },
  ];
  const tools = [LOOK_UP, ACT, ANSWER, SHOW_EXPENSES, SHOW_LIST, UNDO, DECIDE, ...(ctx.state.pending?.kind === 'add' ? [PREVIEW_ANSWER] : [])];
  const shown = [];
  const trail = [];
  /**
   * THE LIGHT MODEL FOR A SHORT, PLAIN ASK (EXPENSE_AGENT_LIGHT=on): one
   * thing, nothing waiting, no list on screen, no correction. Anything else
   * is read by the full model. Off by default until tests say otherwise.
   */
  const light = String(process.env.EXPENSE_AGENT_LIGHT ?? 'off').toLowerCase() === 'on'
    && !ctx.state.pending && !context.view.list.length && said.length < 70 && !planner.needsCare(said)
    && !/\b(?:actually|wait|no|not|instead|undo|only|except|swap|rest|both|all|every|it|that|them)\b/i.test(said);
  for (let round = 0; round < ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    const msg = await askTools({ messages, tools, client: ctx.client, light });
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) {
      const words = String(msg.content ?? '').trim();
      logger.info({ group: ctx.group, said: cut(said, 200), trail }, 'expense agent: done');
      const out = shown.map(String).join('\n\n');
      if (!shown.length) return words || null;
      // a real question under what was shown; "shall I go ahead?" is the preview's job
      const confirming = /\b(?:shall i|should i|go ahead|proceed|save (?:this|these|it|them)|confirm|want me to|ready to|would you like)\b/i.test(words);
      return /\?\s*$/.test(words) && words.length < 400 && !confirming ? `${out}\n\n❓ ${words}` : out;
    }
    for (const call of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* empty */ }
      let result;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await run(call.function.name, args, { said, ctx, b, context, shown });
      } catch (err) {
        logger.warn({ err: err.message, tool: call.function.name }, 'expense agent: tool failed');
        result = `failed: ${err.message}`;
      }
      if (process.env.AGENT_DEBUG) console.log('  ⚙️', call.function.name, JSON.stringify(args).slice(0, 900), '→', String(result).slice(0, 160).replace(/\n/g, ' ⏎ '));
      trail.push(`${call.function.name}${args.ops ? `:${args.ops.map((o) => `${o.kind}${o.ids?.length ? `(${o.ids.join(',')})` : ''}`).join(' ')}` : ''}`);
      messages.push({ role: 'tool', tool_call_id: call.id, content: cut(result, 6000) });
    }
    // SHOWN AND DONE: no second call just to close the turn (half the cost)
    const showedOnly = msg.tool_calls.every((c) => SHOWING.has(c.function.name));
    if (showedOnly && shown.length && !msg.tool_calls.some((c) => messages.find((m) => m.tool_call_id === c.id)?.content?.startsWith('refused'))) {
      logger.info({ group: ctx.group, said: cut(said, 200), trail }, 'expense agent: done');
      const words = String(msg.content ?? '').trim();
      const out = shown.map(String).join('\n\n');
      return /\?\s*$/.test(words) && words.length < 400 && !/\b(?:shall i|should i|go ahead|proceed|confirm|want me to|would you like)\b/i.test(words) ? `${out}\n\n❓ ${words}` : out;
    }
  }
  logger.warn({ group: ctx.group, trail }, 'expense agent: ran out of rounds');
  return shown.length ? shown.map(String).join('\n\n') : null;
}

const SHOWN = (text) => `Shown to the admin:\n${cut(text, 1200)}`;

async function run(name, args, { said, ctx, b, context, shown }) {
  if (name === 'look_up') {
    const from = args.from || `${ctx.today.slice(0, 8)}01`;
    const to = args.to || ctx.today;
    let rows = (await find.between(ctx.group, from, to)).map((r) => ({ ...find.asItem(r), settled: r.settle_status === 'settled' }));
    const has = (h, w) => String(h ?? '').toLowerCase().includes(String(w).toLowerCase());
    if (args.category) rows = rows.filter((r) => r.category === args.category);
    if (args.spent_by) rows = rows.filter((r) => has(r.spentBy, args.spent_by));
    if (args.payee) rows = rows.filter((r) => has(r.payee, args.payee));
    if (args.words) rows = rows.filter((r) => args.words.toLowerCase().split(/\s+/).every((w) => has(`${r.description} ${r.payee}`, w)));
    const aed = (r) => Number(r.aed ?? r.rawAmount);
    if (args.min_amount != null) rows = rows.filter((r) => aed(r) >= args.min_amount);
    if (args.max_amount != null) rows = rows.filter((r) => aed(r) <= args.max_amount);
    const by = { amount_desc: (a, c) => aed(c) - aed(a), amount_asc: (a, c) => aed(a) - aed(c), date_desc: (a, c) => c.spentOn.localeCompare(a.spentOn), date_asc: (a, c) => a.spentOn.localeCompare(c.spentOn) }[args.sort];
    if (by) rows.sort(by);
    rows = rows.slice(0, Math.min(args.limit || 60, 100));
    // what it found may be acted on
    for (const r of rows) context.known.set(r.id, r);
    return rows.length ? `${rows.length} found:\n${rows.map(rowLine).join('\n')}` : 'None found.';
  }
  if (name === 'act') {
    const KINDS = ['change', 'split', 'remove', 'drop', 'add'];
    // a kind it made up ("adjust") is a change; a remove beats a drop of the same one
    let ops = (args.ops ?? []).map((o) => ({ ...o, kind: KINDS.includes(o.kind) ? o.kind : 'change' }));
    /**
     * "DELETE ANYTHING FROM 1ST OCT" IS THAT DAY (hard blind set 2026-10-10: it
     * was read as since 1 Oct, 8 to remove). A range only when they say so.
     */
    const ranged = /\b(?:since|onwards|after|till|until|through|between|to\s+(?:the\s+)?\d|-\s*\d)\b/i.test(said);
    if (/\bfrom\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\b|\bfrom\s+\d{4}-\d{2}-\d{2}\b/i.test(said) && !ranged) {
      for (const o of ops) {
        if (o.filter?.from && (!o.filter.to || o.filter.to >= ctx.today)) o.filter = { ...o.filter, to: o.filter.from };
      }
    }
    /**
     * A NEW CURRENCY WITHOUT THE AMOUNT THEY SAID ("change that one to
     * £18.50" came back as only AED ➜ GBP, the 18.50 lost): read again.
     */
    if (ops.some((o) => o.kind === 'change' && o.set?.currency && o.set?.amount == null && !Object.values(o.adjust ?? {}).some((v) => v != null))
      && /\d/.test(said)) {
      return 'refused: a change sets a new currency but no amount, though they gave one. Put the amount in set.amount too.';
    }
    // HOW IT WAS PAID IS NOT A PERSON ("put it as cash not card" became spent by: cash)
    if (ops.some((o) => /^(?:cash|card|credit card|debit card|bank|bank transfer|company card|amex|visa|apple pay)$/i.test(String(o.set?.spent_by ?? '').trim()))) {
      return 'refused: cash/card is how it was paid, not who spent it, and how it was paid is not stored. Tell them that in one line.';
    }
    const removing = new Set(ops.filter((o) => o.kind === 'remove').flatMap((o) => o.ids ?? []));
    ops = ops.filter((o) => !(o.kind === 'drop' && (o.ids ?? []).every((id) => removing.has(id))));
    const empty = ops.filter((o) => o.kind === 'change' && !Object.values(o.set ?? {}).some((v) => v != null) && !Object.values(o.adjust ?? {}).some((v) => v != null) && !o.shift_days && !o.shift_months && !(o.clear ?? []).length);
    if (empty.length && empty.length === ops.length) return 'refused: no new value was said. Ask them, in one short line, what to change on it (name the expense).';
    ops = ops.filter((o) => !empty.includes(o));
    const onlyAdds = ops.length && ops.every((o) => o.kind === 'add');
    // A MINUS SIGN is asked about first: money back, or a typo? (break test 2026-10-10)
    if (ops.some((o) => o.kind === 'add' && /(?:^|[\s(])[-−]\s?[£$€]?\s?\d/.test(`${o.text} ${said}`))) {
      return 'refused: an amount has a minus sign. Ask them in one short line whether it is money back (a refund) or the amount spent, before adding.';
    }
    // "ADD ANOTHER" while new ones wait JOINS the preview (it was read as a correction:
    // "those were all already in your preview", and later replaced the first one)
    if (onlyAdds && ctx.state.pending?.kind === 'add') {
      const text = await b.addFrom({ text: ops.map((o) => o.text).join('\n') }, ctx);
      shown.push(text);
      return SHOWN(text);
    }
    if (onlyAdds && ctx.state.pending) {
      ctx.state.parked = ctx.state.pending;
      ctx.state.pending = null;
      ctx.parkedNow = true;
    }
    const out = await b.applyPlan({ ops, sure: true, strong: true }, said, ctx, context);
    if (out?.retry) return `refused: ${out.retry}`;
    if (!out?.reply) return 'Nothing to do: nothing fitted.';
    // ONE DRAFT: a second act adds to the same one, so only its latest preview is shown
    const at = shown.findIndex((x) => x.act);
    if (at >= 0) shown.splice(at, 1);
    shown.push(Object.assign(new String(out.reply), { act: true }));
    return SHOWN(out.reply);
  }
  if (name === 'answer') {
    const iso = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d ?? '')) ? d : '');
    const words = String(args.words ?? '').replace(new RegExp(`\\b${String(ctx.group).replace(/[^\w ]/g, '')}\\b`, 'gi'), ' ')
      .replace(/\b(?:new|total|so far|now|again|latest|updated|current|expenses?|spending|spent|this|month|week|year|my|our)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const r = { kind: 'question', query: { from: iso(args.from), to: iso(args.to), group: '', groupBy: args.group_by ?? '', measure: args.measure ?? 'total', words } };
    const text = await b.questionReply(r, ctx, ctx.state.pending);
    shown.push(text);
    return SHOWN(text);
  }
  if (name === 'undo') {
    const recent = await store.recentActions(ctx.phone, ctx.group, 15);
    const action = recent.find((a) => a.id === args.action_id);
    if (!action) return 'No such action of theirs, or it was already undone.';
    const open = (action.changes ?? []).filter((c) => !c.created);
    const more = (args.also ?? []).map((id) => recent.find((a) => a.id === id)).filter(Boolean).filter((a) => a.id !== action.id);
    if (more.length) {
      const all = [action, ...more];
      ctx.state.pending = { kind: 'undo', actionIds: all.map((a) => a.id) };
      const text = format.undoPreview({ kind: 'many', summary: `${all.length} things:\n${all.map((a, i) => `${i + 1}. ${b.actionText(a)}`).join('\n')}` });
      shown.push(text);
      return SHOWN(text);
    }
    const lines = (args.lines ?? []).filter((n) => n >= 1 && n <= open.length);
    if (lines.length && lines.some((n) => open[n - 1].undone)) return `Line ${lines.find((n) => open[n - 1].undone)} was already undone.`;
    // UNDO ALWAYS ASKS (his rule): a preview, and their yes puts it back
    ctx.state.pending = { kind: 'undo', actionId: action.id, ...(lines.length ? { only: lines } : {}) };
    const text = format.undoPreview(lines.length ? { kind: action.kind, summary: `No. ${format.ranges(lines)}: ${b.actionText({ ...action, changes: open }, lines)}` } : action);
    shown.push(text);
    return SHOWN(text);
  }
  if (name === 'show_expenses') {
    const ids = (args.ids ?? []).filter((id) => context.known.has(id)).slice(0, 40);
    if (!ids.length) return 'None of those ids are known: look_up first.';
    const text = await b.showRows(ids, String(args.title ?? 'Expenses'), ctx);
    shown.push(text);
    return SHOWN(text);
  }
  if (name === 'show_list') {
    const text = args.purpose === 'remove' ? await b.whichToRemove(ctx) : await b.whichToChange(ctx, args.spent_by);
    shown.push(text);
    return SHOWN(text);
  }
  if (name === 'preview_answer') {
    if (ctx.state.pending?.kind !== 'add') return 'No preview of new expenses is waiting.';
    const before = ctx.state.pending;
    const text = await b.reviseFrom(args.text, ctx);
    /**
     * NOTHING LEFT, NOT ASKED FOR (break test 2026-10-10: "…delete… no, leave
     * it as me and confirm" emptied the preview): put back, read again.
     */
    const left = (ctx.state.pending?.items ?? []).filter((x) => !x.skipped).length;
    if (before.items.some((x) => !x.skipped) && ctx.state.pending?.kind === 'add' && !left && !/^(?:skip|drop|remove|leave out|cancel)\b/i.test(String(args.text).trim())) {
      ctx.state.pending = before;
      return 'refused: that would leave nothing in the preview. Pass ONLY their final intent, in plain words (like "1 spent by me"), and decide(save) if they also said yes.';
    }
    shown.push(text);
    return SHOWN(text);
  }
  if (name === 'decide') {
    if (!ctx.state.pending) return 'Nothing is waiting for a yes.';
    /**
     * A SAVE NEEDS THEIR AGREEMENT IN WORDS. A bare "2" under a one-line
     * preview was taken as a yes and saved (break test 2026-10-10).
     */
    if (args.save && !/\b(?:y(?:es|eah|eh|ep|up|a)|ok(?:ay)?|sure|save|do it|go(?: ahead| on| for it)?|confirm\w*|correct|right|fine|crack on|sorted|proceed|approved?)\b|👍|✅/i.test(said)) {
      return 'refused: they did not say yes. Ask in one short line what they meant.';
    }
    const text = await b.onReply({ kind: args.save ? 'yes' : 'no' }, ctx);
    shown.push(text);
    return SHOWN(text);
  }
  return `unknown tool ${name}`;
}

module.exports = { agentTurn, SYSTEM };
