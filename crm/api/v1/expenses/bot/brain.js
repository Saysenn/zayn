const expensesRepo = require('../../repos/expenses.repo');
const { broadcast } = require('../../sockets/index');
const { currentDay } = require('../../shared/presetMonth.helper');
const logger = require('../../../configs/logger');
const store = require('./store');
const format = require('./format');
const { extract } = require('./extract');
const {
  normalise, duplicates, ready, currencyOf, num, exactCopy, ME,
} = require('./check');
const { readReply, numberSet } = require('./reply');
const { route, revise } = require('./understand');
const { quickRoute, canonicalVerbs, numberRun } = require('./quick');
const planner = require('./planner');
/**
 * THE EXPENSE AGENT (his call 2026-10-09: "expenses is very critical, this
 * one should be super smart"): Diane's way, see agent.js. Off = the reader
 * below, exactly as before; it is never deleted (his rule).
 */
const AGENT_ON = String(process.env.EXPENSE_AGENT ?? 'off').toLowerCase() === 'on';
const PLANNER_ON = String(process.env.EXPENSE_PLANNER ?? 'on').toLowerCase() !== 'off';
const find = require('./find');
const { liveRates } = require('./rates');
const receipts = require('./receipts');
const spender = require('../spender');
const { readIntent, summaryOf } = require('./intent');
const { renderCards } = require('./card');
const { renderTable, worthAPicture } = require('../../pictures/table');
const settingsRepo = require('../../repos/settings.repo');
const { forDiane } = require('./forDiane');

// ***************************************************
// * THE EXPENSE BOT: ONE MESSAGE IN, ONE REPLY OUT
// ***************************************************
//
// His plan, 2026-10-07 (docs/whatbot-crm-expenses.md): each group's WhatBot
// number takes expenses from that group's registered admins as text,
// photos or files, talks to them before saving, and lets them change,
// remove and undo. The same formula as Diane's master sheet context:
//
//   1. THE GUARD: a number not registered on this group's bot gets nothing:
//      no reply, nothing read, no model called.
//   2. CODE FIRST: answers to the preview ("yes", "skip 2", "2 is 150"),
//      "undo", "hi" are read here at no cost.
//   3. THE ROUTER: one small model call sorts anything else into a kind.
//   4. READ, CHECK, PREVIEW: the model reads expenses; code checks every
//      field, the group comes from the bot, and nothing is saved before yes.
//   5. VERIFIED: every write is read back, one action, one undo.

const EVENT = 'expenses:changed';
const HAND_OFF = Symbol('hand off');
const PENDING_MS = 6 * 60 * 60 * 1000;
const HISTORY = 6;
const year = (today) => Number(String(today).slice(0, 4));
const iso = find.iso;
const minus = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

/** The fields an expense row holds, to compare and to put back. */
const SNAP = (r) => ({
  spentOn: iso(r.spent_on ?? r.spentOn), description: r.description, payee: r.payee, rawAmount: Number(r.raw_amount ?? r.rawAmount), currency: r.currency,
  exchangeRate: r.exchange_rate ?? r.exchangeRate ?? null, groupName: r.group_name ?? r.groupName, spentBy: r.spent_by ?? r.spentBy,
  // the link goes back with the name on undo (migration 077)
  spentByPersonId: r.spent_by_person_id ?? r.spentByPersonId ?? null, spentByPhone: r.spent_by_phone ?? r.spentByPhone ?? null,
  // and who saved it, and its category: undo brings back the whole expense
  savedBy: r.saved_by ?? r.savedBy ?? null, category: r.category ?? null,
});
const same = (a, b) => JSON.stringify(SNAP(a)) === JSON.stringify(SNAP(b));

const GREETING = /^(?:hi+|hello+|hey+|hiya|yo|salam|assalam[ou]?\s*alaikum|good (?:morning|afternoon|evening)|start)(?:\s+there)?[!.? ]*$/i;
// "HELP": the whole guide, as a note picture (his call 2026-10-07)
const HELP_ASK = /^(?:help|menu|guide|commands?|how (?:does this work|do i use (?:this|it)|to use (?:this|it))|what can you do|examples?|show me examples?)[!.? ]*$/i;
// "OKAY", "GOT IT" with nothing waiting: a nod back, never the hello again
const ACK = /^(?:ok(?:ay)?|k+|alright|all right|cool|got it|noted|fine|sure|right|great|nice|perfect|lovely|brilliant|sound|sorted|ace)(?:\s+(?:mate|pal|bud|man|thanks|cheers))?[!. ]*$/i;
const THANKS = /^(?:thanks?(?: you)?(?: (?:so much|very much|a lot))?|thank u|thx|ty|ta|cheers|great|perfect|nice|cool|ok thanks|much appreciated|appreciate it|👍🏻?|🙏)(?:\s+(?:mate|pal|bud|man|bro|again))?[!. ]*$/i;
const EDIT_WORDS = /\b(?:change|changed|edit|update|correct|fix|wrong|should be|was (?:actually|really)|not \d|instead|remove|delete|cancel|undo|how|what|which|when|who|total|list|show|sum|spent on|spend|much|many|biggest|\?)|\?/i;
// A TYPO IN AN EDIT WORD is still an edit: "chnage yestrday's uber to 35"
// skipped the router and was saved as a NEW Uber (live 2026-10-07). One
// slip or a swap of two letters counts, and "yesterday's uber" (a
// possessive pointing at something already saved) always goes to the router.
const EDIT_VERBS = ['change', 'edit', 'update', 'correct', 'remove', 'delete', 'cancel', 'undo', 'make', 'total', 'list', 'show', 'much', 'many', 'amend', 'replace'];
const { oneTypo } = require('../../agent/tools/resolvePerson');
function editish(said) {
  const words = String(said).toLowerCase().split(/[^a-z']+/).filter(Boolean);
  if (words.some((w) => /'s$/.test(w))) return true;
  return words.some((w) => w.length >= 4 && EDIT_VERBS.some((v) => v.length >= 4 && (w === v || oneTypo(w, v))));
}
// a note above the preview it re-sends
const ALREADY = 'Those were all already in your preview, so nothing was added. Here it is again:\n\n';
// "SHOW ME THE IMAGE" re-sends the open preview (his report 2026-10-07: it
// went to the pay side and came back "I can't find your number")
const SHOW_PREVIEW = /^(?:(?:can you |could you |pls |please )?(?:show|send|resend|re-send|give)(?: me)?(?: it| them)?(?: the| my| that)?\s*(?:image|picture|pic|photo|preview|list|expenses|it|them|again)(?: to me| for me)?(?: again| please| pls)?|(?:where(?:'s| is) )?(?:the |my )?(?:image|picture|preview)\??)[!.? ]*$/i;
const RECEIPT_ASK = /\b(?:show|send|see|view|give|open|where(?:'s| is))\b[^?]*\breceipts?\b/i;
const UNDO_WORDS = /^(?:(?:pls|please|can you|could you)\s+)?(?:bring|put|get|take)\s+(?:it|that|them|those|the \w+(?: \w+)?)\s+back|^restore\b|^undo\s+(?:it|that|them|this)\b|^change\s+(?:it|that|them)\s+back\b/i;
const MY_EXPENSES = /\bmy(?: own)? expenses\b|\b(?:what|how much) (?:did|have) i (?:spend|spent)\b|\bwhat i (?:spent|spend)\b/i;
const REMOVE_WHICH = /^(?:(?:ok(?:ay)?|so|hi|hey|sorry|actually|wait|oh|hmm+|right|now|um+|ah)[,!.\s]+)*(?:let'?s|lets|i (?:want|need) to|i'?d like to|can (?:you|i|we)|please|pls)?\s*(?:remov\w*|remo[a-z]{0,3}|delete)(?:\s+(?:some|an?|my|the|few|all|everything|all of them|all of it))?(?:\s+(?:expenses?|ones?|entries|items?))?(?:\s+(?:please|pls|now))?[.!?]*$/i;
const SAVE_THEN = /^(?:(?:ok(?:ay)?|yes|yep|yeah|sure)[,!.\s]+)?(?:save(?: it| them| all| these| those)?|yes|confirm(?: it)?)[,!.\s]+(?:and|then|and then)\s+(?:also\s+)?(.{4,})$/i;
// The bot's last answer goes to the router only when it was a spending
// answer: a follow-up ("and august?") needs it, nothing else does
const FOLLOW_UP_CONTEXT = /^(?:📊|No expenses found|\*?SPENDING)/;
const CHANGE_WHICH = /^(?:(?:ok(?:ay)?|so|hi|hey|sorry|actually|wait|oh|hmm+|right|now|um+|ah)[,!.\s]+)*(?:let'?s|lets|i (?:want|need) to|i'?d like to|can (?:you|i|we)|please|pls)?\s*(?:update|modify|change|edit|fix|correct|amend)\s+(?:some\s+|an?\s+|my\s+|the\s+|few\s+)?(?:([\p{L}][\p{L} .'-]{1,30}?)(?:'s)?\s+)?(?:expenses?|ones?|entries|items?)(?:\s+(?:please|pls|now))?[.!?]*$/iu;
const UNDO = /^(?:undo(?: (?:that|it|this|last|the last one))?|take (?:it|that|them) back|put (?:it|that) back|revert(?: that| it)?)[!. ]*$/i;
// "HOW MUCH IS GLORIA'S TOTAL AFTER THIS?": the draft counted as saved
const AS_IF = /\b(?:after (?:this|that|these|those|the changes?|saving|it'?s saved|they'?re saved)|once (?:it'?s |they'?re )?(?:saved|changed|done)|if i save(?: it| them)?|with (?:the|these|those) changes?)\b/i;
// "UNDO ONLY 2", "undo 2 and 3", "undo the last 2 things", "undo the gloria change"
const UNDO_SOME = /^(?:(?:pls|please)\s+)?(?:undo|revert|put back|take back)\s+(?:only\s+|just\s+)?(?:no\.?\s*|#|numbers?\s+)?\d|^(?:only|just)\s+undo\s+\d|^(?:undo|revert)\s+(?:the\s+)?last\s+(?:\d+|two|three|four|five)\s+(?:things|changes|actions|ones|saves|edits)\b|^undo\s+(?:the\s+)?[a-z][\w\s'.-]{1,40}\s+(?:change|edit|update|removal|save|split)s?\b/i;
// "WHAT DID YOU JUST CHANGE?", "who changed 4?"
// and "show me my last changes (for …)" / "my recent edits": the same history,
// never an expense search (two agent test 2026-10-09)
const WHAT_DONE = /^(?:so\s+)?(?:what|which)\s+(?:did|have)\s+(?:you|i|we)\s+(?:just\s+)?(?:change|changed|do|done|save|saved|remove|removed|update|updated)(?:\s+(?:just\s+now|last))?\??$|^what\s+(?:was|were)\s+(?:just\s+)?(?:changed|saved|removed|updated)\??$|^(?:(?:can you\s+|pls\s+|please\s+)?(?:show|list|give|tell)\s+(?:me\s+)?|what\s+(?:are|were)\s+)?(?:my|the|our)\s+(?:last|recent|latest)\s+(?:\d+\s+)?(?:changes|edits|actions|updates)\b[^?]*\??$/i;
const WHO_DID = /^who\s+(?:changed|edited|updated|added|saved|made|entered|put in)\s+(?:no\.?\s*|#|number\s*)?(\d{1,3}|(?:the\s+)?[a-z][\w\s'&.-]{1,40}?)\??$/i;

/**
 * @param {{ phone: string, group: string, text?: string, attachments?: object[] }} msg
 * @param {{ client?: object, today?: string }} opts `client` for tests
 * @returns {Promise<{ registered: boolean, reply?: string }>}
 */
const PREVIEWS = /_Not (?:saved|removed|changed) yet_|_Nothing changed yet_|WHICH ONE /;

function showAgain(ctx) {
  const p = ctx.state.pending;
  const again = p.kind === 'add' ? format.addPreview(p.items, ctx.group)
    : p.kind === 'edit' ? format.editsPreview(editItems(p), { group: ctx.group === find.ALL, removes: p.removes ?? [] })
      : p.kind === 'remove' ? format.removePreview(p.before)
        : p.kind === 'settle' ? settlePreview(p, ctx)
        : p.kind === 'undo' ? 'Undo the last thing you did?\nReply *yes* to undo it, or *cancel*.'
          : p.kind === 'either' ? 'Do you mean *change* the saved ones, or add them as *new*?' : null;
  // SHOWN NOW: the next "yes" counts (it looped: "yes" → "just to be sure" → "yes" → …)
  if (again) { p.shownLast = true; ctx.keepShown = true; }
  return again ? `Just to be sure, this is still waiting:\n\n${again}` : 'Okay.';
}

async function turn(msg, { client = null, today = currentDay(), channel = 'whatsapp', user = null } = {}) {
  // 1. THE GUARD. Before anything is read. The command center has its own:
  // the admin's signed-in session, every group, and no spender assumed.
  const admin = channel === 'diane'
    ? { name: user ?? null, phone: 'diane', group_name: find.ALL }
    : await store.adminFor(msg.phone, msg.group);
  if (!admin) return { registered: false };
  const phone = admin.phone;
  const group = admin.group_name;
  const state = await store.getChat(phone, group);
  // THE SAME MESSAGE TWICE (WhatsApp redelivers on reconnect) gets the same
  // reply and does nothing again: a second "yes" never saves twice.
  const seen = (state.seen ?? []).find((s) => msg.messageId && s.id === msg.messageId);
  if (seen) return { registered: true, reply: seen.reply };
  // AN UNSAVED PREVIEW EXPIRES after 6 hours: tomorrow's receipts must not
  // quietly join yesterday's half-agreed batch.
  let expired = '';
  if (state.pending && Date.now() - (state.pending.at ?? 0) > PENDING_MS) {
    expired = `_(Your earlier unsaved ${state.pending.kind === 'add' ? 'expenses were' : 'request was'} dropped after 6 hours. Nothing from it was saved.)_\n\n`;
    state.pending = null;
  }
  const said = String(msg.text ?? '').trim();
  const files = (msg.attachments ?? []).filter((f) => f && f.base64);
  const ctx = { admin, group, phone, state, today, client, channel, groups: channel === 'diane' ? await knownGroups() : [] };

  let reply;
  // what the open preview held before this message, to see if it changed
  const heldBefore = state.pending?.kind === 'add' ? JSON.stringify(state.pending.items.map(({ n, spentOn, rawAmount, currency, payee, description, skipped, ok, replaceId, category, spentBy, groupName, exchangeRate }) => [n, spentOn, rawAmount, currency, payee, description, skipped, ok, replaceId, category, spentBy, groupName, exchangeRate])) : null;
  try {
    ctx.said = said;
    // WHAT IT JUST ASKED ("which one should I change?"), for this message only
    ctx.awaiting = state.awaiting ?? null;
    state.awaiting = null;
    // a queue only lives while its first part is still waiting
    if (!state.pending) state.queue = [];
    reply = AGENT_ON ? await agentFirst(said, files, ctx) : await answerTurn(said, files, ctx);
    /**
     * THE NEXT THING THEY ASKED FOR IN THE SAME MESSAGE ("save it and
     * remove the lunch", two changes in one), once nothing is waiting: its
     * own message, with its own yes. Dropped when they move on.
     */
    if (!state.pending && state.queue?.length) {
      const next = state.queue.shift();
      ctx.said = next;
      const then = await answerTurn(next, [], ctx);
      if (then) ctx.then = [...(ctx.then ?? []), then];
    }
    // SET ASIDE, NOW BACK: once the new thing is done, the old one waits again
    // AN UNDO ASKED EARLIER IS NOT KEPT FOR LATER: it came back after an unrelated save (break test)
    if (state.parked?.kind === 'undo') state.parked = null;
    if (state.parked && !state.pending) {
      state.pending = { ...state.parked, shownLast: true, at: Date.now() };
      state.parked = null;
      ctx.then = [...(ctx.then ?? []), `_${waitingLine(state.pending)}_`];
      ctx.keepShown = true;
    } else if (ctx.parkedNow && reply) {
      reply = `_(I've kept ${keptWhat(state.parked)} for after this.)_\n\n${reply}`;
    }
    /**
     * SENT AGAIN, CHANGED NOTHING (his call 2026-10-07): the same expenses
     * typed while their preview is open re-showed it as if new. Now it says
     * so. Only for a message with figures in it, never "yes" or "show it".
     */
    const heldAfter = state.pending?.kind === 'add' ? JSON.stringify(state.pending.items.map(({ n, spentOn, rawAmount, currency, payee, description, skipped, ok, replaceId, category, spentBy, groupName, exchangeRate }) => [n, spentOn, rawAmount, currency, payee, description, skipped, ok, replaceId, category, spentBy, groupName, exchangeRate])) : null;
    const unchanged = heldBefore && heldBefore === heldAfter && !files.length
      && /_Not saved yet_/.test(String(reply ?? '')) && !/^Just to be sure/.test(String(reply ?? '')) && !String(reply ?? '').startsWith(ALREADY) && !SHOW_PREVIEW.test(said);
    if (unchanged && /\d/.test(said) && said.split(/\s+/).length >= 3) {
      // the same expenses typed again: the preview is shown again
      reply = `${ALREADY}${format.addPreview(state.pending.items, group)}`;
    } else if (unchanged) {
      /**
       * NOTHING CHANGED: said in a line, never the whole preview again with
       * its pictures (live 2026-10-07: "I like them, save them" re-sent six
       * pictures). What is still open, and how to answer it.
       */
      const live = state.pending.items.filter((x) => !x.skipped);
      const qs = format.questions(live);
      reply = [
        `Nothing in your preview changed (${live.length} ${live.length === 1 ? 'expense' : 'expenses'}, not saved yet).`,
        ...(qs.length ? ['', '⚠️ *Still open*', ...qs] : []),
        '',
        'Reply *yes* to save · *save the rest* to save the ready ones · *show me the preview* · *cancel*',
      ].join('\n');
    }
  } catch (err) {
    if (err.code === 'NO_AI') reply = 'I can\'t read that right now (my reading service is off). Nothing was saved. Try again later.';
    else {
      logger.error({ err, group }, 'expense bot: turn failed');
      reply = 'Sorry, something went wrong on my side. Nothing was saved. Please try again in a minute.';
    }
  }
  // A SECOND LOOK under a change preview: a big jump, a new payee, a name off
  if (typeof reply === 'string') reply = await withWarnings(reply, ctx);
  // SETTLED ONES LEFT OUT of a bigger change or removal: said under it
  if (typeof reply === 'string' && ctx.locked?.length && !reply.startsWith('🔒')) {
    reply = `${reply}

🔒 Settled (refunded), so left out: ${ctx.locked.slice(0, 5).map((d) => `*${d}*`).join(', ')}${ctx.locked.length > 5 ? ` and ${ctx.locked.length - 5} more` : ''}. The CRM admin can reopen them.`;
  }
  // THE RATES BUBBLE after a preview with other currencies in it: a second
  // message, so the rates read on their own (his call 2026-10-07).
  const more = [...(ctx.then ?? [])];
  /**
   * THE RATES, ONCE (his call 2026-10-07: they came with every reply). Sent
   * the first time a currency is in the preview; a currency added later gets
   * its own, once. Answers, re-shows and the saved note never repeat them;
   * "show rates" asks for them again.
   */
  if (state.pending?.kind === 'add' && PREVIEWS.test(String(reply ?? '')) && !ctx.rateNote) {
    const shown = new Set(state.pending.ratesShown ?? []);
    const fresh = [...new Set(state.pending.items.filter((x) => !x.skipped && x.currency && x.currency !== 'AED').map((x) => x.currency))].filter((c) => !shown.has(c));
    if (fresh.length) {
      const bubble = format.ratesBubble(state.pending.items.filter((x) => fresh.includes(x.currency)));
      if (bubble) more.push(bubble);
      state.pending.ratesShown = [...shown, ...fresh];
    }
  }
  // A RATE THEY CHANGED: one short line above the preview, not the rates again
  if (ctx.rateNote && reply) reply = `${ctx.rateNote}\n\n${reply}`;
  if (reply === HAND_OFF) {
    if (state.pending) state.pending.shownLast = false;
    await store.saveChat(phone, group, state);
    return { registered: true, handOff: true };
  }
  if (expired && reply) reply = `${expired}${reply}`;
  if (ctx.queuedNote && state.pending && reply) reply = `${reply}\n\n${ctx.queuedNote}`;
  // Was the open preview the last thing they saw? A "yes" counts only then.
  if (state.pending) state.pending.at = state.pending.at ?? Date.now();
  // looking at a receipt is not looking away: a yes after it still counts
  if (state.pending) state.pending.shownLast = Boolean(ctx.keepShown && state.pending.shownLast !== false) || PREVIEWS.test(String(reply ?? '')) || (ctx.then ?? []).some((t) => PREVIEWS.test(String(t))) || (/^(?:🧾 Receipt for|Sure, take your time|Okay, kept them|Drop all \d+ without saving|Sure\. Add one, like|Reply \*yes\* to undo it|No problem\. (?:Right now I'm about to|\d+ changes are waiting)|Which ones? should I (?:change|remove)|Left that one out|Swapped it|The \*[^*]+\* isn't in this list|Sure, I'll (?:remove .*|do that change) right after|That's \*\d+ expenses?\*)/.test(String(reply ?? '')) && Boolean(state.pending.shownLast));
  state.history = [...(state.history ?? []), { said: said || (files.length ? `[${files.length} file(s)]` : ''), reply }].slice(-HISTORY);
  if (msg.messageId) state.seen = [...(state.seen ?? []), { id: msg.messageId, reply }].slice(-30);
  // The saved batch is drawn once (below), never kept in the conversation.
  const savedItems = state.lastSaved ?? null;
  delete state.lastSaved;
  await store.saveChat(phone, group, state);
  /**
   * THE PICTURE (his calls 2026-10-07: "always", then a style picked in
   * Settings → Whatbot: sheet, notebook or plain text). A preview or a saved
   * batch goes as a note drawn from the very items "yes" will save, with a
   * short caption. Text stays the fallback: a picture that cannot be drawn
   * never costs them the message.
   */
  let image = null;
  let extraImages = [];
  let text = reply;
  let imageCaption = null;
  let body = null;
  try {
    const savedNow = /^✅ \*SAVED ·/.test(String(reply ?? '')) && savedItems?.length;
    const previewNow = state.pending?.kind === 'add' && /_Not saved yet_/.test(String(reply ?? '')) && !/^Just to be sure/.test(String(reply ?? ''));
    if (previewNow || savedNow) {
      const style = await settingsRepo.expenseStyle();
      const items = savedNow ? savedItems : state.pending.items;
      const pngs = renderCards(items, { group, saved: Boolean(savedNow), style, today });
      if (pngs.length) {
        [image, ...extraImages] = pngs.map((png, i) => ({ base64: png.toString('base64'), mime: 'image/png', filename: `expenses-${i + 1}.png`, saved: Boolean(savedNow) }));
        // what came before the preview stays above it: "Added 3 more", or
        // "(The removal you hadn't confirmed was dropped.)"
        const lead = /^(?:💱[^\n]*\n(?:💱[^\n]*\n)*\n)?(?:_\((?:The|I've kept) [^\n]*\)_\n\n)?(?:(?:Added \d+ more|Those (?:were|are) (?:all )?already)[^\n]*\n\n)?/.exec(String(reply))?.[0] ?? '';
        // what is STILL WAITING after "save the rest" rides under the caption
        const tail = /\n\n⏳[\s\S]*$/.exec(String(reply))?.[0] ?? '';
        text = `${lead}${format.caption(items, group, { saved: Boolean(savedNow) })}${tail}`;
        // ON WHATSAPP: the pictures first with a one-line caption, then the
        // notes, "Please check" and what to reply as a message of their own
        imageCaption = format.captionHead(items, group, { saved: Boolean(savedNow) });
        body = `${lead}${format.captionBody(items, group, { saved: Boolean(savedNow) })}${tail}`;
      }
    } else if (ctx.guide) {
      // THE GUIDE AS A NOTE; its text stays the fallback
      const pngs = renderTable(format.guideSpec(group));
      if (pngs.length) {
        image = { base64: pngs[0].toString('base64'), mime: 'image/png', filename: 'expenses-guide.png', kind: 'guide' };
        text = `📒 How to send *${group}* expenses. Type *payments* for your own pay.`;
      }
    } else if (ctx.answer?.table) {
      // A SPENDING REPORT of 4+ rows: the table as a picture (pages when
      // long), the heading and total as its caption.
      const spec = { ...ctx.answer.table, style: await settingsRepo.expenseStyle() };
      if (worthAPicture(spec)) {
        const pngs = renderTable(spec);
        if (pngs.length) {
          [image, ...extraImages] = pngs.map((p, i) => ({ base64: p.toString('base64'), mime: 'image/png', filename: `spending-${i + 1}.png`, kind: 'report' }));
          text = `${expired ?? ''}${ctx.answer.caption}${pngs.length > 1 ? `\n_${pngs.length} pages_` : ''}${ctx.answer.note ?? ''}`;
        }
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'expense bot: could not draw the picture, sending text');
    image = null;
    extraImages = [];
    text = reply;
  }
  const receiptOut = ctx.receiptOut ? { base64: ctx.receiptOut.buffer.toString('base64'), mime: ctx.receiptOut.mime, filename: ctx.receiptOut.filename } : null;
  if (channel === 'diane') {
    // Diane keeps her card (it can be read and searched); the picture goes
    // under it, to open large and to find again in Attachments.
    const view = forDiane(reply, state);
    // a report picture carries the list, so her text is just its caption
    if (image?.kind === 'report') view.reply = forDiane.plainText(text);
    return {
      registered: true, ...view, ...(image ? { image } : {}), ...(extraImages.length ? { moreImages: extraImages } : {}), ...(receiptOut ? { receipt: receiptOut } : {}),
      reply: [view.reply, ...more.map(forDiane.plainText)].filter(Boolean).join('\n\n'),
    };
  }
  return {
    registered: true, reply: text, replies: [text, ...more], ...(image ? { image } : {}),
    ...(image && imageCaption ? { imageCaption, body } : {}), ...(extraImages.length ? { moreImages: extraImages } : {}), ...(receiptOut ? { receipt: receiptOut } : {}),
  };
}

// ---- warnings under a change preview ----

/**
 * WORTH A SECOND LOOK BEFORE THE YES (his list 2026-10-08): an amount 10×
 * off, a date in the future, a payee never used (and the one they may have
 * meant), a name not on the master sheet (and who they may have meant), a
 * change that makes it the same as one already saved. Said, never blocked.
 */
async function warningsFor(p, ctx) {
  const items = editItems(p);
  const many = items.length + (p.removes ?? []).length > 1;
  const low = (v) => String(v ?? '').trim().toLowerCase();
  const known = await knownNames();
  const people = items.some((x) => x.fields.spentBy) ? await spender.people().catch(() => null) : null;
  const names = new Map();
  const found = [];
  for (const [i, x] of items.entries()) {
    const b = x.before;
    const f = x.fields;
    if (f.rawAmount != null && Number(b.rawAmount) > 0 && Number(f.rawAmount) > 0) {
      const ratio = Number(f.rawAmount) / Number(b.rawAmount);
      if (ratio >= 10 || ratio <= 0.1) found.push({ i, msg: `${format.money(b.currency, b.rawAmount)} ➜ ${format.money(b.currency, f.rawAmount)} is ${ratio >= 10 ? `${Math.round(ratio)}× more` : `${Math.round(1 / ratio)}× less`}. Is that right?` });
    }
    if (f.spentOn && f.spentOn > ctx.today) found.push({ i, msg: `${format.dayFull(f.spentOn)} is in the future.` });
    if (f.payee && !known.payees.some((k) => low(k) === low(f.payee))) {
      const near = known.payees.find((k) => (low(k).length >= 4 && oneTypo(low(k), low(f.payee))) || (low(f.payee).length >= 3 && low(k).startsWith(low(f.payee))));
      found.push({ i, msg: near ? `*${f.payee}* is a new payee. Did you mean *${near}*?` : `*${f.payee}* is a new payee.` });
    }
    if (f.spentBy && people && !x.me) {
      const key = `${low(f.spentBy)}|${b.groupName ?? ctx.group}`;
      if (!names.has(key)) names.set(key, await spender.linkSpender({ name: f.spentBy, group: b.groupName ?? ctx.group, list: people }).catch(() => null));
      const l = names.get(key);
      if (l?.status === 'near') found.push({ i, msg: `*${f.spentBy}* isn't on the master sheet. Did you mean *${l.choices[0]}*?` });
      if (l?.status === 'ambiguous') found.push({ i, msg: `which *${f.spentBy}*? ${l.choices.slice(0, 3).join(' or ')}` });
      if (l?.status === 'none') found.push({ i, msg: `*${f.spentBy}* isn't on the master sheet, so they won't see it on WhatsApp.` });
    }
    if (['spentOn', 'rawAmount', 'payee', 'description', 'currency'].some((k) => k in f)) {
      const a = { ...b, ...f };
      const twin = (await find.between(ctx.group, a.spentOn, a.spentOn)).find((r) => r.id !== x.id && Math.abs(Number(r.raw_amount) - Number(a.rawAmount)) < 0.005
        && r.currency === a.currency && low(r.payee) === low(a.payee) && low(r.description) === low(a.description));
      if (twin) found.push({ i, msg: `this would be the same as the *${twin.description}* already saved on ${format.day(a.spentOn)}.` });
    }
  }
  // the same note on several lines is said once: "No. 1–6: Glroria isn't…"
  const byMsg = new Map();
  for (const w of found) byMsg.set(w.msg, [...(byMsg.get(w.msg) ?? []), w.i + 1]);
  return [...byMsg].slice(0, 6).map(([msg, ns]) => `⚠️ ${many ? `No. ${format.ranges(ns)}: ` : ''}${msg}`);
}

/** The warnings, put just above "Reply yes…" of a change preview. */
async function withWarnings(reply, ctx) {
  const p = ctx.state.pending;
  if (p?.kind !== 'edit' || !/_Not changed yet_/.test(String(reply ?? ''))) return reply;
  const lines = await warningsFor(p, ctx).catch((err) => { logger.warn({ err: err.message }, 'expense bot: warnings skipped'); return []; });
  if (!lines.length) return reply;
  const at = reply.lastIndexOf('\nReply *yes*');
  return at > 0 ? `${reply.slice(0, at)}\n${lines.join('\n')}\n${reply.slice(at)}` : `${reply}\n\n${lines.join('\n')}`;
}

// ---- the list on screen, searches, undo by number, "who changed it" ----

const SHOW_ALL = /^(?:(?:pls|please|can you|could you)\s+)?(?:show|send|list|see|give)(?: me)?\s+(?:them\s+)?(?:all|all of them|every (?:one|line)|everything|the (?:full|whole|entire) (?:list|preview))(?:\s+(?:lines?|please|pls))*[.!?]*$/i;
const SORT = /^(?:(?:pls|please|can you|could you)\s+)?(?:sort|order|arrange)(?:\s+(?:it|them|the list|these|those|this))?\s+by\s+(amount|price|cost|value|date|day|name|description|what|payee|paid to|shop|vendor|person|spender|who|spent by|category|type)(?:\s+(asc|desc|ascending|descending|biggest first|largest first|highest first|smallest first|lowest first|newest first|latest first|oldest first|high(?:est)? to low(?:est)?|low(?:est)? to high(?:est)?|a to z|z to a))?[.!?]*$/i;
const SORT_SHORT = /^(?:(?:sort|order)\s+(?:it|them)?\s*)?(biggest|largest|highest|smallest|lowest|cheapest|newest|latest|oldest) first[.!?]*$/i;
const LIST_ONLY = /^(?:(?:pls|please)\s+)?(?:only|just|show only|show me only|filter(?: to| by)?|keep only)\s+(?:the\s+)?(.+?)(?:\s+ones?)?[.!?]*$/i;
const LIST_HIDE = /^(?:(?:pls|please)\s+)?(?:hide|without|exclude|leave out)\s+(?:the\s+)?(.+?)(?:\s+ones?)?[.!?]*$/i;
const FIND_ASK = /^(?:(?:pls|please|can you|could you)\s+)?(?:find|search(?: for)?|look(?:ing)? for|look up|anything (?:with|from|for|about)|any (?:expenses? )?(?:with|from|for|about))\s+["“'‘]?(.+?)["”'’]?[?.!]*$/i;
const MISSING_ASK = /\b(?:no|without|missing(?:\s+(?:an?|the|their))?|with(?:out)? (?:an? )?(?:empty|blank))\s+(payee|paid to|shop|vendor|category|spender|spent by|receipts?)\b/i;
const MISSING_FIELD = { payee: 'payee', 'paid to': 'payee', shop: 'payee', vendor: 'payee', category: 'category', spender: 'spentBy', 'spent by': 'spentBy', receipt: 'receipt', receipts: 'receipt' };
const SORT_KEY = { amount: 'amount', price: 'amount', cost: 'amount', value: 'amount', date: 'date', day: 'date', name: 'description', description: 'description', what: 'description', payee: 'payee', 'paid to': 'payee', shop: 'payee', vendor: 'payee', person: 'spentBy', spender: 'spentBy', who: 'spentBy', 'spent by': 'spentBy', category: 'category', type: 'category' };
const CATEGORY_SAID = { fuel: 'fuel', petrol: 'fuel', travel: 'travel', transport: 'travel', taxi: 'travel', taxis: 'travel', food: 'food', meals: 'food', meal: 'food', office: 'office', bills: 'bills', bill: 'bills', utilities: 'bills', other: 'other' };

/** One list row against "food", "over 500", "gloria's", "the taxis". */
function rowFits(r, phrase) {
  const t = String(phrase).toLowerCase().replace(/['’]s\b/g, '').trim();
  const cat = CATEGORY_SAID[t.replace(/\s+(?:ones?|expenses?|category)$/, '')];
  if (cat) return r.category === cat;
  const aed = r.aed ?? r.rawAmount;
  const over = /^(?:over|above|more than|bigger than|>)\s*(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)/.exec(t);
  if (over) return aed > Number(over[1].replace(/,/g, ''));
  const under = /^(?:under|below|less than|smaller than|<)\s*(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)/.exec(t);
  if (under) return aed < Number(under[1].replace(/,/g, ''));
  const words = find.wordsOf(t.replace(/^(?:by|spent by|paid to|from)\s+/, ''));
  if (!words.length) return null;
  const have = find.wordsOf(`${r.description} ${r.payee} ${r.spentBy}`);
  return words.every((w) => have.some((h) => h === w || h.startsWith(w)));
}

/** A list, numbered from 1, and made the list on screen. */
/** These saved expenses as the numbered list (the agent's show_expenses). */
async function showRows(ids, title, ctx) {
  const rows = (await Promise.all(ids.map((id) => expensesRepo.findById(id)))).filter(Boolean).map(find.asItem);
  if (!rows.length) return 'None of those are saved any more.';
  return listReply(rows, title.toUpperCase().slice(0, 60), ctx);
}

function listReply(rows, title, ctx, { all = false } = {}) {
  showList(ctx, rows.map((r) => r.id));
  const aed = rows.reduce((n, r) => n + (r.aed ?? 0), 0);
  const lines = rows.map((r, i) => format.line({ ...r, n: i + 1 }, { number: true, group: ctx.group === find.ALL }));
  const shown = all || lines.length <= 20 ? lines : [...lines.slice(0, 15), `_…and ${lines.length - 15} more · reply *show all* to list every one_`];
  return [`📋 *${title}*`, format.SEP, ...shown, format.SEP, `*TOTAL:* *${format.money('AED', Math.round(aed * 100) / 100)}* (${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'})`].join('\n');
}

/**
 * WHAT CODE ANSWERS FIRST, free and the same every time (his list
 * 2026-10-08): the list on screen sorted, narrowed or shown whole; a search;
 * the ones missing something, then filled by number; an undo by number;
 * what was just done; who changed one. Null for everything else.
 */
/**
 * ===============================
 * * "HOW DO I…?" / "CAN I…?" IS ANSWERED, never the hello again
 * ===============================
 * Two agent test 2026-10-09: "can I send the receipt photo first?" was read
 * as a receipt request, and "can I add the cost later?" got the hello three
 * times. A question about how the bot works is answered in one line, the
 * same every time, with anything waiting still said.
 */
const HOW_TO = [
  [/\b(?:receipt|photo|picture|pic)\b[^?]*\b(?:first|before|only|just|without)\b|\bcan i (?:just )?(?:send|upload|share) (?:a |the |just the )?(?:receipt|photo|picture|pic)\b/i,
    'Yes. Send the receipt photo on its own: I read it, show the expense before saving, and ask for anything it doesn\'t show.'],
  [/\b(?:later|after(?:wards)?|another time)\b[^?]*\b(?:add|change|update|edit|fix|put)\b|\b(?:add|change|update|edit|fix|put)\b[^?]*\b(?:later|after(?:wards)?|another time)\b/i,
    'Yes. Save it now and change it any time this month, like _change the office lunch to 100_. Refunded ones are locked.'],
  [/\b(?:first step|where do i (?:start|begin)|how (?:do|can|should) i (?:log|add|send|record|enter|submit|start)|how to (?:log|add|send|record|enter|submit)|what do i (?:send|do first))\b/i,
    'Send it in one line, like _taxi 45 aed careem today_, or a receipt photo. I show it before saving, and *yes* saves it.'],
  [/\bhow (?:do|can) i (?:delete|remove|cancel) (?:an? |the |one )?(?:saved |old )?(?:expense|one|entry)\b/i,
    'Say _remove the taxi on 5 Oct_, or _show all expenses_ then _remove 2_. I ask before removing.'],
  [/\bhow (?:do|can) i (?:change|edit|update|fix|correct)\b/i,
    'Say what to change, like _change the taxi on 5 Oct to 50_ or _2 spent by Gloria_. I show the change before saving.'],
  [/\b(?:how (?:do|can) i|can i) undo\b/i,
    'Say *undo* to take back your last change, or _undo only 2_ for one line of it.'],
];
function howToAnswer(t, pending) {
  if (!/\?|^(?:how|can|could|is it possible|do i|where|what do i)\b/i.test(t)) return null;
  const hit = HOW_TO.find(([re]) => re.test(t));
  if (!hit) return null;
  return pending ? `${hit[1]}\n\n${waitingLine(pending)}` : hit[1];
}

async function codeFirst(said, ctx, pending) {
  const t = String(said ?? '').trim();
  if (!t) return null;
  const how = howToAnswer(t, pending);
  if (how) return how;
  // "SHOW ALL": the whole waiting draft, or the whole list on screen
  if (SHOW_ALL.test(t)) {
    if (pending?.kind === 'edit') return format.editsPreview(editItems(pending), { group: ctx.group === find.ALL, removes: pending.removes ?? [], all: true });
    if (pending?.kind === 'remove') return format.removePreview(pending.before, { group: ctx.group === find.ALL, all: true });
    if (pending?.kind === 'settle') return settlePreview(pending, ctx, { all: true });
    if (!pending && listOnScreen(ctx.state)) {
      const rows = (await Promise.all(ctx.state.listIds.map((id) => expensesRepo.findById(id)))).filter(Boolean).map(find.asItem);
      return listReply(rows, `ALL ${rows.length}`, ctx, { all: true });
    }
  }
  // SETTLE / REOPEN / FOR REVIEW, BY HAND (Diane only)
  const settleAsk = SETTLE_ASK.exec(t);
  if (settleAsk) return startSettle(settleAsk, ctx);
  // WHAT WAS JUST DONE
  if (WHAT_DONE.test(t)) {
    const a = await store.lastAction(ctx.phone, ctx.group);
    if (pending) ctx.keepShown = true;
    if (!a) return 'Nothing yet: you haven\'t saved, changed or removed anything here.';
    const verb = { add: 'Saved', edit: 'Changed', remove: 'Removed' }[a.kind] ?? 'Did';
    const when = new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: process.env.TIMEZONE || 'Asia/Dubai' });
    return `↩️ *Last thing you did* (${when}): ${verb}, ${actionText(a)}.\n\nReply *undo* to take it back.`;
  }
  // WHO CHANGED IT
  const who = WHO_DID.exec(t);
  if (who) return whoDid(who[1], ctx);
  // UNDO BY NUMBER, THE LAST FEW, OR BY WHAT IT CHANGED
  if (UNDO_SOME.test(t)) return startUndo(ctx, t);
  // A SEARCH: "find dewa", "anything with careem" (the 3 months kept)
  const look = FIND_ASK.exec(t);
  if (look && !/\b(?:receipts?|preview)\b/i.test(look[1])) {
    const words = look[1].replace(/\b(?:expenses?|ones?|in it|in them)\b/gi, ' ').trim();
    const rows = (await find.between(ctx.group, minus(ctx.today, 92), ctx.today)).map(find.asItem)
      .filter((r) => find.wordsOf(words).every((w) => find.wordsOf(`${r.description} ${r.payee} ${r.spentBy}`).some((h) => h === w || h.startsWith(w))));
    if (pending) ctx.keepShown = true;
    if (!rows.length) return `Nothing with _${words}_ in the last 3 months.`;
    return listReply(rows, `${rows.length} WITH "${words.toUpperCase()}" · last 3 months`, ctx);
  }
  // THE ONES MISSING SOMETHING, to fill in by number
  const gap = /^(?:which|what|show|list|any|are there|expenses?|ones?|find)\b/i.test(t) && MISSING_ASK.exec(t);
  if (gap) {
    const field = MISSING_FIELD[gap[1].toLowerCase()];
    const rows = (await find.between(ctx.group, `${ctx.today.slice(0, 8)}01`, ctx.today)).filter((r) => (field === 'receipt' ? !r.receipt_path : !String(r[{ payee: 'payee', category: 'category', spentBy: 'spent_by' }[field]] ?? '').trim())).map(find.asItem);
    const label = { payee: 'a payee', category: 'a category', spentBy: 'a spender', receipt: 'a receipt' }[field];
    if (pending) ctx.keepShown = true;
    if (!rows.length) return `Every expense this month has ${label}. 👍`;
    const list = listReply(rows, `${rows.length} WITHOUT ${label.replace(/^an? /, '').toUpperCase()} · this month`, ctx);
    if (field === 'receipt' || pending) return list;
    ctx.state.awaiting = `fill:${field}`;
    const ex = { payee: '1 careem, 2 zuma', category: '1 travel, 2 food', spentBy: '1 gloria, 2 zayn' }[field];
    return `${list}\n\nFill them in by number, like _${ex}_, or _all ${ex.split(', ')[0].split(' ')[1]}_.`;
  }
  // "1 CAREEM, 2 ZUMA" after that list: each one filled, one preview
  if (!pending && String(ctx.awaiting ?? '').startsWith('fill:') && ctx.state.listIds?.length) {
    const field = ctx.awaiting.slice(5);
    const ids = ctx.state.listIds;
    const allOf = /^(?:all|all of them|every one|them all)\s+(?:to\s+|are\s+|is\s+)?(.+)$/i.exec(t);
    const parts = allOf ? ids.map((_, i) => [i + 1, allOf[1]]) : t.split(/\n+|\s*[;,]\s*|\s+and\s+(?=\d)/i).map((p) => /^(?:no\.?\s*|#)?(\d{1,3})\s*[.):-]?\s+(.+)$/.exec(p.trim())).map((m) => (m ? [Number(m[1]), m[2]] : null));
    if (parts.length && parts.every((p) => p && p[0] >= 1 && p[0] <= ids.length)) {
      let reply = null;
      for (const [n, v] of parts) {
        const value = field === 'category' ? CATEGORY_SAID[v.toLowerCase().trim()] : v.trim().replace(/[.!]+$/, '');
        if (!value) return `_${v}_ isn't a category. Use fuel, travel, food, office, bills or other.`;
        // eslint-disable-next-line no-await-in-loop
        const row = await expensesRepo.findById(ids[n - 1]);
        if (row) reply = editPreviewFor(row, { [field]: value }, ctx);
      }
      if (ctx.state.pending?.kind === 'edit') return format.editsPreview(editItems(ctx.state.pending), { group: ctx.group === find.ALL });
      return reply;
    }
  }
  // THE LIST ON SCREEN, SORTED, NARROWED OR WITH SOME HIDDEN (nothing waiting)
  if (!pending && listOnScreen(ctx.state)) {
    const sort = SORT.exec(t);
    const short = !sort && SORT_SHORT.exec(t);
    const only = !sort && !short && LIST_ONLY.exec(t);
    const hide = !sort && !short && !only && LIST_HIDE.exec(t);
    if (sort || short || only || hide) {
      const rows = (await Promise.all(ctx.state.listIds.map((id) => expensesRepo.findById(id)))).filter(Boolean).map(find.asItem);
      if (sort || short) {
        let by = sort ? SORT_KEY[sort[1].toLowerCase()] : /newest|latest|oldest/i.test(short[1]) ? 'date' : 'amount';
        const word = String(sort?.[2] ?? short?.[1] ?? '').toLowerCase();
        const asc = /asc|smallest|lowest|cheapest|oldest|low(?:est)? to|a to z/.test(word) || (!word && ['description', 'payee', 'spentBy', 'category'].includes(by));
        if (!by) by = 'amount';
        const sorted = find.sortRows(rows, `${by}:${asc ? 'asc' : 'desc'}`);
        return listReply(sorted, `SORTED BY ${by === 'spentBy' ? 'PERSON' : by.toUpperCase()}${asc ? '' : ' · ' + (by === 'date' ? 'newest' : 'biggest') + ' first'}`, ctx);
      }
      const phrase = (only ?? hide)[1];
      // by number: "only 1-3", "hide 4"
      const ns = numberSet(phrase);
      const fits = ns ? rows.map((r, i) => ns.includes(i + 1)) : rows.map((r) => rowFits(r, phrase));
      if (fits.some((f) => f === null)) return null;
      // words nothing on the list has ("just a sec", "only joking") are not a filter
      const byWords = !ns && !CATEGORY_SAID[String(phrase).toLowerCase().replace(/['’]s\b/g, '').replace(/\s+(?:ones?|expenses?|category)$/, '').trim()] && !/^(?:over|above|more than|bigger than|under|below|less than|smaller than|[<>])/i.test(phrase);
      if (byWords && !fits.some(Boolean)) return null;
      const kept = rows.filter((_, i) => (only ? fits[i] : !fits[i]));
      if (!kept.length) return only ? `None of the ${rows.length} on the list ${ns ? 'have those numbers' : `fit _${phrase}_`}.` : 'That would hide every one on the list.';
      if (kept.length === rows.length) return only ? `They all fit _${phrase}_ already.` : `None of them fit _${phrase}_, so nothing was hidden.`;
      return listReply(kept, `${kept.length} OF ${rows.length} · ${only ? `only ${phrase}` : `without ${phrase}`}`, ctx);
    }
  }
  return null;
}

// ---- settling by hand: the CRM admin, through Diane ----

const SETTLE_ASK = /^(?:(?:pls|please|can you|could you)\s+)?(?:(settle|unsettle|reopen)\s+(.+?)|mark\s+(.+?)\s+(?:as\s+)?(refunded|settled|paid|unsettled|not refunded|unpaid|for review|to review|needing review|needs review))[.!]*$/i;
const MONTH_NO = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const SETTLE_WORDS = { settled: ['SETTLE', 'mark them refunded', 'SETTLED'], unsettled: ['REOPEN', 'reopen them', 'REOPENED'], review: ['MARK FOR REVIEW', 'mark them for review', 'MARKED FOR REVIEW'] };

/**
 * "SETTLE 1-3", "mark gloria's sept expenses refunded", "reopen 2" (his
 * call 2026-10-08): only the CRM admin, so only with Diane. Shown first;
 * nothing moves before yes.
 */
async function startSettle(m, ctx) {
  if (ctx.channel !== 'diane') return 'Only the CRM admin can settle expenses: on the Expenses page, or with Diane.';
  // one thing waits at a time: what waits is answered first
  if (ctx.state.pending && ctx.state.pending.kind !== 'settle') { ctx.keepShown = true; return `${waitingLine(ctx.state.pending)}\nThen ask me to settle.`; }
  const verb = String(m[1] ?? m[4]).toLowerCase();
  const to = /^(?:settle|refunded|settled|paid)$/.test(verb) ? 'settled' : /review/.test(verb) ? 'review' : 'unsettled';
  const phrase = String(m[2] ?? m[3]).trim();
  const list = listOnScreen(ctx.state) ? ctx.state.listIds : [];
  let rows;
  const ns = numberSet(phrase.replace(/^(?:no\.?\s*|#)/i, ''));
  if (ns) {
    if (!list.length) return 'Which ones? Show a list first, like _show me this month\'s expenses_, then _settle 1-3_.';
    if (!ns.every((n) => n >= 1 && n <= list.length)) return `There ${list.length === 1 ? 'is' : 'are'} only ${list.length} on the list. Pick from 1–${list.length}.`;
    rows = (await Promise.all(ns.map((n) => expensesRepo.findById(list[n - 1])))).filter(Boolean);
  } else if (/^(?:all|them|these|those|all of them|every one|the list)$/i.test(phrase) && list.length) {
    rows = (await Promise.all(list.map((id) => expensesRepo.findById(id)))).filter(Boolean);
  } else {
    // "gloria's sept expenses": a person or words, and a month when said
    const mon = Object.keys(MONTH_NO).find((k) => new RegExp(`\\b${k}[a-z]*\\b`, 'i').test(phrase));
    const words = phrase.replace(/['’]s\b/g, '').replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, ' ').replace(/\b(?:expenses?|ones?|all|the|of|for|from|in)\b/gi, ' ').trim();
    let from = minus(ctx.today, 92);
    let to2 = ctx.today;
    if (mon) {
      const y = Number(ctx.today.slice(0, 4)) - (MONTH_NO[mon] > Number(ctx.today.slice(5, 7)) ? 1 : 0);
      from = `${y}-${String(MONTH_NO[mon]).padStart(2, '0')}-01`;
      to2 = new Date(Date.UTC(y, MONTH_NO[mon], 0)).toISOString().slice(0, 10);
    }
    const all = (await find.between(ctx.group, from, to2)).map((r) => ({ r, item: find.asItem(r) }));
    rows = all.filter(({ item }) => !find.wordsOf(words).length || rowFits(item, words)).map(({ r }) => r);
    if (!rows.length) return `Nothing fits _${phrase}_${mon ? '' : ' in the last 3 months'}.`;
  }
  const moving = rows.filter((r) => (r.settle_status ?? 'unsettled') !== to);
  if (!moving.length) return `${rows.length === 1 ? 'It is' : `All ${rows.length} are`} already ${to === 'settled' ? 'settled' : to === 'review' ? 'marked for review' : 'unsettled'}.`;
  ctx.state.pending = { kind: 'settle', to, ids: moving.map((r) => r.id), before: moving.map((r) => ({ ...SNAP(r), id: r.id })) };
  return settlePreview(ctx.state.pending, ctx);
}

function settlePreview(p, ctx, { all = false } = {}) {
  const [head, act] = SETTLE_WORDS[p.to];
  const items = p.before.map((b) => ({ ...b, n: null }));
  const lines = items.map((x, i) => format.line({ ...x, n: items.length > 1 ? i + 1 : null }, { number: items.length > 1, group: ctx.group === find.ALL }));
  const shown = all || lines.length <= 15 ? lines : [...lines.slice(0, 10), `_…and ${lines.length - 10} more · reply *show all*_`];
  return [`✅ *${head} ${items.length} ${items.length === 1 ? 'EXPENSE' : 'EXPENSES'}?*`, '_Not changed yet_', format.SEP, ...shown, format.SEP,
    `Reply *yes* to ${act} · *cancel*`].join('\n');
}

async function saveSettle(ctx) {
  const p = ctx.state.pending;
  ctx.state.pending = null;
  // eslint-disable-next-line global-require
  const checks = require('../../repos/expenseChecks.repo');
  const moved = await checks.setStatus(p.ids, p.to, { by: ctx.admin?.name ?? 'the CRM admin', via: 'diane' });
  broadcast(null, EVENT, { action: p.to, ids: moved.map((r) => r.id), via: 'diane' });
  const [, , done] = SETTLE_WORDS[p.to];
  return `✅ *${done} · ${moved.length} ${moved.length === 1 ? 'expense' : 'expenses'}*${moved.length < p.ids.length ? `\n_${p.ids.length - moved.length} had already moved, left as they are._` : ''}`;
}

/** One action in words: "Spent by Zayn ➜ Gloria on the Taxi, the Lunch…". */
function actionText(a, only = null) {
  const list = (a.changes ?? []).map((c, i) => ({ c, i })).filter(({ c, i }) => !c.undone && !c.undid && (!only || only.includes(i + 1)));
  const one = ({ c }) => {
    if (c.removed || a.kind === 'remove') return `removed the *${c.before?.description}*`;
    if (c.created) return `split off *${c.after?.description}* (${format.money(c.after?.currency, c.after?.rawAmount)} by ${c.after?.spentBy ?? 'nobody'})`;
    if (a.kind === 'add') return `saved the *${c.after?.description}*${c.replaced ? ' (replaced)' : ''}`;
    const moved = Object.keys(c.after ?? {}).filter((f) => !['exchangeRate', 'spentByPersonId', 'spentByPhone', 'savedBy'].includes(f) && String(c.before?.[f] ?? '') !== String(c.after?.[f] ?? ''));
    return `the *${c.before?.description}*: ${moved.map((f) => `${format.LABEL[f] ?? f} ${c.before?.[f] ?? 'blank'} ➜ ${c.after?.[f] ?? 'blank'}`).join(', ') || 'changed'}`;
  };
  const shown = list.slice(0, 5).map(one);
  return `${shown.join('; ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}`;
}

/** "WHO CHANGED 4?": who saved it, and every change made on WhatsApp since. */
async function whoDid(target, ctx) {
  const pool = require('../../../configs/db');
  let row = null;
  if (/^\d+$/.test(target)) {
    const id = listOnScreen(ctx.state) ? ctx.state.listIds[Number(target) - 1] : null;
    if (!id) return `Which one is No. ${target}? Show a list first, like _show me this month's expenses_.`;
    row = await expensesRepo.findById(id);
  } else {
    const hits = thisMonthOr(await find.findTarget(ctx.group, { words: target.replace(/^the\s+/i, '') }, { today: ctx.today }), ctx.today);
    if (hits.length > 1) return `There are ${hits.length} of those. Say which by number from a list, like _who changed 3?_`;
    if (hits.length === 1) row = await expensesRepo.findById(hits[0].id);
  }
  if (!row) return 'I couldn\'t find that expense.';
  const { rows } = await pool.query(
    `SELECT a.*, (SELECT name FROM tb_expense_admins m WHERE m.phone = a.phone AND lower(m.group_name) = lower(a.group_name) LIMIT 1) AS who
       FROM tb_expense_actions a
      WHERE a.kind IN ('add', 'edit') AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.changes) c WHERE c->>'id' = $1::text)
      ORDER BY a.created_at ASC LIMIT 10`,
    [String(row.id)],
  );
  const day = (v) => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: process.env.TIMEZONE || 'Asia/Dubai' });
  const lines = [`🔎 *${row.description}* · ${format.money(row.currency, Number(row.raw_amount))} · ${format.day(find.iso(row.spent_on))}`, format.SEP,
    `• Saved by *${row.saved_by ?? 'someone in the CRM'}* on ${day(row.created_at)}`];
  for (const a of rows) {
    const c = a.changes.find((x) => String(x.id) === String(row.id));
    if (a.kind === 'edit' && c && !c.created) lines.push(`• Changed by *${a.who ?? a.phone}* on ${day(a.created_at)}: ${actionText({ ...a, changes: [c] })}${a.undone_at ? ' _(undone)_' : ''}`);
  }
  if (row.updated_at && new Date(row.updated_at) - new Date(rows.at(-1)?.created_at ?? row.created_at) > 60000) lines.push(`• Last updated ${day(row.updated_at)} (in the CRM or by Diane)`);
  if (ctx.state.pending) ctx.keepShown = true;
  return lines.join('\n');
}

/**
 * WITH THE AGENT ON: code answers only the instant replies (a short yes, no,
 * number or pick to what waits; hi, thanks, help, show it, undo, rates,
 * files), then the agent reads everything else with the whole conversation.
 * If it cannot be reached, or passes, the reader below answers.
 */
async function agentFirst(said, files, ctx) {
  const t = said.trim();
  const pending = ctx.state.pending ?? null;
  const short = t.split(/\s+/).length <= 4;
  const lastReply = String((ctx.state.history ?? []).at(-1)?.reply ?? '');
  const askedLast = ctx.state.agentAsked === true && /\?\s*(?:\n|$)/.test(lastReply.trim());
  const instant = files.length || !t
    || GREETING.test(t) || HELP_ASK.test(t) || THANKS.test(t) || ACK.test(t) || SHOW_PREVIEW.test(t) || UNDO.test(t) || RECEIPT_ASK.test(t)
    || (/^(?:the\s+)?receipts?\b/i.test(t) && t.length < 40)
    || (/\brates?\b/i.test(t) && t.length < 30)
    // "update zayn expenses", "delete some": the numbered list to pick from;
    // not when it answers the agent's own question ("change, or add new?")
    || (!pending && !askedLast && (CHANGE_WHICH.test(canonicalVerbs(t)) || REMOVE_WHICH.test(canonicalVerbs(t))))
    || (pending && short && readReply(t, pending, { year: year(ctx.today), groups: ctx.groups }))
    // a yes or no with nothing waiting: said plainly in code
    || (!pending && short && /^(?:y|ya|yes|yep|yeah|yup|ok|okay|sure|go ahead|do it|save(?: it)?|no|nope|cancel)\b[\s!.]*$/i.test(t))
    // A TYPED NEW EXPENSE ("45 aed careem taxi", "taxi 45 / lunch 30 / parking 15"): the
    // reader below, with its own "change or new?" check, did these right every time
    // (a minus sign goes to the agent, which asks: a refund, or a typo?)
    || (!pending && !askedLast && pureNewExpense(t) && !/(?:^|\s)[-−]\s?[£$€]?\s?\d/.test(t))
  ctx.state.agentAsked = false;
  /**
   * A YES IN THEIR OWN WORDS while something waits: "yes cheers", "yeh do it",
   * "ffs i said yes just update it pls" re-showed the same preview three
   * times (break test 2026-10-10). Agreement with no change in it is a yes.
   */
  // THE LAST THING SAID DECIDES: "no, cancel, oh actually, yes, put it back!" is a yes
  const tail = t.split(/\b(?:actually|wait|oh|sorry|hold on|hang on)\b/i).pop().replace(/^[\s,.!—-]+/, '');
  const yesWords = /\b(?:y(?:es|eah|eh|ep|up|a)|ok(?:ay)?|sure|do it|go ahead|go on|crack on|save (?:it|them)|update it|put it back|confirm|i said yes|go for it|sounds good|that'?s (?:fine|right|correct))\b/i;
  const changeCues = /\d|\b(?:no|nope|nah|not|don'?t|cancel|stop|wait|hold|change|remove|delete|only|except|instead|but|undo|add|also|and)\b/i;
  const agrees = (x) => x && x.split(/\s+/).length <= 14 && yesWords.test(x) && !changeCues.test(x.replace(/\b(?:i said yes|update it|put it back)\b/gi, ''));
  if (pending && !files.length && (agrees(t) || (tail !== t && agrees(tail)))) {
    return onReply({ kind: 'yes' }, ctx);
  }
  // "ACTUALLY NEVER MIND, LEAVE IT": a no, in code (it said "nothing changed" and left it waiting)
  const dropsIt = /^(?:(?:actually|oh|sorry|ok(?:ay)?|no)[,!.\s]+)*(?:never ?mind|nvm|forget (?:it|that)|leave it(?: as it (?:was|is))?|scrap (?:it|that)|don'?t bother|cancel (?:it|that))(?:[,!.\s]+(?:leave it|thanks|cheers|ta|please|pls))*[.!\s]*$/i;
  if (pending && !files.length && dropsIt.test(t)) return onReply({ kind: 'no' }, ctx);
  // A BARE NUMBER TO "WHICH ONE?" is the pick (it was read as "add that too")
  if (pending?.kind === 'pick' && /^\s*(?:no\.?\s*|#)?\d{1,2}[.!\s]*$/i.test(t)) {
    const n = Number(t.replace(/\D/g, ''));
    if (n >= 1 && n <= pending.choices.length) return onReply({ kind: 'pick', n }, ctx);
  }
  // "UNDO" AGAIN while that undo waits is the yes to it, not a cancel
  if (pending?.kind === 'undo' && UNDO.test(t)) return onReply({ kind: 'yes' }, ctx);
  /**
   * ANOTHER GROUP'S EXPENSES, asked on this group's number: said plainly
   * (it answered "No expenses found for MANBAT · INDIGO").
   */
  if (ctx.channel !== 'diane' && !files.length) {
    const other = (await knownGroups()).find((g) => g !== ctx.group && new RegExp(`(?:^|[^a-z0-9])${g.toLowerCase().replace(/[^a-z0-9 ]/g, '')}(?:$|[^a-z0-9])`).test(t.toLowerCase()));
    if (other && /\b(?:show|see|list|spend\w*|expenses?|total|how much|what)\b/i.test(t)) {
      return `This number is for *${ctx.group}* expenses only, so I can't show *${other}*'s here. Each group's admins see their own group; the CRM admin sees every group.`;
    }
  }
  if (instant && /^(?:the\s+)?receipts?\b/i.test(t) && !RECEIPT_ASK.test(t)) return receiptFor(t, ctx);
  // "SHOW EXPENSES" WITH NO PREVIEW OPEN is this month's list ("there is no preview open" before)
  if (!pending && SHOW_PREVIEW.test(t) && /\bexpenses?\b/i.test(t)) {
    return questionReply({ kind: 'question', query: { from: '', to: '', group: '', groupBy: '', measure: 'list', words: '' } }, ctx, null);
  }
  if (instant) {
    const out = await answerTurn(said, files, ctx);
    /**
     * "OK SAVE IT, 1 ME": the answer, then the save, when nothing else is
     * open (break test 2026-10-10: it answered and asked for yes again).
     */
    const p2 = ctx.state.pending;
    if (pending?.kind === 'add' && p2?.kind === 'add' && /\b(?:save|yes|yeah|yep)\b/i.test(t) && !/^\s*(?:yes|yeah|yep|save)[\s!.]*$/i.test(t)
      && !format.questions(p2.items.filter((x) => !x.skipped)).length) {
      return onReply({ kind: 'yes' }, ctx);
    }
    return out;
  }
  /**
   * EXACT COMMANDS STAY IN CODE (the harness, 2026-10-10: the agent did them
   * worse): sort, only, hide, show all, find, what was just done, who changed
   * it, undo by number, settle; a question the code reader reads whole; an
   * answer to the bot's own "change or new?" / "which one?"; "remove 3"
   * with no list (the list is shown).
   */
  // an order in it ("anything from 1st oct, delete it") is not a search
  const orders = /\b(?:delete|remove|bin|scrap|change|update|make|set|add|move|knock|take|double|halve|put|fix)\b/i.test(t);
  const coded = orders && !/^(?:sort|order|show|list|undo|revert|who|what|which|find|search)\b/i.test(t) ? null : await codeFirst(t, ctx, pending);
  if (coded) return coded;
  const q = quickRoute(t, { today: ctx.today, groups: ctx.groups, group: ctx.group });
  if (q?.kind === 'question' && !/\b(?:and|also|then|plus)\b.*\b(?:delete|remove|change|update|make|set|add|move|knock|double|halve)\b/i.test(t)) return answerTurn(said, files, ctx);
  if (pending && ['either', 'pick', 'settle'].includes(pending.kind) && t.split(/\s+/).length <= 8) return answerTurn(said, files, ctx);
  if (!listOnScreen(ctx.state) && /^(?:remove|delete|change|edit)\s+(?:no\.?\s*|#)?\d+[.!]*$/i.test(t)) return answerTurn(said, files, ctx);
  try {
    // eslint-disable-next-line global-require
    const out = await require('./agent').agentTurn(said, ctx, {
      plannerContext, applyPlan, onReply, questionReply, reviseFrom, actionText, quickRoute, route, whichToChange, whichToRemove, showRows, addFrom,
    });
    // a question of its own: the short answer comes back to it, not to a code path
    ctx.state.agentAsked = Boolean(out) && !ctx.state.pending && (/\?\s*$/.test(String(out).trim()) || /\?\s*\n|reply with \d|^\s*1[.)]\s/im.test(String(out)));
    // ITS OWN NUMBERED QUESTION: "1" answers it, never an older list (break test: "1" changed the DEWA bill)
    if (ctx.state.agentAsked) { ctx.state.listIds = null; ctx.state.awaiting = null; }
    if (out) return out;
  } catch (err) {
    if (err.code === 'NO_AI') throw err;
    logger.warn({ err: err.message }, 'expense agent failed, the reader answers');
  }
  return answerTurn(said, files, ctx);
}

async function answerTurn(said, files, ctx) {
  const { state, admin, group, today } = ctx;
  let pending = state.pending ?? null;

  /**
   * NEVER LOCKED (his call 2026-10-07: "I don't want it locked when we don't
   * answer yes or cancel"). What waits can be dropped in words, or set aside
   * while something else is done, and comes back with a reminder after.
   */
  if (pending && !files.length) {
    /**
     * A CHANGE OF MIND: "actually just change the cleaner to 200 instead"
     * while its removal waits (his harness 2026-10-07: the next yes removed
     * it). The new request replaces the waiting one, of the other kind.
     */
    const mind = /^(?:(?:actually|no|sorry|oops|wait|hmm)[,!.\s]+)+(?:just\s+|rather\s+|instead\s+)?(.+?)(?:\s+instead)?[.!]*$/i.exec(said.trim());
    const newKind = mind ? quickRoute(mind[1], { today, groups: ctx.groups, group })?.kind : null;
    if (mind && ((pending.kind === 'remove' && newKind === 'edit') || (pending.kind === 'edit' && newKind === 'remove'))) {
      state.pending = null;
      pending = null;
      said = mind[1];
      ctx.said = said;
    }
    // "NEVER MIND THAT, change the taxi to 50": drop it, do the rest
    const drop = /^(?:never ?mind|nvm|forget|scrap|ignore|cancel|skip)\s+(?:that|it|this|those|the (?:change|changes|removal|preview|last one))\b[,.!\s]*(?:and\s+|instead\s+)?(.*)$/i.exec(said.trim());
    if (drop) {
      state.pending = null;
      pending = null;
      if (!drop[1].trim()) return 'Okay, dropped it. Nothing was changed.';
      said = drop[1].trim();
      ctx.said = said;
    }
  }
  /**
   * SOME OF THE PREVIEW, BY NUMBER: "only 1-3", "not 5-6", "1-3 only" (his
   * report 2026-10-08: refused, then read as a new expense). Read in code,
   * before anything can take it for something else.
   */
  if (pending && !files.length) {
    const r = readReply(said, pending, { year: year(today), groups: ctx.groups });
    if (r?.byLines) return onReply(r, ctx);
  }
  if (!files.length) {
    const first = await codeFirst(said, ctx, pending);
    if (first) return first;
  }
  if (pending && !files.length && pending.kind !== 'either') {
    const canon = canonicalVerbs(said);
    const asked = quickRoute(said, { today, groups: ctx.groups, group });
    // A NEW EXPENSE WHILE A CHANGE, A REMOVAL OR A PICK WAITS: that one aside
    const newExpense = pending.kind !== 'add' && /[a-z]{3,}/i.test(said) && /\d/.test(said) && !asked
      && !EDIT_WORDS.test(canon) && !editish(canon) && !/^(?:yes|no|cancel|not|and|also|actually)\b/i.test(said.trim());
    // A CHANGE OR REMOVAL OF A SAVED ONE WHILE NEW EXPENSES WAIT: those aside
    let savedOne = false;
    if (pending.kind === 'add' && (asked?.kind === 'edit' || asked?.kind === 'remove') && !asked.target.last) {
      const words = find.wordsOf(asked.target.words);
      const inPreview = words.length && pending.items.some((x) => !x.skipped && words.every((w) => find.wordsOf(`${x.description} ${x.payee}`).some((h) => h.startsWith(w))));
      const hits = inPreview ? [] : await find.findTarget(group, asked.target, { today });
      savedOne = !inPreview && hits.length > 0;
    }
    if (newExpense || savedOne) {
      state.parked = pending;
      state.pending = null;
      pending = null;
      ctx.parkedNow = true;
    }
  }
  // "CHANGE THESE SAVED ONES, OR ADD THEM AS NEW?" answered
  if (pending?.kind === 'either' && !files.length) {
    if (/^(?:change|update|edit|fix|existing|saved|the saved ones?|change them|yes|correct them)\b/i.test(said.trim())) {
      state.pending = null;
      let reply = null;
      for (const e of pending.edits) {
        // eslint-disable-next-line no-await-in-loop
        const row = await expensesRepo.findById(e.id);
        if (row) reply = editPreviewFor(row, { rawAmount: e.amount }, ctx);
      }
      return reply && state.pending?.kind === 'edit' ? format.editsPreview(editItems(state.pending), { group: group === find.ALL }) : 'Those have changed since, so nothing is waiting. Send them again.';
    }
    if (/^(?:new|add|add them|as new|new ones?|save (?:them )?as new|they'?re new)\b/i.test(said.trim())) {
      state.pending = null;
      return addFrom({ text: pending.text }, ctx);
    }
    if (/^(?:cancel|no|never ?mind)\b/i.test(said.trim())) { state.pending = null; return 'Okay, nothing was changed or added.'; }
    state.pending = null;
    pending = null;
  }

  // A NEW BATCH WHILE A REMOVAL OR A CHANGE WAITS: that one is dropped, and
  // said (his sweep 2026-10-07: it vanished without a word)
  let droppedNote = '';
  if (pending && pending.kind !== 'add' && files.length) {
    // SET ASIDE, not dropped: it comes back once these are saved or cancelled
    ctx.state.parked = pending;
    ctx.state.pending = null;
    ctx.parkedNow = true;
    return addFrom({ text: said, attachments: files }, ctx);
  }
  /**
   * THE PLANNER, WHILE A CHANGE, A REMOVAL OR A PICK WAITS: anything that is
   * not an instant reply (yes, no, a number) is read with what waits in view.
   */
  if (pending?.kind === 'pick' && !files.length) {
    const words = find.wordsOf(said.replace(/\b(?:the|one|that|this|i mean|i meant)\b/gi, ' '));
    if (words.length) {
      const rows = (await Promise.all(pending.choices.map((id) => expensesRepo.findById(id)))).map((r) => r && find.asItem(r));
      const fit = rows.map((r, i) => (r && words.every((w) => find.wordsOf(`${r.description} ${r.payee} ${r.spentOn} ${format.day(r.spentOn)}`).some((h) => h.startsWith(w))) ? i + 1 : null)).filter(Boolean);
      if (fit.length === 1) return onReply({ kind: 'pick', n: fit[0] }, ctx);
    }
  }
  if (PLANNER_ON && pending && ['edit', 'remove', 'pick', 'undo'].includes(pending.kind) && !files.length && !cheapMessage(said, pending, ctx)) {
    const out = await runPlanner(said, ctx);
    if (out) return out;
  }
  /**
   * ANOTHER CHANGE WHILE CHANGES WAIT ("update internet bill also to 800
   * pls"): it JOINS them, all asked once (his call 2026-10-07). While a
   * "which one?" is open, it is kept for after the pick.
   */
  if ((pending?.kind === 'edit' || (pending?.kind === 'pick' && pending.then.kind === 'edit')) && !files.length) {
    // "update zayns expenses" while changes wait: the list, the changes kept
    if (pending.kind === 'edit' && CHANGE_WHICH.test(canonicalVerbs(said))) {
      const n = editItems(pending).length;
      return `${await whichToChange(ctx, CHANGE_WHICH.exec(canonicalVerbs(said))[1])}\n\n_${n === 1 ? 'Your change is' : `Your ${n} changes are`} still waiting: add more, or reply *yes* to save._`;
    }
    // "CANCEL THE GROCERIES", "drop the taxi": one out, when it is in the list
    const out = pending.kind === 'edit' && /^(?:cancel|drop|forget|skip|leave out|scrap)\s+(?:the\s+)?(.+?)(?:\s+change)?[.!]*$/i.exec(said.trim());
    if (out) {
      const words = find.wordsOf(out[1]);
      const items = editItems(pending);
      const keep = items.filter((x) => !words.every((w) => find.wordsOf(`${x.before.description} ${x.before.payee}`).some((h) => h.startsWith(w))));
      if (words.length && keep.length < items.length) {
        if (!keep.length) { ctx.state.pending = null; return 'Okay, nothing will be changed.'; }
        ctx.state.pending = draft(keep, pending.removes ?? [], pending);
        return `Left that one out.\n\n${format.editsPreview(keep, { group: group === find.ALL })}`;
      }
    }
    // "ACTUALLY NO, THE INTERNET BILL": the change moves to that one
    const swap = pending.kind === 'edit' && /^(?:(?:actually|no|sorry|oops|wait)[,!.\s]+)+(?:i meant\s+|i mean\s+)?(?:the\s+)?([a-z][\w\s'&.-]{1,40})$/i.exec(said.trim());
    if (swap) {
      const items = editItems(pending);
      const last = items.at(-1);
      const hits = thisMonthOr(await find.findTarget(group, { words: swap[1] }, { today }), today);
      if (last && hits.length === 1 && hits[0].id !== last.id) {
        ctx.state.pending = draft(items.slice(0, -1), pending.removes ?? [], pending);
        return editPreviewFor(await expensesRepo.findById(hits[0].id), last.fields, ctx);
      }
    }
    // A REMOVAL WHILE CHANGES WAIT: right after them, said plainly
    if (pending.kind === 'edit' && /^(?:remove|delete)\b/i.test(canonicalVerbs(said)) && quickRoute(said, { today, group })?.kind === 'remove') {
      ctx.state.queue = [...(ctx.state.queue ?? []), canonicalVerbs(said)].slice(0, 3);
      const n = editItems(pending).length;
      return `Sure, I'll remove ${canonicalVerbs(said).replace(/^remove\s+/i, '')} right after. First, reply *yes* to save ${n === 1 ? 'the change' : `the ${n} changes`}, or *cancel*.`;
    }
    const many = await severalEdits(said, ctx);
    if (many) return many;
    const asks = editParts(said).map((p) => quickRoute(p, { today, groups: ctx.groups, group })).filter((r) => r?.kind === 'edit');
    if (asks.length) {
      if (pending.kind === 'pick') {
        pending.then.more = [...(pending.then.more ?? []), ...asks];
        return `Got it, I'll add that too. First, which one did you mean? Reply with its number (1–${pending.choices.length}).`;
      }
      return stackEdits(asks, ctx);
    }
    // "NOT THE GROCERIES": one out
    const not = pending.kind === 'edit' && /^(?:not|but not|except|leave|keep|don'?t change|skip)\s+(?:the\s+)?(.+)$/i.exec(said.trim());
    if (not) {
      const words = find.wordsOf(not[1]);
      const items = editItems(pending);
      const keep = items.filter((x) => !words.every((w) => find.wordsOf(`${x.before.description} ${x.before.payee}`).some((h) => h.startsWith(w))));
      if (keep.length < items.length) {
        if (!keep.length) { ctx.state.pending = null; return 'Okay, nothing will be changed.'; }
        ctx.state.pending = draft(keep, pending.removes ?? [], pending);
        return `Left that one out.\n\n${format.editsPreview(keep, { group: group === find.ALL })}`;
      }
    }
  }
  // "SAVE IT AND REMOVE THE LUNCH": the yes first, the rest next
  const saveThen = pending && pending.kind !== 'pick' && !files.length && SAVE_THEN.exec(said);
  if (saveThen) {
    ctx.state.queue = [saveThen[1]];
    return onReply({ kind: 'yes' }, ctx);
  }
  // "WHICH ONE" OPEN, AND MORE TO REMOVE NAMED ("also yesterday's lunch"):
  // kept for when they pick
  if (pending?.kind === 'pick' && pending.then.kind === 'remove' && !files.length && /\b(?:also|too|as well|plus|and)\b/i.test(said)) {
    const extra = await idsNamed(said, ctx);
    if (extra.found.length) {
      pending.extraIds = [...new Set([...(pending.extraIds ?? []), ...extra.found])];
      return `Got ${extra.found.length === 1 ? 'that one' : `those ${extra.found.length}`} too. Now which one first: reply with its number (1–${pending.choices.length}).`;
    }
  }
  // THE RATES ON REQUEST: "show rates", "what rate?", "rates", any time
  if (!files.length && /^(?:(?:pls|please|can you|could you)\s+)?(?:show(?: me)?|send|what(?:'s| is| are)?|which|give me)?\s*(?:the\s+)?(?:exchange\s+)?rates?(?:\s+(?:to aed|please|pls|again|used))?\??[.!]*$/i.test(said.trim())) {
    const bubble = pending?.kind === 'add' ? format.ratesBubble(pending.items) : null;
    if (pending) ctx.keepShown = true;
    return bubble ?? 'Everything here is in AED, so there are no rates to show.';
  }
  /**
   * WHILE SOMETHING WAITS, the everyday messages are answered in code, with
   * what waits said under them: a question, a hello, a thanks (his harness
   * 2026-10-07: each went through a model call first).
   */
  if (pending && !files.length) {
    const q = quickRoute(said, { today, groups: ctx.groups, group });
    if (q?.kind === 'question') return questionReply(q, ctx, pending);
    if (GREETING.test(said)) return `Hi ${admin.name ? admin.name.split(' ')[0] : 'there'} 👋 ${waitingLine(pending)}`;
    // a thanks is a nod; a word that is a yes ("ok", "sorted", "perfect") stays a yes
    if ((THANKS.test(said) || ACK.test(said)) && readReply(said, pending, { year: year(today), groups: ctx.groups })?.kind !== 'yes') {
      ctx.keepShown = true;
      return `👍 ${waitingLine(pending)}`;
    }
  }
  // 2. CODE FIRST: an answer to what is open.
  if (pending?.kind === 'remove' && !files.length) {
    const more = await moreToRemove(said, ctx);
    if (more) return more;
  }
  if (pending && !files.length) {
    // "1, AND THE SPENDER IS LEO P": a pick with more change in it. The
    // extra part went to the router alone and the first change was lost.
    const picked = pending.kind === 'pick' && /^\s*(?:#|no\.?\s*)?(\d+)\b[\s,.;:-]+(.{3,})$/.exec(said);
    if (picked && Number(picked[1]) >= 1 && Number(picked[1]) <= pending.choices.length && pending.then.kind === 'edit') {
      const more = await route(picked[2], { today, pending: false, client: ctx.client, groups: ctx.groups });
      const row = await expensesRepo.findById(pending.choices[Number(picked[1]) - 1]);
      if (row) return editPreviewFor(row, { ...pending.then.changes, ...changesFrom(more.changes, today) }, ctx);
    }
    const r = readReply(said, pending, { year: year(today), groups: ctx.groups });
    if (r) return onReply(r, ctx);
    if (PLANNER_ON && pending.kind === 'add' && !cheapMessage(said, pending, ctx)) {
      const out = await runPlanner(said, ctx);
      if (out) return out;
    }
    /**
     * NOT ONE CODE KNOWS: the reply reader picks what it is, from their words
     * and a one line summary only (intent.js). Sure of it, it is acted on;
     * not sure, or a question, it goes on to the router as before.
     */
    if (pending.kind === 'add' || pending.kind === 'edit' || pending.kind === 'remove' || pending.kind === 'undo') {
      const it = await readIntent(said, summaryOf(pending), { client: ctx.client }).catch(() => null);
      logger.info({ group, intent: it?.intent, sure: it?.sure }, 'expense bot: reply read');
      if (it?.sure) {
        const changeSaid = /\d|\b(?:was|were|is|should|to|from|paid|date|amount|payee|change|wrong)\b/i.test(said);
        switch (it.intent) {
          // A YES THAT SAYS MORE is not a yes: "only the first two" saved all
          // three (his harness 2026-10-07). Those go on to be read properly.
          case 'confirm':
            if (/\b(?:only|just|except|but|not|skip|remove|without|first|second|third|last|drop|leave|apart from|other than)\b|\d/i.test(said)) break;
            return onReply({ kind: 'yes' }, ctx);
          case 'cancel': return onReply({ kind: 'no' }, ctx);
          case 'wait': return onReply({ kind: 'hold' }, ctx);
          case 'show': if (pending.kind === 'add') return format.addPreview(pending.items, group); break;
          case 'save_ready': if (pending.kind === 'add') return onReply({ kind: 'saveReady' }, ctx); break;
          case 'skip_copies': case 'skip_saved': {
            const bulk = readReply(it.intent === 'skip_copies' ? 'skip copies' : 'skip saved', pending, { year: year(today), groups: ctx.groups });
            if (bulk) return onReply(bulk, ctx);
            break;
          }
          case 'change':
            if (pending.kind === 'add' && changeSaid) return reviseFrom(said, ctx);
            return onReply({ kind: 'modify' }, ctx);
          default: break;
        }
      }
    }
  }
  // "NO, CANCEL THAT" WITH NOTHING OPEN: nothing to cancel, said so, never
  // read as "undo the last thing" or "not about expenses".
  if (!pending && !files.length && /^(?:(?:no+|nope|nah)[,.!\s]*)?(?:cancel|stop|never ?mind|forget it|leave it)\b/i.test(said) && said.split(/\s+/).length <= 4) {
    return 'Okay, there was nothing waiting, so nothing changed.';
  }
  // New expenses in a photo or a file: always an add, no router needed.
  if (files.length) return addFrom({ text: said, attachments: files }, ctx);
  if (!said) return null;
  // THE HELP ONCE, then a short hello: "hi" three times gave the same block
  // three times (2026-10-07).
  if (GREETING.test(said) && pending && pending.kind !== 'add') {
    return `Hi ${admin.name ? admin.name.split(' ')[0] : 'there'} 👋 ${waitingLine(pending)}`;
  }
  if (GREETING.test(said)) {
    const lastBot = String(state.history?.at(-1)?.reply ?? '');
    if (/I show it before saving|I'll save it|Hi again/.test(lastBot)) {
      return pending ? 'Hi again! Your preview is still waiting: reply *yes*, *modify* or *cancel*.' : 'Hi again! Send an expense whenever you\'re ready.';
    }
    return ctx.channel === 'diane' ? format.HELP_DIANE : format.HELLO(admin.name.split(' ')[0], group);
  }
  if (HELP_ASK.test(said)) {
    if (ctx.channel === 'diane') return format.HELP_DIANE;
    ctx.guide = true;
    // reading the guide is not looking away: a yes after it still counts
    if (pending) ctx.keepShown = true;
    return format.guideText(group);
  }
  if (THANKS.test(said) && !pending) return 'You\'re welcome 🙂';
  if (!pending && ACK.test(said)) return '👍 Send anything else whenever you\'re ready.';
  if (!pending && /^(?:y|ye|yes+|yeah|yep|yup|confirm(?:ed)?|go ahead|do it|save(?: it| them)?)[!. ]*$/i.test(said)) {
    return 'There\'s nothing waiting for a yes right now. Send an expense, or say what to change or remove.';
  }
  // "SHOW ME THE RECEIPT FOR 4" / "...for the careem taxi" (his call 2026-10-07)
  if (RECEIPT_ASK.test(said)) return receiptFor(said, ctx);
  if (SHOW_PREVIEW.test(said)) {
    if (pending?.kind === 'edit') return format.editsPreview(editItems(pending), { group: group === find.ALL, removes: pending.removes ?? [], all: true });
    if (pending?.kind === 'remove') return format.removePreview(pending.before, { group: group === find.ALL, all: true });
    return pending?.kind === 'add' ? format.addPreview(pending.items, group) : 'There is no preview open right now. Send an expense, a receipt photo or a file and I\'ll show you one.';
  }
  if (UNDO.test(said) || UNDO_WORDS.test(said.trim())) return startUndo(ctx);

  /**
   * THE PLANNER, NOTHING WAITING: what they want, read with what they can
   * see. A plain new expense, a list request and bare numbers stay in code.
   */
  const listIds = ctx.state.listIds ?? [];
  // A list they can still see: the same window the planner is shown it for
  const listShown = Boolean(ctx.awaiting) || listOnScreen(ctx.state);
  const run = !pending && !files.length && listShown ? numberRun(said) : null;
  /**
   * BY NUMBER, FROM THE LIST JUST SHOWN: "2 and 3" / "delete 2 and 3" to
   * remove, "2 to 50" / "change 2 to 50" to change (his sweep 2026-10-07).
   */
  /**
   * ONE CHANGE, A RUN OF NUMBERS: "1-6 spent by zayn", "1 to 6 to fuel",
   * "1, 3 and 5 paid to Careem" (his report 2026-10-08: only No. 1 moved).
   * Every number is read first; one out of the list, or a change that can't
   * be read, and it falls through untouched.
   */
  if (run && run.ns.every((x) => x <= listIds.length)) {
    const rows = (await Promise.all(run.ns.map((x) => expensesRepo.findById(listIds[x - 1])))).filter(Boolean);
    const plan = rows.map((row) => ({ row, changes: changeFromWords(run.words, row, today) }));
    const bad = plan.find((p) => p.changes?.why);
    if (bad) return `No. ${run.ns[plan.indexOf(bad)]}: ${bad.changes.why} Nothing was changed yet.`;
    if (rows.length === run.ns.length && plan.every((p) => p.changes)) {
      for (const { row, changes } of plan) editPreviewFor(row, changes, ctx);
      if (ctx.state.pending?.kind === 'edit') return format.editsPreview(editItems(ctx.state.pending), { group: group === find.ALL });
    }
  }
  if (PLANNER_ON && !pending && !files.length && !cheapMessage(said, null, ctx) && !pureNewExpense(said)
    && !CHANGE_WHICH.test(canonicalVerbs(said)) && !REMOVE_WHICH.test(canonicalVerbs(said))
    && !(ctx.awaiting && /^[\d\s,&and-]+$/i.test(said.trim()))
    && !/^(?:remove|change)\s+(?:no\.?\s*|#)?\d+(?:\s*(?:,|&|and)\s*\d+)*[.!]*$/i.test(canonicalVerbs(said))) {
    const out = await runPlanner(said, ctx);
    if (out) return out;
  }
  if (!pending && !files.length && listIds.length && ctx.awaiting) {
    const t = canonicalVerbs(said);
    const byNum = /^(?:remove\s+)?(?:no\.?\s*|number\s*|#)?(\d+(?:\s*(?:,|&|and|-|to)\s*\d+)*)[.!]*$/i.exec(t);
    if (byNum && (ctx.awaiting === 'remove' || /^remove/i.test(t))) {
      const run = /^(\d+)\s*(?:-|to)\s*(\d+)$/.exec(byNum[1].trim());
      const ns = run ? Array.from({ length: Number(run[2]) - Number(run[1]) + 1 }, (_, i) => Number(run[1]) + i) : (byNum[1].match(/\d+/g) ?? []).map(Number);
      if (ns.length && ns.every((x) => x >= 1 && x <= listIds.length)) {
        const rows = (await Promise.all(ns.map((x) => expensesRepo.findById(listIds[x - 1])))).filter(Boolean);
        if (rows.length) return removePreviewFor(rows, ctx);
      }
    }
    /**
     * EACH LINE BY ITS NUMBER, said any way (his report 2026-10-07): "1. Add
     * 500", "2) deduct 100", "3 make it 800", "4. internet bill make it
     * 1299", "2 to 50". Worked out from what each one is now.
     */
    const lines = String(said).split(/\n+|\s*;\s*|,\s*(?=\d+[.):]?\s)|\s+and\s+(?=\d+[.):]?\s)/i).map((l) => l.trim()).filter(Boolean);
    const byLine = lines.map((l) => /^(?:change\s+)?(?:no\.?\s*|number\s*|#)?(\d{1,2})\s*[.):-]?\s+(.+)$/i.exec(l));
    if (byLine.length && byLine.every((m) => m && Number(m[1]) >= 1 && Number(m[1]) <= listIds.length)) {
      // ALL OR NOTHING: every line read first; one that can't be done is
      // named, and none of them is applied
      const plan = [];
      for (const m of byLine) {
        // eslint-disable-next-line no-await-in-loop
        const row = await expensesRepo.findById(listIds[Number(m[1]) - 1]);
        const changes = row && changeFromWords(m[2], row, today);
        if (changes?.why) return `No. ${m[1]}: ${changes.why} Nothing was changed yet. Send the list again with that one fixed.`;
        if (!changes) return `I couldn't read No. ${m[1]} (_${m[2]}_). Say it like _${m[1]} to 50_, _${m[1]} add 20_ or _${m[1]} date 3 Oct_. Nothing was changed yet.`;
        plan.push({ row, changes });
      }
      let reply = null;
      for (const { row, changes } of plan) reply = editPreviewFor(row, changes, ctx);
      // all of them at once: the whole list, without "Added the …"
      if (reply && ctx.state.pending?.kind === 'edit') return format.editsPreview(editItems(ctx.state.pending), { group: group === find.ALL });
      if (reply) return reply;
    }
  }
  // "DELETE 2 AND 3" with no list shown: the list, numbered, to pick from
  if (!pending && !files.length && !ctx.awaiting && /^(?:remove|change)\s+(?:no\.?\s*|#)?\d+(?:\s*(?:,|&|and)\s*\d+)*[.!]*$/i.test(canonicalVerbs(said))) {
    const which = /^remove/i.test(canonicalVerbs(said)) ? await whichToRemove(ctx) : await whichToChange(ctx);
    return `Here's this month's list, so the numbers are clear:\n\n${which}`;
  }
  // "ADD 500 TO THE GROCERIES", "deduct 100 from the taxi": a change, never a new expense
  const relative = !pending && !files.length && (/^(?:pls\s+|please\s+)?(add|plus|increase|raise|top up|deduct|minus|subtract|take off|reduce|lower|knock off)\s+(?:aed|gbp|£|dhs?)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:aed|gbp|dhs?)?\s+(?:to|from|on|off|for)\s+(?:the\s+)?(.+?)[.!]*$/i.exec(said.trim())
    // "knock 10 off the groceries", "take 10 off the taxi"
    ?? ((m) => (m ? [m[0], 'deduct', m[1], m[2]] : null))(/^(?:pls\s+|please\s+)?(?:knock|take|shave)\s+(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:aed)?\s+off\s+(?:of\s+)?(?:the\s+)?(.+?)[.!]*$/i.exec(said.trim())));
  if (relative) {
    const hits = thisMonthOr(await find.findTarget(group, { words: relative[3] }, { today }), today);
    if (hits.length === 1) {
      const row = await expensesRepo.findById(hits[0].id);
      const changes = row && changeFromWords(`${relative[1]} ${relative[2]}`, row, today);
      if (changes?.why) return `Hmm, ${changes.why} Nothing was changed.`;
      if (changes) return editPreviewFor(row, changes, ctx);
    }
  }
  /**
   * AN ANSWER TO "WHICH ONE SHOULD I CHANGE?" ("Groceries to 800 ⏎ Lunch and
   * drinks to 50"): changes, never new expenses (his report 2026-10-07). The
   * same shape, "X to 800" on each line, is a change whenever X is already
   * saved, asked or not.
   */
  if (!pending && !files.length) {
    const lines = String(said).split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const split = editParts(said);
    const looksLikeChanges = ctx.awaiting === 'change'
      || (split.length > 1 && /\b(?:should be|was|were|is now|to|=|->|change|update|correct|fix|make)\b/i.test(lines[0]) && split.every((p) => quickRoute(p, { today, group })?.kind === 'edit'))
      || lines.every((l) => /^(?!.*\b(?:paid|spent)\b)[^\d]{2,60}?\s+(?:to|=|is now|should be|was|is)\s+\S/i.test(l) || quickRoute(l, { today, group })?.kind === 'edit');
    if (looksLikeChanges) {
      const asks = editParts(said).map((p) => quickRoute(p, { today, groups: ctx.groups, group }));
      if (asks.length && asks.every((r) => r?.kind === 'edit')) {
        const found = await Promise.all(asks.map((r) => find.findTarget(group, r.target, { today, lastIds: ctx.state.lastIds ?? [] })));
        if (found.every((h) => h.length)) return stackEdits(asks, ctx);
      }
    }
    // an answer to "which ones should I remove?": "the taxi and the petrol"
    if (ctx.awaiting === 'remove' && !/\d+\s*(?:aed|gbp|dhs?)?\s+(?:paid|to)\b/i.test(said)) {
      const named = await moreToRemove(`remove ${said.replace(/^(?:the\s+)?/i, 'the ')}`, ctx, { fresh: true });
      if (named) return named;
    }
  }
  // "LUNCH 30 ZUMA TODAY ME AND CHANGE THE TAXI TO 50": the new one, then the rest
  const addThen = !pending && !files.length && /^(.+?\d.+?)[,\s]+and\s+(?:then\s+)?((?:change|update|edit|set|correct|remove|delete|bin|get rid of)\b.+)$/i.exec(said.trim());
  if (addThen && !EDIT_WORDS.test(canonicalVerbs(addThen[1])) && !quickRoute(addThen[1], { today, group })) {
    ctx.state.queue = [addThen[2]];
    ctx.queuedNote = `_Then I'll ${canonicalVerbs(addThen[2])} once these are saved._`;
    return addFrom({ text: addThen[1] }, ctx);
  }
  /**
   * SAVED NAMES WITH AMOUNTS ("groceries 300 ⏎ taxi 50", "groceries: 300"):
   * changes, or new expenses? A person would ask, so it asks.
   */
  if (!pending && !files.length) {
    const lines = String(said).split(/\n+/).map((l) => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
    const shaped = lines.map((l) => /^([a-z][a-z\s'&.-]{1,40}?)\s*[:=]?\s+(?:aed\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:aed)?$/i.exec(l));
    if (shaped.length && shaped.every(Boolean)) {
      const edits = [];
      for (const m of shaped) {
        // eslint-disable-next-line no-await-in-loop
        const hits = thisMonth(await find.findTarget(group, { words: m[1] }, { today }), today);
        if (hits.length !== 1) { edits.length = 0; break; }
        edits.push({ id: hits[0].id, name: hits[0].description, from: hits[0].rawAmount, currency: hits[0].currency, amount: num(m[2]) });
      }
      if (edits.length === shaped.length) {
        state.pending = { kind: 'either', text: said, edits };
        return [`Do you mean *change* ${edits.length === 1 ? 'this saved one' : 'these saved ones'}, or add ${edits.length === 1 ? 'it' : 'them'} as *new* expenses?`,
          ...edits.map((e) => `• ${e.name}: ${format.money(e.currency, e.from)} ➜ *${format.money(e.currency, e.amount)}*`),
          '', 'Reply *change* or *new*.'].join('\n');
      }
    }
  }
  // A PLAIN NEW EXPENSE ("taxi 45 paid to Careem") needs no router: an
  // amount, nothing open, and no word that edits, removes or asks.
  // (read with the one verb: "tweak the taxi to 50" is a change, not a new expense)
  const canon = canonicalVerbs(said);
  if (!pending && /\d/.test(said) && !EDIT_WORDS.test(canon) && !editish(canon)) return addFrom({ text: said }, ctx);

  // ONE VERB FOR EVERY WAY OF SAYING IT ("tanggalin", "hatao", "modify",
  // "delte"): the code paths below read this; the router still gets theirs
  const said0 = said;
  said = canonicalVerbs(said);
  // "REMOVE THE LAST 3": the last ones SAVED here, shown first
  const lastN = !pending && /^(?:(?:ok(?:ay)?|pls|please)[,\s]+)?(?:remov\w*|delete)\s+(?:the\s+)?last\s+(\d{1,2}|one|two|three|four|five)(?:\s+(?:ones?|expenses?|saved))?[.!]*$/i.exec(said);
  if (lastN) {
    const n = Number(lastN[1]) || { one: 1, two: 2, three: 3, four: 4, five: 5 }[lastN[1].toLowerCase()];
    const rows = (await Promise.all((await find.lastSaved(group, Math.min(n, 30))).map((r) => expensesRepo.findById(r.id)))).filter(Boolean);
    return rows.length ? removePreviewFor(rows, ctx) : 'There are no expenses here to remove.';
  }
  /**
   * TWO CHANGES IN ONE ("change the taxi on 5 Oct to 50 and the cleaner to
   * 200"): the first now, the next once that one is answered. Each is
   * shown and confirmed on its own.
   */
  if (!pending && /^(?:pls\s+|please\s+)?(?:change|make|edit|update|correct|set)\b/i.test(canonicalVerbs(said))) {
    // "…AND REMOVE THE PETROL": the changes first, the removal right after
    const mixed = /^(.+?)\s+(?:,\s*)?and\s+(?:then\s+)?((?:remove|delete|bin|get rid of|drop)\s+.+)$/i.exec(canonicalVerbs(said));
    if (mixed) {
      ctx.state.queue = [canonicalVerbs(mixed[2])];
      ctx.queuedNote = `_Then I'll ${canonicalVerbs(mixed[2]).replace(/^remove/i, 'remove')} right after._`;
      said = mixed[1];
    }
    const many = await severalEdits(said, ctx);
    if (many) return many;
    const parts = editParts(said);
    if (parts.length > 1) {
      const asks = parts.map((p) => quickRoute(p, { today, groups: ctx.groups, group }));
      if (asks.every((r) => r?.kind === 'edit')) return stackEdits(asks, ctx);
    }
  }
  // "UPDATE ZAYN EXPENSES", "MODIFY EXPENSES", nothing said to change: which
  // one, and what? In code: the router handed these to the pay side (2026-10-07)
  const changeWhich = (!pending || pending.kind === 'edit') && CHANGE_WHICH.exec(said);
  if (changeWhich) {
    const list = await whichToChange(ctx, changeWhich[1]);
    const n = pending?.kind === 'edit' ? editItems(pending).length : 0;
    return n ? `${list}\n\n_${n === 1 ? 'Your change is' : `Your ${n} changes are`} still waiting: add more, or reply *yes* to save._` : list;
  }
  // "REMOVE THE PETROL AND CHANGE THE TAXI TO 50": the removal first, the change right after
  const removeThen = !pending && /^(remove\s+.+?)\s*,?\s+and\s+(?:then\s+)?((?:change|update|set|make|correct)\s+.+)$/i.exec(said);
  if (removeThen) {
    ctx.state.queue = [removeThen[2]];
    ctx.queuedNote = `_Then I'll ${removeThen[2].replace(/^(?:update|set|correct)/i, 'change')} right after._`;
    said = removeThen[1];
  }
  // "LET'S REMOVE EXPENSES", nothing named: which ones? In code, because the
  // router once handed it to the pay side (2026-10-07)
  if (!pending && REMOVE_WHICH.test(said)) return whichToRemove(ctx);
  // "REMOVE THE CLEANER AND THE PETROL": several at once, in code
  if (!pending && /^\s*(?:(?:ok(?:ay)?|yes|so|and)[,\s]+)?(?:pls\s+|please\s+)?(?:remov\w*|remo[a-z]{0,3}|delete)\b/i.test(said) && find.targetsIn(said, year(today), today).length > 1) {
    return moreToRemove(said, ctx, { fresh: true });
  }
  // 3. THE ROUTER.
  const lastReply = state.history?.at(-1)?.reply ?? '';
  /**
   * "MY EXPENSES" from an admin (his call 2026-10-07): what THEY spent, read
   * as their name. They see their whole group anyway; this only narrows it.
   */
  if ((!pending || pending.kind === 'add') && admin?.name && MY_EXPENSES.test(said)) {
    said = said.replace(MY_EXPENSES, `expenses spent by ${admin.name}`);
  }
  // THE COMMON ASKS IN CODE FIRST (quick.js): the router only for the rest
  const r = quickRoute(said, { today, groups: ctx.groups, group })
    ?? await route(said === canonicalVerbs(said0) && !/^(?:remove|change|show) /.test(said) ? said : said0, { today, pending: pending?.kind === 'add', lastReply: FOLLOW_UP_CONTEXT.test(lastReply) ? lastReply : '', client: ctx.client, groups: ctx.groups });
  logger.info({ group, kind: r.kind, sure: r.sure, quick: Boolean(r.quick) }, 'expense bot: routed');
  switch (r.kind) {
    case 'answer': return pending?.kind === 'add' ? reviseFrom(said, ctx) : addFrom({ text: said }, ctx);
    case 'add': return addFrom({ text: said }, ctx);
    // A CORRECTION WITH A PREVIEW OPEN is about the preview: "actually it was
    // 18" was taken for an edit of a saved expense, and the next "yes" saved
    // the old 15. Live 2026-10-07.
    case 'edit':
    case 'remove':
      if (pending?.kind === 'add' && !savedTargetOutsidePreview(r, pending)) return reviseFrom(said, ctx);
      return r.kind === 'edit' ? startEdit(r, ctx) : startRemove(r, ctx);
    case 'question': return questionReply(r, ctx, pending);
    case 'undo': return startUndo(ctx);
    case 'chat': {
      if (THANKS.test(said)) return 'You\'re welcome 🙂';
      // A PREVIEW IS WAITING: say that, not the whole help (2026-10-07)
      if (pending?.kind === 'add') {
        const live = pending.items.filter((x) => !x.skipped);
        const open = format.questions(live);
        return [`${live.length} ${live.length === 1 ? 'expense is' : 'expenses are'} still waiting, not saved yet.`, ...(open.length ? open : []), '', 'Reply *yes* to save · *show me the preview* · *cancel*'].join('\n');
      }
      return ctx.channel === 'diane' ? format.HELP_DIANE : format.HELLO(admin.name.split(' ')[0], group);
    }
    default:
      if (ctx.channel === 'diane') return 'That isn\'t about expenses. Switch the context to Master sheet for deals, people and companies.';
      // NOT ABOUT EXPENSES ("how much am I getting paid?"): WhatBot's own
      // agent answers it, his call 2026-10-07. Nothing here is touched. A
      // message that SAYS expense never goes there: it is said back plainly.
      if (/\bexpen[cs]\w*\b/i.test(said) || ctx.awaiting || pending) {
        return 'I didn\'t catch what to do with the expenses. You can *send* new ones, *change* one (_change the taxi on 5 Oct to 50_), *remove* one (_remove the cleaner_) or ask (_how much this month?_). Type *help* for more.';
      }
      return HAND_OFF;
  }
}

/**
 * THE RECEIPT ITSELF, sent back: by its number in the open preview, else
 * the latest saved expense their words name ("the careem taxi"), else the
 * last one saved. ctx.receiptOut carries the file to the sender.
 */
async function receiptFor(said, ctx) {
  const { pending } = ctx.state;
  const n = Number(/\b(?:no\.?|number|#)?\s*(\d{1,3})\b/i.exec(said.replace(/\breceipts?\b/i, ''))?.[1] ?? 0);
  if (pending?.kind === 'add' && n) {
    const x = pending.items.find((i) => i.n === n);
    if (!x) return `There is no number ${n} in your preview.`;
    const file = await receipts.heldFile(x.receipt);
    if (!file) return `No. ${n} came from a typed message, so there is no receipt for it.`;
    ctx.receiptOut = file;
    return `🧾 Receipt for *${n}. ${x.description}* (not saved yet).`;
  }
  const pool = require('../../../configs/db');
  // "RECEIPT FOR 3" from the list on screen (his list 2026-10-08)
  const listed = n && pending?.kind !== 'add' && listOnScreen(ctx.state) ? ctx.state.listIds[n - 1] : null;
  if (n && pending?.kind !== 'add' && listOnScreen(ctx.state) && !listed) return `There is no No. ${n} on the list. Pick from 1–${ctx.state.listIds.length}.`;
  if (listed) {
    const one = await expensesRepo.findById(listed);
    if (!one) return `No. ${n} is no longer there.`;
    const what = `*${n}. ${one.description}* · ${format.money(one.currency, Number(one.raw_amount))} · ${format.day(find.iso(one.spent_on))}`;
    const file = await receipts.fileOf(one.id);
    if (file.missing === 'cleared') return `${what}: its receipt was cleared (receipts are kept for 3 months).`;
    if (file.missing) return `${what} has no receipt: it was typed, not sent as a photo or file.`;
    ctx.receiptOut = file;
    if (pending) ctx.keepShown = true;
    return `🧾 Receipt for ${what}.`;
  }
  const words = said.replace(RECEIPT_ASK, ' ').replace(/\b(?:me|the|a|for|of|my|please|pls|that|this|one|last|latest)\b/gi, ' ').trim().split(/\s+/).filter((w) => w.length >= 3);
  const scope = ctx.group === '*' ? [] : [ctx.group];
  const { rows } = await pool.query(
    `SELECT id, description, payee, spent_on, currency, raw_amount, receipt_path, receipt_cleared_at FROM tb_expenses
      WHERE archived_at IS NULL ${scope.length ? 'AND group_name = $1' : ''}
        ${words.length ? `AND (${words.map((_, i) => `(description ILIKE $${i + 1 + scope.length} OR payee ILIKE $${i + 1 + scope.length})`).join(' AND ')})` : ''}
      ORDER BY spent_on DESC, id DESC LIMIT 1`,
    [...scope, ...words.map((w) => `%${w}%`)],
  );
  const row = rows[0] ?? (ctx.state.lastIds?.length ? (await pool.query('SELECT id, description, payee, spent_on, currency, raw_amount, receipt_path, receipt_cleared_at FROM tb_expenses WHERE id = $1', [ctx.state.lastIds.at(-1)])).rows[0] : null);
  if (!row) return 'I couldn\'t find that expense. Say which one, like _receipt for the careem taxi_.';
  const what = `*${row.description}* · ${format.money(row.currency, Number(row.raw_amount))} · ${format.day(String(row.spent_on instanceof Date ? row.spent_on.toISOString() : row.spent_on).slice(0, 10))}`;
  const file = await receipts.fileOf(row.id);
  if (file.missing === 'cleared') return `${what}: its receipt was cleared (receipts are kept for 3 months).`;
  if (file.missing) return `${what} has no receipt: it was typed, not sent as a photo or file.`;
  ctx.receiptOut = file;
  return `🧾 Receipt for ${what}.`;
}

/** Their words name a SAVED expense, not one in the open preview. */
function savedTargetOutsidePreview(r, pending) {
  const words = String(r.target?.words ?? '').toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
  if (!words.length) return false;
  const inPreview = pending.items.some((x) => words.some((w) => `${x.description ?? ''} ${x.payee ?? ''}`.toLowerCase().includes(w)));
  return !inPreview;
}

/** The CRM's groups, from the deals and the expenses, for the command center. */
async function knownGroups() {
  const pool = require('../../../configs/db');
  const { rows } = await pool.query(
    `SELECT DISTINCT group_name AS g FROM tb_mastersheet WHERE group_name IS NOT NULL AND btrim(group_name) <> ''
     UNION SELECT DISTINCT group_name FROM tb_expenses WHERE group_name IS NOT NULL AND btrim(group_name) <> ''`,
  );
  return rows.map((r) => r.g).sort();
}

// ---- adding ----

async function rates() {
  return (await expensesRepo.options().catch(() => ({ lastRateByCurrency: {} }))).lastRateByCurrency ?? {};
}

/** The payees and spenders already used, so new ones are matched to them. */
async function knownNames() {
  const o = await expensesRepo.options().catch(() => ({}));
  return { payees: o.payees ?? [], spentBy: o.spentBy ?? [] };
}

/** Payee → the one category it has had every time, at least twice (never "other"). */
async function payeeHabits() {
  const pool = require('../../../configs/db');
  const { rows } = await pool.query(
    `SELECT lower(btrim(payee)) AS p, min(category) AS c, count(*) AS n
       FROM tb_expenses WHERE payee IS NOT NULL AND btrim(payee) <> '' AND category IS NOT NULL
      GROUP BY 1 HAVING count(DISTINCT category) = 1 AND count(*) >= 2 AND min(category) <> 'other'`,
  );
  return new Map(rows.map((r) => [r.p, r.c]));
}

/** Check every item again: fields, defaults, duplicates against what is saved. */
async function recheck(items, ctx) {
  const r = await rates();
  // Today's market rate for every other currency in the batch.
  const live = await liveRates(items.map((x) => currencyOf(x.currency) ?? 'AED'));
  const known = await knownNames();
  const out = items.map((x) => normalise({ ...x, doubt: x.modelDoubt }, { admin: ctx.admin, group: ctx.group, groups: ctx.groups, rates: r, live, known, today: ctx.today }))
    .map((x, i) => ({ ...x, modelDoubt: items[i].modelDoubt ?? null }));
  /**
   * THEIR HABITS (his list 2026-10-08): a payee whose words say no category
   * ("Al Noor", not "Careem") takes the one it always has here, and says so.
   */
  const habits = await payeeHabits().catch(() => new Map());
  for (const [i, x] of out.entries()) {
    const was = items[i];
    if (was.habitCat && x.category === was.habitCat) { x.habitCat = was.habitCat; x.notes.push(`category ${x.category}, like your other ${x.payee} ones`); continue; }
    if ((was.category && was.category !== 'other') || x.category !== 'other' || !x.payee) continue;
    const h = habits.get(String(x.payee).toLowerCase());
    if (h) { x.category = h; x.habitCat = h; x.notes.push(`category ${h}, like your other ${x.payee} ones`); }
  }
  const dates = out.map((x) => x.spentOn).filter(Boolean).sort();
  const saved = dates.length ? await find.between(ctx.group, minus(dates[0], 1), dates.at(-1)) : [];
  const checked = duplicates(out, saved);
  /**
   * THE SAME RECEIPT, SAVED BEFORE (his call 2026-10-07): its fingerprint is
   * kept forever, so a receipt sent again weeks later is caught even once
   * its file is cleared. A question, never a silent drop.
   */
  for (const x of checked) {
    if (!x.receipt || x.ok || x.skipped) continue;
    // eslint-disable-next-line no-await-in-loop
    const hit = await receipts.seenBefore(x.receipt).catch(() => null);
    if (hit) {
      x.repeatOf = hit.id;
      // the receipt says it better than "looks already saved": one note
      x.doubts = x.doubts.filter((d) => !/^looks already saved/.test(d));
      x.doubts.push(`same receipt as one saved on ${format.day(String(hit.spent_on instanceof Date ? hit.spent_on.toISOString() : hit.spent_on).slice(0, 10))} (${hit.payee || 'no payee'}, ${format.money(hit.currency, Number(hit.raw_amount))})`);
      x.flag = true;
    }
  }
  return link(checked, ctx);
}

/**
 * WHO SPENT IT, AS A MASTER SHEET PERSON (his calls 2026-10-07): people see
 * their own expenses on WhatsApp, so each "spent by" is linked here, before
 * the preview, by spender.js's one rule. Two people with that name is a
 * question; a name on nobody is saved as typed and never shown to anyone.
 */
async function link(items, ctx) {
  const list = await spender.people().catch((err) => { logger.warn({ err: err.message }, 'expense bot: people could not be read'); return null; });
  for (const x of items) {
    x.spentById = null;
    x.spentByPhone = null;
    if (x.skipped || !x.spentBy || !list) continue;
    // eslint-disable-next-line no-await-in-loop
    const l = await spender.linkSpender({
      name: x.spentBy, me: x.spentMe, admin: ctx.admin, group: x.groupName ?? ctx.group, list,
    });
    x.spentById = l.personId;
    x.spentByPhone = l.phone;
    if (l.status === 'linked' && l.spentBy && l.spentBy !== x.spentBy) {
      // "Ahmed" is the master sheet's Ahmed Khan: said back in full
      x.notes.push(`spent by ${x.spentBy}, read as ${l.spentBy} (master sheet)`);
      x.spentBy = l.spentBy;
    }
    // A NAME ONE LETTER OFF ("Abe Lincon"): asked, never fixed by itself
    if (l.status === 'near' && !x.ok) {
      x.doubts.push(`did you mean ${l.choices[0]}? (${x.spentBy})`);
      x.flag = true;
    }
    if (l.status === 'ambiguous' && !x.ok) {
      x.doubts.push(`which ${x.spentBy}? ${l.choices.slice(0, 4).join(' or ')}`);
      x.flag = true;
    }
    if (l.status === 'none' && !x.spentMe) x.notes.push(`${x.spentBy} is not on the master sheet, so it is not shown to anyone on WhatsApp`);
  }
  return items;
}

async function addFrom(msg, ctx) {
  /**
   * THE SAME FILE, ALREADY IN THIS PREVIEW, IS NOT READ AGAIN (his report
   * 2026-10-07): 6 files sent twice were read twice, the model worded 3 of
   * them differently, and they slipped in as new. A file is known by its
   * fingerprint before any model sees it, so a resend costs nothing.
   */
  const open0 = ctx.state.pending?.kind === 'add' ? ctx.state.pending.items : [];
  const inPreview = new Set(open0.filter((x) => !x.skipped).map((x) => x.receipt?.print).filter(Boolean));
  let knownFiles = 0;
  if (msg.attachments?.length) {
    const seen = new Set();
    const fresh = [];
    for (const file of msg.attachments) {
      // eslint-disable-next-line no-await-in-loop
      const print = (await receipts.fingerprint(file).catch(() => null))?.print;
      if (print && (inPreview.has(print) || seen.has(print))) { knownFiles += 1; continue; }
      if (print) seen.add(print);
      fresh.push(file);
    }
    if (!fresh.length && !String(msg.text ?? '').trim()) {
      return `${ALREADY}${format.addPreview(open0, ctx.group)}`;
    }
    msg = { ...msg, attachments: fresh };
  }
  const got = await extract(msg, { today: ctx.today, client: ctx.client, groups: ctx.groups });
  if (!got.items.length) {
    const why = got.notes.length ? `\n_${got.notes.join('; ')}_` : '';
    return msg.attachments?.length
      ? `I couldn't find any expenses in that.${why}\nSend the receipt or a line like _taxi 45 paid to Careem_.`
      : `I couldn't find an expense in that. Send it like _taxi to office 45 paid to Careem_ or a photo of the receipt.${why}`;
  }
  // MORE FOR THE SAME PREVIEW: receipts arrive one photo per message, so a
  // new batch joins the one still open rather than replacing it.
  const open = ctx.state.pending?.kind === 'add' ? ctx.state.pending.items : [];
  // EACH FILE HELD ONCE (shrunk, fingerprinted), and every expense read
  // from it carries its receipt; the file's bytes never go into the chat
  const heldFor = new Map();
  for (const x of got.items) {
    if (x.file && !heldFor.has(x.file)) {
      // eslint-disable-next-line no-await-in-loop
      heldFor.set(x.file, await receipts.hold(x.file).catch((err) => { logger.warn({ err: err.message }, 'expense bot: a receipt could not be held'); return null; }));
    }
  }
  let fresh = got.items.map(({ file, ...x }, i) => ({ ...x, receipt: file ? heldFor.get(file) ?? null : null, n: open.length + i + 1, modelDoubt: x.doubt || null }));
  let items = await recheck([...open, ...fresh], ctx);
  /**
   * AN EXACT COPY OF ONE ALREADY IN THE PREVIEW ADDS NOTHING (his call
   * 2026-10-07: the same 6 files sent again stacked a preview to 141).
   * Checked once the new ones are read like the old, then numbered again.
   */
  let dropped = 0;
  if (open.length) {
    const before = items.slice(0, open.length).filter((o) => !o.skipped);
    const keep = items.slice(open.length).map((x) => !before.some((o) => exactCopy(o, x)));
    dropped = keep.filter((k) => !k).length;
    if (dropped) {
      fresh = fresh.filter((_, i) => keep[i]).map((x, i) => ({ ...x, n: open.length + i + 1 }));
      if (!fresh.length) {
        // THE PREVIEW AGAIN, picture and all (his report 2026-10-07: the
        // note came alone and the preview was nowhere to be seen)
        return `${ALREADY}${format.addPreview(open, ctx.group)}`;
      }
      items = await recheck([...open, ...fresh], ctx);
    }
  }
  ctx.state.pending = { kind: 'add', items, ratesShown: ctx.state.pending?.kind === 'add' ? ctx.state.pending.ratesShown ?? [] : [] };
  // THE NEW NUMBERS, named: they think of these as "1 and 2" of the message
  // they just sent, and the list calls them 2 and 3.
  const nums = fresh.map((x) => x.n);
  const already = dropped + knownFiles;
  const skippedNote = already ? ` Skipped ${already} already in this preview.` : '';
  const lead = open.length ? `Added ${fresh.length} more: *${format.ranges(nums)}*.${skippedNote}\n\n` : '';
  const notes = got.notes.length ? `\n\n_${got.notes.join('; ')}_` : '';
  return `${lead}${format.addPreview(items, ctx.group)}${notes}`;
}

/** Their fixes, applied by code; the item checked again from scratch. */
function applyFix(items, part, today) {
  for (const n of part.which) {
    const x = items.find((i) => i.n === n);
    if (!x) continue;
    for (const f of part.fixes) {
      let { value } = f;
      if (f.field === 'spentOn' && value === 'today') value = today;
      if (f.field === 'spentOn' && value === 'yesterday') value = minus(today, 1);
      if (f.field === 'currency') value = currencyOf(value) ?? value;
      if (f.field === 'rawAmount') value = num(value);
      x[f.field] = value;
    }
    x.modelDoubt = null;
    x.ok = false;
  }
}

async function reviseFrom(said, ctx) {
  const { pending } = ctx.state;
  const got = await revise(said, pending.items, { today: ctx.today, client: ctx.client, groups: ctx.groups });
  if (got.cancel) { ctx.state.pending = null; return 'Okay, cancelled. Nothing was saved.'; }
  if (got.unclear && !got.updates.length && !got.skip.length && !got.newExpenses.length && !got.ok.length) return got.unclear;
  const items = pending.items.map((x) => ({ ...x }));
  for (const u of got.updates) applyFix(items, { which: [u.n], fixes: [{ field: u.field, value: u.value }] }, ctx.today);
  for (const n of got.skip) { const x = items.find((i) => i.n === n); if (x) x.skipped = true; }
  for (const n of got.ok) { const x = items.find((i) => i.n === n); if (x) x.ok = true; }
  const before = items.length;
  for (const e of got.newExpenses) items.push({ ...e, n: items.length + 1, modelDoubt: e.doubt || null });
  let checked = await recheck(items, ctx);
  /**
   * TYPED AGAIN, ADDED NOTHING (his call 2026-10-07): new ones that are
   * exact copies of ones already in the preview are dropped, as for files.
   */
  if (got.newExpenses.length) {
    const open = checked.slice(0, before).filter((o) => !o.skipped);
    const fresh = checked.slice(before);
    const copies = fresh.filter((x) => open.some((o) => exactCopy(o, x)));
    if (copies.length) {
      const kept = items.slice(before).filter((_, i) => !copies.includes(fresh[i])).map((x, i) => ({ ...x, n: before + i + 1 }));
      if (!kept.length && !got.updates.length && !got.skip.length && !got.ok.length) {
        return `${ALREADY}${format.addPreview(pending.items, ctx.group)}`;
      }
      checked = await recheck([...items.slice(0, before), ...kept], ctx);
    }
  }
  ctx.state.pending = { kind: 'add', items: checked, ratesShown: [...new Set([...(ctx.state.pending?.ratesShown ?? []), ...(pending?.ratesShown ?? [])])] };
  // NEVER SAVED FROM AN ANSWER. "they're all new ones" and "1 milkman nadia
  // r, yes its right" saved at once, unseen (test sweep 2026-10-07). Changed
  // things are always shown again, and only a plain yes saves.
  return format.addPreview(checked, ctx.group);
}

/** An answer to what one expense is actually missing, as an example. */
function exampleFor(x) {
  const f = x.missing[0];
  return {
    spentBy: `${x.n} me`, payee: `${x.n} paid to Careem`, spentOn: `${x.n} is 5 Oct`, rawAmount: `${x.n} is 150`,
    exchangeRate: `1 ${String(x.currency ?? 'gbp').toLowerCase()} to aed is 4.85`, description: `${x.n} is taxi`, groupName: `${x.n} is MANBAT`,
  }[f] ?? `${x.n} is 150`;
}

async function saveAdd(ctx, { readyOnly = false } = {}) {
  const live = ctx.state.pending.items.filter((x) => !x.skipped);
  const waiting = live.filter((x) => x.missing.length);
  const items = readyOnly ? live.filter((x) => !x.missing.length) : live;
  if (!items.length) {
    if (readyOnly && waiting.length) return `None of them is ready yet: all ${waiting.length} still need an answer.`;
    ctx.state.pending = null;
    return 'Nothing left to save, so nothing was saved.';
  }
  /**
   * NOT EVERYTHING IS READY: said in a few lines, never the whole preview
   * again (live 2026-10-07: six pictures re-sent, the four missing payees
   * never named). What is missing, by number, and the ways out.
   */
  if (!readyOnly && waiting.length) {
    const ready = live.length - waiting.length;
    // COPIES AND ONES SAVED BEFORE would be saved twice by "save the rest":
    // said first, with their one-word way out
    const copies = live.filter((x) => (x.doubts ?? []).some((d) => /^same as \d+/.test(d))).length;
    const before = live.filter((x) => (x.doubts ?? []).some((d) => /^looks already saved|^same receipt as one saved/.test(d))).length;
    const first = [copies ? `*skip copies* (${copies})` : '', before ? `*skip saved* (${before})` : ''].filter(Boolean);
    return [
      `I can't save all ${live.length} yet: ${waiting.length} still ${waiting.length === 1 ? 'needs' : 'need'} an answer.`,
      ...(first.length ? [`First reply ${first.join(' and ')}, so nothing is saved twice.`] : []),
      ...format.questions(waiting).filter((l) => !/copies|already saved|same receipt/.test(l)),
      '',
      `Reply: answer like *${exampleFor(waiting[0])}* · *skip ${format.ranges(waiting.map((x) => x.n))}*${ready ? ` · *save the rest* (the ${ready} ready)` : ''} · *cancel*`,
    ].join('\n');
  }
  const fieldsOf = (x) => ({
    spentOn: x.spentOn, description: x.description, payee: x.payee, currency: x.currency, rawAmount: x.rawAmount,
    exchangeRate: x.exchangeRate, groupName: x.groupName ?? ctx.group, spentBy: x.spentBy, category: x.category ?? null,
    // who spent it, linked (link() above), and who sent it in: never asked
    spentByPersonId: x.spentById ?? null, spentByPhone: x.spentByPhone ?? null, savedBy: ctx.admin?.name ?? null,
  });
  /**
   * REPLACE THE SAVED ONE (his call 2026-10-07): the same receipt, its saved
   * expense UPDATED to these values rather than a second copy. Its old
   * values are recorded, so "undo" puts them back.
   */
  const replaced = [];
  for (const x of items.filter((i) => i.replaceId)) {
    /* eslint-disable no-await-in-loop */
    const before = await expensesRepo.findById(x.replaceId);
    if (!before) { x.replaceId = null; continue; }
    const after = await expensesRepo.update(x.replaceId, fieldsOf(x));
    if (x.receipt) await receipts.keep(x.receipt, after).catch(() => null);
    replaced.push({ id: x.replaceId, before: SNAP(before), after: SNAP(after), replaced: true });
    /* eslint-enable no-await-in-loop */
  }
  const fresh = items.filter((x) => !x.replaceId);
  const made = await expensesRepo.createMany(fresh.map(fieldsOf));
  // THE RECEIPTS GO WITH THEM, into this month's folder (receipts.js). A
  // receipt that cannot be kept never undoes a saved expense; it is logged.
  for (const [i, x] of fresh.entries()) {
    if (!x.receipt || !made[i]) continue;
    // eslint-disable-next-line no-await-in-loop
    await receipts.keep(x.receipt, made[i]).catch((err) => logger.warn({ err: err.message, id: made[i].id }, 'expense bot: a receipt could not be kept'));
  }
  // VERIFIED: read back from the table, never assumed.
  const check = await Promise.all(made.map((m) => expensesRepo.findById(m.id)));
  if (check.some((c) => !c) || made.length !== fresh.length) {
    logger.error({ group: ctx.group, asked: fresh.length, made: made.length }, 'expense bot: save did not verify');
    return `⚠️ Only ${check.filter(Boolean).length} of ${fresh.length} could be confirmed saved. Please check the Expenses page.`;
  }
  // ONE ACTION for the batch: the new ones (undo removes them) and the
  // replaced ones (undo puts their old values back)
  // in the order the ✅ message numbers them, so "undo only 2" is No. 2
  let k = 0;
  const all = items.map((x) => (x.replaceId ? replaced.find((r) => r.id === x.replaceId) : made[k] && { id: made[k].id, after: SNAP(made[k++]) })).filter(Boolean);
  await store.recordAction(require('../../../configs/db'), {
    phone: ctx.phone, group: ctx.group, kind: 'add', changes: all,
    summary: `${all.map((c) => `${c.after.description} · ${format.money(c.after.currency, c.after.raw_amount ?? c.after.rawAmount)}${c.replaced ? ' (replaced)' : ''}`).slice(0, 4).join(', ')}${all.length > 4 ? ` and ${all.length - 4} more` : ''}`,
  });
  broadcast(null, EVENT, { action: 'imported', count: made.length, via: 'whatbot' });
  // SAVED THE READY ONES: the rest stay open, numbered again from 1
  ctx.state.pending = readyOnly && waiting.length
    ? { kind: 'add', items: waiting.map((x, i) => ({ ...x, n: i + 1 })), shownLast: true }
    : null;
  ctx.state.lastIds = made.map((m) => m.id);
  ctx.state.lastSaved = items;
  const still = readyOnly && waiting.length
    ? `\n\n⏳ *${waiting.length} still waiting* (now ${waiting.length === 1 ? 'no. 1' : `numbered 1–${waiting.length}`}): ${format.questions(ctx.state.pending.items).map((l) => l.replace(/^• /, '').replace(/[?.]$/, '')).join('; ')}? Answer ${waiting.length === 1 ? 'it' : 'them'}, or *cancel* to drop ${waiting.length === 1 ? 'it' : 'them'}.`
    : '';
  return `${format.saved(items, ctx.group)}${still}`;
}

// ---- answers to what is open, read in code ----

async function onReply(r, ctx) {
  const { pending } = ctx.state;
  if (r.kind === 'modify') {
    if (pending.kind === 'add') return 'Sure, what should change? Just say it, like _the taxi was 50_, _the lunch was yesterday_ or _leave out the parking_.';
    // A REMOVAL is changed by what is in it, never by "what should it be"
    // (his report 2026-10-07: it asked that three times)
    if (pending.kind === 'remove') return `Sure. Add one, like _also the taxi on 5 Oct_, or drop some, like _not the cleaner_${pending.ids.length > 1 ? ` or _only 1-${pending.ids.length - 1}_` : ''}. Or reply *yes* to remove, or *cancel*.`;
    if (pending.kind === 'undo') return 'Reply *yes* to undo it, or *cancel* to leave it as it is.';
    if (pending.kind === 'settle') return 'Say which ones instead, like _settle 1-3_, or reply *yes*, or *cancel*.';
    if (pending.kind === 'edit') {
      const items = editItems(pending);
      const m = (pending.removes ?? []).length;
      return [`No problem. ${items.length === 1 && !m ? `Right now I'm about to ${changeText(items[0])}.` : `${items.length + m} changes are waiting.`}`,
        `Add another (_change the taxi to 50_), change one (_make the groceries 250_), drop some (_not the groceries_${items.length + m > 1 ? `, _only 1-${items.length + m - 1}_` : ''}), or reply *yes* to save, or *cancel*.`].join('\n');
    }
    return 'Sure, what should it be instead? Just say it, like _make it 50_ or _it was on 5 Oct_.';
  }
  /**
   * A BIG PREVIEW IS NOT DROPPED ON ONE WORD (his call 2026-10-07): 20 or
   * more waiting, a cancel asks once. Its "yes" then means drop, its "no"
   * keeps them, anything else carries on as normal.
   */
  if (pending.confirmDrop) {
    delete pending.confirmDrop;
    if (r.kind === 'yes') { ctx.state.pending = null; return 'Okay, dropped them all. Nothing was saved.'; }
    if (r.kind === 'no') return 'Okay, kept them. Reply *yes* to save, *modify* to change, or *cancel*.';
  }
  if (r.kind === 'hold') return 'Sure, take your time. Your preview is waiting.';
  if (r.kind === 'no' && pending.kind === 'add' && pending.items.filter((x) => !x.skipped).length >= 20) {
    pending.confirmDrop = true;
    const n = pending.items.filter((x) => !x.skipped).length;
    return `Drop all ${n} without saving any? Reply *yes* to drop them, or *no* to keep them.`;
  }
  if (r.kind === 'no') { ctx.state.pending = null; return `Okay, cancelled. Nothing was ${pending.kind === 'remove' ? 'removed' : pending.kind === 'add' ? 'saved' : 'changed'}.`; }
  if (pending.kind === 'pick') {
    const extra = pending.extraIds ?? [];
    // SEVERAL ("1 and 2", "both", "all"): fine for removing, one at a time for a change
    if (r.kind === 'pickMany') {
      if (pending.then.kind !== 'remove') return `Pick one to change: reply with its number (1–${pending.choices.length}), or *cancel*.`;
      const ids = [...new Set([...r.ns.map((n) => pending.choices[n - 1]), ...extra])];
      const rows = (await Promise.all(ids.map((id) => expensesRepo.findById(id)))).filter(Boolean);
      if (!rows.length) { ctx.state.pending = null; return 'Those are no longer there. Nothing was changed.'; }
      return removePreviewFor(rows, ctx);
    }
    // A YES IS NOT A PICK (his sweep 2026-10-07: "That expense is no longer there")
    if (r.kind !== 'pick') return `Which one? Reply with its number (1–${pending.choices.length}), or *cancel*.`;
    const id = pending.choices[r.n - 1];
    const row = await expensesRepo.findById(id);
    if (!row) { ctx.state.pending = null; return 'That expense is no longer there. Nothing was changed.'; }
    if (pending.then.kind === 'edit') {
      const { keepItems, more = [], changes } = pending.then;
      ctx.state.pending = keepItems?.length ? { kind: 'edit', items: keepItems } : null;
      const first = editPreviewFor(row, changes, ctx);
      return more.length && ctx.state.pending?.kind === 'edit' ? stackEdits(more, ctx) : first;
    }
    const rows = [row, ...(await Promise.all(extra.filter((x) => x !== id).map((x) => expensesRepo.findById(x)))).filter(Boolean)];
    return removePreviewFor(rows, ctx);
  }
  if (r.kind === 'saveReady') {
    if (pending.kind !== 'add') return 'There is nothing waiting to save.';
    return saveAdd(ctx, { readyOnly: true });
  }
  if (r.kind === 'yes') {
    // ONLY WHAT WAS SHOWN LAST. Another reply came in between, so this yes
    // may not be about the preview: it is shown again, and the next yes saves.
    if (pending.shownLast === false) return showAgain(ctx);
    /**
     * A BIG CHANGE, SAID TWICE (his list 2026-10-08): over 20 expenses, or
     * over AED 10,000 moved, takes "yes 25", so a stray yes can't do it.
     */
    const big = bigDraft(pending);
    if (big && r.n !== big.count) {
      return `That's *${big.count} ${big.count === 1 ? 'expense' : 'expenses'}*${big.aed >= BIG_AED ? `, moving *${format.money('AED', Math.round(big.aed * 100) / 100)}*` : ''}. To be sure, reply *yes ${big.count}*, or *cancel*.`;
    }
    if (pending.kind === 'add') return saveAdd(ctx);
    if (pending.kind === 'edit') return saveEdit(ctx);
    if (pending.kind === 'remove') return saveRemove(ctx);
    if (pending.kind === 'undo') return saveUndo(ctx);
    if (pending.kind === 'settle') return saveSettle(ctx);
  }
  if (r.kind === 'lineOut') return `There ${r.count === 1 ? 'is' : 'are'} only ${r.count} in this preview. Pick from 1–${r.count}, like *only 1-${Math.max(1, r.count - 1)}* or *not ${r.count}*.`;
  if (r.kind === 'lines') return keepLines(r.keep, ctx);
  // add: skip / only / fixes
  const items = pending.items.map((x) => ({ ...x }));
  // THEIR OWN RATE TO AED: for the currency they named, or the only one.
  if (r.kind === 'rate') {
    const others = [...new Set(items.filter((x) => !x.skipped && x.currency !== 'AED').map((x) => x.currency))];
    let given = r.rates ?? {};
    if (r.lastUsed) {
      const last = await rates();
      given = Object.fromEntries(others.filter((c) => last[c]?.rate).map((c) => [c, last[c].rate]));
      if (!Object.keys(given).length) return 'There is no earlier rate saved for that currency. Send it like *1 gbp to aed is 4.85*.';
    }
    if (r.only) {
      if (others.length !== 1) return `Which currency is ${r.only} for? Say it like *1 ${String(others[0] ?? 'gbp').toLowerCase()} to aed is ${r.only}*.`;
      given = { [others[0]]: r.only };
    }
    if (!Object.keys(given).some((c) => others.includes(c))) return `None of these expenses are in ${Object.keys(given).join(', ')}. The other currencies here: ${others.join(', ') || 'none'}.`;
    for (const x of items) if (given[x.currency] > 0) x.rateGiven = given[x.currency];
    // said back in one line ("GBP now 4.90 AED · applied to No. 3, 5")
    ctx.rateNote = Object.entries(given).filter(([c]) => others.includes(c)).map(([c, v]) => {
      const ns = items.filter((x) => !x.skipped && x.currency === c).map((x) => x.n);
      return `💱 *${c} now ${v} AED* · applied to No. ${format.ranges(ns)}`;
    }).join('\n');
    pending.ratesShown = [...new Set([...(pending.ratesShown ?? []), ...Object.keys(given)])];
  }
  if (r.kind === 'skip' && r.bulk && !r.which.length) {
    return r.bulk === 'saved' ? 'None of them look already saved, so nothing was skipped.' : 'There are no copies in this preview, so nothing was skipped.';
  }
  if (r.kind === 'skip') for (const n of r.which) items.find((x) => x.n === n).skipped = true;
  // "KEEP 6": back in AND accepted as a new one (a lookalike they know is real)
  if (r.kind === 'unskip') for (const n of r.which) { const x = items.find((i) => i.n === n); x.skipped = false; x.ok = true; x.modelDoubt = null; }
  // SKIP, SAVE OR REPLACE, for all of them or one by one ("Please check")
  if (r.kind === 'choices') {
    for (const n of r.skip) items.find((x) => x.n === n).skipped = true;
    for (const n of r.keep) {
      const x = items.find((i) => i.n === n);
      Object.assign(x, { skipped: false, ok: true, replaceId: null, modelDoubt: null });
    }
    for (const n of r.replace) {
      const x = items.find((i) => i.n === n);
      // only one that IS a saved one again; anything else is just kept
      Object.assign(x, { skipped: false, ok: true, modelDoubt: null, replaceId: x.repeatOf ?? x.lookalikeOf ?? null });
    }
  }

  if (r.kind === 'only') for (const x of items) x.skipped = !r.which.includes(x.n);
  if (r.kind === 'fix') {
    for (const part of r.parts) applyFix(items, part, ctx.today);
    for (const n of r.ok ?? []) { const x = items.find((i) => i.n === n); if (x) { x.ok = true; x.modelDoubt = null; } }
  }
  const checked = await recheck(items, ctx);
  ctx.state.pending = { kind: 'add', items: checked, ratesShown: [...new Set([...(ctx.state.pending?.ratesShown ?? []), ...(pending?.ratesShown ?? [])])] };
  if (!checked.some((x) => !x.skipped)) { ctx.state.pending = null; return 'All of them left out, so nothing was saved.'; }
  return format.addPreview(checked, ctx.group);
}

// ---- editing ----

function changesFrom(list, today) {
  const out = {};
  for (const c of list ?? []) {
    let v = String(c.value ?? '').trim();
    if (!v) continue;
    if (c.field === 'rawAmount') { v = num(v); if (v === null) continue; }
    if (c.field === 'currency') { v = currencyOf(v); if (!v) continue; }
    if (c.field === 'spentOn') { if (v === 'today') v = today; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue; }
    if (c.field === 'category') { v = String(v).toLowerCase(); if (!['fuel', 'travel', 'food', 'office', 'bills', 'other'].includes(v)) continue; }
    out[c.field] = v;
  }
  return out;
}

async function startEdit(r, ctx, { stack = false } = {}) {
  const changes = changesFrom(r.changes, ctx.today);
  // ON A GROUP'S OWN NUMBER the group never moves (his sweep 2026-10-07:
  // "category to office" came back as group: office)
  if (ctx.group !== find.ALL && 'groupName' in changes) {
    delete changes.groupName;
    if (!Object.keys(changes).length) return `Expenses on this number stay in *${ctx.group}*. To move one to another group, use Diane in the CRM.`;
  }
  if (!Object.keys(changes).length) return 'What should it change to? For example _change the taxi to 50_ or _the lunch was on 5 Oct_.';
  /**
   * MORE FOR THE SAME CHANGE: "change the taxi to 50", then "and the
   * spender is Leo P", lost the 50; "and paid to costa" changed the
   * description (test sweep 2026-10-07). With a change open and no other
   * expense named, the new part joins it.
   */
  const open = ctx.state.pending?.kind === 'edit' ? editItems(ctx.state.pending) : [];
  if (open.length) {
    const words = find.wordsOf(r.target?.words ?? '');
    // no expense named: the last one asked about; named: that one if waiting
    const mine = !words.length ? open.at(-1)
      : open.find((x) => words.length && words.every((w) => find.wordsOf(`${x.before.description} ${x.before.payee}`).some((h) => h.startsWith(w))));
    if (mine) {
      const row = await expensesRepo.findById(mine.id);
      if (row) return editPreviewFor(row, changes, ctx);
    }
  }
  const hits = await find.findTarget(ctx.group, r.target, { today: ctx.today, lastIds: ctx.state.lastIds ?? [] });
  if (!hits.length) return notFound(ctx);
  // ONE OF THEM THIS MONTH: that one, shown for a yes (a person reads
  // "update groceries" as this month's); several this month: asked
  const here = thisMonth(hits, ctx.today);
  if (here.length === 1) return editPreviewFor(await expensesRepo.findById(here[0].id), changes, ctx);
  if (hits.length > 1) return pick(here.length > 1 ? here : hits, { kind: 'edit', changes }, 'should I change', ctx);
  return editPreviewFor(await expensesRepo.findById(hits[0].id), changes, ctx);
}

function editPreviewFor(row, changes, ctx) {
  // SETTLED IS LOCKED (his call 2026-10-08): refunded is final; the CRM admin reopens it
  if (row.settle_status === 'settled') {
    ctx.locked = [...new Set([...(ctx.locked ?? []), row.description])];
    const waiting = ctx.state.pending?.kind === 'edit' ? editItems(ctx.state.pending) : [];
    const msg = `🔒 The *${row.description}* is settled (refunded), so it can't be changed. The CRM admin can reopen it.`;
    return waiting.length ? `${msg}

${format.editsPreview(waiting, { group: ctx.group === find.ALL, removes: ctx.state.pending.removes ?? [] })}` : msg;
  }
  // "SPENT BY ME": the admin, by name in the preview and linked on save
  const me = changes.spentBy != null && ME.test(String(changes.spentBy).trim());
  if (me && ctx.admin?.name) changes = { ...changes, spentBy: ctx.admin.name };
  else if (me) return 'Who should it be spent by? Send their name.';
  const before = SNAP(row);
  const fields = Object.fromEntries(Object.entries(changes).filter(([f, v]) => String(before[f] ?? '') !== String(v ?? '')));
  // EVERY CHANGE JOINS THE ONES WAITING: one preview, one yes
  const waiting = ctx.state.pending?.kind === 'edit' ? editItems(ctx.state.pending) : [];
  if (!Object.keys(fields).length) {
    const removesNow = ctx.state.pending?.kind === 'edit' ? ctx.state.pending.removes ?? [] : [];
    if (!waiting.length && !removesNow.length) { ctx.state.pending = null; return 'It already says that, so nothing needs changing.'; }
    return `The *${before.description}* already says that.\n\n${format.editsPreview(waiting, { group: ctx.group === find.ALL, removes: removesNow })}`;
  }
  const at = waiting.findIndex((x) => x.id === row.id);
  const splits = ctx.splitNow?.[row.id] ?? (at >= 0 ? waiting[at].splits : undefined);
  const item = { id: row.id, before, fields: { ...(at >= 0 ? waiting[at].fields : {}), ...fields }, me: (me && 'spentBy' in fields) || (at >= 0 && waiting[at].me), ...(splits?.length ? { splits } : {}) };
  const items = at >= 0 ? waiting.map((x, i) => (i === at ? item : x)) : [...waiting, item];
  const removes = ctx.state.pending?.kind === 'edit' ? (ctx.state.pending.removes ?? []).filter((x) => x.id !== row.id) : [];
  ctx.state.pending = draft(items, removes, ctx.state.pending);
  const lead = waiting.length && at < 0 ? `Added the *${before.description}*. ` : '';
  return `${lead ? `${lead}\n\n` : ''}${format.editsPreview(items, { group: ctx.group === find.ALL, removes })}`;
}

const BIG_LINES = 20;
const BIG_AED = 10000;
/** A change or removal big enough to need "yes 25": how many, and the AED it moves. */
function bigDraft(p) {
  if (p.kind !== 'edit' && p.kind !== 'remove') return null;
  const rate = (b) => (b.currency === 'AED' ? 1 : Number(b.exchangeRate) || 0);
  const items = p.kind === 'edit' ? editItems(p) : [];
  const removes = p.kind === 'edit' ? p.removes ?? [] : p.before.map((before, i) => ({ id: p.ids[i], before }));
  const count = items.length + removes.length;
  const aed = items.reduce((n, x) => n + ('rawAmount' in x.fields ? Math.abs(Number(x.fields.rawAmount) - Number(x.before.rawAmount)) * rate(x.before) : 0), 0)
    + removes.reduce((n, r) => n + Number(r.before.rawAmount) * rate(r.before), 0);
  return count > BIG_LINES || aed >= BIG_AED ? { count, aed } : null;
}

/** A draft of changes and removals for one yes. A split rides on its change (item.splits). */
function draft(items, removes = []) {
  return { kind: 'edit', items, removes };
}

/**
 * THE LIST ON SCREEN STAYS until a new list replaces it (his list
 * 2026-10-08), or for 6 hours, like a preview: "2 to 50" after a question
 * or two still means No. 2 of that list.
 */
const LIST_MS = 6 * 60 * 60 * 1000;
function listOnScreen(state) {
  if (!state.listIds?.length) return false;
  return state.listTime ? Date.now() - state.listTime < LIST_MS : (state.history ?? []).length - (state.listAt ?? -99) <= 6;
}
function showList(ctx, ids) {
  ctx.state.listIds = ids;
  ctx.state.listAt = (ctx.state.history ?? []).length;
  ctx.state.listTime = Date.now();
}

/** The changes waiting, in the list shape (one change, before stacking, too). */
function editItems(p) {
  if (!p) return [];
  return p.items ?? (p.id ? [{ id: p.id, before: p.before, fields: p.fields, me: p.me }] : []);
}

/**
 * ONLY THESE LINES OF WHAT WAITS ("only 1-3", "not 5-6"): the rest left out,
 * the preview shown again, numbered afresh. Changes are 1..n, removals after.
 */
function keepLines(keep, ctx) {
  const p = ctx.state.pending;
  const isRemove = p.kind === 'remove';
  const items = isRemove ? [] : editItems(p);
  const removes = isRemove ? p.ids.map((id, i) => ({ id, before: p.before[i] })) : p.removes ?? [];
  const total = items.length + removes.length;
  const left = total - keep.length;
  const what = isRemove ? 'removed' : 'changed';
  if (!keep.length) { ctx.state.pending = null; return `Okay, all ${total} left out. Nothing will be ${what}.`; }
  if (!left) { ctx.keepShown = true; return `All ${total} are already in it. Reply *yes* to go ahead, or *cancel*.`; }
  const keptItems = items.filter((_, i) => keep.includes(i + 1));
  const keptRemoves = removes.filter((_, i) => keep.includes(items.length + i + 1));
  // "now the rest to zayn": the ones left out, kept in mind
  ctx.state.leftOut = [...items.filter((_, i) => !keep.includes(i + 1)), ...removes.filter((_, i) => !keep.includes(items.length + i + 1))].map((x) => x.id);
  const lead = `Okay, only No. ${format.ranges(keep)}. Left out ${left}.${keep.some((n, i) => n !== i + 1) ? ' _Numbered again below._' : ''}`;
  if (isRemove) {
    ctx.state.pending = { kind: 'remove', ids: keptRemoves.map((x) => x.id), before: keptRemoves.map((x) => x.before) };
    return `${lead}\n\n${format.removePreview(keptRemoves.map((x) => x.before), { group: ctx.group === find.ALL })}`;
  }
  ctx.state.pending = draft(keptItems, keptRemoves, p);
  return `${lead}\n\n${format.editsPreview(keptItems, { group: ctx.group === find.ALL, removes: keptRemoves })}`;
}

/** "groceries to 300 and internet bill to 800" → each part, as a change. */
function editParts(said) {
  // "also", "too", "pls" wherever they sit: "update internet bill also to 800 pls"
  const t = canonicalVerbs(String(said ?? '').trim()).replace(/\s+(?:also|too|as well|pls|please)\b/gi, '').replace(/[.!]+$/, '');
  return t.split(/\s*\n+\s*|\s+and\s+(?:also\s+)?(?=(?:the\s+)?[a-z][\w\s'-]{1,40}?\s+(?:(?:to|is|was|should be)\s+\S|(?:aed\s*)?\d[\d,.]*\s*(?:aed)?$))/i)
    .map((p) => p.trim().replace(/^(?:and\s+)?(?:also\s+)?/i, ''))
    .filter(Boolean)
    .map((p) => (/^(?:change|make|update|edit|set|correct)\b/i.test(canonicalVerbs(p)) || quickRoute(p, { today: currentDay() })?.kind === 'edit' ? canonicalVerbs(p) : `change ${p}`));
}

/**
 * A CHANGE IN WORDS, AGAINST ONE EXPENSE: "add 500", "deduct 100", "make
 * it 800", "internet bill make it 1299", "to 50", "the date to 3 Oct".
 * Adding and taking off are worked out from its amount now. Null when the
 * words are not a change.
 */
function changeFromWords(words, row, today) {
  const t = String(words ?? '').trim().replace(/[.!]+$/, '');
  const now = Number(row.raw_amount ?? row.rawAmount);
  const rel = /^(?:(add|plus|increase(?: it)? by|raise(?: it)? by|up by|top(?: it)? up by|\+)|(deduct|minus|less|subtract|take off|reduce(?: it)? by|lower(?: it)? by|down by|knock off|-))\s*(?:aed|gbp|£|dhs?)?\s*(\d[\d,]*(?:\.\d+)?)\b/i.exec(t);
  if (rel && Number.isFinite(now)) {
    const by = Number(rel[3].replace(/,/g, ''));
    const next = Math.round((rel[1] ? now + by : now - by) * 100) / 100;
    if (next < 0) return { why: `taking ${by} off would put the *${row.description}* (${format.money(row.currency, now)}) below zero.` };
    return { rawAmount: next };
  }
  // the value after "make it" / "to" / "->", whatever names it first
  const at = /(?:^|\s)(?:make it|change it to|set it to|it'?s|to|=|is|should be|->|=>|→|➜)\s*(.+)$/i.exec(t);
  const value = at ? at[1] : t;
  const r1 = quickRoute(`change the zzplaceholder to ${value}`, { today, group: null });
  return r1?.kind === 'edit' ? changesFrom(r1.changes, today) : null;
}

/** This month's, when there are some: "the taxi" is this month's taxi. */
const thisMonthOr = (hits, today) => (thisMonth(hits, today).length ? thisMonth(hits, today) : hits);

/**
 * ONE CHANGE, SEVERAL EXPENSES: "change the taxi and the cleaner to 60",
 * "change all taxis to 40" (his sweep 2026-10-07: only the first moved).
 * Each joins the one preview; "all" is this month's.
 */
async function severalEdits(said, ctx) {
  const t = canonicalVerbs(String(said ?? '').trim());
  const m = /^(?:change|update|set|make|correct)\s+(?:the\s+)?(.+?)\s+(?:to|=)\s+(.+)$/i.exec(t);
  if (!m) return null;
  const all = /^(?:all|every|each)\s+(?:the\s+)?(.+)$/i.exec(m[1]);
  const names = all ? null : m[1].split(/\s*(?:,|\band\b|&)\s*(?:the\s+)?/i).filter(Boolean);
  if (!all && (!names || names.length < 2)) return null;
  const route1 = quickRoute(`change the zzplaceholder to ${m[2]}`, { today: ctx.today, group: ctx.group });
  if (route1?.kind !== 'edit') return null;
  const ids = [];
  if (all) {
    const hits = thisMonthOr(await find.findTarget(ctx.group, { words: all[1] }, { today: ctx.today }), ctx.today);
    ids.push(...hits.map((h) => h.id));
  } else {
    for (const n of names) {
      // eslint-disable-next-line no-await-in-loop
      const hits = thisMonthOr(await find.findTarget(ctx.group, { words: n }, { today: ctx.today }), ctx.today);
      if (hits.length !== 1) return null;
      ids.push(hits[0].id);
    }
  }
  if (!ids.length) return null;
  let reply = null;
  for (const id of ids.slice(0, 20)) {
    // eslint-disable-next-line no-await-in-loop
    reply = editPreviewFor(await expensesRepo.findById(id), changesFrom(route1.changes, ctx.today), ctx);
  }
  return reply;
}

/** Several changes into the one waiting preview; a part that needs a pick is asked. */
async function stackEdits(asks, ctx) {
  let reply = null;
  for (let i = 0; i < asks.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    reply = await startEdit(asks[i], ctx, { stack: true });
    if (ctx.state.pending?.kind === 'pick') {
      ctx.state.pending.then.more = asks.slice(i + 1);
      return reply;
    }
  }
  return reply;
}

/** Not on a row that moved since they were shown it. */
async function stale(id, before) {
  const now = await expensesRepo.findById(id);
  if (!now) return 'that expense has since been removed';
  if (now.settle_status === 'settled') return 'that expense was settled (refunded) since I showed it, so it is locked';
  return same(now, before) ? null : 'that expense was changed since I showed it';
}

async function saveEdit(ctx) {
  const items = editItems(ctx.state.pending);
  const removes = ctx.state.pending.removes ?? [];
  for (const x of removes) {
    // eslint-disable-next-line no-await-in-loop
    const why = await stale(x.id, x.before);
    if (why) { ctx.state.pending = null; return `Nothing was changed: the *${x.before.description}* ${why.replace(/^that expense /, '')}. Ask again and I'll show it as it is now.`; }
  }
  // ALL OR NOTHING: one moved since it was shown, and none is changed
  for (const x of items) {
    // eslint-disable-next-line no-await-in-loop
    const why = await stale(x.id, x.before);
    if (why) { ctx.state.pending = null; return `Nothing was changed: the *${x.before.description}* ${why.replace(/^that expense /, '')}. Ask again and I'll show it as it is now.`; }
  }
  const done = [];
  for (const { id, before, fields, me } of items) {
    /* eslint-disable no-await-in-loop */
    // a new spender is linked: "me" here by the admin's phone, any other name
    // by the repo's own relink
    let link = {};
    if (me) {
      const l = await spender.linkSpender({ name: fields.spentBy, me: true, admin: ctx.admin, group: before.groupName ?? ctx.group });
      link = { spentByPersonId: l.personId, spentByPhone: l.phone };
    }
    const after = await expensesRepo.update(id, { ...fields, ...link });
    const check = await expensesRepo.findById(id);
    if (!after || !check) return '⚠️ A change could not be confirmed. Please check the Expenses page.';
    done.push({ id, before, fields, check });
    /* eslint-enable no-await-in-loop */
  }
  // A SPLIT'S NEW EXPENSES: the same expense in every way but who and how much
  const made = [];
  for (const x of items.filter((i) => i.splits?.length)) {
    const b = x.before;
    // eslint-disable-next-line no-await-in-loop
    const rows = await expensesRepo.createMany(x.splits.map((p) => ({
      spentOn: x.fields.spentOn ?? b.spentOn, description: x.fields.description ?? b.description, payee: 'payee' in x.fields ? x.fields.payee : b.payee,
      currency: b.currency, rawAmount: p.rawAmount, exchangeRate: b.exchangeRate, groupName: b.groupName ?? ctx.group, spentBy: p.spentBy,
      category: 'category' in x.fields ? x.fields.category : b.category, savedBy: ctx.admin?.name ?? null,
    })));
    made.push(...rows.map((m) => Object.assign(m, { fromId: x.id })));
  }
  // THE REMOVALS IN THE SAME DRAFT: their receipts kept for undo
  const gone = [];
  for (const x of removes) {
    /* eslint-disable no-await-in-loop */
    const row = await expensesRepo.findById(x.id);
    if (row && await expensesRepo.remove(x.id)) gone.push({ id: x.id, before: x.before, receiptPath: row.receipt_path ?? null });
    /* eslint-enable no-await-in-loop */
  }
  const back = (x) => `${x.before.description}: ${Object.keys(x.fields).map((f) => `${format.LABEL[f] ?? f} back to ${f === 'spentOn' ? format.day(x.before[f]) : f === 'rawAmount' ? format.amount(x.before[f]) : x.before[f]}`).join(', ')}`;
  await store.recordAction(require('../../../configs/db'), {
    phone: ctx.phone, group: ctx.group, kind: 'edit',
    changes: [...done.map((x) => ({ id: x.id, before: x.before, after: SNAP(x.check) })), ...gone.map((g) => ({ ...g, removed: true })), ...made.map((m) => ({ id: m.id, after: SNAP(m), created: true, from: m.fromId }))],
    summary: [...done.map(back), ...gone.map((g) => `bring back ${g.before.description}`), ...made.map((m) => `take back the split ${m.description} by ${m.spent_by ?? 'nobody'}`)].join('; '),
  });
  broadcast(null, EVENT, { action: 'updated', ids: done.map((x) => x.id), via: 'whatbot' });
  if (made.length) broadcast(null, EVENT, { action: 'imported', count: made.length, via: 'whatbot' });
  ctx.state.pending = null;
  ctx.state.lastIds = done.map((x) => x.id);
  rememberChange(items, ctx);
  if (gone.length) broadcast(null, EVENT, { action: 'deleted', count: gone.length, via: 'whatbot' });
  const changedText = !done.length ? '' : done.length === 1 ? format.changed(find.asItem(done[0].check), { group: ctx.group === find.ALL })
    : format.changedMany(done.map((x) => find.asItem(x.check)), { group: ctx.group === find.ALL });
  const madeText = made.length ? `\n\n➕ *Split off:* ${made.map((m) => `${format.money(m.currency, Number(m.raw_amount))} by ${m.spent_by ?? 'nobody'}`).join(' · ')}` : '';
  const recap = await recapFor(done, ctx);
  if (!gone.length) return `${changedText}${madeText}${recap}`;
  const removedText = format.removed(gone.map((g) => g.before), { start: done.length });
  return done.length ? `${changedText.replace(/\n*Reply \*undo\*[^\n]*$/, '')}\n\n${removedText.replace(/\n*Reply \*undo\*[^\n]*$/, '')}${madeText}${recap}\n\nReply *undo* to put it all back, or *undo only 2*.` : removedText;
}

/**
 * WHAT WAS JUST DONE, for "do the same for 5 and 6" (his list 2026-10-08):
 * the change in words when every expense got the same one.
 */
function rememberChange(items, ctx) {
  const shape = (x) => JSON.stringify(Object.entries(x.fields).filter(([f]) => f !== 'rawAmount' || !x.splits?.length).sort());
  const same = items.length && items.every((x) => shape(x) === shape(items[0]));
  const what = same ? Object.entries(items[0].fields).map(([f, v]) => `${f} → ${v == null ? '(empty)' : v}`).join(', ') : items.map((x) => `${x.before.description}: ${Object.entries(x.fields).map(([f, v]) => `${f} → ${v}`).join(', ')}`).slice(0, 5).join('; ');
  ctx.state.lastChange = what ? { what, n: items.length, at: Date.now() } : null;
  // the ones left out stay in mind for "now the rest", minus any just changed
  if (ctx.state.leftOut?.length) ctx.state.leftOut = ctx.state.leftOut.filter((id) => !items.some((x) => x.id === id));
}

/**
 * AFTER A CHANGE OF WHO SPENT IT: where they stand now, this month (his
 * list 2026-10-08): "Gloria now has 9 expenses this month (AED 2,340.00)".
 */
async function recapFor(done, ctx) {
  const names = [...new Set(done.filter((x) => 'spentBy' in x.fields && x.fields.spentBy).map((x) => String(x.check.spent_by ?? x.fields.spentBy)))].slice(0, 3);
  if (!names.length) return '';
  const rows = (await find.between(ctx.group, `${ctx.today.slice(0, 8)}01`, ctx.today)).map(find.asItem);
  const lines = names.map((name) => {
    const theirs = rows.filter((r) => String(r.spentBy ?? '').toLowerCase() === name.toLowerCase());
    const aed = theirs.reduce((n, r) => n + (r.aed ?? 0), 0);
    return `${name} now has ${theirs.length} ${theirs.length === 1 ? 'expense' : 'expenses'} this month (*${format.money('AED', Math.round(aed * 100) / 100)}*)`;
  });
  return `\n\n📊 ${lines.join('\n📊 ')}`;
}

// ---- removing ----

async function startRemove(r, ctx) {
  // SEVERAL NAMED AT ONCE ("remove the cleaner and the petrol"): all of them
  const named = find.targetsIn(ctx.said ?? '', year(ctx.today), ctx.today);
  if (named.length > 1) return moreToRemove(ctx.said, ctx, { fresh: true });
  // NOTHING NAMED ("let's remove expenses"): asked which, never "not found"
  const t = r.target ?? {};
  if (!find.wordsOf(t.words).length && !t.date && !t.amount && !t.from && !t.to && !t.last) return whichToRemove(ctx);
  const hits = await find.findTarget(ctx.group, r.target, { today: ctx.today, lastIds: ctx.state.lastIds ?? [] });
  if (!hits.length) return notFound(ctx);
  if (hits.length > 1 && !r.target.all) {
    const here = thisMonth(hits, ctx.today);
    if (here.length === 1) return removePreviewFor([await expensesRepo.findById(here[0].id)].filter(Boolean), ctx);
    return pick(here.length > 1 ? here : hits, { kind: 'remove' }, 'should I remove', ctx);
  }
  const rows = await Promise.all(hits.slice(0, 30).map((h) => expensesRepo.findById(h.id)));
  return removePreviewFor(rows.filter(Boolean), ctx);
}

/** The expenses a message names, each matching exactly one; and the rest. */
async function idsNamed(said, ctx) {
  const found = [];
  const unclear = [];
  for (const t of find.targetsIn(said, year(ctx.today), ctx.today)) {
    // eslint-disable-next-line no-await-in-loop
    const hits = await find.findTarget(ctx.group, t, { today: ctx.today });
    if (hits.length === 1) found.push(hits[0].id); else unclear.push(t);
  }
  return { found, unclear };
}

/**
 * "Which one, and what?" for "update Zayn's expenses": the latest, only
 * theirs when a person is named, and how to say the change.
 */
async function whichToChange(ctx, who = null) {
  const name = who && !/^(?:my|our|the|some|these|those|all)$/i.test(who.trim()) ? who.trim() : null;
  const theirs = (r) => !name || find.wordsOf(r.spentBy).some((w) => find.wordsOf(name).includes(w));
  const pickFrom = await recentToPick(ctx, theirs);
  if (!pickFrom.rows.length) return name ? `There are no expenses spent by *${name}* in the last 2 months.` : 'There are no expenses in the last 2 months to change.';
  // the name as it is saved ("Zayn"), not as typed ("zayn")
  const shown = name ? (pickFrom.rows.find((r) => r.spentBy)?.spentBy ?? name) : null;
  ctx.state.awaiting = 'change';
  showList(ctx, pickFrom.rows.map((r) => r.id));
  return [`Which one should I change${shown ? ` for *${shown}*` : ''}? ${pickFrom.heading}`, '', ...pickFrom.lines, '',
    'Say the change, like _2 to 50_, _change the taxi to 50_ or _change the date of the petrol to 6 Oct_.'].join('\n');
}

/**
 * WHAT TO PICK FROM: THIS MONTH'S, all of them (up to 12), with how many
 * (his report 2026-10-07: 2 removed, 4 left, and the list of 6 filled up
 * with September's, so the removed ones looked still there). An empty
 * month says so, and the latest before it are shown with their month.
 */
async function recentToPick(ctx, keep = () => true) {
  const first = `${ctx.today.slice(0, 8)}01`;
  const month = (await find.between(ctx.group, first, ctx.today)).map(find.asItem).filter(keep);
  let n = 0;
  const fmt = (r) => { n += 1; return format.line({ ...r, n }, { number: true, group: ctx.group === find.ALL }); };
  const monthName = new Date(`${first}T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  if (month.length) {
    const rows = month.slice(0, 12);
    return { rows, lines: [...rows.map(fmt), ...(month.length > 12 ? [`_…and ${month.length - 12} more this month: name the one you mean_`] : [])], heading: `${month.length} this ${monthName}:` };
  }
  const before = (await find.between(ctx.group, minus(ctx.today, 62), minus(first, 1))).map(find.asItem).filter(keep).slice(0, 6);
  return { rows: before, lines: before.map(fmt), heading: `None yet this ${monthName}. The latest before that:` };
}

/**
 * INSTANT REPLIES STAY IN CODE: yes, no, a number, hi, thanks, help, rates, a
 * question code answers. Only the rest goes to the planner.
 */
function cheapMessage(said, pending, ctx) {
  const t = String(said ?? '').trim();
  if (!t) return true;
  if (GREETING.test(t) || HELP_ASK.test(t) || THANKS.test(t) || ACK.test(t) || UNDO.test(t) || UNDO_WORDS.test(t) || RECEIPT_ASK.test(t) || SHOW_PREVIEW.test(t)) return true;
  if (/^(?:(?:pls|please|can you|could you)\s+)?(?:show(?: me)?|send|what(?:'s| is| are)?|which|give me)?\s*(?:the\s+)?(?:exchange\s+)?rates?\b/i.test(t) && t.length < 30) return true;
  if (pending) {
    const r = readReply(t, pending, { year: year(ctx.today), groups: ctx.groups });
    if (r) return true;
  }
  const q = quickRoute(t, { today: ctx.today, groups: ctx.groups, group: ctx.group });
  return q?.kind === 'question';
}

/** A plain new expense, typed: an amount and nothing that points at a saved one. */
function pureNewExpense(said) {
  const t = String(said ?? '');
  const canon = canonicalVerbs(t);
  return /\d/.test(t) && !EDIT_WORDS.test(canon) && !editish(canon)
    && !/\b(?:should|was|were|is|it|that|those|these|both|every|swap|half|double|percent|except|instead|wrong|mistake|actually|number|no\.|set|date|amount|payee|category|rename|move|first|second|third|fourth|fifth|last|one)\b|%|->|=>|\bto\s+(?:aed\s*)?\d/i.test(t);
}

/** What the planner sees: the list on screen, this month, the last saved, what waits. */
async function plannerContext(ctx) {
  const { state, group, today } = ctx;
  const rowsOf = async (ids) => (await Promise.all((ids ?? []).map((id) => expensesRepo.findById(id)))).filter(Boolean).map(find.asItem);
  // this month and the last days of the one before: enough to find any "the X"
  const month = (await find.between(group, minus(today, 35), today)).map(find.asItem).slice(0, 45);
  const listFresh = listOnScreen(state);
  const list = listFresh ? await rowsOf(state.listIds) : [];
  const about = await rowsOf((state.lastIds ?? []).slice(0, 5));
  const last = (await find.lastSaved(group, 3)).filter((r) => !about.some((a) => a.id === r.id));
  const p = state.pending;
  let waiting = null;
  if (p?.kind === 'add') waiting = `A PREVIEW OF NEW EXPENSES (not saved yet):\n${p.items.filter((x) => !x.skipped).map((x) => `${x.n}. ${x.description ?? '?'} | ${x.payee ?? '?'} | ${x.currency} ${x.rawAmount ?? '?'} | ${x.spentOn ?? '?'}`).join('\n')}`;
  // numbered as the preview shows them: "only the groceries and 4" reads both
  if (p?.kind === 'edit') {
    const lines = [...editItems(p).map((x) => `change id ${x.id} (${x.before.description}): ${Object.entries(x.fields).map(([f, v]) => `${f} → ${v}`).join(', ')}`),
      ...(p.removes ?? []).map((x) => `remove id ${x.id} (${x.before.description})`)].map((l, i) => `P${i + 1}. ${l}`);
    // in the order they were asked: "actually no, the X" swaps the LAST
    if (lines.length > 1) lines[lines.length - 1] += '   ← added last';
    waiting = lines.join('\n');
  }
  if (p?.kind === 'remove') waiting = p.ids.map((id, i) => `P${i + 1}. remove id ${id} (${p.before?.[i]?.description ?? ''})`).join('\n');
  if (p?.kind === 'pick') waiting = `They were asked WHICH ONE (to ${p.then.kind}): ${p.choices.map((id, i) => `${i + 1} = id ${id}`).join(', ')}`;
  const all = new Map([...month, ...list, ...last].map((r) => [r.id, r]));
  if (p?.kind === 'pick') for (const r of await rowsOf(p.choices)) all.set(r.id, r);
  for (const r of about) all.set(r.id, r);
  // THE LAST TWO TURNS, short: "gloria" answers "Spent by who?"
  const cut = (t, n) => String(t ?? '').replace(/\s+/g, ' ').slice(0, n);
  const talk = (state.history ?? []).slice(-2).map((h) => `Them: ${cut(h.said, 200)}\nBot: ${cut(typeof h.reply === 'string' ? h.reply : '', 400)}`).join('\n') || null;
  // "do the same for 5 and 6", "now the rest to zayn"
  const lastChange = state.lastChange ? `${state.lastChange.what} (on ${state.lastChange.n} ${state.lastChange.n === 1 ? 'expense' : 'expenses'})` : null;
  const leftRows = await rowsOf((state.leftOut ?? []).slice(0, 30));
  for (const r of leftRows) all.set(r.id, r);
  const leftOut = leftRows.length ? leftRows.map((r) => `id ${r.id} (${r.description})`).join('\n') : null;
  return { view: { today, group, list, month, last, waiting, about, talk, lastChange, leftOut }, known: all };
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function addMonths(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * A SET BY ITS RULE, found by code (his list 2026-10-08): "gloria's taxis
 * this week", "over 500", "all except the cleaner". This month unless they
 * said dates; the same exact words as everywhere else.
 */
async function idsByFilter(f, ctx) {
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? v : null);
  const from = day(f.from) ?? `${ctx.today.slice(0, 8)}01`;
  const to = day(f.to) ?? ctx.today;
  const rows = (await find.between(ctx.group, from, to)).map(find.asItem);
  const has = (text, words) => { const have = find.wordsOf(text); return find.wordsOf(words).every((w) => have.some((h) => h === w || h.startsWith(w))); };
  const out = rows.filter((r) => {
    if (f.spent_by && !has(r.spentBy, f.spent_by)) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.payee && !has(r.payee, f.payee)) return false;
    if (f.words && !has(`${r.description} ${r.payee}`, f.words)) return false;
    const aed = r.aed ?? r.rawAmount;
    if (f.min_amount != null && !(aed >= Number(f.min_amount))) return false;
    if (f.max_amount != null && !(aed <= Number(f.max_amount))) return false;
    if (f.except && String(f.except).split(/\s*(?:,|\band\b|&|\bor\b)\s*/i).filter(Boolean).some((w) => has(`${r.description} ${r.payee} ${r.spentBy}`, w))) return false;
    return true;
  });
  return out.map((r) => r.id);
}

/**
 * "SPLIT 3 BETWEEN GLORIA AND ZAYN" (his list 2026-10-08): the first part
 * keeps the expense, each other part is a new one, the same in every way
 * but who and how much. Shares not said are equal; parts never add up to
 * more than it is.
 */
function splitFor(op, row) {
  const parts = (op.parts ?? []).filter((p) => p.spent_by || p.amount != null);
  if (parts.length < 2) return { why: 'say who it is split between, like _split it between Gloria and Zayn_' };
  const total = Number(row.rawAmount);
  const said = parts.filter((p) => p.amount != null).reduce((n, p) => n + Number(p.amount), 0);
  const open = parts.filter((p) => p.amount == null).length;
  if (said > total + 0.005 || (!open && Math.abs(said - total) > 0.005)) return { why: `the parts come to ${format.amount(said)}, and it is ${format.money(row.currency, total)}` };
  const share = open ? Math.floor(((total - said) / open) * 100) / 100 : 0;
  let left = Math.round((total - said - share * open) * 100) / 100;
  const amounts = parts.map((p) => {
    if (p.amount != null) return Number(p.amount);
    const a = Math.round((share + left) * 100) / 100;
    left = 0;
    return a;
  });
  if (amounts.some((a) => !(a > 0))) return { why: 'every part has to be above 0' };
  const [first, ...rest] = parts;
  return {
    changes: { rawAmount: amounts[0], ...(first.spent_by ? { spentBy: String(first.spent_by).trim().slice(0, 60) } : {}) },
    splits: rest.map((p, i) => ({ rawAmount: amounts[i + 1], spentBy: p.spent_by ? String(p.spent_by).trim().slice(0, 60) : row.spentBy })),
  };
}

/** One planner change on one expense, as checked field values (or why not). */
function changesForOp(op, row) {
  const out = {};
  const s = op.set ?? {};
  if (s.amount != null) { const v = num(s.amount); if (v === null || v < 0) return { why: 'the amount is not a number of 0 or more' }; out.rawAmount = v; }
  if (s.currency) { const c = currencyOf(s.currency); if (!c) return { why: `"${s.currency}" is not a currency I know` }; out.currency = c; }
  if (s.date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || Number.isNaN(Date.parse(`${s.date}T00:00:00Z`))) return { why: `"${s.date}" is not a date` }; out.spentOn = s.date; }
  if (s.payee) out.payee = String(s.payee).trim().slice(0, 80);
  if (s.description) out.description = String(s.description).trim().slice(0, 120);
  if (s.spent_by) out.spentBy = String(s.spent_by).trim().slice(0, 60);
  if (s.category && planner.CATEGORIES.includes(s.category)) out.category = s.category;
  const a = op.adjust ?? {};
  // NEVER BOTH: given a total AND "+80", the +80 is from what it is now
  // (his harness 2026-10-07: "add 80" came back as +160)
  const relative = a.by != null || a.percent != null || a.times != null;
  if (relative) delete out.rawAmount;
  const base = Number(row.rawAmount);
  if (relative) {
    let v = base;
    if (a.times != null) v *= Number(a.times);
    if (a.percent != null) v *= 1 + Number(a.percent) / 100;
    if (a.by != null) v += Number(a.by);
    v = Math.round(v * 100) / 100;
    if (!Number.isFinite(v) || v < 0) return { why: `that would put the *${row.description}* below zero` };
    out.rawAmount = v;
  }
  if (op.shift_days && !out.spentOn) out.spentOn = addDays(row.spentOn, Number(op.shift_days));
  // "PUSH THEM TO NEXT MONTH": the same day, a month on (the 31st becomes the month's last day)
  if (op.shift_months && !out.spentOn) out.spentOn = addMonths(row.spentOn, Number(op.shift_months));
  // "NO PAYEE ON 2": emptied, never the description, amount or date
  const CLEAR = { payee: 'payee', spent_by: 'spentBy', category: 'category' };
  for (const f of op.clear ?? []) if (CLEAR[f] && !(CLEAR[f] in out)) out[CLEAR[f]] = null;
  return Object.keys(out).length ? { changes: out } : { why: 'nothing to change was said' };
}

/**
 * THE PLANNER, END TO END: read, check every operation (the guard), and put
 * the changes and removals in ONE draft for one yes. Null when the message
 * belongs to the code paths after it (a preview answer, small talk), or the
 * model cannot be reached: then the old way answers, and nothing is guessed.
 */
async function runPlanner(said, ctx) {
  /**
   * SIMPLE AND CERTAIN, IN CODE (free, instant): one change or removal the
   * code reader understands, on exactly one expense this month, with no list
   * on screen and nothing waiting. Anything else is the planner's.
   */
  if (!ctx.state.pending && !ctx.awaiting && !/\n|,|\band\b|&/i.test(said) && !planner.needsCare(said)) {
    const q = quickRoute(said, { today: ctx.today, groups: ctx.groups, group: ctx.group });
    if ((q?.kind === 'edit' || q?.kind === 'remove') && !q.target.all && !q.target.last && find.wordsOf(q.target.words).length) {
      const hits = await find.findTarget(ctx.group, q.target, { today: ctx.today, lastIds: ctx.state.lastIds ?? [] });
      const here = thisMonthOr(hits, ctx.today);
      if (here.length === 1 && hits.length <= 2) {
        logger.info({ group: ctx.group, kind: q.kind }, 'expense bot: simple, in code');
        return q.kind === 'edit' ? startEdit(q, ctx) : startRemove(q, ctx);
      }
    }
  }
  let context;
  let result;
  try {
    context = await plannerContext(ctx);
    /**
     * NUMBERED LINES WITH A LIST ON SCREEN: each line is tagged with its
     * expense id, so "3. Add 80" can't be read as a new expense or slide onto
     * the next line (his screenshot, 2026-10-07).
     */
    const list = context.view.list;
    if (list.length) {
      // a dash before a digit is a run, not a line: "1-6 spent by zayn"
      // was read as "No. 1: 6 spent by zayn" (his report 2026-10-08)
      said = String(said).replace(/^(\s*)(?:no\.?\s*|#)?(\d{1,2})\s*(?:[.):]|-(?!\s*\d))\s*/gim, (m, sp, n) => (list[Number(n) - 1] ? `${sp}No. ${n} (id ${list[Number(n) - 1].id}, a SAVED one): ` : m));
    }
    let strong = planner.needsCare(said);
    let p = await planner.plan(said, context.view, { client: ctx.client, strong });
    result = await applyPlan(p, said, ctx, context);
    // A READING THE GUARD REFUSED, or one not sure: once more, carefully
    if (result?.retry && !strong) {
      strong = true;
      p = await planner.plan(said, context.view, { client: ctx.client, strong, note: result.retry });
      result = await applyPlan(p, said, ctx, context);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'expense bot: the planner failed, the code paths answer');
    return null;
  }
  logger.info({ group: ctx.group, said: String(said).slice(0, 200), ops: result?.ops, reply: result?.reply ? 'answered' : 'passed' }, 'expense bot: planned');
  return result?.reply ?? null;
}

async function applyPlan(p, said, ctx, context) {
  const ops = p.ops ?? [];
  const summary = ops.map((o) => `${o.kind}${o.ids?.length ? `:${o.ids.join(',')}` : ''}`).join(' ');
  if (!ops.length) return { reply: null, ops: summary };
  const kinds = new Set(ops.map((o) => o.kind));
  // what the code after answers better: the preview's own answers, small talk
  if ([...kinds].every((k) => ['about_preview', 'chat'].includes(k))) return { reply: null, ops: summary };
  if (kinds.size === 1 && kinds.has('confirm') && ctx.state.pending) return { reply: await onReply({ kind: 'yes' }, ctx), ops: summary };
  if (kinds.size === 1 && kinds.has('cancel') && ctx.state.pending) return { reply: await onReply({ kind: 'no' }, ctx), ops: summary };
  if (kinds.size === 1 && kinds.has('undo')) return { reply: await startUndo(ctx), ops: summary };

  // THE GUARD: every id is one it was shown; words are found exactly
  const asks = [];
  const edits = [];
  const removeIds = [];
  const adds = [];
  const questionsAsked = [];
  const pendingBefore = ctx.state.pending;
  let unknownIds = false;
  let dropped = false;
  for (const op of ops) {
    if (op.kind === 'unclear') { if (op.ask) asks.push(op.ask); continue; }
    if (op.kind === 'add') { if (op.text) adds.push(op.text); continue; }
    if (op.kind === 'question') { questionsAsked.push(op.text || said); continue; }
    // "NOT THE CLEANER": out of what waits
    if (op.kind === 'drop' && ctx.state.pending?.kind === 'edit') {
      const d = ctx.state.pending;
      const out = new Set((op.ids ?? []).filter((id) => editItems(d).some((x) => x.id === id) || (d.removes ?? []).some((x) => x.id === id)));
      if (!out.size) continue;
      ctx.state.pending = draft(editItems(d).filter((x) => !out.has(x.id)), (d.removes ?? []).filter((x) => !out.has(x.id)), d);
      dropped = true;
      continue;
    }
    // "ONLY THE CLEANER ONES" while removals wait: the others out
    if (op.kind === 'drop' && ctx.state.pending?.kind === 'remove') {
      const d = ctx.state.pending;
      const out = new Set((op.ids ?? []).filter((id) => d.ids.includes(id)));
      if (!out.size) continue;
      ctx.state.pending = { kind: 'edit', items: [], removes: d.ids.map((id, i) => ({ id, before: d.before[i] })).filter((x) => !out.has(x.id)) };
      dropped = true;
      continue;
    }
    // "SPLIT 3 BETWEEN GLORIA AND ZAYN": one expense, shared out
    if (op.kind === 'split') {
      const id = (op.ids ?? []).find((x) => context.known.has(x));
      const row = id && await expensesRepo.findById(id);
      if (!row) { asks.push('Which one should I split? Say it like _split 3 between Gloria and Zayn_.'); continue; }
      const got = splitFor(op, find.asItem(row));
      if (got.why) { asks.push(`*${row.description}*: ${got.why}.`); continue; }
      edits.push({ row, changes: got.changes, splits: got.splits });
      continue;
    }
    if (op.kind !== 'change' && op.kind !== 'remove') continue;
    let ids = (op.ids ?? []).filter((id) => context.known.has(id));
    // A SET BY ITS RULE: every one that fits, found here, never guessed (its
    // ids, if the model gave any too, are not what decides)
    const rule = op.filter && Object.values(op.filter).some((v) => v != null && v !== '');
    if (!rule && (op.ids ?? []).some((id) => !context.known.has(id))) unknownIds = true;
    if (rule) {
      ids = await idsByFilter(op.filter, ctx);
      if (!ids.length) { asks.push(`Nothing this month fits _${op.match || 'that'}_.`); continue; }
    }
    if (!ids.length && op.match) {
      const hits = thisMonthOr(await find.findTarget(ctx.group, { words: op.match }, { today: ctx.today, lastIds: ctx.state.lastIds ?? [] }), ctx.today);
      if (hits.length === 1) ids = [hits[0].id];
      else if (hits.length > 1) { asks.push(`Which *${op.match}*? ${hits.slice(0, 4).map((h) => `${h.description} (${format.day(h.spentOn)}, ${format.money(h.currency, h.rawAmount)})`).join(' · ')}`); continue; }
      else { asks.push(`I couldn't find *${op.match}* in this month's expenses.`); continue; }
    }
    if (!ids.length) continue;
    /**
     * ONE PICKED WHERE THE WORDS FIT SEVERAL ("change the lunch to 35": two
     * lunches this month, his harness 2026-10-07): asked, never chosen.
     * Not when it came from the list on screen, or the words name it fully.
     */
    if (ids.length === 1 && op.match && !context.view.list.length && !/^(?:no\.?\s*)?\d+$|\b(?:it|that|this|last|first|second|third)\b/i.test(op.match)) {
      const fits = thisMonthOr(await find.findTarget(ctx.group, { words: op.match }, { today: ctx.today }), ctx.today);
      if (fits.length > 1 && ops.filter((o) => o.kind === 'change' || o.kind === 'remove').length === 1) {
        if (op.kind === 'remove') return { reply: pick(fits, { kind: 'remove' }, 'should I remove', ctx), ops: summary };
        const row0 = await expensesRepo.findById(ids[0]);
        const got = row0 && changesForOp(op, find.asItem(row0));
        if (got?.changes && !op.adjust?.by && !op.adjust?.percent && !op.adjust?.times && !op.shift_days) {
          return { reply: pick(fits, { kind: 'edit', changes: got.changes }, 'should I change', ctx), ops: summary };
        }
      }
    }
    if (op.kind === 'remove') { removeIds.push(...ids); continue; }
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const row = await expensesRepo.findById(id);
      if (!row) continue;
      const got = changesForOp(op, find.asItem(row));
      // asked for the value already ("Spent by who?"): not asked again per expense
      if (got.why === 'nothing to change was said' && ops.some((o) => o.kind === 'unclear')) continue;
      if (got.why) asks.push(`*${row.description}*: ${got.why}.`);
      else edits.push({ row, changes: got.changes });
    }
  }
  // IN THE LIST'S ORDER, so the preview's "1-3" is the list's 1-3
  if (context.view.list.length) {
    const at = (id) => { const i = context.view.list.findIndex((r) => r.id === id); return i < 0 ? 1e9 : i; };
    edits.sort((a, b) => at(a.row.id) - at(b.row.id));
    removeIds.sort((a, b) => at(a) - at(b));
  }
  if (unknownIds && !p.strong) return { retry: 'it named an expense id that is not in the context', ops: summary };
  if (removeIds.length >= 3 && !p.strong) return { retry: `it would remove ${removeIds.length}: check each one is meant`, ops: summary };
  if (!p.sure && !p.strong && !edits.length && !removeIds.length && !adds.length && !questionsAsked.length) return { retry: 'it was not sure', ops: summary };

  // ONLY DROPPED: the draft as it is now
  if (dropped && !edits.length && !removeIds.length && !adds.length) {
    // "ACTUALLY NO, THE PETROL" is a swap, not only a drop: read again
    if (!p.strong && /\b(?:actually|instead|i meant|i mean|rather|meant)\b/i.test(said) && /\bthe\s+\w+/i.test(said)) {
      ctx.state.pending = pendingBefore;
      return { retry: 'it is a SWAP: drop the last one that waits AND do the same action on the one they name now', ops: summary };
    }
    const d = ctx.state.pending;
    if (!editItems(d).length && !(d.removes ?? []).length) { ctx.state.pending = null; return { reply: 'Okay, nothing is waiting now.', ops: summary }; }
    const was = pendingBefore?.kind === 'remove' ? pendingBefore.ids.length : editItems(pendingBefore).length + (pendingBefore?.removes ?? []).length;
    const gone = was - editItems(d).length - (d.removes ?? []).length;
    return { reply: `${gone > 1 ? `Left ${gone} out.` : 'Left that out.'}\n\n${format.editsPreview(editItems(d), { group: ctx.group === find.ALL, removes: d.removes ?? [] })}`, ops: summary };
  }
  // NOTHING TO DO BUT ASK
  if (!edits.length && !removeIds.length && !adds.length && !questionsAsked.length) {
    return asks.length ? { reply: asks.join('\n'), ops: summary } : { reply: null, ops: summary };
  }
  // ONLY QUESTIONS: answered
  if (!edits.length && !removeIds.length && !adds.length) {
    const replies = [];
    for (const q of questionsAsked) {
      // eslint-disable-next-line no-await-in-loop
      const r = quickRoute(q, { today: ctx.today, groups: ctx.groups, group: ctx.group }) ?? await route(q, { today: ctx.today, client: ctx.client, groups: ctx.groups });
      // eslint-disable-next-line no-await-in-loop
      if (r?.kind === 'question') replies.push(await questionReply(r, ctx, ctx.state.pending));
    }
    return replies.length ? { reply: replies.join('\n\n'), ops: summary } : { reply: null, ops: summary };
  }
  // ONLY NEW EXPENSES: the usual preview
  if (!edits.length && !removeIds.length) {
    if (ctx.state.pending?.kind === 'add') return { reply: null, ops: summary };
    return { reply: await addFrom({ text: adds.join('\n') }, ctx), ops: summary };
  }

  // CHANGES AND REMOVALS: one draft. New expenses waiting are set aside;
  // a removal or pick waiting joins the draft.
  const pending = ctx.state.pending;
  if (pending?.kind === 'add') { ctx.state.parked = pending; ctx.state.pending = null; ctx.parkedNow = true; }
  if (pending?.kind === 'remove') ctx.state.pending = { kind: 'edit', items: [], removes: pending.ids.map((id, i) => ({ id, before: pending.before[i] })) };
  if (pending?.kind === 'pick' || pending?.kind === 'undo' || pending?.kind === 'either') ctx.state.pending = null;
  let reply = null;
  for (const e of edits) {
    ctx.splitNow = e.splits ? { [e.row.id]: e.splits } : null;
    reply = editPreviewFor(e.row, e.changes, ctx);
  }
  ctx.splitNow = null;
  if (removeIds.length) {
    if (removeIds.length > 20) return { reply: await whichToRemove(ctx), ops: summary };
    const all = (await Promise.all([...new Set(removeIds)].map((id) => expensesRepo.findById(id)))).filter(Boolean);
    // settled ones are locked: left out, and said
    const rows = all.filter((r) => r.settle_status !== 'settled');
    if (rows.length < all.length) ctx.locked = [...new Set([...(ctx.locked ?? []), ...all.filter((r) => r.settle_status === 'settled').map((r) => r.description)])];
    const cur = ctx.state.pending?.kind === 'edit' ? ctx.state.pending : { kind: 'edit', items: [], removes: [] };
    const removes = [...(cur.removes ?? []), ...rows.filter((r) => !(cur.removes ?? []).some((x) => x.id === r.id)).map((r) => ({ id: r.id, before: SNAP(r) }))];
    // an expense removed is not also changed
    const items = editItems(cur).filter((x) => !removes.some((r) => r.id === x.id));
    ctx.state.pending = draft(items, removes, ctx.state.pending);
  }
  const plan = ctx.state.pending;
  if (plan?.kind !== 'edit' || (!editItems(plan).length && !(plan.removes ?? []).length)) return { reply: reply ?? (asks.length ? asks.join('\n') : null), ops: summary };
  const n = editItems(plan).length;
  const m = (plan.removes ?? []).length;
  const lead = ops.length > 1 || n + m > 1 ? `Got it: ${[n ? `${n} ${n === 1 ? 'change' : 'changes'}` : '', m ? `${m} to remove` : ''].filter(Boolean).join(' and ')}.\n\n` : '';
  reply = `${lead}${format.editsPreview(editItems(plan), { group: ctx.group === find.ALL, removes: plan.removes ?? [] })}`;
  if (asks.length) reply += `\n\n❓ ${asks.join('\n❓ ')}`;
  // new expenses said in the same message come right after this yes
  if (adds.length) {
    ctx.state.queue = [...(ctx.state.queue ?? []), adds.join('\n')];
    reply += `\n\n_Then I'll add the new ${adds.length === 1 ? 'one' : 'ones'} right after._`;
  }
  // questions in the same message: answered under it
  for (const q of questionsAsked) {
    const r = quickRoute(q, { today: ctx.today, groups: ctx.groups, group: ctx.group });
    // eslint-disable-next-line no-await-in-loop
    if (r?.kind === 'question') ctx.then = [...(ctx.then ?? []), await questionReply(r, ctx, null)];
  }
  return { reply, ops: summary };
}

/** A question answered; what waits said under it, still counted as shown. */
async function questionReply(r, ctx, pending) {
  // ctx.answer receives the same answer as a table, for the picture
  ctx.answer = {};
  /**
   * AS IF THE WAITING CHANGES WERE SAVED (his list 2026-10-08): "how much is
   * gloria's total after this?" counts the draft as done, and says so.
   */
  const asIf = pending?.kind === 'edit' && AS_IF.test(String(ctx.said ?? ''));
  let { query } = r;
  if (asIf) {
    const q2 = quickRoute(String(ctx.said).replace(AS_IF, ' ').replace(/\s+/g, ' ').trim(), { today: ctx.today, groups: ctx.groups, group: ctx.group });
    if (q2?.kind === 'question') query = q2.query;
  }
  const text = await find.answer(ctx.group, query, { today: ctx.today, out: ctx.answer, overlay: asIf ? { items: editItems(pending), removes: pending.removes ?? [] } : null });
  // WHAT WAS JUST SHOWN is what "it" means next ("show me the groceries",
  // then "bin it": his harness 2026-10-07 removed the last saved instead)
  if (ctx.answer.ids?.length && ctx.answer.ids.length <= 10) ctx.state.lastIds = ctx.answer.ids.filter(Boolean);
  // A NUMBERED LIST is the list on screen now: "1-3 spent by gloria" means these
  if (!asIf && ctx.answer.listIds?.length > 1) showList(ctx, ctx.answer.listIds.filter(Boolean));
  const waiting = pending?.kind === 'add' ? pending.items.filter((x) => !x.skipped).length : 0;
  const n = asIf ? editItems(pending).length + (pending.removes ?? []).length : 0;
  ctx.answer.note = asIf ? `\n\n_As if your ${n === 1 ? 'change was' : `${n} changes were`} saved. Nothing is saved yet: reply *yes* to save._`
    : waiting ? `\n\n_Not counted: ${waiting} in your preview, not saved yet. Reply *yes* to save them._`
      : pending ? `\n\n_${waitingLine(pending)}_` : '';
  // a question in between is not looking away: a yes after it still counts
  if (pending) ctx.keepShown = true;
  return `${text}${ctx.answer.note}`;
}

/** What waits, in one line, with what to reply. */
function waitingLine(p) {
  if (!p) return '';
  if (p.kind === 'add') {
    const n = p.items.filter((x) => !x.skipped).length;
    return `Still waiting from before: ${n} new ${n === 1 ? 'expense' : 'expenses'}, not saved yet. Reply *yes* to save, *show me the preview* to see ${n === 1 ? 'it' : 'them'}, or *cancel*.`;
  }
  if (p.kind === 'edit') {
    const items = editItems(p);
    const m = (p.removes ?? []).length;
    const what = [items.length === 1 && !m ? changeText(items[0]) : items.length ? `${items.length} ${items.length === 1 ? 'change' : 'changes'}` : '', m ? `${m} to remove` : ''].filter(Boolean).join(' and ');
    return `Still waiting: ${what}. Reply *yes* to save, or *cancel*.`;
  }
  if (p.kind === 'remove') return `Still waiting: removing ${p.ids.length === 1 ? (p.before?.[0]?.description ? `the *${p.before[0].description}*` : '1 expense') : `${p.ids.length} expenses`}. Reply *yes* to remove, or *cancel*.`;
  if (p.kind === 'pick') return `Still waiting: which one did you mean? Reply with its number (1–${p.choices.length}).`;
  if (p.kind === 'undo') return 'Still waiting: reply *yes* to undo, or *cancel*.';
  if (p.kind === 'settle') return `Still waiting: ${{ settled: 'settling', unsettled: 'reopening', review: 'marking for review' }[p.to]} ${p.ids.length} ${p.ids.length === 1 ? 'expense' : 'expenses'}. Reply *yes*, or *cancel*.`;
  return '';
}

/** "your change to the Groceries", for the note when it is set aside. */
function keptWhat(p) {
  if (!p) return 'what was waiting';
  if (p.kind === 'add') return `your ${p.items.filter((x) => !x.skipped).length} new expense(s)`;
  if (p.kind === 'edit') {
    const items = editItems(p);
    const m = (p.removes ?? []).length;
    if (!items.length && m) return m === 1 ? `the removal of the *${p.removes[0].before.description}*` : `the ${m} removals`;
    return items.length === 1 && !m ? `your change to the *${items[0].before.description}*` : `your ${items.length + m} changes`;
  }
  if (p.kind === 'remove') return p.ids.length === 1 ? `the removal of the *${p.before?.[0]?.description ?? 'expense'}*` : `the ${p.ids.length} removals`;
  return 'what was waiting';
}

/** "change the Groceries to AED 300.00", from a waiting change. */
function changeText(x) {
  const b = x.before ?? {};
  const bits = Object.entries(x.fields ?? {}).map(([f, v]) => (f === 'rawAmount' ? `*${format.money(x.fields.currency ?? b.currency, v)}*`
    : f === 'spentOn' ? `the date to *${format.day(v)}*` : f === 'currency' ? null : `${format.LABEL[f] ?? f} to *${v}*`)).filter(Boolean);
  return `change the *${b.description ?? 'expense'}* to ${bits.join(' and ') || 'what you said'}`;
}

/** The ones from this month: "the groceries" usually means this month's. */
const thisMonth = (hits, today) => hits.filter((h) => String(h.spentOn ?? '').slice(0, 7) === String(today).slice(0, 7));

/** "a, b and c" */
const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');

/** "Which ones?", with the latest to point at. */
async function whichToRemove(ctx) {
  const pickFrom = await recentToPick(ctx);
  if (!pickFrom.rows.length) return 'There are no expenses in the last 2 months to remove.';
  ctx.state.awaiting = 'remove';
  showList(ctx, pickFrom.rows.map((r) => r.id));
  return [`Which ones should I remove? ${pickFrom.heading}`, '', ...pickFrom.lines, '',
    'Reply with their numbers, like _2 and 3_, or say them, like _remove the cleaner and the petrol_.'].join('\n');
}

const REMOVE_ALL_OF_THEM = /^(?:(?:yes|ok(?:ay)?|sure|yeah)[,!.\s]+)?(?:(?:remove|delete)\s+)?(?:both|them(?: all)?|all(?: of them)?|those|these|both of them)(?:\s+(?:please|pls|now))?[.!]*$/i;
const NOT_THIS = /^(?:not|but not|except|leave|keep|don'?t remove)\s+(?:the\s+)?(.+)$/i;

/**
 * MORE FOR A REMOVAL, OR ITS YES (his report 2026-10-07): "yes and remove
 * the taxi too", "remove both", "not the cleaner", or the list copied back.
 * Every expense named joins the same preview, for one "yes". Null when the
 * message is not about what to remove.
 */
async function moreToRemove(said, ctx, { fresh = false } = {}) {
  // every way of saying remove ("bin the petrol"), and "too" / "pls" anywhere
  const text = canonicalVerbs(String(said ?? '').trim());
  const pending = fresh ? null : ctx.state.pending;
  if (pending && REMOVE_ALL_OF_THEM.test(text)) return onReply({ kind: 'yes' }, ctx);
  const current = pending ? (await Promise.all(pending.ids.map((id) => expensesRepo.findById(id)))).filter(Boolean) : [];
  // "REMOVE EXPENSES" while some wait: the list to pick from, the ones waiting kept
  if (pending && REMOVE_WHICH.test(text)) {
    return `${await whichToRemove(ctx)}\n\n_${current.length === 1 ? '1 is' : `${current.length} are`} waiting to be removed: add more, or reply *yes*._`;
  }
  // "NOT THE CLEANER": one out of the removal
  const not = pending && NOT_THIS.exec(text);
  if (not) {
    const words = find.wordsOf(not[1]);
    const keep = current.filter((r) => !words.every((w) => find.wordsOf(`${r.description} ${r.payee}`).some((h) => h === w || h.startsWith(w))));
    if (keep.length === current.length) return `The *${not[1].replace(/[.!]+$/, '')}* isn't in this list.\n\n${removePreviewFor(current, ctx)}`;
    if (!keep.length) { ctx.state.pending = null; return 'Okay, nothing will be removed.'; }
    return `Left that one out.\n\n${removePreviewFor(keep, ctx)}`;
  }
  // "ACTUALLY NO, THE PETROL": that one instead of the last one added
  const swap = pending && /^(?:(?:actually|no|sorry|oops|wait)[,!.\s]+)+(?:i meant\s+|i mean\s+)?(?:the\s+)?([a-z][\w\s'&.-]{1,40})$/i.exec(text);
  if (swap) {
    const hits = thisMonthOr(await find.findTarget(ctx.group, { words: swap[1] }, { today: ctx.today }), ctx.today);
    if (hits.length === 1) {
      const rows = [...current.slice(0, -1).filter((r) => r.id !== hits[0].id), await expensesRepo.findById(hits[0].id)].filter(Boolean);
      return `Swapped it.\n\n${removePreviewFor(rows, ctx)}`;
    }
  }
  // A CHANGE WHILE A REMOVAL WAITS: right after it, said plainly
  if (pending && quickRoute(said, { today: ctx.today, group: ctx.group })?.kind === 'edit' && /^(?:change|update|set|make|correct)\b/i.test(text)) {
    ctx.state.queue = [...(ctx.state.queue ?? []), text].slice(0, 3);
    return `Sure, I'll do that change right after. First, reply *yes* to remove ${current.length === 1 ? 'it' : `the ${current.length}`}, or *cancel*.`;
  }
  if (pending && !/^\s*and\b|\b(?:remov\w*|remo[a-z]{0,3}|delete|also|too|as well|plus)\b|•|\n/i.test(text)) return null;
  const targets = find.targetsIn(text, year(ctx.today), ctx.today);
  if (!targets.length) return null;
  const added = [];
  const missed = [];
  const unsure = [];
  for (const t of targets) {
    // eslint-disable-next-line no-await-in-loop
    const found = await find.findTarget(ctx.group, t, { today: ctx.today });
    // one of them this month: that one, as "the taxi" means this month's
    const here = thisMonth(found, ctx.today);
    const hits = found.length > 1 && here.length === 1 ? here : found;
    if (hits.length === 1) added.push(hits[0].id);
    else if (hits.length > 1) unsure.push(hits);
    if (hits.length !== 1) {
      // the words they used, and the ones it could be: they pick by day
      const what = `${t.words || ''}${t.date ? ` on ${format.day(t.date)}` : ''}`.trim() || t.said;
      missed.push(hits.length
        ? `*${hits.length} ${what}*: ${hits.slice(0, 3).map((h) => `${format.day(h.spentOn)} ${format.money(h.currency, h.rawAmount)}`).join(' · ')}`
        : `nothing matches _${what.slice(0, 50)}_`);
    }
  }
  const ids = [...new Set([...current.map((r) => r.id), ...added])];
  /**
   * ONE NAMED THAT COULD BE SEVERAL ("remove the lunch", two this month):
   * asked which, and everything already waiting stays waiting with it
   */
  if (unsure.length === 1 && missed.length === 1) {
    const reply = pick(thisMonth(unsure[0], ctx.today).length > 1 ? thisMonth(unsure[0], ctx.today) : unsure[0], { kind: 'remove' }, 'should I remove', ctx);
    ctx.state.pending.extraIds = ids;
    return ids.length ? `${reply}\n\n_${ids.length === 1 ? '1 more is' : `${ids.length} more are`} waiting to be removed with it._` : reply;
  }
  if (!ids.length) return missed.length ? `Which one? ${missed.join('; ')}. Say the day, like _remove the cleaner on 7 Oct_.` : null;
  const rows = (await Promise.all(ids.map((id) => expensesRepo.findById(id)))).filter(Boolean);
  const newOnes = added.filter((id) => !current.some((r) => r.id === id)).length;
  const lead = [
    pending && newOnes ? `Added ${newOnes} to remove.` : null,
    missed.length ? `⚠️ Not added yet: ${missed.join('; ')}. Say the day, like _also the cleaner on 7 Oct_.` : null,
  ].filter(Boolean).join(' ');
  return `${lead ? `${lead}\n\n` : ''}${removePreviewFor(rows, ctx)}`;
}

function removePreviewFor(rows, ctx) {
  // SETTLED IS LOCKED: left out, and said
  const locked = rows.filter((r) => r.settle_status === 'settled');
  if (locked.length) {
    ctx.locked = [...new Set([...(ctx.locked ?? []), ...locked.map((r) => r.description)])];
    rows = rows.filter((r) => r.settle_status !== 'settled');
    if (!rows.length) return `🔒 ${locked.length === 1 ? `The *${locked[0].description}* is` : `Those ${locked.length} are`} settled (refunded), so ${locked.length === 1 ? 'it' : 'they'} can't be removed. The CRM admin can reopen ${locked.length === 1 ? 'it' : 'them'}.`;
  }
  ctx.state.pending = { kind: 'remove', ids: rows.map((r) => r.id), before: rows.map(SNAP) };
  return format.removePreview(rows.map(find.asItem), { group: ctx.group === find.ALL });
}

async function saveRemove(ctx) {
  const { ids, before } = ctx.state.pending;
  for (let i = 0; i < ids.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const why = await stale(ids[i], before[i]);
    if (why) { ctx.state.pending = null; return `Nothing was removed: ${why}. Ask again and I'll show it as it is now.`; }
  }
  const gone = [];
  // the receipt FILE stays for now, so "undo" can bring it back with the
  // expense; it goes with its month (3 months)
  const paths = new Map();
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    paths.set(id, (await expensesRepo.findById(id))?.receipt_path ?? null);
    // eslint-disable-next-line no-await-in-loop
    if (await expensesRepo.remove(id)) gone.push(id);
  }
  const left = (await Promise.all(ids.map((id) => expensesRepo.findById(id)))).filter(Boolean);
  await store.recordAction(require('../../../configs/db'), {
    phone: ctx.phone, group: ctx.group, kind: 'remove', changes: ids.filter((id) => gone.includes(id)).map((id) => ({ id, before: before[ids.indexOf(id)], receiptPath: paths.get(id) })),
    summary: `${before.slice(0, 4).map((b) => `${b.description} · ${format.money(b.currency, b.rawAmount)}`).join(', ')}${before.length > 4 ? ` and ${before.length - 4} more` : ''}`,
  });
  broadcast(null, EVENT, { action: 'deleted', count: gone.length, via: 'whatbot' });
  ctx.state.pending = null;
  if (left.length) return `⚠️ ${left.length} could not be removed. Please check the Expenses page.`;
  return format.removed(before);
}

// ---- undo: always asks ----

const COUNT_WORD = { two: 2, three: 3, four: 4, five: 5 };

async function startUndo(ctx, said = ctx.said) {
  const t = String(said ?? '').trim();
  /**
   * "UNDO ONLY 2", "undo 2 and 3" (his list 2026-10-08): those lines of the
   * last thing done, as numbered in its ✅ message; the rest stay.
   */
  const some = /^(?:(?:pls|please)\s+)?(?:(?:only|just)\s+)?(?:undo|revert|put back|take back)\s+(?:only\s+|just\s+)?(?:no\.?\s*|#|numbers?\s+)?([\d\s,&\-–to]+?(?:\s*and\s*\d+)?)[.!]*$/i.exec(t);
  if (some && numberSet(some[1])) {
    const ns = numberSet(some[1]);
    const action = await store.lastAction(ctx.phone, ctx.group);
    if (!action) return 'There is nothing of yours to undo.';
    const open = (action.changes ?? []).filter((c) => !c.created);
    if (!ns.every((n) => n >= 1 && n <= open.length)) return `The last thing you did had ${open.length} ${open.length === 1 ? 'line' : 'lines'}. Pick from 1–${open.length}, like *undo only 2*.`;
    if (ns.some((n) => open[n - 1].undone)) return `No. ${ns.find((n) => open[n - 1].undone)} was already undone.`;
    ctx.state.pending = { kind: 'undo', actionId: action.id, only: ns };
    return format.undoPreview({ kind: action.kind, summary: `No. ${format.ranges(ns)}: ${actionText({ ...action, changes: open }, ns)}` });
  }
  // "UNDO THE LAST 2 THINGS": that many of theirs, newest first
  const lastN = /^(?:undo|revert)\s+(?:the\s+)?last\s+(\d+|two|three|four|five)\s+(?:things|changes|actions|ones|saves|edits)\b/i.exec(t);
  if (lastN) {
    const n = Math.min(COUNT_WORD[lastN[1].toLowerCase()] ?? Number(lastN[1]), 10);
    const recent = await store.recentActions(ctx.phone, ctx.group, n);
    if (!recent.length) return 'There is nothing of yours to undo.';
    ctx.state.pending = { kind: 'undo', actionIds: recent.map((a) => a.id) };
    return format.undoPreview({ kind: 'many', summary: `${recent.length === n ? `the last ${n}` : `only ${recent.length} to undo`}:\n${recent.map((a, i) => `${i + 1}. ${actionText(a)}`).join('\n')}` });
  }
  // "UNDO THE CLEANER REMOVAL", "undo the gloria change": the latest of
  // theirs that names it in what it was OR what it became
  const words = find.wordsOf(t.replace(/\b(?:undo|revert|restore|bring|put|get|take|back|it|that|them|those|this|please|pls|removal|removed|remove|deletion|deleted|delete|change|changed|changes|edit|update|saving|saved|save|added|add|split|the|my|last)\b/gi, ' '));
  let action = null;
  if (words.length) {
    const recent = await store.recentActions(ctx.phone, ctx.group, 15);
    action = recent.find((a) => {
      const text = find.wordsOf(`${a.summary} ${(a.changes ?? []).map((c) => Object.values(c.after ?? {}).join(' ')).join(' ')}`);
      return words.every((w) => text.some((h) => h === w || h.startsWith(w) || w.startsWith(h)));
    }) ?? null;
    // NOTHING AT ALL to undo is said plainly, as plain "undo" says it; their
    // sentence read back as keywords ("about _name gloria not spent_") was
    // noise (two agent test 2026-10-09).
    if (!action && !recent.length) return 'There is nothing of yours to undo.';
    if (!action) return `None of your recent changes is about that. Your last one: ${actionText(recent[0])}. Say *undo* to take it back.`;
  } else {
    action = await store.lastAction(ctx.phone, ctx.group);
  }
  if (!action) return 'There is nothing of yours to undo.';
  ctx.state.pending = { kind: 'undo', actionId: action.id };
  return format.undoPreview(action);
}

async function saveUndo(ctx) {
  const { actionId, actionIds, only } = ctx.state.pending;
  ctx.state.pending = null;
  const out = [];
  for (const id of actionIds ?? [actionId]) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await undoOne(id, ctx, only ?? null));
  }
  if (out.length === 1) return out[0];
  return out.map((x, i) => `${i + 1}. ${x}`).join('\n');
}

/** One action taken back, whole or only some of its lines. */
async function undoOne(actionId, ctx, only) {
  const pool = require('../../../configs/db');
  const { rows } = await pool.query('SELECT * FROM tb_expense_actions WHERE id = $1 AND undone_at IS NULL', [actionId]);
  const action = rows[0];
  if (!action) return 'That was already undone. Nothing changed.';
  const done = [];
  const skipped = [];
  // the numbered lines are the ones not split off; a split's new one goes with its line
  const open = action.changes.filter((c) => !c.created);
  const chosen = only ? new Set(only.map((n) => open[n - 1]).filter(Boolean)) : null;
  for (const c of action.changes) {
    /* eslint-disable no-await-in-loop */
    if (c.undone) continue;
    if (chosen && !chosen.has(c) && !(c.created && [...chosen].some((x) => x.id === c.from))) continue;
    c.undone = true;
    if (action.kind === 'add') {
      const now = await expensesRepo.findById(c.id);
      if (!now) continue;
      if (!same(now, c.after)) { skipped.push(c.after.description); continue; }
      // a REPLACED one goes back to what it was; a new one is taken back,
      // and its receipt file and fingerprint with it
      if (c.replaced && c.before) await expensesRepo.update(c.id, c.before);
      else {
        await receipts.forget(now);
        await expensesRepo.remove(c.id);
      }
      done.push(c.id);
    } else if (action.kind === 'edit' && c.created) {
      // a split's new expense: taken back, unless it changed since
      const now = await expensesRepo.findById(c.id);
      if (!now) continue;
      if (!same(now, c.after)) { skipped.push(c.after.description); continue; }
      await expensesRepo.remove(c.id);
      done.push(c.id);
    } else if (action.kind === 'edit' && c.removed) {
      const back = await expensesRepo.create(c.before);
      await receipts.reattach(c.id, back.id, c.receiptPath ?? null).catch(() => null);
      done.push(back.id);
    } else if (action.kind === 'edit') {
      const now = await expensesRepo.findById(c.id);
      if (!now) { skipped.push(c.before.description); continue; }
      if (!same(now, c.after)) { skipped.push(c.before.description); continue; }
      await expensesRepo.update(c.id, c.before);
      done.push(c.id);
    } else if (action.kind === 'remove') {
      const back = await expensesRepo.create(c.before);
      // its receipt comes back with it
      await receipts.reattach(c.id, back.id, c.receiptPath ?? null).catch(() => null);
      done.push(back.id);
    }
    /* eslint-enable no-await-in-loop */
  }
  // SOME LINES: the rest stay undoable; all of them, and the action is done
  const whole = action.changes.every((c) => c.undone);
  await pool.query(`UPDATE tb_expense_actions SET changes = $2${whole ? ', undone_at = now()' : ''} WHERE id = $1`, [action.id, JSON.stringify(action.changes)]);
  await store.recordAction(pool, { phone: ctx.phone, group: ctx.group, kind: 'undo', changes: [{ undid: action.id, only }], summary: `undid${only ? ` No. ${format.ranges(only)} of` : ''}: ${action.summary}` });
  broadcast(null, EVENT, { action: 'reverted', via: 'whatbot' });
  ctx.state.lastIds = [];
  const verb = { add: 'Taken back', edit: 'Put back', remove: 'Brought back' }[action.kind];
  const what = only ? `No. ${format.ranges(only)} (${done.length} ${done.length === 1 ? 'expense' : 'expenses'})${whole ? '' : '. The rest stay as they are'}` : action.summary;
  return `✅ *${verb}:* ${what}${skipped.length ? `\n⚠️ Left alone, changed since: ${skipped.join(', ')}` : ''}`;
}

// ---- helpers ----

function pick(hits, then, what, ctx) {
  const list = hits.slice(0, 8);
  // CHANGES ALREADY WAITING stay waiting through the pick
  if (then.kind === 'edit' && ctx.state.pending?.kind === 'edit') then.keepItems = editItems(ctx.state.pending);
  // what it is about, so a new request while it waits is told apart
  ctx.state.pending = { kind: 'pick', choices: list.map((h) => h.id), then, label: [...new Set(list.map((h) => `${h.description} ${h.payee ?? ''}`))].join(' ') };
  return format.pickList(list, what, { group: ctx.group === find.ALL });
}

async function notFound(ctx) {
  // ANOTHER GROUP NAMED: said plainly, not "not found"
  if (ctx.group !== find.ALL) {
    const other = (await knownGroups().catch(() => [])).find((g) => g.toUpperCase() !== String(ctx.group).toUpperCase()
      && new RegExp(`\\b${g.replace(/[^a-z0-9 ]/gi, '')}\\b`, 'i').test(String(ctx.said ?? '')));
    if (other) return `On this number you can only manage *${ctx.group}* expenses. *${other}* ones go through the ${other} number, or Diane in the CRM.`;
  }
  const recent = await find.latest(ctx.group, ctx.today);
  const whose = ctx.group === find.ALL ? 'the' : `*${ctx.group}*'s`;
  if (!recent.length) return `I couldn't find that. There are no expenses ${ctx.group === find.ALL ? '' : `for *${ctx.group}* `}in the last 2 months.`;
  return [`I couldn't find that in ${whose} expenses from the last 2 months. The latest:`, '', ...recent.map((r) => format.line({ ...r, n: null }, { number: false, group: ctx.group === find.ALL })), '', 'Say which one, like _change the taxi on 6 Oct to 50_.'].join('\n');
}

module.exports = { turn, SNAP, editish };
