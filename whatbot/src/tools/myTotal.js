import { z } from "zod";
import { defineTool } from "./shared/defineTool.js";
import * as access from "../employee/access.js";
import { totalLine, totalsByCurrency } from "./format/index.js";
import { MONTH_FIELD, NO_HISTORY } from "./shared/toolInputs.js";

/**
 * "What's my total?" — the number, and nothing else.
 *
 * Its own tool rather than an argument to a broader one. A small model reliably
 * picks between differently-named tools; it does not reliably remember to set
 * `aggregate: 'sum'`, and when it forgot, "what's my total" came back as the
 * entire list with the total buried at the bottom.
 */
export const myTotal = defineTool({
  name: "get_my_total",
  description:
    'ONE figure and no list: the sum across everything on this number. Use ONLY when they ask for a total or a single number — "what is my total", "how much altogether", "add it all up". For a plain "what am I owed" or "my pay", use get_my_breakdown instead.',
  schema: z.object({ month: MONTH_FIELD }),
  handler: async (args, ctx) => {
    if (args.month) return { summary: NO_HISTORY };

    const rows = await access.readable(ctx);
    if (rows.length === 0) {
      return {
        summary:
          "The caller holds nothing on this number. Say so kindly in one line, and offer to help with anything else.",
      };
    }

    return {
      summary: `Returned the caller's own total for ${ctx.channelGroup} (${totalsByCurrency(rows)} across ${rows.length} assignments).`,
      display: totalLine(rows, ctx.channelGroup),
      subjects: [ctx.person.personId],
      offer: {
        prompt: "Want more?",
        choices: [
          {
            label: "The breakdown behind it",
            ask: "show me my full breakdown",
          },
          {
            label: "Which pays me most",
            ask: "which company pays me the most?",
          },
        ],
      },
    };
  },
});
