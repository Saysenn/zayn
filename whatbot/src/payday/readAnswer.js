import OpenAI from "openai";
import { z } from "zod";
import { openaiConfig } from "../config/index.js";
import { logger } from "../system/logger.js";

/**
 * A PAYDAY ANSWER IN ANY WORDING (his call 2026-10-07): "oo natanggap ko na",
 * "haan mil gaya", "wala pa", "nahi mila", "got only half". Reached only when
 * the menu numbers and the code classifier could not place it (handleMessage
 * paydayAnswer -> "other"). One small call, a strict choice, their words only.
 *
 * WAGES, SO ONLY WHEN SURE. Reading "not received" as received closes a real
 * complaint; anything it is not sure of is left as "other", and the check
 * stays open and they are asked, as before.
 */
const client = new OpenAI({ apiKey: openaiConfig.apiKey, baseURL: openaiConfig.baseURL, timeout: 15_000 });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "sure"],
  properties: {
    answer: { type: "string", enum: ["yes", "no", "partial", "other"] },
    sure: { type: "boolean" },
  },
};
const Answer = z.object({ answer: z.enum(["yes", "no", "partial", "other"]), sure: z.boolean() });

const SYSTEM = [
  "A worker was asked: did you receive this month's pay? Classify their reply. Any language or slang.",
  "yes: they received it in full. no: nothing arrived yet. partial: some came but not all, or the amount is wrong.",
  "other: a question, something unrelated, or unclear. sure: false if it could be two of these.",
].join("\n");

/** @returns {Promise<"yes"|"no"|"partial"|null>} null when not sure */
export async function readPaydayAnswer(text) {
  if (openaiConfig.mode === "mock" || !String(text ?? "").trim()) return null;
  try {
    const res = await client.chat.completions.create({
      model: openaiConfig.model,
      temperature: 0,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: String(text).slice(0, 300) }],
      response_format: { type: "json_schema", json_schema: { name: "payday", strict: true, schema: SCHEMA } },
    });
    const parsed = Answer.safeParse(JSON.parse(res.choices?.[0]?.message?.content ?? "null"));
    if (!parsed.success || !parsed.data.sure || parsed.data.answer === "other") return null;
    return parsed.data.answer;
  } catch (err) {
    logger.warn({ err: err.message }, "payday answer reader failed; the check stays open");
    return null;
  }
}
