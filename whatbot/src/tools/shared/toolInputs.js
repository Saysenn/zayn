import { z } from "zod";
import * as access from "../../employee/access.js";
import { list } from "../format/index.js";

/**
 * The arguments the tools share, in one place.
 *
 * NOTE: no tool ever takes a "who am I" argument, and none takes a group. Whose
 * rows get read comes from ctx, worked out from their phone number; which
 * group's rows comes from the number they messaged.
 *
 * The LLM picks WHAT to ask for. It never picks WHOSE, and it never picks
 * WHERE.
 */

/**
 * The sheet is one snapshot of the current month, so we cannot answer "what did
 * I earn in June".
 *
 * So why have a `month` field at all? Because without it the LLM just labels
 * the current figures "June" and hands them over. With it, it has a way to say
 * "you asked about a month" and we can refuse properly.
 */
export const MONTH_FIELD = z
  .string()
  .nullish()
  .describe(
    'The month or period the user asked about, e.g. "June", "last month". Pass it whenever they name one. There is NO historical data, so this always returns a refusal.',
  );

export const NO_HISTORY =
  "There is no monthly history in the data — only the current month, with no earlier periods recorded. Tell the user you cannot answer for a past month and offer the current figures instead. Do NOT present current figures as belonging to any other month.";

export const SORT_FIELD = z
  .enum(["highest", "lowest"])
  .nullish()
  .describe(
    'Order by payable amount. Use with limit for "which company pays me most".',
  );

export const LIMIT_FIELD = z.coerce
  .number()
  .int()
  .positive()
  .max(50)
  .nullish()
  .describe('Return only this many assignments. Use 1 for "my biggest one".');

/** the shape the tools accept. the LLM can send any subset. */

/** sort by what is actually payable this month, then cut to a limit. */
export function rankAndLimit(rows, args) {
  let out = rows;
  if (args.sort) {
    out = [...rows].sort((a, b) =>
      args.sort === "highest"
        ? b.payableAmount - a.payableAmount
        : a.payableAmount - b.payableAmount,
    );
  }
  return args.limit ? out.slice(0, args.limit) : out;
}

/**
 * THIS IS WHERE ACCESS CONTROL MEETS THE LLM.
 *
 * The `company` option is built from the companies this caller holds on THIS
 * thread. So the LLM gets a dropdown, not a text box — it cannot ask about a
 * company this person has nothing to do with, or one that belongs to their
 * other group, because the option is not in the schema it was handed.
 *
 * Two people's schemas are different objects. So are one person's, on two
 * different numbers.
 */
/**
 * The company they named, as free text.
 *
 * This was an enum of the caller's own companies, which meant the model
 * physically could not name anything else — and so, asked about a company that
 * had ENDED, it picked the nearest one still on the list and answered about
 * that instead. "What does Social work first PR pay me" came back as a
 * confident figure for Social work partners PR.
 *
 * A wrong company answered confidently is far worse than a refusal, so the
 * model may now say any name and the handler decides. Nothing is given away by
 * that: `access.readable` filters to this caller and this group BEFORE the name
 * is matched, so an unknown name finds nothing and gets told which companies
 * are actually theirs.
 */
function companyField(companies) {
  if (companies.length === 0) return {};
  return {
    // nullish rather than optional — some models send "company": null to mean
    // "all of them", and a string-only schema rejects the whole call over it
    company: z
      .string()
      .nullish()
      .describe(
        `The company they named, copied EXACTLY as they wrote it. Never substitute a different company, even a similar one — if it is not theirs you will be told, and that is the right answer. Omit or null for all. Theirs are: ${companies.join(", ")}`,
      ),
  };
}

export async function companyFilterSchema(ctx) {
  const companies = await access.companiesInScope(ctx);
  return z.object({
    month: MONTH_FIELD,
    sort: SORT_FIELD,
    limit: LIMIT_FIELD,
    ...companyField(companies),
  });
}

/**
 * The company dropdown on its own, for tools that rank and total nothing.
 *
 * `get_my_dates` has no use for sort or limit, and offering them invites the
 * model to pass "highest" to a tool that returns no amounts.
 */
export async function companyOnlySchema(ctx) {
  return z.object(companyField(await access.companiesInScope(ctx)));
}

/**
 * What to tell the model when there is nothing to show.
 *
 * Instructions, not text to repeat — it writes the actual sentence. Warm and
 * specific, because "no results" is where a bot most easily sounds like a
 * broken form.
 */
/**
 * The reply itself, written here, for when they named a company that is not
 * theirs on this number.
 *
 * `emptyMessage` below tells the MODEL what happened, and that was the whole
 * problem: handed "they asked about X, tell them it is not theirs", the model
 * wrote a sentence with invented figures in it. The guard caught it, but only
 * after a second round trip and a reply that helped nobody.
 *
 * Code writes it now, so there is no sentence for the model to make up.
 */
export function notYours(company, available) {
  if (available.length === 0) {
    return `\u{1F937} I've no record of ${company} on this number, and nothing else on file for you here either.`;
  }
  return `\u{1F937} I've no record of ${company} on this number.\n\nYou're on ${list(available)}.`;
}

export function emptyMessage(company, available) {
  if (available.length === 0) {
    return "The caller holds nothing on this number. Say so kindly in one line, and suggest that if they work with another group they should try that number.";
  }
  if (company) {
    return `They asked about "${company}", which is not one of theirs on this number. Say so warmly and tell them the ones they do have: ${available.join(", ")}.`;
  }
  return "The caller holds nothing on this number. Say so kindly in one line.";
}
