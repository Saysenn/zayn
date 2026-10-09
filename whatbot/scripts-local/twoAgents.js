/**
 * TWO SIMULATED PEOPLE TALK TO WHATBOT, and every message that would reach
 * their phone is printed. Run by a person, from whatbot/:
 *
 *   node scripts-local/twoAgents.js payments [conversations=3] [turns=8] [seed]
 *   node scripts-local/twoAgents.js expenses [conversations=3] [turns=8] [seed]
 *
 * Each person is an AI playing a randomised character (an employee asking
 * about pay, or an expense admin adding and changing expenses), typing the
 * way real people do. Whatbot answers through the SAME handleMessage the
 * WhatsApp worker calls, and its reply is turned into WhatsApp messages by
 * the SAME rules as worker.js (picture + caption, body, extra bubbles,
 * receipt, file), recorded instead of sent.
 *
 * Flagged as it goes:
 *   DUPLICATE   the same text twice in one turn, or a caption sent again as text
 *   REPEAT      the same reply as the turn before
 *   ERROR       a crash, "something went wrong", or an empty reply
 *   SLOW        over 20 seconds
 *   REDELIVERY  one message processed twice (a worker retry): what a second
 *               run would send, and (expenses) whether anything saved twice
 *
 * Local Redis only (refuses Upstash). No WhatsApp: nothing reaches a phone.
 */
import "dotenv/config";
import OpenAI from "openai";

if (/upstash/.test(process.env.REDIS_URL ?? "")) {
  process.stderr.write("refusing: REDIS_URL is Upstash. Run against the local Redis only.\n");
  process.exit(1);
}

const mode = process.argv[2] ?? "payments";
const conversations = Number(process.argv[3] ?? 3);
const turns = Number(process.argv[4] ?? 8);
let seed = Number(process.argv[5] ?? Date.now() % 100000);
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const { redis } = await import("../src/system/redis.js");
const { handleMessage, NO_REPLY } = await import("../src/conversation/handleMessage.js");
const { clearConversation } = await import("../src/conversation/memory.js");
const features = (await import("../src/config/index.js")).features ?? {};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const C = { dim: "\x1b[2m", red: "\x1b[31m", yel: "\x1b[33m", grn: "\x1b[32m", cyan: "\x1b[36m", off: "\x1b[0m" };
const out = (s) => process.stdout.write(`${s}\n`);
const flags = [];
const flag = (kind, detail) => { flags.push({ kind, detail }); out(`${C.red}      ⚑ ${kind}: ${detail}${C.off}`); };

/** What the worker would send for this reply, in order (worker.js). */
function outbound(reply, notes) {
  const sent = notes.map((t) => ({ kind: "text", text: t }));
  if (reply === NO_REPLY) return sent;
  if (reply.image && features[reply.image.feature ?? "expenseImages"] !== false) {
    const caption = reply.imageCaption ?? (reply.caption ? reply.caption : reply.text);
    sent.push({ kind: "picture", text: caption ?? "" });
    for (const _ of reply.moreImages ?? []) sent.push({ kind: "picture", text: "" });
    if (reply.imageCaption && reply.body?.trim()) sent.push({ kind: "text", text: reply.body });
  } else {
    sent.push({ kind: "text", text: reply.text ?? "" });
  }
  for (const t of reply.more ?? []) sent.push({ kind: "text", text: t });
  if (reply.receipt) sent.push({ kind: "receipt", text: reply.receipt.filename ?? "receipt" });
  if (reply.attachment) sent.push({ kind: "file", text: reply.attachment.fileName ?? "file" });
  return sent;
}

const CHARACTERS = {
  payments: [
    "a busy worker who types short, lower case, no punctuation, sometimes Taglish words like 'sige', 'po', 'ano'",
    "a worried person who thinks they were underpaid and asks the same thing in different ways",
    "a polite person who asks for a breakdown, then a different month, then whether payday has happened",
    "someone who makes typos, sends 'hi' first, and asks unrelated things in between (the weather, a joke)",
    "a person who answers the payday check ('yes got it' / 'not yet' / 'only half') and then changes their mind",
    "someone who asks about another person's pay, then asks for a file, then says thanks",
  ],
  expenses: [
    "an admin who adds expenses in one line each ('taxi 45 aed careem today'), then fixes one",
    "an admin who asks to see all expenses, then changes 'only 1-3' or 'not 2', then says yes",
    "an admin who adds two at once, cancels, then adds them again with a typo",
    "an admin who changes who spent it ('spent by gloria'), then says 'undo that'",
    "an admin who asks totals ('how much this month'), then deletes one, then asks again",
    "a hurried admin who types 'yes' or 'cancel' at odd moments and mixes in a question",
  ],
};

async function nextLine(character, transcript, i) {
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 1,
    messages: [
      { role: "system", content: `You play a REAL person texting a company WhatsApp bot (${mode === "payments" ? "about your own pay" : "you are an expense admin logging and editing expenses"}). You are ${character}. Write ONLY your next WhatsApp message, short, the way such a person types. React to what the bot just said. Message ${i + 1} of about ${turns}. Never explain yourself. If the conversation is clearly finished, reply exactly END.` },
      { role: "user", content: transcript.slice(-10).map((m) => `${m.who}: ${m.text}`).join("\n") || "(you start the chat)" },
    ],
  });
  return (res.choices?.[0]?.message?.content ?? "").trim().replace(/^"|"$/g, "");
}

async function oneTurn(person, text, messageId) {
  const notes = [];
  const started = Date.now();
  let reply;
  try {
    reply = await handleMessage({
      phone: person.phone, channelGroup: person.group, text, messageId,
      notify: (t) => { notes.push(t); },
      typing: () => () => {},
      typingOnce: () => {},
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), sent: [], ms: Date.now() - started };
  }
  return { reply, sent: outbound(reply, notes), ms: Date.now() - started };
}

async function people() {
  if (mode === "payments") {
    const { syncSheet } = await import("../src/sheet/syncSheet.js");
    const repo = await import("../src/employee/storage.js");
    await syncSheet();
    const all = (await repo.findAll()).filter((a) => a.status === "active" && a.phone);
    const seen = new Set();
    return all.filter((a) => { const k = a.phone; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((a) => ({ phone: a.phone, group: a.group, name: a.personName }));
  }
  const group = process.env.TWO_AGENTS_GROUP ?? "MANBAT";
  return [{ phone: process.env.TWO_AGENTS_ADMIN ?? "+447700900001", group, name: "Test admin" }];
}

const roster = await people();
if (!roster.length) { out("nobody to play: the roster is empty"); process.exit(1); }
out(`${C.cyan}== ${mode.toUpperCase()} · ${conversations} conversations · up to ${turns} turns · seed ${seed}${C.off}`);

for (let c = 1; c <= conversations; c += 1) {
  const person = pick(roster);
  const character = pick(CHARACTERS[mode]);
  await clearConversation(person.phone).catch(() => {});
  out(`\n${C.cyan}--- conversation ${c}: ${person.name} (${person.phone}) on ${person.group}\n    playing: ${character}${C.off}`);
  const transcript = [];
  if (mode === "expenses") {
    const r = await oneTurn(person, "expense", `sim-${Date.now()}-switch`);
    out(`${C.dim}  you > expense${C.off}`);
    for (const m of r.sent) out(`  bot > ${m.text.split("\n").join("\n        ")}`);
  }
  let previous = "";
  for (let i = 0; i < turns; i += 1) {
    const text = await nextLine(character, transcript, i);
    if (!text || text === "END") break;
    transcript.push({ who: "person", text });
    out(`${C.grn}  you > ${text}${C.off}`);
    const messageId = `sim-${Date.now()}-${c}-${i}`;
    const r = await oneTurn(person, text, messageId);
    if (r.error) { flag("ERROR", `crash: ${r.error}`); continue; }
    if (r.reply === NO_REPLY && !r.sent.length) out(`${C.dim}  bot > (no reply)${C.off}`);
    for (const m of r.sent) out(`  bot ${m.kind === "text" ? ">" : `[${m.kind}]`} ${m.text.split("\n").join("\n        ")}`);
    out(`${C.dim}        (${(r.ms / 1000).toFixed(1)}s, ${r.sent.length} message${r.sent.length === 1 ? "" : "s"} to the phone)${C.off}`);
    const texts = r.sent.map((m) => m.text.trim()).filter(Boolean);
    const dup = texts.find((t, k) => texts.indexOf(t) !== k);
    if (dup) flag("DUPLICATE", `sent twice in one turn: "${dup.slice(0, 80)}"`);
    const joined = texts.join("\n");
    if (joined && joined === previous) flag("REPEAT", `same reply as the turn before: "${joined.slice(0, 80)}"`);
    if (r.reply !== NO_REPLY && !joined) flag("ERROR", "empty reply");
    if (/something went wrong|couldn'?t note that|error:/i.test(joined)) flag("ERROR", `bot said: "${joined.slice(0, 100)}"`);
    if (r.ms > 20000) flag("SLOW", `${(r.ms / 1000).toFixed(1)}s`);
    previous = joined;
    transcript.push({ who: "bot", text: joined.slice(0, 600) });
    // A WORKER RETRY: the same message processed again (every 4th turn).
    if (i % 4 === 3) {
      const again = await oneTurn(person, text, messageId);
      const twice = again.sent.map((m) => m.text.trim()).filter(Boolean).join("\n");
      if (twice) out(`${C.yel}      ↻ the same message processed again would send ${again.sent.length}: "${twice.slice(0, 120).replace(/\n/g, " / ")}"${C.off}`);
      if (twice && twice === joined) flag("REDELIVERY", "a worker retry sends the whole reply a second time (BullMQ's jobId stops a redelivery, not a retry)");
      transcript.push({ who: "bot", text: twice.slice(0, 300) });
    }
  }
}

out(`\n${C.cyan}== ${flags.length ? `${flags.length} flags` : "no flags"}${C.off}`);
const by = {};
for (const f of flags) by[f.kind] = (by[f.kind] ?? 0) + 1;
for (const [k, n] of Object.entries(by)) out(`   ${k}: ${n}`);
await redis.quit().catch(() => {});
process.exit(0);
