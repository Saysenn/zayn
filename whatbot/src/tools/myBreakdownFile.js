import { z } from "zod";
import { defineTool } from "./shared/defineTool.js";
import * as access from "../employee/access.js";
import { breakdownSummary, groupName } from "./format/index.js";
import { breakdownCsv, breakdownFileName } from "./format/csv.js";
import { currentPeriod } from "../config/index.js";
import { MONTH_FIELD, NO_HISTORY } from "./shared/toolInputs.js";

/**
 * "Can you send me that as a file?"
 *
 * The same rows as `get_my_breakdown`, in a spreadsheet instead of a sentence.
 * Separate tools rather than a `format` argument on one, for the reason the
 * rest of tools/ is split this way: a small model picks reliably between
 * differently-named tools and unreliably between arguments to the same one.
 *
 * It also matters more here than usual. Getting the argument wrong on a
 * breakdown sends the wrong shape of the same answer; getting it wrong here
 * puts a file on somebody's phone that they did not ask for, and a file cannot
 * be scrolled past.
 *
 * Scoped identically — `access.readable` returns this caller's rows on this
 * number's group only, and there is no argument that can widen it.
 */
export const myBreakdownFile = defineTool({
  name: "get_my_breakdown_file",
  description:
    "The caller's own breakdown as a CSV file they can open in Excel. Use ONLY when they explicitly ask for a file, a spreadsheet, a CSV, a download, or something they can send on. For an ordinary question about their pay use get_my_breakdown instead. No historical months exist.",
  schema: z.object({ month: MONTH_FIELD }),
  // off unless FEATURE_DOCUMENTS=true. With it off this tool is never loaded,
  // so the model is not told a file is possible.
  requires: "documents",
  handler: async (args, ctx) => {
    if (args.month) return { summary: NO_HISTORY };

    const rows = await access.readable(ctx);
    if (rows.length === 0) {
      return {
        summary:
          "The caller holds nothing on this number, so there is no file to build. Say so kindly in one line, and mention that if they work with another group they should try that number.",
      };
    }

    const period = currentPeriod();
    const group = groupName(ctx.channelGroup);

    return {
      // no names, no amounts, no filename that hints at either
      summary: `Built the caller's own breakdown as a CSV for ${ctx.channelGroup}: ${breakdownSummary(rows)}. The file is being sent — do not describe its contents or repeat any figure from it.`,
      /**
       * The caption carries the sentence, not the model. A document arriving
       * with nothing said about it is indistinguishable from spam, and this is
       * the one reply where the words and the file have to agree exactly.
       */
      display: `\u{1F4C4} Here's your ${group} breakdown for this month as a spreadsheet.`,
      attachment: {
        content: Buffer.from(breakdownCsv(rows), "utf8"),
        fileName: breakdownFileName(ctx.channelGroup, period),
        mimetype: "text/csv",
      },
      subjects: [ctx.person.personId],
    };
  },
});
