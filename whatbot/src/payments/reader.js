import OpenAI from "openai";
import { z } from "zod";
import { openaiConfig } from "../config/index.js";
import { tools } from "../tools/index.js";
import { invokeTool } from "../agent/toolRunner.js";
import { logger } from "../system/logger.js";
import { ANOTHER_MONTH } from "./quick.js";

/**
 * THE SMALL QUESTION READER: what code does not catch, read in one small
 * call into the tool that answers it (his call 2026-10-07). It sees the
 * question and the caller's OWN company names, nothing else: no prompt of
 * rules, no tool schemas, no figures. Then the tool runs once, and its own
 * display is the reply, exactly as on the model's path.
 *
 * Not sure, or a tool that only explained something (a month it does not
 * hold), goes on to the full agent as before. "magkano sahod ko", "kitna
 * milega", "how much this mnth", "what do I get from imperium" land here.
 */
const client = new OpenAI({ apiKey: openaiConfig.apiKey, baseURL: openaiConfig.baseURL, timeout: 15_000 });

const TOOLS = ["get_my_breakdown", "get_my_total", "get_my_company", "count_my_companies", "get_my_dates", "rank_my_companies", "none"];
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tool", "company", "sort", "limit", "sure"],
  properties: {
    tool: { type: "string", enum: TOOLS },
    company: { type: "string", description: "ONE of their companies exactly as listed, or empty" },
    sort: { type: "string", enum: ["", "highest", "lowest"] },
    limit: { type: ["integer", "null"] },
    sure: { type: "boolean" },
  },
};
const Shape = z.object({ tool: z.enum(TOOLS), company: z.string(), sort: z.enum(["", "highest", "lowest"]), limit: z.number().int().nullable(), sure: z.boolean() });

const SYSTEM = [
  "A worker asks a WhatsApp bot about THEIR OWN pay. Pick the one tool that answers. Any language, slang or typos.",
  "get_my_breakdown: what they are owed / their pay / salary / am I getting paid, company by company (the default for a plain pay question).",
  "get_my_total: ONLY when they ask for one total figure. get_my_company: what ONE named company pays them.",
  "count_my_companies: which / how many companies (no amounts). get_my_dates: start, end, how long.",
  "rank_my_companies: which pays most / least / top N (sort, limit).",
  "none: another person's pay, another month, a greeting, anything else. sure: false if unsure or two questions.",
].join("\n");

export async function answerByReader(ctx, text) {
  // ANOTHER MONTH is the agent's to answer: the reader has no months, and
  // answered "my total last month" with this month's figures (eval 2026-10-07)
  if (openaiConfig.mode === "mock" || ANOTHER_MONTH.test(String(text ?? ""))) return null;
  const companies = [...new Set(ctx.person.assignments.filter((a) => a.group === ctx.channelGroup).map((a) => a.company).filter(Boolean))];
  let shape;
  try {
    const res = await client.chat.completions.create({
      model: openaiConfig.model,
      temperature: 0,
      messages: [
        { role: "system", content: `${SYSTEM}\nTheir companies: ${companies.join(", ") || "none"}.` },
        { role: "user", content: String(text).slice(0, 300) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "pay_question", strict: true, schema: SCHEMA } },
    });
    const parsed = Shape.safeParse(JSON.parse(res.choices?.[0]?.message?.content ?? "null"));
    if (!parsed.success) return null;
    shape = parsed.data;
  } catch (err) {
    logger.warn({ err: err.message }, "payments reader failed, the agent answers");
    return null;
  }
  if (!shape.sure || shape.tool === "none") return null;
  // a company it named must be one of theirs, exactly
  const company = shape.company ? companies.find((c) => c.toLowerCase() === shape.company.toLowerCase()) : null;
  if (shape.company && !company) return null;
  const args = {
    ...(company && ["get_my_company", "get_my_dates"].includes(shape.tool) ? { company } : {}),
    ...(shape.tool === "rank_my_companies" ? { sort: shape.sort || "highest", ...(shape.limit ? { limit: shape.limit } : {}) } : {}),
  };
  if (shape.tool === "get_my_company" && !company) return null;
  const result = await invokeTool(tools, shape.tool, JSON.stringify(args), ctx);
  if (!result?.display) return null;
  logger.info({ tool: shape.tool, actor: ctx.person.personId }, "payments: answered by the reader");
  return {
    text: result.display,
    hadDisplay: true,
    subjectCount: (result.subjects ?? []).length,
    offer: result.offer,
    attachment: result.attachment,
    image: result.image,
    tools: [shape.tool],
  };
}
