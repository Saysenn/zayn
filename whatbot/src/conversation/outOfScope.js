import { logger } from "../system/logger.js";
import { NEXT_STEPS } from "./scripted.js";
import { forMatching } from "./normalize.js";

/**
 * The honest noes.
 *
 * One read only sheet is the whole of what this bot knows. It cannot change a
 * bank account, tell you when money will land, produce a payslip, or say what
 * you will earn in November. All of those get asked anyway, and until now each
 * one was refused by the model in whatever words it landed on that day.
 *
 * Written down here so the answer is the same every time, and so each no comes
 * with the nearest thing that IS possible. A refusal on its own is where people
 * give up on a bot.
 *
 * Checked LAST, after the greetings and the escalations, because these are the
 * broadest patterns in the codebase and the most likely to catch something they
 * shouldn't. Anything more specific gets first refusal.
 */

const LIMITS = [
  {
    name: "bank-details",
    re: /\b(bank (details|account|info)|account (number|details)|sort code|iban|change (my )?bank|where (is|do) (it|the money|my (money|pay)) (go|going|sent|paid) (to|into))\b/i,
    reply:
      "Bank details aren't something I touch, and never over WhatsApp. That one needs a person. I can show you what you're owed though.",
  },
  {
    name: "personal-details",
    re: /\b(change|update|correct|amend) my (name|address|number|phone|email|details|spelling)\b|\bmy (address|phone number|name) has changed\b|\bi'?ve (moved|changed my (name|number))\b/i,
    reply:
      "I can read the sheet but not change it, so that one needs whoever keeps it. Worth doing soon if it affects your pay.",
  },
  {
    name: "payment-timing",
    re: /\bwhen (will|do|am) i (be |get |going to )?(paid|get paid|receive)\b|\bwhen is payday\b|\bwhat day (do|are|is)\b[^?]{0,20}\bpaid\b|\bhas (my |the )?(pay|payment|money|wages?) (been )?(sent|paid|left|arrived|gone out)\b|\bwhen will (it|the money|my (money|pay|payment|wages?)) (arrive|land|come|clear|be sent)\b|\bwhy (have|haven'?t|hasn'?t) (i|it) (not )?(been )?(paid|arrived|received)\b|\b(transaction|payment) reference\b|\bproof of payment\b/i,
    reply:
      "I don't see payments going out, only what you're owed, so I can't tell you when it lands. Whoever chases it will want the figures, and those I've got.",
  },
  {
    name: "tax",
    // "declare" is qualified on purpose. Bare "income" would swallow "what is
    // my income", which is the commonest question there is.
    re: /\b(tax|taxable|hmrc|national insurance|ni contributions?|p60|p45|self assessment|deduct(ed|ions?)?)\b|\bdeclare (this|my|it|that)\b/i,
    reply:
      "Tax I'd only be guessing at, and you don't want that. My figures are what's payable, nothing taken off. An accountant is the one to ask.",
  },
  {
    name: "invoice",
    re: /\b(invoice|vat|billing address|remittance|purchase order|\bpo number\b)\b/i,
    reply:
      "Invoices go to whoever you deal with on the finance side, not me. I can show you your figures if that helps you put it together.",
  },
  {
    name: "documents",
    re: /\b(payslip|pay slip|statement|remittance advice|receipt|letter|pdf|download|proof of (earnings|income)|for my (accountant|mortgage|landlord))\b/i,
    reply:
      "No payslips or PDFs from me, only messages. I can lay the figures out here and you're welcome to screenshot it.",
  },
  {
    name: "forecast",
    // "how much will I earn" alone is ambiguous — it's also how people phrase
    // an ordinary question about THIS month, spoken or typed. Only treat it as
    // a forecast when nothing nearby scopes it to the current month.
    re: /\b(next month|next year|coming months?|going forward|in (the )?future|forecast|projection|project(ed)?|estimate my|how much will i (earn|get|make)(?!.*\bthis month\b)|what will i (earn|get|make)(?!.*\bthis month\b))\b/i,
    reply:
      "I only hold this month, so anything ahead would be a guess, and a guess about wages is worth nothing. I can show you where things stand now.",
  },
  {
    name: "leaving",
    re: /\b(i want to (stop|leave|quit|cancel)|stop (receiving|my) payments?|leave the arrangement|pause (my|the) (payments?|participation)|cancel my|opt out of (the|my) (arrangement|payments?))\b/i,
    reply:
      "That's one for a person, I can't change anything on the sheet. If you just want me to stop messaging, send STOP.",
  },
  {
    name: "other-channel",
    re: /\b(email me|send (me )?an email|call me|ring me|give me a call|phone me|voice note|by post)\b/i,
    reply:
      "WhatsApp is the only place I work, sorry. At least it all stays here for you to look back at.",
  },
  {
    name: "why",
    re: /\bwhy (is|are|was|were|did|does|do|has|have)\b[^?]{0,40}\b(zero|0 days|no days|nothing|changed|dropped|gone down|gone up|less|lower|higher|different)\b/i,
    reply:
      "I see the days and the amount, not the reason behind either. Payroll will know. I can show you what's recorded so you've something specific to ask.",
  },
];

/**
 * A reply if this is something the bot genuinely cannot do, otherwise null.
 *
 * Logged at info, because the mix of these over a month is the clearest signal
 * of what people actually want that this thing does not yet do.
 */
export function outOfScopeReply(text, personId) {
  const hit = LIMITS.find((l) => l.re.test(forMatching(text)));
  if (!hit) return null;

  logger.info(
    { actor: personId, limit: hit.name },
    "asked for something out of scope",
  );

  return { text: hit.reply, offer: NEXT_STEPS };
}
