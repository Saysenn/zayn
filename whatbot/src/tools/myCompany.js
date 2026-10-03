import { z } from "zod";
import { defineTool } from "./shared/defineTool.js";
import * as access from "../employee/access.js";
import {
  breakdownByCompany,
  breakdownSummary,
  groupName,
} from "./format/index.js";
import {
  companyFilterSchema,
  emptyMessage,
  notYours,
  MONTH_FIELD,
  NO_HISTORY,
} from "./shared/toolInputs.js";

/**
 * One company, when they name one: "what does Imperium pay me?"
 *
 * The company list in the schema is built per caller per thread, so a company
 * they do not hold on this number is not an option the LLM can pick.
 */
export const myCompany = defineTool({
  name: "get_my_company",
  description:
    "What ONE named company pays the caller this month. Use when they name a specific company. Only companies they hold on this number are available.",
  schema: z.object({ month: MONTH_FIELD, company: z.string().nullish() }),
  schemaFor: companyFilterSchema,
  handler: async (args, ctx) => {
    if (args.month) return { summary: NO_HISTORY };

    const available = await access.companiesInScope(ctx);

    // Called with no company, this used to fall through to "all of them" — so
    // "which pays me most" came back as the full list under a sentence claiming
    // it was one company. A tool named get_my_company returns one company.
    if (!args.company) {
      return {
        summary:
          "No company was named. Do NOT answer from this call. Use get_my_breakdown to list everything, get_my_total for a total, or rank_my_companies to rank them.",
      };
    }

    const rows = await access.readable(ctx, args.company);

    if (rows.length === 0) {
      return {
        summary: emptyMessage(args.company, available),
        // written in code — handed only an instruction, the model invented figures
        display: args.company ? notYours(args.company, available) : undefined,
      };
    }

    return {
      summary: `Returned the caller's own assignments on ${args.company} in ${ctx.channelGroup}: ${breakdownSummary(rows)}.`,
      display: breakdownByCompany(rows),
      subjects: [ctx.person.personId],
      offer:
        available.length > 1
          ? {
              prompt: "What next?",
              choices: [
                {
                  label: `My full ${groupName(ctx.channelGroup)} breakdown`,
                  ask: "show me my full breakdown",
                },
                { label: "Just my total", ask: "what is my total this month?" },
              ],
            }
          : undefined,
    };
  },
});
