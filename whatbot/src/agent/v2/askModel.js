import OpenAI from "openai";
import { openaiConfig } from "../../config/index.js";
import { logger } from "../../system/logger.js";
import { invokeTool } from "../toolRunner.js";
import { schemaOf } from "../../tools/shared/defineTool.js";
import { tools } from "../../tools/index.js";
import { systemPrompt } from "../prompt.js";
import { containsFigures, containsNameList } from "../blockFakeNumbers.js";
import { noDashes } from "../noDashes.js";
import { LlmUnavailableError } from "../askModel.js";
import { z } from "zod";

/**
 * ***************************************************
 * * THE PAYMENTS AGENT, V2 (2026-10-09)
 * ***************************************************
 * Beside v1 (../askModel.js) and off unless PAYMENTS_V2=1. The same tools,
 * the same prompt, the same promises; what changes is the model and the API:
 *
 *   v1  gpt-4.1-mini on Chat Completions, temperature 0.2
 *   v2  a current model (PAYMENTS_V2_MODEL, gpt-5.4-mini) on the Responses
 *       API, which is the only door newer models take tools with reasoning
 *
 * Unchanged on purpose, because they are why v1 is safe:
 *   - who is asking comes from the verified phone (ctx), never the model
 *   - the tools list only the caller's own companies (schemaOf(tool, ctx))
 *   - every call goes through invokeTool: validated and audited
 *   - the reply is the tools' own display; the model's words are thrown away
 *   - the model sees each tool's summary only, never the figures
 *   - an answer from memory is pushed back once, then refused
 *   - every tool answered = done, no second call to write a sentence
 *
 * Scored against v1 on the same evals (src/agent/evals) before it is used.
 */

const client = new OpenAI({
  apiKey: openaiConfig.apiKey,
  baseURL: openaiConfig.baseURL,
  timeout: openaiConfig.requestTimeoutMs,
});

const BUSY =
  "Sorry, I'm a bit swamped at the moment. Give me a few minutes and ask me again?";

/** the Responses API's tool shape: flat, not nested under `function` */
async function responseTools(ctx) {
  return Promise.all(
    tools.map(async (t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: z.toJSONSchema(await schemaOf(t, ctx)),
      strict: false,
    })),
  );
}

export async function runAgentV2(ctx, question, history) {
  const { model, effort } = openaiConfig.v2;
  const input = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
  const toolList = await responseTools(ctx);

  const displayByTool = new Map();
  const subjects = new Set();
  let offer;
  let attachment;
  let image;
  const seenCalls = new Map();
  let nudgedToUseATool = false;

  const answered = () => ({
    text: [...displayByTool.values()].join("\n\n"),
    hadDisplay: true,
    subjectCount: subjects.size,
    offer,
    attachment,
    image,
  });

  for (let round = 0; round < openaiConfig.maxToolRounds; round++) {
    let res;
    try {
      res = await client.responses.create({
        model,
        instructions: systemPrompt(ctx),
        input,
        tools: toolList,
        reasoning: { effort },
      });
    } catch (err) {
      if (err.status === 429 || err.status === 401 || err.status === 403) {
        logger.error({ model, status: err.status }, "payments v2: model unreachable, nobody is being answered");
        throw new LlmUnavailableError(BUSY);
      }
      throw err;
    }

    const calls = res.output.filter((o) => o.type === "function_call");
    logger.info(
      {
        model,
        round,
        inputTokens: res.usage?.input_tokens,
        cachedTokens: res.usage?.input_tokens_details?.cached_tokens,
        outputTokens: res.usage?.output_tokens,
        tools: calls.map((c) => c.name),
      },
      "payments v2: model round",
    );

    // ---- no tools: the answer ----
    if (calls.length === 0) {
      if (displayByTool.size > 0) return answered();
      const prose = res.output_text?.trim();
      if (prose && (containsFigures(prose) || containsNameList(prose))) {
        if (!nudgedToUseATool) {
          nudgedToUseATool = true;
          logger.warn({ actor: ctx.person.personId }, "payments v2: answered from memory, pushing it to a tool");
          input.push(...res.output, {
            role: "user",
            content:
              "You answered without calling a tool. Figures from earlier in this conversation are stale and must never be repeated. Work out what was being referred to, call the right tool, and let the figures be attached.",
          });
          continue;
        }
        logger.error({ actor: ctx.person.personId }, "payments v2: invented figures with no tool call");
        return { text: "Sorry, I didn't get that quite right. Which company did you mean?", hadDisplay: false, subjectCount: 0 };
      }
      return {
        text: (prose && noDashes(prose)) || "Sorry, I have no answer for that.",
        hadDisplay: false,
        subjectCount: 0,
      };
    }

    // ---- run the tools ----
    input.push(...res.output);
    let allDisplayed = true;
    for (const call of calls) {
      const key = `${call.name}:${call.arguments}`;
      const cached = seenCalls.get(key);
      if (cached) {
        input.push({ type: "function_call_output", call_id: call.call_id, output: cached });
        continue;
      }
      const result = await invokeTool(tools, call.name, call.arguments, ctx);
      if (result.display) displayByTool.set(call.name, result.display);
      else allDisplayed = false;
      if (result.offer) offer = result.offer;
      if (result.attachment && !attachment) attachment = result.attachment;
      if (result.image && !image) image = result.image;
      for (const code of result.subjects ?? []) subjects.add(code);
      seenCalls.set(key, result.summary);
      // the summary only: the model never sees a figure it could get wrong
      input.push({ type: "function_call_output", call_id: call.call_id, output: result.summary ?? "" });
    }
    if (allDisplayed && displayByTool.size > 0) return answered();
  }

  logger.warn({ actor: ctx.person.personId }, "payments v2: hit max tool rounds");
  if (displayByTool.size > 0) return answered();
  return {
    text: "That one's got me tied in knots, sorry. Could you narrow it down a bit?",
    hadDisplay: false,
    subjectCount: 0,
  };
}
