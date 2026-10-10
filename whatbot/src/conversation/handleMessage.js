import { logger } from "../system/logger.js";
import { checkRateLimit, RATE_LIMIT_MESSAGES } from "../system/rateLimit.js";
import {
  isOptedOut,
  optOutIntent,
  OPT_OUT_MESSAGES,
  setOptedOut,
} from "../system/optOut.js";
import * as employees from "../employee/access.js";
import { LlmUnavailableError, runAgent } from "../agent/askModel.js";
import { answerQuick } from "../payments/quick.js";
import { answerMyExpenses } from "../expenses/myExpenses.js";
import { answerByReader } from "../payments/reader.js";
import { CLARIFY_PROMPT, UNKNOWN_SENDER } from "../agent/prompt.js";
import {
  appendTurn,
  classifyReply,
  getHistory,
  resolveOffer,
  setPendingOffer,
  setState,
} from "./memory.js";
import { choicesBlock } from "../tools/format/index.js";
import {
  awaitClarify,
  clarifyOpenFor,
  clearClarify,
  lastCheckFor,
  openCheckFor,
  recordReply,
  reopenCheck,
} from "../payday/records.js";
import { pushOutcome } from "../payday/crmOutbox.js";
import { readPaydayAnswer } from "../payday/readAnswer.js";
import {
  AMOUNT_WRONG,
  CHOICE_NO,
  CHOICE_PARTIAL,
  CHOICE_STOP,
  CHOICE_YES,
  NO_RECEIVED,
  NOTHING_ARRIVED,
  paydayReopened,
  paydayReplies,
  REOPEN_INTENT,
  YES_RECEIVED,
} from "../payday/paydayMessages.js";
import { scriptedReply } from "./scriptedReply.js";
import { replier } from "./sendReply.js";
import { expenseTurn, isExpenseAdmin, openPreviewSize, unreadableReply } from "../expenses/expenses.js";
import { collect, firstOfBurst } from "../expenses/batch.js";
import { answerExpenseCheckIfOpen, expenseCheckAfterPayday } from "../expenses/expenseCheck.js";
import {
  EXPENSE,
  EXPENSE_WORD,
  MODE_REPLIES,
  PAYMENTS,
  PAYMENTS_WORD,
  modeOf,
  setMode,
} from "../expenses/mode.js";

/**
 * Their answer to the payday check. Three ways in, because people use all
 * three: the menu number, a bare yes/no, or the question echoed back.
 *
 * `stop` only reachable here, while a check is open. optOutIntent runs much
 * earlier and knows nothing about digits, so "3" cannot opt anyone out in
 * ordinary conversation.
 */
function paydayAnswer(text) {
  const t = text.trim();
  if (CHOICE_YES.test(t)) return "yes";
  if (CHOICE_NO.test(t)) return "no";
  if (CHOICE_PARTIAL.test(t)) return "partial";
  if (CHOICE_STOP.test(t)) return "stop";
  if (YES_RECEIVED.test(t)) return "yes";
  if (NO_RECEIVED.test(t)) return "no";
  // Before the yes/no classifier, not after: "yes but only half of it"
  // reads as a yes to anything looking for agreement, and filing a short
  // payment as fully received is the one wrong answer that closes the case.
  if (AMOUNT_WRONG.test(t) && !NOTHING_ARRIVED.test(t)) return "partial";
  const { verdict, rest } = classifyReply(text);
  return rest ? "other" : verdict;
}

/** The payday reply, and the Expenses check after it as its own message, when there is one. */
async function withExpenseCheck(reply, person, group, phone, period) {
  const next = await expenseCheckAfterPayday(person, group, phone, period);
  return next ? { ...reply, more: [...(reply.more ?? []), next] } : reply;
}

/** send nothing at all. used for opted-out people — silence, not an explanation. */
export const NO_REPLY = Symbol("no-reply");

/** the common case: words only. an object, because a file cannot be a string */
const words = (text) => ({ text });

// The expense bot's word while it reads files (his call 2026-10-07).
const readingNote = (files, open) => {
  const n = `${files} ${files === 1 ? "file" : "files"}`;
  return open
    ? `📥 Got ${n}, adding ${files === 1 ? "it" : "them"} to your open preview (${open} so far)…`
    : `📥 Got ${n}, reading your expenses now…`;
};
const STILL_READING = "⏳ Still reading, almost there…";
const STILL_READING_AFTER_MS = 30_000;

/**
 * One message in, one reply out. The orchestrator.
 *
 * WhatsApp and `npm run chat` both call this, which is why the terminal
 * proves something: same path, no WhatsApp attached.
 *
 * Order below is deliberate: expense admin > stop > opted out > rate limit > who are you >
 * payday reply > answered in code > the model.
 */
export async function handleMessage(input) {
  const { phone, channelGroup, text, attachments = [], messageId } = input;

  /**
   * A REGISTERED EXPENSE ADMIN on this group's number. FIRST, before the
   * opt-out words: to an admin in expense mode "cancel" and "stop" mean
   * "drop that preview", and read as an opt-out they silenced the bot (live
   * 2026-10-07). Before the per-minute limit too: a pile of receipts is one
   * photo per message. See expenses/expenses.js and expenses/mode.js.
   *
   *   "expense" / "payments"   switch side, answered here for nothing
   *   a photo or a file        always expenses (the pay side cannot read one)
   *   expense mode             the CRM's expense brain; a message it says is
   *                            not about expenses is answered below, once
   *   payments mode            below, exactly as for anyone else
   */
  if (await isExpenseAdmin(phone, channelGroup)) {
    if (EXPENSE_WORD.test(text ?? "")) {
      await setMode(phone, channelGroup, EXPENSE);
      return words(MODE_REPLIES[EXPENSE](channelGroup));
    }
    if (PAYMENTS_WORD.test(text ?? "")) {
      await setMode(phone, channelGroup, PAYMENTS);
      return words(MODE_REPLIES[PAYMENTS](channelGroup));
    }
    // A FILE IT WILL NOT READ (wrong type, too big, failed download): said at
    // once, never silence.
    if (input.unreadable && !attachments.length) return words(unreadableReply(input.unreadable));
    let mode = await modeOf(phone, channelGroup);
    let lead = "";
    if (attachments.length && mode === PAYMENTS) {
      await setMode(phone, channelGroup, EXPENSE);
      mode = EXPENSE;
      lead = MODE_REPLIES.switchedForFile(channelGroup);
    }
    if (mode === EXPENSE) {
      // SEVERAL FILES AT ONCE: only the last of the burst answers, for all of
      // them; the others say nothing (expenses/batch.js).
      let files = attachments;
      let said = text;
      if (attachments.length && input.batchSeq) {
        // "typing…" from the first file of the burst, at once (his call
        // 2026-10-07: never silence while it reads).
        if (await firstOfBurst(phone, channelGroup).catch(() => false)) input.typingOnce?.();
        const burst = await collect({ phone, group: channelGroup, seq: input.batchSeq, attachments, text });
        if (!burst) return NO_REPLY;
        files = burst.attachments;
        said = burst.text;
        // "GOT 6 FILES": the count, and the open preview they are joining,
        // so sending the same files twice is plain to see.
        const open = await openPreviewSize(phone, channelGroup);
        await input.notify?.(`${lead}${readingNote(burst.count, open)}`);
        lead = "";
      }
      // "typing…" while it reads, and one "still reading" if it is slow
      const stopTyping = files.length ? (input.typing?.() ?? (() => {})) : () => {};
      const slow = files.length
        ? setTimeout(() => void input.notify?.(STILL_READING), STILL_READING_AFTER_MS)
        : null;
      let out;
      try {
        out = await expenseTurn({ phone, group: channelGroup, text: said, attachments: files, messageId });
      } finally {
        clearTimeout(slow);
        stopTyping();
      }
      if (out.registered !== false && !out.handOff) {
        if (!out.reply) return NO_REPLY;
        // EXTRA BUBBLES (the rates to AED after a preview) go after the first.
        const extra = (out.replies ?? []).slice(1).filter(Boolean);
        return {
          text: `${lead}${out.reply}`,
          ...(extra.length ? { more: extra } : {}),
          ...(out.image ? { image: out.image } : {}),
          // the picture's one-line caption, and the notes / "Please check" /
          // what to reply sent AFTER the pictures (his call 2026-10-07)
          ...(out.image && out.imageCaption ? { imageCaption: out.imageCaption, body: `${lead}${out.body ?? ''}` } : {}),
          ...(out.moreImages?.length ? { moreImages: out.moreImages } : {}),
          ...(out.receipt ? { receipt: out.receipt } : {}),
        };
      }
      // NOT ABOUT EXPENSES ("how much am I getting paid?"): answered as a
      // payments question this once, and said so.
      if (out.handOff) {
        // NOT ON THE MASTER SHEET, so the pay side has nothing for them:
        // "show the image to me" came back "I can't find your number"
        // (2026-10-07). An admin who is not an employee gets what the
        // expense side CAN do instead.
        if (!(await employees.identify(phone, channelGroup).catch(() => null))) {
          return words(MODE_REPLIES.notForExpenses(channelGroup));
        }
        // HANDED OVER, NEVER AN OPT-OUT: a word meant for the expense side
        // must not stop every message to them
        const answered = await answerAsEmployee({ ...input, handedOver: true });
        return answered === NO_REPLY ? answered : { ...answered, text: `${answered.text}${MODE_REPLIES.handedOver}` };
      }
    }
  }

  return answerAsEmployee(input);
}

/** Everyone who is not an expense admin in expense mode: the bot as it always was. */
async function answerAsEmployee(input) {
  const { phone, channelGroup, text } = input;

  // STOP first, before anything. it must never be treated as a question.
  // (not for a message the expense side handed over: see above)
  const intent = input.handedOver ? null : optOutIntent(text);
  switch (intent) {
    case "stop":
      await setOptedOut(phone, true);
      return words(OPT_OUT_MESSAGES.stopped);
    case "start":
      await setOptedOut(phone, false);
      return words(OPT_OUT_MESSAGES.started);
  }

  if (await isOptedOut(phone)) {
    logger.info(
      { phone: `${phone.slice(0, 6)}***` },
      "ignoring message from opted-out number",
    );
    return NO_REPLY;
  }

  const limit = await checkRateLimit(phone);
  if (!limit.allowed) {
    logger.warn({ reason: limit.reason }, "rate limited");
    return words(RATE_LIMIT_MESSAGES[limit.reason]);
  }

  // identity on EVERY message, so someone marked inactive loses access now,
  // not when a session expires.
  const ctx = await employees.identify(phone, channelGroup);
  if (!ctx) {
    logger.warn(
      { phone: phone.slice(0, 5) + "***" },
      "no active employee for sender",
    );
    return words(UNKNOWN_SENDER);
  }

  // Read here rather than further down, because the payday paths below now
  // greet people too — reopening a check says their name back to them.
  const firstName =
    ctx.person.personName.split(" ")[0] ?? ctx.person.personName;

  // An open payday check comes first. "no" here means "I have not been paid",
  // NOT "bad answer" — confuse them and missing wages get filed as a
  // formatting complaint.
  // Scoped to the group they replied on: two groups = two open checks, and
  // answering one must not close the other.
  const openPeriod = await openCheckFor(channelGroup, phone);
  if (openPeriod) {
    // the numbers and code first; any other wording, a small reader, when sure
    let answer = paydayAnswer(text);
    if (answer === "other") answer = (await readPaydayAnswer(text)) ?? "other";

    // Option 3 = STOP. An opt-out that half works is worse than none.
    // The check stays open: they said stop asking, not whether they were paid.
    if (answer === "stop") {
      await setOptedOut(phone, true);
      return words(OPT_OUT_MESSAGES.stopped);
    }

    if (answer === "yes") {
      await recordReply(
        openPeriod,
        channelGroup,
        ctx.person.personId,
        phone,
        "confirmed",
      );
      // Best-effort, never awaited into the reply path — see crmClient.js.
      // recordReply above (Redis) is the source of truth either way, and a
      // push that fails leaves crmSynced false for the outbox sweep to
      // retry, so an unreachable CRM costs a delay and never the outcome.
      void pushOutcome(ctx.person, channelGroup, openPeriod, "confirmed");
      // THE EXPENSES CHECK, its own message, right after (never cold)
      return withExpenseCheck(words(paydayReplies.confirmed), ctx.person, channelGroup, phone, openPeriod);
    }
    if (answer === "no") {
      await recordReply(
        openPeriod,
        channelGroup,
        ctx.person.personId,
        phone,
        "not_received",
        text,
      );
      void pushOutcome(ctx.person, channelGroup, openPeriod, "not_received", text);
      logger.warn(
        {
          personId: ctx.person.personId,
          group: channelGroup,
          period: openPeriod,
        },
        "person reports payment not received",
      );
      const method =
        ctx.person.assignments.find((a) => a.group === channelGroup)
          ?.paymentMethod ?? "cash";
      // The reply below asks whether nothing arrived or the amount was
      // wrong. Until now we asked and then had nowhere to put the answer.
      await awaitClarify(openPeriod, channelGroup, phone);
      return words(paydayReplies.notReceived(method, openPeriod, channelGroup));
    }
    if (answer === "partial") {
      await recordReply(
        openPeriod,
        channelGroup,
        ctx.person.personId,
        phone,
        "partial",
        text,
      );
      void pushOutcome(ctx.person, channelGroup, openPeriod, "partial", text);
      logger.warn(
        {
          personId: ctx.person.personId,
          group: channelGroup,
          period: openPeriod,
        },
        "person reports partial payment",
      );
      // Their next message becomes the note: "how much came through" is
      // the first thing payroll asks, and it costs them nothing to say it
      // now rather than being asked again by a human tomorrow.
      await awaitClarify(openPeriod, channelGroup, phone);
      return words(paydayReplies.partial);
    }
    // anything else is a real question. leave the check open, answer them.
  }

  // Their answer to the follow-up, reached from either direction: a "no"
  // being narrowed down, or a "partial" being given its detail. Runs only
  // while one is outstanding, so the words below can be loose without "the
  // amount was wrong on my last invoice" being read as a payday answer in
  // ordinary conversation.
  //
  // Both branches record, rather than assuming what's already there. The
  // two entry paths leave different outcomes behind, and a clarification
  // that contradicts the first answer ("actually nothing came at all") has
  // to be able to correct it.
  const clarifyPeriod = await clarifyOpenFor(channelGroup, phone);
  if (clarifyPeriod) {
    const outcome = NOTHING_ARRIVED.test(text)
      ? "not_received"
      : AMOUNT_WRONG.test(text)
        ? "partial"
        : null;

    if (outcome) {
      await recordReply(
        clarifyPeriod,
        channelGroup,
        ctx.person.personId,
        phone,
        outcome,
        text,
      );
      void pushOutcome(ctx.person, channelGroup, clarifyPeriod, outcome, text);
      await clearClarify(channelGroup, phone);
      logger.warn(
        {
          personId: ctx.person.personId,
          group: channelGroup,
          period: clarifyPeriod,
          outcome,
        },
        "payday follow-up answered",
      );
      return withExpenseCheck(
        words(
          outcome === "partial"
            ? paydayReplies.detailNoted
            : paydayReplies.nothingArrived,
        ),
        ctx.person,
        channelGroup,
        phone,
        clarifyPeriod,
      );
    }
    // Neither. It's a real question, so answer it and leave the follow-up
    // outstanding — they may still come back to it, and the TTL closes it
    // if they don't.
  }

  // THE EXPENSES CHECK: their yes / no / partial, or "sorry, that was a
  // mistake" after a yes. Asked only after the payday check is answered, so
  // it never cuts across one.
  const expenseReply = await answerExpenseCheckIfOpen(channelGroup, phone, text);
  if (expenseReply) return words(expenseReply);

  // Changing an answer already given. Only reachable with no check open,
  // so it can never cut across one they're in the middle of answering.
  //
  // This is a reply to their own message, not us reopening a check on our
  // own initiative — the never-message-first rule is intact.
  if (REOPEN_INTENT.test(text)) {
    const period = await lastCheckFor(channelGroup, phone);
    if (period) {
      await reopenCheck(period, channelGroup, phone);
      logger.info(
        { personId: ctx.person.personId, group: channelGroup, period },
        "person asked to change their payday answer",
      );
      return words(paydayReopened(firstName, period, channelGroup));
    }
    // Nobody ever asked them, so there's nothing to change. Falls through
    // to the model, which can answer whatever they actually meant.
  }


  // Read once, used twice: is this their first message, and did our last
  // reply end in a menu. Nothing writes history in between.
  const history = await getHistory(phone);
  const send = replier(phone, text, history);

  // Everything answered in code, before the model. The ORDER matters and
  // lives in scriptedReply.js — read it there. This is just plumbing.
  const scripted = await scriptedReply(text, {
    ctx,
    firstName,
    firstContact: history.length === 0,
    history,
  });

  if (scripted) {
    // Upset people repeat themselves. Sending the identical paragraph back
    // three times reads as nobody listening. Still recorded every time;
    // only the wording shortens.
    if (scripted.category && scripted.text === send.lastReply) {
      return words(
        await send.say(
          "Still with a person, and I've added this to the same note.",
        ),
      );
    }
    return words(
      await (scripted.plain
        ? send.say(scripted.text)
        : send.withMenu(scripted.text, scripted.offer)),
    );
  }

  // "yes" or "2" means whatever the last menu offered. Turned back into a
  // real question before the model sees it.
  const resolved = await resolveOffer(phone, text);
  if ("declined" in resolved) {
    await setState(phone, "clarifying");
    return words(CLARIFY_PROMPT);
  }
  const question = resolved.question;

  let reply;
  try {
    // EVERYDAY QUESTIONS IN CODE first, no model (payments/quick.js)
    // then the small reader (one small call, no rules or schemas sent),
    // then the full agent for anything they could not place
    // THEIR OWN EXPENSES, read only, when his switch is on (expenses/myExpenses.js)
    reply = (await answerMyExpenses(ctx, phone, question))
      ?? (await answerQuick(ctx, question))
      ?? (await answerByReader(ctx, question))
      ?? (await runAgent(ctx, question, history));
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      await setState(phone, "idle");
      return words(err.message);
    }
    throw err;
  }

  await appendTurn(phone, { role: "user", content: question });
  await appendTurn(phone, { role: "assistant", content: reply.text });

  await setState(phone, "idle");

  // ASKED AGAIN, SENT AGAIN, his call 2026-10-08. Identical figures used to
  // get "Same as I've just sent you": but the turn above is remembered before
  // WhatsApp delivers it, so a job retried after a stall refused a breakdown
  // that never arrived, and someone asking on purpose was refused too.

  if (reply.offer && reply.offer.choices.length > 0) {
    // remember what each number will run, or the menu is decoration
    await setPendingOffer(phone, reply.offer.choices);
    if (send.menuJustShown)
      return { text: reply.text, attachment: reply.attachment, ...extras(reply) };
    return {
      text: `${reply.text}\n\n${choicesBlock(
        reply.offer.prompt,
        reply.offer.choices.map((c) => c.label),
      )}`,
      attachment: reply.attachment,
      ...extras(reply),
    };
  }

  // A refusal always ends by offering the breakdown, so a "yes" after one
  // means that. Without this, "tell me now" reached the model as a fresh
  // question and it repeated itself.
  if (!reply.hadDisplay) {
    await setPendingOffer(phone, [
      { label: "Show me what I am owed", ask: "show me my full breakdown" },
    ]);
  }

  return { text: reply.text, attachment: reply.attachment, ...extras(reply) };
}

/** A breakdown's picture, and which tools answered (for the eval), carried through. */
const extras = (reply) => ({
  // the picture's one line caption leads; the menu, if any, stays under it
  ...(reply.image?.caption ? { caption: reply.image.caption } : {}),
  ...(reply.image ? { image: reply.image } : {}),
  ...(reply.tools?.length ? { tools: reply.tools } : {}),
});
