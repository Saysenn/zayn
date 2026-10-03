import { z } from "zod";
import { defineTool } from "./shared/defineTool.js";
import * as access from "../employee/access.js";
import { datesByCompany, datesSummary } from "./format/index.js";
import {
  companyOnlySchema,
  emptyMessage,
  notYours,
} from "./shared/toolInputs.js";

/**
 * "When did this start?", "when does it end?", "how long have I got left?"
 *
 * The dates were always on every row. Nothing exposed them, so the bot answered
 * the second most common question after "what am I owed" by saying it had no
 * idea — which was never true, only unimplemented.
 *
 * It reports what the sheet holds and says so plainly when the sheet holds
 * nothing. It never works out how many months are left, and it never calls an
 * end date settled: those get amended, and a number the bot computed would be
 * read as a promise.
 */
export const myDates = defineTool({
  name: "get_my_dates",
  description:
    'When the caller\'s own assignments on this number started and when they end. Use for ANY question about time, dates, duration or what is left to run, even when it mentions pay and names no date: "when did this start", "when does my payment end", "how long have I got left", "how much longer", "how long is this for", "is this my last month", "when does it stop", "how many months left". A question about HOW LONG is always this tool, never get_my_breakdown. Returns dates only, no amounts.',
  schema: z.object({ company: z.string().nullish() }),
  schemaFor: companyOnlySchema,
  handler: async (args, ctx) => {
    const available = await access.companiesInScope(ctx);
    const rows = await access.readable(ctx, args.company ?? undefined);

    if (rows.length === 0)
      return {
        summary: emptyMessage(args.company, available),
        // written in code — handed only an instruction, the model invented figures
        display: args.company ? notYours(args.company, available) : undefined,
      };

    return {
      // no dates and no names — this line is all the model ever sees
      summary: `Returned the caller's own dates for ${ctx.channelGroup}: ${datesSummary(rows)}. Do NOT state or estimate any date yourself, and do NOT count how many payments are left.`,
      display: datesByCompany(rows, { group: ctx.channelGroup }),
      subjects: [ctx.person.personId],
      offer: {
        prompt: "Anything else?",
        choices: [
          { label: "What each one pays me", ask: "show me my full breakdown" },
          { label: "Just my total", ask: "what is my total this month?" },
        ],
      },
    };
  },
});
