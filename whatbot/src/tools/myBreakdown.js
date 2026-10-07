import { z } from "zod";
import { defineTool } from "./shared/defineTool.js";
import * as access from "../employee/access.js";
import { breakdownByCompany, breakdownSummary } from "./format/index.js";
import { MONTH_FIELD, NO_HISTORY } from "./shared/toolInputs.js";
import { breakdownPicture } from "../pictures/breakdown.js";
import { noteText } from "../payments/elsewhere.js";
import { features } from "../config/features.js";
import { logger } from "../system/logger.js";

/**
 * "What am I owed?" — the question almost everybody asks.
 *
 * Answers for THIS number's group only. Somebody who works across Milkman and
 * Indigo asks the same question on two threads and gets two different answers,
 * which is correct: those are two separate sets of companies.
 */
export const myBreakdown = defineTool({
  name: "get_my_breakdown",
  description:
    "The caller's own companies on this number, and what each one pays them this month. Use for any question about their own pay, their companies, or what they are owed. No historical months exist.",
  schema: z.object({ month: MONTH_FIELD }),
  handler: async (args, ctx) => {
    if (args.month) return { summary: NO_HISTORY };

    const rows = await access.readable(ctx);
    if (rows.length === 0) {
      return {
        summary:
          "The caller holds nothing on this number. Say so kindly in one line, and mention that if they work with another group they should try that number.",
      };
    }

    const companies = new Set(rows.map((r) => r.company).filter(Boolean)).size;

    // THE PICTURE, every time (his call 2026-10-07); text stays the fallback
    const image = features.payImages
      ? await breakdownPicture(rows, ctx).catch((err) => { logger.warn({ err: err.message }, "breakdown picture failed, sending text"); return null; })
      : null;

    return {
      ...(image ? { image } : {}),
      // no names, no amounts — this line is all the model ever sees
      summary: `Returned the caller's own breakdown for ${ctx.channelGroup}: ${breakdownSummary(rows)}.`,
      // the text keeps the same note, for when the picture is off
      display: [breakdownByCompany(rows, { group: ctx.channelGroup }), noteText(ctx)].filter(Boolean).join("\n\n"),
      subjects: [ctx.person.personId],
      offer:
        companies > 1
          ? {
              prompt: "Anything else?",
              choices: [
                { label: "Just my total", ask: "what is my total this month?" },
                {
                  label: "Which pays me most",
                  ask: "which company pays me the most?",
                },
              ],
            }
          : undefined,
    };
  },
});
