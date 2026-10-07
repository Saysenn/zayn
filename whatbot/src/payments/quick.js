import { tools } from "../tools/index.js";
import { invokeTool } from "../agent/toolRunner.js";
import { logger } from "../system/logger.js";
import { otherGroupIn } from "./elsewhere.js";
import { groupName } from "../tools/format/money.js";

/**
 * EVERYDAY PAY QUESTIONS, ANSWERED IN CODE: NO MODEL, NO COST, NO WAIT.
 *
 * His call 2026-10-07: payments as efficient as Diane and the expense brain.
 * "what's my total", "my breakdown", "which companies am I on", "which pays
 * me most", "when did I start", "how much does acqua pay me" are read here
 * and the tool that answers them is called once, exactly as the model would
 * have called it. The reply is that tool's own display, as it always is
 * (askModel.js discards the model's wording anyway).
 *
 * Narrow on purpose. Anything with another month, two questions in one, or
 * wording it is not sure of goes to the model as before. A company is only
 * ever one of THEIR OWN on this number (ctx), so a name cannot reach anyone
 * else's figures: the tools enforce that too.
 */

const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const ANOTHER_MONTH = /\b(?:last|next|previous|past|coming)\s+month\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b20\d\d\b|\bago\b|\bhistory\b|\bbefore\b/i;
const TWO_ASKS = /\b(?:and|also|plus)\b.*\b(?:when|how|what|which|who)\b|[?].+\S/i;
const MONEY = /\b(?:how much|pay(?:s|ing)?|paid|earn\w*|get(?:ting)?|owe[ds]?|salary|wage|money|amount)\b/i;

/** Which of THEIR companies the words name: whole name, or a word of it (4+ letters). */
function companyIn(text, ctx) {
  const names = [...new Set(ctx.person.assignments.filter((a) => a.group === ctx.channelGroup).map((a) => a.company).filter(Boolean))];
  const said = String(text).toLowerCase();
  const words = said.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const hits = names.filter((n) => said.includes(n.toLowerCase())
    || n.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["resourcing", "payroll", "limited", "group", "services", "solutions"].includes(w)).some((w) => words.includes(w)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The tool and its arguments for a question code is sure of, or null.
 * @returns {null | { name: string, args: object }}
 */
export function readQuick(text, ctx) {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!t || t.length > 90 || ANOTHER_MONTH.test(t) || TWO_ASKS.test(t)) return null;
  const company = companyIn(t, ctx);

  // WHEN: start, end, how long
  if (/\b(?:when (?:did|do|does|will)\b.*\b(?:start|begin|end|finish|stop)|start(?:ed|ing)? date|end(?:ing)? date|how long (?:left|have i|do i|is left)|contract end|dates?)\b/i.test(t)) {
    return { name: "get_my_dates", args: company ? { company } : {} };
  }
  // WHICH PAYS MOST / LEAST / TOP N
  const top = /\btop\s+(\d{1,2})\b/i.exec(t);
  if (top || /\b(?:pays?|paying|paid)\b.*\b(?:most|highest|best|least|lowest|worst)\b|\b(?:highest|lowest|best|worst|biggest|smallest)\b.*\b(?:pay|paying|paid|company|one)\b|^(?:lowest|highest|biggest|smallest) (?:paying )?one\??$/i.test(t)) {
    const low = /\b(?:least|lowest|worst|smallest)\b/i.test(t);
    return { name: "rank_my_companies", args: { sort: low ? "lowest" : "highest", limit: top ? Number(top[1]) : 1 } };
  }
  // ONE NAMED COMPANY, and money
  if (company && MONEY.test(t)) return { name: "get_my_company", args: { company } };
  // WHICH / HOW MANY COMPANIES (no amounts)
  if (/\b(?:which|what|list|how many|name)\b.*\bcompan(?:y|ies)\b|\bmy companies\b/i.test(t) && !MONEY.test(t)) {
    return { name: "count_my_companies", args: {} };
  }
  // A TOTAL, one figure
  if (/^(?:what'?s |whats |what is |my |the )*(?:my )?total(?: pay)?(?: (?:pls|please|this month|for this month|now))*\??$/i.test(t) || /\b(?:altogether|in total|add (?:it|them) (?:all )?up)\b/i.test(t)) {
    return { name: "get_my_total", args: {} };
  }
  // THE BREAKDOWN, and a plain "what am I owed" (the tools' own rule);
  // "am I getting paid this month" too: what they are owed IS the answer
  if (/\b(?:am i (?:getting |being )?paid|will i (?:get|be) paid|do i get paid)\b/i.test(t) || /\bbreak ?down\b/i.test(t) || /^(?:how much|hw much|how mch)\b.*\b(?:i|me|my)\b/i.test(t) || /\b(?:my (?:pay|salary|wages?|payslip)|what (?:am i|do i get) (?:owed|paid|getting))\b/i.test(t) || /^(?:my )?(?:pay|salary|payslip)\??$/i.test(t)) {
    return { name: "get_my_breakdown", args: {} };
  }
  return null;
}

/**
 * Answered in code when it can be: the same shape runAgent returns, or null
 * to go on to the model.
 */
export async function answerQuick(ctx, text) {
  /**
   * ANOTHER MONTH, ABOUT PAY: only this month is held, said in code (it cost
   * two model calls to say the same thing). The "show me what I am owed"
   * offer handleMessage adds to a reply with no figures makes a "yes" work.
   */
  const t = String(text ?? "");
  if (ANOTHER_MONTH.test(t) && MONEY.test(t) || ANOTHER_MONTH.test(t) && /\b(?:break ?down|total|payslip)\b/i.test(t)) {
    const when = /\bnext month\b|\bcoming\b/i.test(t) ? "anything ahead" : "past months";
    return {
      text: `I only hold this month's figures, so I can't show you ${when}. Want what you're owed this month instead?`,
      hadDisplay: false,
      subjectCount: 0,
      tools: [],
    };
  }
  /**
   * THEIR OTHER GROUP, ASKED ABOUT HERE: where it is, never "no record"
   * (his report 2026-10-07: "No record of Indigo on this number").
   */
  const other = otherGroupIn(t, ctx);
  if (other) {
    const here = groupName(ctx.channelGroup);
    const there = groupName(other.group);
    return {
      text: other.number
        ? `Your *${there}* pay is on the ${there} number: ${other.number}. Message it there and it'll show you everything. Here I can only show your *${here}* pay.`
        : `Your *${there}* pay isn't on WhatsApp, so I can't show it here. Ask payroll for that one. Here I can only show your *${here}* pay.`,
      hadDisplay: false,
      subjectCount: 0,
      tools: [],
    };
  }
  const pick = readQuick(text, ctx);
  if (!pick) return null;
  const result = await invokeTool(tools, pick.name, JSON.stringify(pick.args), ctx);
  // a tool that only explained something (nothing on this number, a company
  // it could not place) is said in words by the model, as before
  if (!result?.display) return null;
  logger.info({ tool: pick.name, actor: ctx.person.personId }, "payments: answered in code");
  return {
    text: result.display,
    hadDisplay: true,
    subjectCount: (result.subjects ?? []).length,
    offer: result.offer,
    attachment: result.attachment,
    image: result.image,
    tools: [pick.name],
  };
}
