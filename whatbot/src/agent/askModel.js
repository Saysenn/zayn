import OpenAI from "openai";
import { openaiConfig } from "../config/index.js";
import { logger } from "../system/logger.js";
import { invokeTool, toOpenAITools } from "./toolRunner.js";
import { tools } from "../tools/index.js";
import { systemPrompt } from "./prompt.js";
import { containsFigures, containsNameList } from "./blockFakeNumbers.js";
import { noDashes } from "./noDashes.js";

const client = new OpenAI({
  apiKey: openaiConfig.apiKey,
  baseURL: openaiConfig.baseURL,
  timeout: openaiConfig.requestTimeoutMs,
});

/**
 * The model is unreachable — out of quota, or the key is wrong.
 *
 * The message on this error goes STRAIGHT TO SOMEBODY'S PHONE, so it says what
 * a person would say and nothing else. "The AI service has hit its usage limit,
 * set LLM_MODE=mock" was, briefly, real text sent to a real employee asking
 * about their wages. Whatever went wrong is our problem, and it belongs in the
 * log where somebody can act on it.
 */
export class LlmUnavailableError extends Error {}

/** what they read. deliberately identical whatever the cause — it is not their problem. */
const BUSY =
  "Sorry, I'm a bit swamped at the moment. Give me a few minutes and ask me again?";

/**
 * The agent loop.
 *
 *   ask the LLM > it asks for tools > we run them > send results back > repeat
 *   until it stops asking for tools and just answers. Max 4 rounds.
 *
 * The LLM writes the sentence. We paste the real figures underneath it.
 */
export async function runAgent(ctx, question, history) {
  // mock mode = pick tools by keyword, no API call (for when a free tier runs out)
  if (openaiConfig.mode === "mock") {
    const { runMockAgent } = await import("./offlineMode.js");
    return runMockAgent(ctx, question);
  }

  // what we send the LLM: the rules, the last few turns, then the new question
  const messages = [
    { role: "system", content: systemPrompt(ctx) },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];

  // built per person — the group list only contains groups THIS caller can see
  const openAITools = await toOpenAITools(tools, ctx);

  // the real figures, kept out here so the LLM never sees them.
  // keyed by tool name so calling one tool twice gives one block, not two copies.
  const displayByTool = new Map();
  const subjects = new Set();
  /** the last tool to offer one wins — it is the one that answered the question */
  let offer;
  /**
   * At most ONE file per reply, and the first tool to build one keeps it.
   *
   * Two documents landing on somebody's phone from one question is not an
   * answer, it is a mess — and the second would silently overwrite the first
   * in the chat list, which is the version they would open.
   */
  let attachment;
  /** a tool's picture (the pay breakdown), the first one wins */
  let image;
  /** same tool + same arguments = reuse the answer instead of running it again */
  const seenCalls = new Map();
  /** we push back exactly once when it answers from memory instead of looking */
  let nudgedToUseATool = false;

  for (let round = 0; round < openaiConfig.maxToolRounds; round++) {
    let completion;
    try {
      // ---- send to the LLM ----
      completion = await client.chat.completions.create({
        model: openaiConfig.model,
        temperature: openaiConfig.temperature,
        messages,
        tools: openAITools,
      });
    } catch (err) {
      const status = err.status;
      const code = err.code;

      // the LLM picked an argument it wasn't allowed to (usually a group).
      // tell it what it did wrong and let it try once more.
      if (status === 400 && code === "tool_use_failed") {
        logger.warn(
          { actor: ctx.person.personId, round },
          "provider rejected tool arguments",
        );
        if (round < openaiConfig.maxToolRounds - 1) {
          messages.push({
            role: "user",
            content:
              "That tool call was rejected because an argument was not allowed. Only use values listed in the tool schema — especially for group. If the value you wanted is not listed, call the tool without that argument and say what is available.",
          });
          continue;
        }
        return {
          text: "I can't look that up, sorry. It may be outside what you can see. Try asking about one of your own companies?",
          hadDisplay: false,
          subjectCount: 0,
        };
      }

      // out of credit / bad key. retrying won't fix either, so say so and stop.
      if (status === 429) {
        logger.error(
          { model: openaiConfig.model },
          "LLM quota exhausted — nobody is being answered until this is topped up",
        );
        throw new LlmUnavailableError(BUSY);
      }
      if (status === 401 || status === 403) {
        logger.error(
          { model: openaiConfig.model },
          "LLM rejected our credentials — check OPENAI_API_KEY. Nobody is being answered.",
        );
        throw new LlmUnavailableError(BUSY);
      }
      throw err;
    }

    // ---- read what came back ----
    const choice = completion.choices[0]?.message;
    if (!choice) {
      return {
        text: "Sorry, I didn't quite catch that. Try me again?",
        hadDisplay: false,
        subjectCount: 0,
      };
    }

    const calls = choice.tool_calls ?? [];

    // no tool calls = the LLM is done thinking and this is the answer
    if (calls.length === 0) {
      const displays = [...displayByTool.values()];
      const prose = choice.content?.trim();

      if (displays.length > 0) {
        /**
         * The tool's own words, verbatim. The model's prose is discarded.
         *
         * It used to go on top, and it kept containing amounts — so the guard
         * stripped it and left a bare "Here you go:" on nearly every reply.
         * Fighting that with prompt rules failed too: told never to state a
         * figure and never to apologise for one, a small model does both.
         *
         * So the model does the part only it can do — working out what was
         * asked and which tool answers it — and everything the user reads is
         * written here.
         */
        return {
          text: displays.join("\n\n"),
          hadDisplay: true,
          subjectCount: subjects.size,
          offer,
          attachment,
          image,
        };
      }

      // No tool ran, but it wrote numbers or a list of names anyway = it made
      // them up. (It once invented three employees who don't work here.)
      //
      // This happens most on a FOLLOW-UP — "break it down for me", "and the
      // other one" — where the answer is sitting in the conversation and the
      // model recites it instead of looking it up. Telling the user to ask
      // again is a dead end: they already asked, clearly, and rephrasing is
      // our job not theirs. So push back once and let it try properly.
      if (prose && (containsFigures(prose) || containsNameList(prose))) {
        if (!nudgedToUseATool) {
          nudgedToUseATool = true;
          logger.warn(
            { actor: ctx.person.personId },
            "model answered from memory — pushing it to call a tool",
          );
          messages.push({
            role: "user",
            content:
              "You answered without calling a tool. Figures from earlier in this conversation are stale and must never be repeated. Work out what was being referred to, call the right tool, and let the figures be attached.",
          });
          continue;
        }

        logger.error(
          { actor: ctx.person.personId },
          "model invented figures with no tool call",
        );
        return {
          text: "Sorry, I didn't get that quite right. Which company did you mean?",
          hadDisplay: false,
          subjectCount: 0,
        };
      }

      // plain answer, no data involved ("I don't hold holiday balances")
      return {
        // prose only. The code-built displays never come through here, which is
        // what keeps hyphenated company names and dates intact.
        text: (prose && noDashes(prose)) || "Sorry, I have no answer for that.",
        hadDisplay: false,
        subjectCount: 0,
      };
    }

    // ---- it asked for tools. run them. ----
    messages.push(choice); // keep its request in the conversation or the next call breaks

    // did every tool this round write its own answer? (see below)
    let allDisplayed = calls.length > 0;
    for (const call of calls) {
      if (call.type !== "function") continue;

      // already ran this exact call? reuse it. stops the LLM looping on itself.
      const key = `${call.function.name}:${call.function.arguments}`;
      const cached = seenCalls.get(key);
      if (cached) {
        messages.push({ role: "tool", tool_call_id: call.id, content: cached });
        continue;
      }

      const result = await invokeTool(
        tools,
        call.function.name,
        call.function.arguments,
        ctx,
      );
      if (result.display) displayByTool.set(call.function.name, result.display); // real figures, kept back
      else allDisplayed = false;
      if (result.offer) offer = result.offer;
      if (result.attachment && !attachment) attachment = result.attachment;
      if (result.image && !image) image = result.image;
      for (const code of result.subjects ?? []) subjects.add(code);
      seenCalls.set(key, result.summary);

      // THE IMPORTANT LINE: only the summary goes back to the LLM.
      // "Returned 12 people (paid by cash)" — no names, no amounts.
      // it can't get a number wrong if it never saw one.
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.summary,
      });
    }

    /**
     * ===============================
     * * EVERY TOOL ANSWERED: DONE, NO SECOND CALL
     * ===============================
     * The reply is the tools' own displays and the model's wording is thrown
     * away (above), so asking it again only to write a sentence nobody reads
     * doubled every answer's cost and time (measured 2026-10-07: 2 calls,
     * $0.0020 and ~2.3s per question). When each tool this round wrote its
     * display, that IS the answer. A tool that only explained something (a
     * month it does not hold, a company it could not place) still goes back
     * to the model to be said in words.
     */
    if (allDisplayed && displayByTool.size > 0) {
      return {
        text: [...displayByTool.values()].join("\n\n"),
        hadDisplay: true,
        subjectCount: subjects.size,
        offer,
        attachment,
        image,
      };
    }
  }

  // 4 rounds and still asking for tools. give back whatever we collected.
  logger.warn({ actor: ctx.person.personId }, "agent hit max tool rounds");
  const fallback = [...displayByTool.values()];
  if (fallback.length > 0) {
    return {
      text: fallback.join("\n\n"),
      hadDisplay: true,
      subjectCount: subjects.size,
      attachment,
      image,
    };
  }
  return {
    text: "That one's got me tied in knots, sorry. Could you narrow it down a bit?",
    hadDisplay: false,
    subjectCount: 0,
  };
}
