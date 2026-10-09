/**
 * HOW WELL THE PAYMENTS SIDE ANSWERS: right tool, cost, speed, which path.
 * Run by a person: `npm run eval`. Rewritten 2026-10-07; the old set asked
 * for a get_my_pay tool and a "courier" role that no longer exist.
 *
 * It runs every question through the REAL handler (handleMessage), as one
 * employee from the FAKE sheet, against a THROWAWAY Redis. It must never
 * point at the live bot's Redis: loading the sheet would overwrite the
 * live roster. So it refuses to run unless DATA_SOURCE=fake and REDIS_URL
 * is set to something other than .env's:
 *
 *   docker run -d --rm --name whatbot-test-redis -p 6391:6379 redis:7-alpine
 *   DATA_SOURCE=fake REDIS_URL=redis://127.0.0.1:6391 npm run eval
 *
 * "want" is the tool(s) that answer it right, `a|b` for either, "none" for
 * a message no pay tool should touch. A question answered IN CODE (no
 * model) counts as right when the code path names the wanted tool.
 */
import { readFile } from "node:fs/promises";
import { Completions } from "openai/resources/chat/completions";

// The live bot's Redis: whatever .env names (local 127.0.0.1:6379 since
// 2026-10-09), and the ones it used before (Upstash, local 6390). Read from
// the file, not the environment, so an override cannot hide it.
const liveRedis = /^REDIS_URL=(.*)$/m.exec(await readFile(new URL("../../../.env", import.meta.url), "utf8").catch(() => ""))?.[1]?.trim();
const samePlace = (a, b) => {
  try {
    const x = new URL(a); const y = new URL(b);
    const host = (h) => (h === "localhost" ? "127.0.0.1" : h);
    return host(x.hostname) === host(y.hostname) && (x.port || "6379") === (y.port || "6379");
  } catch { return false; }
};
if (process.env.DATA_SOURCE !== "fake" || !process.env.REDIS_URL || (liveRedis && samePlace(process.env.REDIS_URL, liveRedis)) || /:6390\b|upstash\.io/.test(process.env.REDIS_URL)) {
  process.stderr.write("refusing: run with DATA_SOURCE=fake and a throwaway REDIS_URL (not the live bot's)\n");
  process.exit(1);
}

const { redis } = await import("../../system/redis.js");
const { syncSheet } = await import("../../sheet/syncSheet.js");
const { handleMessage, NO_REPLY } = await import("../../conversation/handleMessage.js");

// every model call, counted: tokens, cost, and the tools it asked for
const PRICE = { "gpt-4.1-mini": [0.4, 1.6], "gpt-4.1": [2, 8], "gpt-4.1-nano": [0.1, 0.4] };
let calls = [];
const create = Completions.prototype.create;
Completions.prototype.create = async function counted(body, ...rest) {
  const res = await create.call(this, body, ...rest);
  const [pin, pout] = PRICE[body.model] ?? [2, 8];
  const u = res.usage ?? {};
  calls.push({
    model: body.model,
    usd: ((u.prompt_tokens ?? 0) * pin + (u.completion_tokens ?? 0) * pout) / 1e6,
    tools: (res.choices?.[0]?.message?.tool_calls ?? []).map((t) => t.function?.name),
  });
  return res;
};
// the payments agent v2 (PAYMENTS_V2=1) speaks the Responses API: counted
// the same way. Prices for newer models from EVAL_PRICE_IN/OUT ($ per 1M).
const { Responses } = await import("openai/resources/responses/responses");
const respond = Responses.prototype.create;
Responses.prototype.create = async function counted(body, ...rest) {
  const res = await respond.call(this, body, ...rest);
  const [pin, pout] = PRICE[body.model] ?? [Number(process.env.EVAL_PRICE_IN ?? 2), Number(process.env.EVAL_PRICE_OUT ?? 8)];
  const u = res.usage ?? {};
  calls.push({
    model: body.model,
    usd: ((u.input_tokens ?? 0) * pin + (u.output_tokens ?? 0) * pout) / 1e6,
    tools: (res.output ?? []).filter((o) => o.type === "function_call").map((o) => o.name),
  });
  return res;
};

const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"));
await syncSheet();
const PHONE = process.env.EVAL_PHONE ?? "+447100000918";
const GROUP = process.env.EVAL_GROUP ?? "INDIGO";

let right = 0;
let usd = 0;
let ms = 0;
const paths = {};
for (const [i, c] of cases.entries()) {
  calls = [];
  // a fresh minute for each question: the per minute limit is not under test
  // and a fresh conversation, so each question stands alone
  for (const k of [...await redis.keys("rl:*"), ...await redis.keys("conv:*")]) await redis.del(k);
  const t0 = Date.now();
  const reply = await handleMessage({ phone: PHONE, channelGroup: GROUP, text: c.ask, messageId: `eval-${Date.now()}-${i}` });
  const took = Date.now() - t0;
  const used = [...new Set([...calls.flatMap((x) => x.tools), ...(reply?.tools ?? [])])];
  const want = c.want.split("|");
  // "none" in the list: answering in words with no tool is right too
  const ok = (want.includes("none") && used.length === 0) || (used.length > 0 && used.every((t) => want.includes(t)));
  const cost = calls.reduce((n, x) => n + x.usd, 0);
  const path = calls.length === 0 ? "code" : `${calls.length} model call${calls.length > 1 ? "s" : ""}`;
  paths[path] = (paths[path] ?? 0) + 1;
  if (ok) right += 1;
  usd += cost;
  ms += took;
  const text = reply === NO_REPLY ? "(no reply)" : String(reply.text ?? "").replace(/\s+/g, " ").slice(0, 90);
  process.stdout.write(`${ok ? "✅" : "❌"} [${String(i + 1).padStart(2)}] ${c.ask.padEnd(46)} ${path.padEnd(14)} $${cost.toFixed(4)} ${String(took).padStart(5)}ms  ${ok ? "" : `want ${c.want}, used ${used.join(",") || "nothing"}`}\n     → ${text}${reply?.image ? "  [+ picture]" : ""}\n`);
}
process.stdout.write(`\n${right}/${cases.length} right · total $${usd.toFixed(4)} · avg $${(usd / cases.length).toFixed(5)} per question · avg ${Math.round(ms / cases.length)}ms · paths ${JSON.stringify(paths)}\n`);
await redis.quit();
process.exit(0);
