import { z } from "zod";
import { defineTool } from "./shared/defineTool.js";
import * as access from "../employee/access.js";
import { countLine } from "./format/index.js";
import { MONTH_FIELD, NO_HISTORY } from "./shared/toolInputs.js";

/**
 * "How many companies am I on?" — the count and their names, no amounts.
 *
 * Separate from the breakdown because the answer to "how many" is a number,
 * not four blocks of figures. It also keeps the model out of trouble: it is
 * forbidden from stating a count, so without a tool that returns one the count
 * appeared nowhere at all.
 */
export const myCount = defineTool({
  name: "count_my_companies",
  description:
    'How many companies the caller is on for this number, and their names — no amounts. Use for "how many companies am I on", "which companies am I on", "list my companies".',
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

    const companies = new Set(rows.map((a) => a.company).filter(Boolean)).size;

    return {
      summary: `Returned the caller's own company count for ${ctx.channelGroup}: ${companies}.`,
      display: countLine(rows, ctx.channelGroup),
      subjects: [ctx.person.personId],
      offer: {
        prompt: "Want more?",
        choices: [
          { label: "What each one pays me", ask: "show me my full breakdown" },
          { label: "Just my total", ask: "what is my total this month?" },
        ],
      },
    };
  },
});
