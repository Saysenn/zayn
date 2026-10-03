import { z } from "zod";
import { schemaOf } from "../tools/shared/defineTool.js";
import { record } from "../system/audit.js";
import { logger } from "../system/logger.js";

/**
 * The bridge between the LLM and our tools. Two functions:
 *
 *   toOpenAITools   our tools  ->  the LLM   ("here is what you can ask for")
 *   invokeTool      the LLM    ->  our tools ("run this one")
 *
 * The loop that calls these lives in askModel.ts.
 * What a tool IS lives in tools/shared/defineTool.ts.
 */

/**
 * Run one tool the LLM asked for.
 *
 * name    what the LLM called it, e.g. "get_my_breakdown"
 * rawArgs its arguments, as a JSON string
 * ctx     who is asking. From the verified phone number, never from the LLM.
 *
 * Validate, run, audit. Here rather than in each tool so tool number eight
 * cannot forget the audit log.
 */
export async function invokeTool(tools, name, rawArgs, ctx) {
  // 1. FIND the tool. `tools` is a plain array, built once at boot.
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    // the LLM half-remembered a name. reply, do not crash.
    logger.warn({ name }, "model requested an unknown tool");
    return { summary: `No such tool: ${name}` };
  }

  // 2. PARSE. arguments arrive as a JSON string.
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawArgs || "{}");
  } catch {
    return { summary: "Arguments were not valid JSON." };
  }

  // 3. VALIDATE. the LLM is untrusted input, even when it looks fine.
  // Same schema we sent it, so the allowed companies are checked twice.
  const args = (await schemaOf(tool, ctx)).safeParse(parsedJson);
  if (!args.success) {
    return {
      summary: `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    };
  }

  // 4. RUN. args from the LLM, ctx from us. That is why no tool takes an
  // identity: the LLM has no say in whose data gets read.
  const result = await tool.handler(args.data, ctx);

  // 5. AUDIT. proves who looked at whose records.
  await record({
    actor: ctx.person.personId,
    tool: name,
    args: args.data,
    subjects: result.subjects ?? [],
    flagged: result.flagged,
  });

  return result;
}

/** turn our tools into the JSON Schema format the LLM API expects */
export async function toOpenAITools(tools, ctx) {
  return Promise.all(
    tools.map(async (t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: z.toJSONSchema(await schemaOf(t, ctx)),
      },
    })),
  );
}
