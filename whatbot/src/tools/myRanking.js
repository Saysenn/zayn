import { z } from "zod";
import { defineTool } from "./shared/defineTool.js";
import * as access from "../employee/access.js";
import { groupName, money, NO_COMPANY } from "./format/index.js";
import {
  companyFilterSchema,
  emptyMessage,
  notYours,
  LIMIT_FIELD,
  MONTH_FIELD,
  NO_HISTORY,
  rankAndLimit,
  SORT_FIELD,
} from "./shared/toolInputs.js";

/**
 * Everything that is a total, a ranking or a count: "what's my total?", "which
 * company pays me most?", "how many companies am I on?"
 *
 * One flexible tool rather than three narrow ones. Narrow tools mean guessing
 * the questions in advance, and anything not guessed either broke or dumped the
 * whole list at them.
 */
export const myRanking = defineTool({
  name: "rank_my_companies",
  description:
    'The caller\'s companies ordered by what they pay, optionally cut to the top or bottom few. Use for "which pays me most", "my top 3", "which pays me least". NOT for a plain total — that is get_my_total.',
  schema: z.object({
    month: MONTH_FIELD,
    company: z.string().nullish(),
    sort: SORT_FIELD,
    limit: LIMIT_FIELD,
  }),
  schemaFor: companyFilterSchema,
  handler: async (args, ctx) => {
    if (args.month) return { summary: NO_HISTORY };

    const available = await access.companiesInScope(ctx);
    const all = await access.readable(ctx, args.company ?? undefined);

    if (all.length === 0)
      return {
        summary: emptyMessage(args.company, available),
        // written in code — handed only an instruction, the model invented figures
        display: args.company ? notYours(args.company, available) : undefined,
      };

    const rows = rankAndLimit(all, args);
    const scope = args.company ?? ctx.channelGroup;

    /**
     * "Oaiss Umbrella pays you the most this month" answers the question in the
     * first six words. A heading reading PAYABLE THIS MONTH — MILKMAN makes
     * them work the answer out for themselves.
     */
    const top = rows[0];
    const opening =
      args.limit === 1 && top?.company
        ? `${args.sort === "lowest" ? "\u{1F53B}" : "\u{1F3C6}"} ${top.company} pays you the ${args.sort === "lowest" ? "least" : "most"} this month.`
        : `Your ${groupName(ctx.channelGroup)} companies, ${args.sort === "lowest" ? "lowest" : "highest"} first:`;

    /**
     * "Oaiss Umbrella pays you the most" needs the figure under it.
     *
     * This used to slice the opening line off breakdownByCompany's output and
     * keep the rest. Once a single-company breakdown stopped repeating its own
     * figure in the body there was nothing left to slice, and the reply came
     * back as a sentence followed by two blank lines.
     */
    const lines = rows.map((a) =>
      a.payableAmount === 0
        ? `${a.company ?? NO_COMPANY} \u{00B7} nothing this month`
        : `${a.company ?? NO_COMPANY} \u{00B7} ${money(a.payableAmount, a.currency)}`,
    );
    const display = `${opening}\n\n${lines.join("\n")}`;

    return {
      summary: `Returned the caller's own ${rows.length} assignment(s) in ${scope}, ordered by amount.`,
      display,
      subjects: [ctx.person.personId],
      // only when we cut the list down — otherwise they are already looking at it
      offer:
        rows.length < all.length
          ? {
              prompt: "What next?",
              choices: [
                { label: "The full list", ask: "show me my full breakdown" },
                { label: "Just my total", ask: "what is my total this month?" },
              ],
            }
          : undefined,
    };
  },
});
