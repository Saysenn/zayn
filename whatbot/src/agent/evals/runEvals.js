import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { openaiConfig } from "../../config/index.js";
import { redis } from "../../system/redis.js";
import { syncSheet } from "../../sheet/syncSheet.js";
import * as employees from "../../employee/access.js";
import * as repo from "../../employee/storage.js";
import { toOpenAITools } from "../toolRunner.js";
import { tools } from "../../tools/index.js";
import { systemPrompt } from "../prompt.js";

const client = new OpenAI({
  apiKey: openaiConfig.apiKey,
  baseURL: openaiConfig.baseURL,
  timeout: openaiConfig.requestTimeoutMs,
});

const cases = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);

await syncSheet();
const all = await repo.findAll();

/**
 * Pick which assignment to run a test case as.
 *
 * If the question mentions a company, the person we pick has to actually hold
 * it on that thread — otherwise it isn't in their allowed list, the API rejects
 * the call, and the test fails for a completely unrelated reason.
 *
 * Always picks the first match, so two runs are comparable. And it searches
 * rather than hardcoding names, so regenerating the sample data doesn't quietly
 * break the whole suite.
 */
async function pickBy(role, needsCompany) {
  const candidates = all.filter(
    (a) => a.role === role && a.status === "active" && a.phone,
  );

  if (!needsCompany) {
    const found = candidates[0];
    if (!found)
      throw new Error(`no active ${role} with a phone in the fixture`);
    return found;
  }

  for (const c of candidates) {
    const ctx = await employees.identify(c.phone, c.group);
    if (!ctx) continue;
    const companies = await employees.companiesInScope(ctx);
    if (companies.includes(needsCompany)) return c;
  }
  throw new Error(
    `no active ${role} holds "${needsCompany}" — fix the case or the fixture`,
  );
}

/** free tiers cap requests per minute. slow down and retry instead of dying halfway. */
const PACE_MS = Number(process.env.EVAL_PACE_MS ?? 7000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, attempts = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status;
      // only retry rate limits. a 400 means we sent something wrong — retrying
      // sends the same wrong thing again.
      if (status !== 429 || i >= attempts - 1) throw err;
      const wait = 20_000 * (i + 1);
      console.log(`     rate limited, waiting ${wait / 1000}s…`);
      await sleep(wait);
    }
  }
}

let passed = 0;
const failures = [];

for (const [i, c] of cases.entries()) {
  const me = await pickBy(
    c.as,
    typeof c.args?.company === "string" ? c.args.company : undefined,
  );
  // identify on THEIR group — the thread decides which companies are in play
  const ctx = await employees.identify(me.phone, me.group);
  if (!ctx)
    throw new Error(`could not identify ${me.personName} (${me.group})`);

  const messages = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: c.ask },
  ];
  const await_tools = await toOpenAITools(tools, ctx);

  if (i > 0) await sleep(PACE_MS);

  let completion;
  try {
    completion = await withRetry(() =>
      client.chat.completions.create({
        model: openaiConfig.model,
        temperature: openaiConfig.temperature,
        messages,
        tools: await_tools,
      }),
    );
  } catch (err) {
    // one broken case shouldn't take down the whole run
    const detail = err.error?.message ?? String(err);
    const label = `[${String(i + 1).padStart(2)}] ${c.as.padEnd(8)} "${c.ask}"`;
    console.log(
      `  \u274c ${label}\n       provider error: ${detail.slice(0, 120)}`,
    );
    failures.push(`${label} — provider error`);
    continue;
  }

  const call = completion.choices[0]?.message.tool_calls?.[0];
  const gotTool = call && call.type === "function" ? call.function.name : null;
  const gotArgs =
    call && call.type === "function"
      ? JSON.parse(call.function.arguments || "{}")
      : {};

  const allowed = Array.isArray(c.tool) ? c.tool : [c.tool];
  const toolOk = allowed.includes(gotTool);
  const argsOk =
    !c.args || Object.entries(c.args).every(([k, v]) => gotArgs[k] === v);

  const label = `[${String(i + 1).padStart(2)}] ${c.as.padEnd(8)} "${c.ask}"`;

  if (toolOk && argsOk) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    const detail = !toolOk
      ? `expected ${allowed.map((t) => t ?? "no tool").join(" or ")}, got ${gotTool ?? "no tool"}`
      : `args expected ${JSON.stringify(c.args)}, got ${JSON.stringify(gotArgs)}`;
    console.log(`  ❌ ${label}\n       ${detail}`);
    failures.push(`${label} — ${detail}`);
  }
}

const pct = Math.round((passed / cases.length) * 100);
console.log(`\n${passed}/${cases.length} passed (${pct}%)\n`);

if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  ${f}`);
}

await redis.quit();
process.exit(failures.length > 0 ? 1 : 0);
