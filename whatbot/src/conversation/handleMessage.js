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
import { expenseTurn, isExpenseAdmin } from "../expenses/expenses.js";

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

/** send nothing at all. used for opted-out people — silence, not an explanation. */
export const NO_REPLY = Symbol("no-reply");

/** the common case: words only. an object, because a file cannot be a string */
const words = (text) => ({ text });

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
   * A REGISTERED EXPENSE ADMIN on this group's number goes to the CRM's
   * expense brain: expenses in, a preview, saved on their yes. FIRST, before
   * the opt-out words: to an admin "cancel" and "stop" mean "drop that
   * preview", and read as an opt-out they silenced the bot (live 2026-10-07).
   * Before the per-minute limit too: a pile of receipts is one photo per message.
   * The CRM checks the registration again; if it says no, they are handled
   * below exactly as before. See expenses/expenses.js.
   */
  if (await isExpenseAdmin(phone, channelGroup)) {
    const out = await expenseTurn({ phone, group: channelGroup, text, attachments, messageId });
    if (out.registered !== false) return out.reply ? words(out.reply) : NO_REPLY;
  }

  // STOP first, before anything. it must never be treated as a question.
  const intent = optOutIntent(text);
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
    const answer = paydayAnswer(text);

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
      return words(paydayReplies.confirmed);
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
      return words(
        outcome === "partial"
          ? paydayReplies.detailNoted
          : paydayReplies.nothingArrived,
      );
    }
    // Neither. It's a real question, so answer it and leave the follow-up
    // outstanding — they may still come back to it, and the TTL closes it
    // if they don't.
  }

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
    reply = await runAgent(ctx, question, history);
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

  // Identical figures to the ones just sent. Four different questions can
  // land on one tool, and nobody reads the fourth identical wall. They are
  // still one message up the thread, so nothing is hidden.
  if (reply.hadDisplay && send.lastReply.startsWith(reply.text)) {
    return words(
      await send.say("Same as I've just sent you, nothing's changed 🙂"),
    );
  }

  if (reply.offer && reply.offer.choices.length > 0) {
    // remember what each number will run, or the menu is decoration
    await setPendingOffer(phone, reply.offer.choices);
    if (send.menuJustShown)
      return { text: reply.text, attachment: reply.attachment };
    return {
      text: `${reply.text}\n\n${choicesBlock(
        reply.offer.prompt,
        reply.offer.choices.map((c) => c.label),
      )}`,
      attachment: reply.attachment,
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

  return { text: reply.text, attachment: reply.attachment };
}
