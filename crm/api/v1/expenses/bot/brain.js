const expensesRepo = require('../../repos/expenses.repo');
const { broadcast } = require('../../sockets/index');
const { currentDay } = require('../../shared/presetMonth.helper');
const logger = require('../../../configs/logger');
const store = require('./store');
const format = require('./format');
const { extract } = require('./extract');
const { normalise, duplicates, ready, currencyOf, num, exactCopy } = require('./check');
const { readReply } = require('./reply');
const { route, revise } = require('./understand');
const find = require('./find');
const { liveRates } = require('./rates');
const receipts = require('./receipts');
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
});
const same = (a, b) => JSON.stringify(SNAP(a)) === JSON.stringify(SNAP(b));

const GREETING = /^(?:hi+|hello+|hey+|hiya|salam|assalam[ou]?\s*alaikum|good (?:morning|afternoon|evening)|help|menu|start|what can you do\??)[!. ]*$/i;
const THANKS = /^(?:thanks?(?: you)?|thank u|thx|ty|cheers|great|perfect|nice|cool|ok thanks|👍🏻?|🙏)[!. ]*$/i;
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
const UNDO = /^(?:undo(?: (?:that|it|this|last|the last one))?|take (?:it|that|them) back|put (?:it|that) back|revert(?: that| it)?)[!. ]*$/i;

/**
 * @param {{ phone: string, group: string, text?: string, attachments?: object[] }} msg
 * @param {{ client?: object, today?: string }} opts `client` for tests
 * @returns {Promise<{ registered: boolean, reply?: string }>}
 */
const PREVIEWS = /_Not (?:saved|removed|changed) yet_|_Nothing changed yet_|WHICH ONE /;

function showAgain(ctx) {
  const p = ctx.state.pending;
  const again = p.kind === 'add' ? format.addPreview(p.items, ctx.group)
    : p.kind === 'edit' ? format.editPreview({ ...p.before, n: null }, p.fields)
      : p.kind === 'remove' ? format.removePreview(p.before)
        : p.kind === 'undo' ? 'Undo the last thing you did?\nReply *yes* to undo it, or *cancel*.' : null;
  return again ? `Just to be sure, this is still waiting:\n\n${again}` : 'Okay.';
}

async function turn(msg, { client = null, today = currentDay(), channel = 'whatsapp' } = {}) {
  // 1. THE GUARD. Before anything is read. The command center has its own:
  // the admin's signed-in session, every group, and no spender assumed.
  const admin = channel === 'diane'
    ? { name: null, phone: 'diane', group_name: find.ALL }
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
  const heldBefore = state.pending?.kind === 'add' ? JSON.stringify(state.pending.items.map(({ n, spentOn, rawAmount, currency, payee, description, skipped }) => [n, spentOn, rawAmount, currency, payee, description, skipped])) : null;
  try {
    reply = await answerTurn(said, files, ctx);
    /**
     * SENT AGAIN, CHANGED NOTHING (his call 2026-10-07): the same expenses
     * typed while their preview is open re-showed it as if new. Now it says
     * so. Only for a message with figures in it, never "yes" or "show it".
     */
    const heldAfter = state.pending?.kind === 'add' ? JSON.stringify(state.pending.items.map(({ n, spentOn, rawAmount, currency, payee, description, skipped }) => [n, spentOn, rawAmount, currency, payee, description, skipped])) : null;
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
  // THE RATES BUBBLE after a preview with other currencies in it: a second
  // message, so the rates read on their own (his call 2026-10-07).
  const more = [];
  if (state.pending?.kind === 'add' && PREVIEWS.test(String(reply ?? ''))) {
    const bubble = format.ratesBubble(state.pending.items);
    if (bubble) more.push(bubble);
  }
  if (reply === HAND_OFF) {
    if (state.pending) state.pending.shownLast = false;
    await store.saveChat(phone, group, state);
    return { registered: true, handOff: true };
  }
  if (expired && reply) reply = `${expired}${reply}`;
  // Was the open preview the last thing they saw? A "yes" counts only then.
  if (state.pending) state.pending.at = state.pending.at ?? Date.now();
  // looking at a receipt is not looking away: a yes after it still counts
  if (state.pending) state.pending.shownLast = PREVIEWS.test(String(reply ?? '')) || (/^🧾 Receipt for/.test(String(reply ?? '')) && Boolean(state.pending.shownLast));
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
  try {
    const savedNow = /^✅ \*SAVED ·/.test(String(reply ?? '')) && savedItems?.length;
    const previewNow = state.pending?.kind === 'add' && /_Not saved yet_/.test(String(reply ?? '')) && !/^Just to be sure/.test(String(reply ?? ''));
    if (previewNow || savedNow) {
      const style = await settingsRepo.expenseStyle();
      const items = savedNow ? savedItems : state.pending.items;
      const pngs = renderCards(items, { group, saved: Boolean(savedNow), style, today });
      if (pngs.length) {
        [image, ...extraImages] = pngs.map((png, i) => ({ base64: png.toString('base64'), mime: 'image/png', filename: `expenses-${i + 1}.png`, saved: Boolean(savedNow) }));
        const lead = /^(?:Added \d+ more|Those (?:were|are) (?:all )?already)[^\n]*\n\n/.exec(String(reply))?.[0] ?? '';
        // what is STILL WAITING after "save the rest" rides under the caption
        const tail = /\n\n⏳[\s\S]*$/.exec(String(reply))?.[0] ?? '';
        text = `${lead}${format.caption(items, group, { saved: Boolean(savedNow) })}${tail}`;
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
    registered: true, reply: text, replies: [text, ...more], ...(image ? { image } : {}), ...(extraImages.length ? { moreImages: extraImages } : {}), ...(receiptOut ? { receipt: receiptOut } : {}),
  };
}

async function answerTurn(said, files, ctx) {
  const { state, admin, group, today } = ctx;
  const pending = state.pending ?? null;

  // 2. CODE FIRST: an answer to what is open.
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
  if (GREETING.test(said)) {
    const lastBot = String(state.history?.at(-1)?.reply ?? '');
    if (/I'll save it|I'll save them to the CRM|Hi again/.test(lastBot)) {
      return pending ? 'Hi again! Your preview is still waiting: reply *yes*, *modify* or *cancel*.' : 'Hi again! Send an expense whenever you\'re ready.';
    }
    return ctx.channel === 'diane' ? format.HELP_DIANE : format.HELP(admin.name.split(' ')[0], group);
  }
  if (THANKS.test(said) && !pending) return 'You\'re welcome 🙂';
  // "SHOW ME THE RECEIPT FOR 4" / "...for the careem taxi" (his call 2026-10-07)
  if (RECEIPT_ASK.test(said)) return receiptFor(said, ctx);
  if (SHOW_PREVIEW.test(said)) {
    return pending?.kind === 'add' ? format.addPreview(pending.items, group) : 'There is no preview open right now. Send an expense, a receipt photo or a file and I\'ll show you one.';
  }
  if (UNDO.test(said)) return startUndo(ctx);

  // A PLAIN NEW EXPENSE ("taxi 45 paid to Careem") needs no router: an
  // amount, nothing open, and no word that edits, removes or asks.
  if (!pending && /\d/.test(said) && !EDIT_WORDS.test(said) && !editish(said)) return addFrom({ text: said }, ctx);

  // 3. THE ROUTER.
  const lastReply = state.history?.at(-1)?.reply ?? '';
  const r = await route(said, { today, pending: pending?.kind === 'add', lastReply, client: ctx.client, groups: ctx.groups });
  logger.info({ group, kind: r.kind, sure: r.sure }, 'expense bot: routed');
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
    case 'question': {
      // ctx.answer receives the same answer as a table, for the picture
      ctx.answer = {};
      const text = await find.answer(group, r.query, { today, out: ctx.answer });
      const waiting = pending?.kind === 'add' ? pending.items.filter((x) => !x.skipped).length : 0;
      ctx.answer.note = waiting ? `\n\n_Not counted: ${waiting} in your preview, not saved yet._` : '';
      return `${text}${ctx.answer.note}`;
    }
    case 'undo': return startUndo(ctx);
    case 'chat': {
      if (THANKS.test(said)) return 'You\'re welcome 🙂';
      // A PREVIEW IS WAITING: say that, not the whole help (2026-10-07)
      if (pending?.kind === 'add') {
        const live = pending.items.filter((x) => !x.skipped);
        const open = format.questions(live);
        return [`${live.length} ${live.length === 1 ? 'expense is' : 'expenses are'} still waiting, not saved yet.`, ...(open.length ? open : []), '', 'Reply *yes* to save · *show me the preview* · *cancel*'].join('\n');
      }
      return ctx.channel === 'diane' ? format.HELP_DIANE : format.HELP(admin.name.split(' ')[0], group);
    }
    default:
      if (ctx.channel === 'diane') return 'That isn\'t about expenses. Switch the context to Master sheet for deals, people and companies.';
      // NOT ABOUT EXPENSES ("how much am I getting paid?"): WhatBot's own
      // agent answers it, his call 2026-10-07. Nothing here is touched.
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

/** Check every item again: fields, defaults, duplicates against what is saved. */
async function recheck(items, ctx) {
  const r = await rates();
  // Today's market rate for every other currency in the batch.
  const live = await liveRates(items.map((x) => currencyOf(x.currency) ?? 'AED'));
  const known = await knownNames();
  const out = items.map((x) => normalise({ ...x, doubt: x.modelDoubt }, { admin: ctx.admin, group: ctx.group, groups: ctx.groups, rates: r, live, known, today: ctx.today }))
    .map((x, i) => ({ ...x, modelDoubt: items[i].modelDoubt ?? null }));
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
      // the receipt says it better than "looks already saved": one note
      x.doubts = x.doubts.filter((d) => !/^looks already saved/.test(d));
      x.doubts.push(`same receipt as one saved on ${format.day(String(hit.spent_on instanceof Date ? hit.spent_on.toISOString() : hit.spent_on).slice(0, 10))} (${hit.payee || 'no payee'}, ${format.money(hit.currency, Number(hit.raw_amount))})`);
      x.flag = true;
    }
  }
  return checked;
}

async function addFrom(msg, ctx) {
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
  ctx.state.pending = { kind: 'add', items };
  // THE NEW NUMBERS, named: they think of these as "1 and 2" of the message
  // they just sent, and the list calls them 2 and 3.
  const nums = fresh.map((x) => x.n);
  const skippedNote = dropped ? ` Skipped ${dropped} already in this preview.` : '';
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
  ctx.state.pending = { kind: 'add', items: checked };
  // NEVER SAVED FROM AN ANSWER. "they're all new ones" and "1 milkman nadia
  // r, yes its right" saved at once, unseen (test sweep 2026-10-07). Changed
  // things are always shown again, and only a plain yes saves.
  return format.addPreview(checked, ctx.group);
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
      `Reply with the answers (like *${waiting[0].n} paid to Careem*), *skip ${format.ranges(waiting.map((x) => x.n))}*${ready ? `, or *save the rest* to save the ${ready} ready ${ready === 1 ? 'one' : 'ones'} now and keep ${waiting.length === 1 ? 'that one' : 'these'} waiting` : ''}.`,
    ].join('\n');
  }
  const made = await expensesRepo.createMany(items.map((x) => ({
    spentOn: x.spentOn, description: x.description, payee: x.payee, currency: x.currency, rawAmount: x.rawAmount,
    exchangeRate: x.exchangeRate, groupName: x.groupName ?? ctx.group, spentBy: x.spentBy, category: x.category ?? null,
  })));
  // THE RECEIPTS GO WITH THEM, into this month's folder (receipts.js). A
  // receipt that cannot be kept never undoes a saved expense; it is logged.
  for (const [i, x] of items.entries()) {
    if (!x.receipt || !made[i]) continue;
    // eslint-disable-next-line no-await-in-loop
    await receipts.keep(x.receipt, made[i]).catch((err) => logger.warn({ err: err.message, id: made[i].id }, 'expense bot: a receipt could not be kept'));
  }
  // VERIFIED: read back from the table, never assumed.
  const check = await Promise.all(made.map((m) => expensesRepo.findById(m.id)));
  if (check.some((c) => !c) || made.length !== items.length) {
    logger.error({ group: ctx.group, asked: items.length, made: made.length }, 'expense bot: save did not verify');
    return `⚠️ Only ${check.filter(Boolean).length} of ${items.length} could be confirmed saved. Please check the Expenses page.`;
  }
  await store.recordAction(require('../../../configs/db'), {
    phone: ctx.phone, group: ctx.group, kind: 'add', changes: made.map((m) => ({ id: m.id, after: SNAP(m) })),
    summary: `${made.map((m) => `${m.description} · ${format.money(m.currency, m.raw_amount)}`).slice(0, 4).join(', ')}${made.length > 4 ? ` and ${made.length - 4} more` : ''}`,
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
    return pending.kind === 'add'
      ? 'Sure, what should change? Just say it, like _the taxi was 50_, _the lunch was yesterday_ or _leave out the parking_.'
      : 'Sure, what should it be instead? Just say it, like _make it 50_ or _it was on 5 Oct_.';
  }
  if (r.kind === 'no') { ctx.state.pending = null; return `Okay, cancelled. Nothing was ${pending.kind === 'remove' ? 'removed' : pending.kind === 'add' ? 'saved' : 'changed'}.`; }
  if (pending.kind === 'pick') {
    const id = pending.choices[r.n - 1];
    const row = await expensesRepo.findById(id);
    if (!row) { ctx.state.pending = null; return 'That expense is no longer there. Nothing was changed.'; }
    return pending.then.kind === 'edit' ? editPreviewFor(row, pending.then.changes, ctx) : removePreviewFor([row], ctx);
  }
  if (r.kind === 'saveReady') {
    if (pending.kind !== 'add') return 'There is nothing waiting to save.';
    return saveAdd(ctx, { readyOnly: true });
  }
  if (r.kind === 'yes') {
    // ONLY WHAT WAS SHOWN LAST. Another reply came in between, so this yes
    // may not be about the preview: it is shown again, and the next yes saves.
    if (pending.shownLast === false) return showAgain(ctx);
    if (pending.kind === 'add') return saveAdd(ctx);
    if (pending.kind === 'edit') return saveEdit(ctx);
    if (pending.kind === 'remove') return saveRemove(ctx);
    if (pending.kind === 'undo') return saveUndo(ctx);
  }
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
  }
  if (r.kind === 'skip' && r.bulk && !r.which.length) {
    return r.bulk === 'saved' ? 'None of them look already saved, so nothing was skipped.' : 'There are no copies in this preview, so nothing was skipped.';
  }
  if (r.kind === 'skip') for (const n of r.which) items.find((x) => x.n === n).skipped = true;
  if (r.kind === 'unskip') for (const n of r.which) items.find((x) => x.n === n).skipped = false;
  if (r.kind === 'only') for (const x of items) x.skipped = !r.which.includes(x.n);
  if (r.kind === 'fix') {
    for (const part of r.parts) applyFix(items, part, ctx.today);
    for (const n of r.ok ?? []) { const x = items.find((i) => i.n === n); if (x) { x.ok = true; x.modelDoubt = null; } }
  }
  const checked = await recheck(items, ctx);
  ctx.state.pending = { kind: 'add', items: checked };
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
    out[c.field] = v;
  }
  return out;
}

async function startEdit(r, ctx) {
  const changes = changesFrom(r.changes, ctx.today);
  if (!Object.keys(changes).length) return 'What should it change to? For example _change the taxi to 50_ or _the lunch was on 5 Oct_.';
  /**
   * MORE FOR THE SAME CHANGE: "change the taxi to 50", then "and the
   * spender is Leo P", lost the 50; "and paid to costa" changed the
   * description (test sweep 2026-10-07). With a change open and no other
   * expense named, the new part joins it.
   */
  const open = ctx.state.pending?.kind === 'edit' ? ctx.state.pending : null;
  if (open) {
    const row = await expensesRepo.findById(open.id);
    const words = String(r.target?.words ?? '').toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
    const sameOne = !words.length || words.some((w) => `${row?.description ?? ''} ${row?.payee ?? ''}`.toLowerCase().includes(w));
    if (row && sameOne) return editPreviewFor(row, { ...open.fields, ...changes }, ctx);
  }
  const hits = await find.findTarget(ctx.group, r.target, { today: ctx.today, lastIds: ctx.state.lastIds ?? [] });
  if (!hits.length) return notFound(ctx);
  if (hits.length > 1) return pick(hits, { kind: 'edit', changes }, 'should I change', ctx);
  return editPreviewFor(await expensesRepo.findById(hits[0].id), changes, ctx);
}

function editPreviewFor(row, changes, ctx) {
  const before = SNAP(row);
  const fields = Object.fromEntries(Object.entries(changes).filter(([f, v]) => String(before[f] ?? '') !== String(v)));
  if (!Object.keys(fields).length) { ctx.state.pending = null; return 'It already says that, so nothing needs changing.'; }
  ctx.state.pending = { kind: 'edit', id: row.id, before, fields };
  return format.editPreview(find.asItem(row), fields, { group: ctx.group === find.ALL });
}

/** Not on a row that moved since they were shown it. */
async function stale(id, before) {
  const now = await expensesRepo.findById(id);
  if (!now) return 'that expense has since been removed';
  return same(now, before) ? null : 'that expense was changed since I showed it';
}

async function saveEdit(ctx) {
  const { id, before, fields } = ctx.state.pending;
  const why = await stale(id, before);
  if (why) { ctx.state.pending = null; return `Nothing was changed: ${why}. Ask again and I'll show it as it is now.`; }
  const after = await expensesRepo.update(id, fields);
  const check = await expensesRepo.findById(id);
  if (!after || !check) return '⚠️ The change could not be confirmed. Please check the Expenses page.';
  await store.recordAction(require('../../../configs/db'), {
    phone: ctx.phone, group: ctx.group, kind: 'edit', changes: [{ id, before, after: SNAP(check) }],
    summary: `${before.description}: ${Object.keys(fields).map((f) => `${format.LABEL[f] ?? f} back to ${f === 'spentOn' ? format.day(before[f]) : f === 'rawAmount' ? format.amount(before[f]) : before[f]}`).join(', ')}`,
  });
  broadcast(null, EVENT, { action: 'updated', id, via: 'whatbot' });
  ctx.state.pending = null;
  ctx.state.lastIds = [id];
  return format.changed(find.asItem(check), { group: ctx.group === find.ALL });
}

// ---- removing ----

async function startRemove(r, ctx) {
  const hits = await find.findTarget(ctx.group, r.target, { today: ctx.today, lastIds: ctx.state.lastIds ?? [] });
  if (!hits.length) return notFound(ctx);
  if (hits.length > 1 && !r.target.all) return pick(hits, { kind: 'remove' }, 'should I remove', ctx);
  const rows = await Promise.all(hits.slice(0, 30).map((h) => expensesRepo.findById(h.id)));
  return removePreviewFor(rows.filter(Boolean), ctx);
}

function removePreviewFor(rows, ctx) {
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
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    if (await expensesRepo.remove(id)) gone.push(id);
  }
  const left = (await Promise.all(ids.map((id) => expensesRepo.findById(id)))).filter(Boolean);
  await store.recordAction(require('../../../configs/db'), {
    phone: ctx.phone, group: ctx.group, kind: 'remove', changes: ids.filter((id) => gone.includes(id)).map((id) => ({ id, before: before[ids.indexOf(id)] })),
    summary: `${before.slice(0, 4).map((b) => `${b.description} · ${format.money(b.currency, b.rawAmount)}`).join(', ')}${before.length > 4 ? ` and ${before.length - 4} more` : ''}`,
  });
  broadcast(null, EVENT, { action: 'deleted', count: gone.length, via: 'whatbot' });
  ctx.state.pending = null;
  if (left.length) return `⚠️ ${left.length} could not be removed. Please check the Expenses page.`;
  return format.removed(before);
}

// ---- undo: always asks ----

async function startUndo(ctx) {
  const action = await store.lastAction(ctx.phone, ctx.group);
  if (!action) return 'There is nothing of yours to undo.';
  ctx.state.pending = { kind: 'undo', actionId: action.id };
  return format.undoPreview(action);
}

async function saveUndo(ctx) {
  const pool = require('../../../configs/db');
  const { rows } = await pool.query('SELECT * FROM tb_expense_actions WHERE id = $1 AND undone_at IS NULL', [ctx.state.pending.actionId]);
  const action = rows[0];
  ctx.state.pending = null;
  if (!action) return 'That was already undone. Nothing changed.';
  const done = [];
  const skipped = [];
  for (const c of action.changes) {
    /* eslint-disable no-await-in-loop */
    if (action.kind === 'add') {
      const now = await expensesRepo.findById(c.id);
      if (!now) continue;
      if (!same(now, c.after)) { skipped.push(c.after.description); continue; }
      await expensesRepo.remove(c.id);
      done.push(c.id);
    } else if (action.kind === 'edit') {
      const now = await expensesRepo.findById(c.id);
      if (!now) { skipped.push(c.before.description); continue; }
      if (!same(now, c.after)) { skipped.push(c.before.description); continue; }
      await expensesRepo.update(c.id, c.before);
      done.push(c.id);
    } else if (action.kind === 'remove') {
      const back = await expensesRepo.create(c.before);
      done.push(back.id);
    }
    /* eslint-enable no-await-in-loop */
  }
  await pool.query('UPDATE tb_expense_actions SET undone_at = now() WHERE id = $1', [action.id]);
  await store.recordAction(pool, { phone: ctx.phone, group: ctx.group, kind: 'undo', changes: [{ undid: action.id }], summary: `undid: ${action.summary}` });
  broadcast(null, EVENT, { action: 'reverted', via: 'whatbot' });
  ctx.state.lastIds = [];
  const verb = { add: 'Taken back', edit: 'Put back', remove: 'Brought back' }[action.kind];
  return `✅ *${verb}:* ${action.summary}${skipped.length ? `\n⚠️ Left alone, changed since: ${skipped.join(', ')}` : ''}`;
}

// ---- helpers ----

function pick(hits, then, what, ctx) {
  const list = hits.slice(0, 8);
  ctx.state.pending = { kind: 'pick', choices: list.map((h) => h.id), then };
  return format.pickList(list, what, { group: ctx.group === find.ALL });
}

async function notFound(ctx) {
  const recent = await find.latest(ctx.group, ctx.today);
  const whose = ctx.group === find.ALL ? 'the' : `*${ctx.group}*'s`;
  if (!recent.length) return `I couldn't find that. There are no expenses ${ctx.group === find.ALL ? '' : `for *${ctx.group}* `}in the last 2 months.`;
  return [`I couldn't find that in ${whose} expenses from the last 2 months. The latest:`, '', ...recent.map((r) => format.line({ ...r, n: null }, { number: false, group: ctx.group === find.ALL })), '', 'Say which one, like _change the taxi on 6 Oct to 50_.'].join('\n');
}

module.exports = { turn, SNAP, editish };
