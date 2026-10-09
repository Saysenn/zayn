import { crmConfig } from "../config/index.js";
import { logger } from "../system/logger.js";
import { renderTable } from "../pictures/table.js";
import { payPictureStyle } from "../pictures/style.js";
import { money, groupName, totalsByCurrency } from "../tools/format/money.js";
import { employeeExpensesOn } from "./expenses.js";

/**
 * MY EXPENSES, READ ONLY (his calls 2026-10-07).
 *
 * Anyone on the master sheet may ask what they SPENT, in THIS group, THIS
 * month, once his switch is on (CRM → Settings → Whatbot). Nothing else:
 *   - never someone else's ("Ahmed's expenses" is a polite no);
 *   - never another month;
 *   - never by a name. The CRM is asked for the person the verified phone
 *     already is, and checks that again itself before reading anything.
 * Off: this answers nothing and the bot does not know the feature exists.
 *
 * The list goes as a picture in the pay breakdown's paper-note style, with
 * the same list in words for when pictures are off. No receipt pictures.
 */

// "my expenses", "what did I spend", "gastos ko", "mera kharcha"
const ASKS = /\b(?:expenses?|expences?|spendings?|gastos?|kharch\w*)\b|\b(?:what|how much|how many)\b.*\b(?:did i|have i|i)\s+(?:spend|spent)\b/i;
const MINE = /\b(?:my|mine|i|me|ko|mera|meri|mere)\b/i;
// words that are never a person: "this month's", "what's", "for today"
const NOT_A_NAME = new Set(["this", "the", "me", "my", "today", "now", "month", "week", "what", "that", "it", "there", "here", "who", "let", "he", "she",
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july", "aug", "august", "sep", "sept",
  "september", "oct", "october", "nov", "november", "dec", "december", "all", "group", "milkman", "indigo", "nexus", "manbat", "takeoff"]);
/** Someone else's: "his", "Ahmed's", "expenses of Sara", "for Leo", "everyone's". */
function someoneElse(text) {
  const t = String(text ?? "").toLowerCase();
  if (/\b(?:his|her|their|everyone'?s?|everybody'?s?|others?'?|all (?:the )?(?:staff|people|drivers|employees))\b/.test(t)) return true;
  for (const m of t.matchAll(/\b([a-z]+)'s\b|\b(?:of|for|by)\s+([a-z]+)\b/g)) {
    const word = m[1] ?? m[2];
    if (word && !NOT_A_NAME.has(word)) return true;
  }
  return false;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ANOTHER = /\b(?:last|next|previous|past)\s+(?:month|week|year)\b|\b20\d\d\b|\bago\b|\bhistory\b/i;

export { someoneElse };

/** Is this a question about expenses at all? */
export function asksExpenses(text) {
  const t = String(text ?? "").trim();
  return t.length > 0 && t.length <= 120 && ASKS.test(t);
}

/** A month they named that is not this one, or null. */
function otherMonthIn(text, now = new Date()) {
  const t = String(text ?? "").toLowerCase();
  if (ANOTHER.test(t)) return true;
  const named = MONTHS.filter((m) => new RegExp(`\\b${m}[a-z]*\\b`).test(t));
  const here = MONTHS[now.getMonth()];
  return named.some((m) => m !== here);
}

async function fetchMine(ctx, phone) {
  const q = new URLSearchParams({ phone, group: ctx.channelGroup, personId: ctx.person.personId }).toString();
  const res = await fetch(`${crmConfig.apiUrl}/api/v1/agent/expenses/mine?${q}`, {
    headers: { "x-api-key": crmConfig.apiKey },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 403) return { off: true };
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

const day = (v) => new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
const title = (s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : "");

/** " · ✅ refunded", " · from Sep, not refunded yet": after each line, when the CRM says. */
function statusOf(r) {
  switch (r.settle_tag) {
    case "settled": return " · ✅ refunded";
    case "review": return " · being checked";
    case "late": case "unpaid": case "overdue": return ` · from ${r.from_month}, not refunded yet`;
    default: return "";
  }
}

/** What they spent, in words and as a paper note. */
function reply(rows, ctx, month) {
  const when = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  const group = groupName(ctx.channelGroup);
  if (!rows.length) {
    return { text: `🧾 Nothing is saved as spent by you in *${group}* for ${when} yet.`, hadDisplay: true, subjectCount: 0, tools: ["my_expenses"] };
  }
  const items = rows.map((r) => ({ ...r, amount: Number(r.raw_amount) }));
  const total = totalsByCurrency(items, (r) => r.amount);
  const mixed = new Set(items.map((r) => r.currency)).size > 1;
  const aed = items.every((r) => r.aed_amount != null) ? items.reduce((n, r) => n + Number(r.aed_amount), 0) : null;
  const totalLine = `${total}${mixed && aed != null ? ` (about ${money(Math.round(aed * 100) / 100, "AED")})` : ""}`;
  const lines = items.map((r, i) => `${i + 1}. ${day(r.spent_on)} · ${r.description}${r.payee ? ` · ${r.payee}` : ""} · *${money(r.amount, r.currency)}*${statusOf(r)}`);
  // REFUNDED OR NOT (the CRM's Expenses check): "3 refunded · 2 in the next check"
  const refunded = items.filter((r) => r.settle_tag === "settled").length;
  const review = items.filter((r) => r.settle_tag === "review").length;
  const waiting = items.length - refunded - review;
  const refundLine = items.some((r) => "settle_tag" in r)
    ? [refunded ? `${refunded} refunded` : "", waiting ? `${waiting} in the next check` : "", review ? `${review} being checked by the team` : ""].filter(Boolean).join(" · ")
    : "";
  const text = [`🧾 *Your ${when} expenses · ${group}*`, ...lines, "", `*Total:* ${totalLine}`, ...(refundLine ? [refundLine] : [])].join("\n");
  let image = null;
  try {
    const pngs = renderTable({
      style: payPictureStyle(),
      title: `${ctx.person.personName.split(" ")[0]}'s expenses · ${group}`,
      subtitle: `${when} · ${items.length} ${items.length === 1 ? "expense" : "expenses"}`,
      columns: [{ label: "Date" }, { label: "What" }, { label: "Paid to" }, { label: "Category" }, ...(refundLine ? [{ label: "Refunded" }] : []), { label: "Amount", align: "right" }],
      sections: [{ rows: items.map((r) => ({ cells: [day(r.spent_on), r.description ?? "", r.payee ?? "", title(r.category), ...(refundLine ? [r.settle_tag === "settled" ? "Yes" : r.settle_tag === "review" ? "Checking" : "Not yet"] : []), money(r.amount, r.currency)] })) }],
      total: { label: "Total", value: totalLine },
      marks: false,
    });
    if (pngs.length) {
      image = {
        base64: pngs[0].toString("base64"),
        mime: "image/png",
        caption: `🧾 Your ${when} ${group} expenses: *${totalLine}* (${items.length})`,
        feature: "payImages",
      };
    }
  } catch (err) {
    logger.warn({ err: err.message }, "my expenses: the picture could not be drawn, words only");
  }
  return { text, hadDisplay: true, subjectCount: 1, tools: ["my_expenses"], ...(image ? { image } : {}) };
}

/**
 * The answer to an expenses question, or null when it is not one, or his
 * switch is off (then nothing here exists).
 * @param {{ person: object, channelGroup: string }} ctx verified identity
 * @param {string} phone the verified sender
 */
export async function answerMyExpenses(ctx, phone, text) {
  if (!asksExpenses(text)) return null;
  if (!(await employeeExpensesOn())) return null;
  const words = (t) => ({ text: t, hadDisplay: false, subjectCount: 0, tools: [] });
  const t = String(text);
  if (someoneElse(t) && !/\bmy\b/i.test(t)) {
    return words("I can only show *your own* expenses, the ones saved as spent by you. Ask me _my expenses_.");
  }
  if (otherMonthIn(t)) {
    return words("I can only show *this month's* expenses. Ask me _my expenses_ for this month.");
  }
  try {
    const got = await fetchMine(ctx, phone);
    if (got.off) return null;
    return reply(got.rows ?? [], ctx, got.month);
  } catch (err) {
    logger.warn({ err: err.message }, "my expenses: the CRM did not answer");
    return words("I couldn't reach the expenses just now. Please try again in a minute.");
  }
}
