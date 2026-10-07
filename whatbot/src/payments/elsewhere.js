import { numberForGroup } from "../config/index.js";
import { groupName } from "../tools/format/money.js";

/**
 * WHERE THE REST OF THEIR PAY IS (his call 2026-10-07): the person's OTHER
 * groups, by name only, and how to reach each. One bot per group is the
 * design, so a group's companies and figures are never shown here; only
 * that it exists and which number answers for it.
 *
 * A group with a WhatsApp number: "message the Indigo number (+44…)", the
 * bot's own number, never a person's. A group with none yet: said plainly.
 * Grows by itself as numbers are added to WHATSAPP_NUMBERS.
 */
export function otherGroups(ctx) {
  return [...new Set((ctx.person?.assignments ?? []).map((a) => a.group))]
    .filter((g) => g && g !== ctx.channelGroup)
    .sort()
    .map((g) => ({ group: g, number: numberForGroup(g) ?? null }));
}

const pretty = (n) => String(n).replace(/^\+44(\d{4})(\d{6})$/, "+44 $1 $2").replace(/^\+(\d{3})(\d{3})(\d{6})$/, "+$1 $2 $3");

/** One line for each, for the picture's notes box. */
export function noteLines(ctx) {
  return otherGroups(ctx).map(({ group, number }) => ({
    label: groupName(group),
    text: number ? `message the ${groupName(group)} number, ${pretty(number)}` : "not on WhatsApp, ask payroll",
  }));
}

/** The same, as WhatsApp text under a breakdown. */
export function noteText(ctx) {
  const lines = noteLines(ctx);
  if (!lines.length) return "";
  return [`📍 *Your other pay* (not on this number)`, ...lines.map((l) => `• *${l.label}*: ${l.text}`)].join("\n");
}

/** Which of their OTHER groups the words name, if one. */
export function otherGroupIn(text, ctx) {
  const said = String(text ?? "").toLowerCase();
  return otherGroups(ctx).find(({ group }) => new RegExp(`\\b${group.toLowerCase().replace(/[^a-z0-9]+/g, "\\s*")}\\b`).test(said)) ?? null;
}
