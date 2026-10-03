import { invokeTool } from "./toolRunner.js";
import { tools } from "../tools/index.js";
import * as access from "../employee/access.js";

/**
 * Picks a tool by keyword instead of calling the LLM.
 *
 * Everything else still runs for real — identity, group scoping, the tools, the
 * formatters — so this exercises the whole path when a free tier runs out. What
 * it does not exercise is the model's judgement, which is the interesting part.
 *
 * Never turn this on in production.
 */
export async function runMockAgent(ctx, question) {
  const q = question.toLowerCase();

  const wantsMoney =
    /(salary|pay|earn|owed|payslip|income|payroll|wage|money|breakdown)/.test(
      q,
    );
  const wantsTotal =
    /(total|sum|altogether|average|most|highest|lowest|how many|count)/.test(q);

  // only match companies this person holds on THIS number
  const companies = await access.companiesInScope(ctx);
  const company = companies.find((c) => q.includes(c.toLowerCase()));

  /**
   * Checked before the money branches, because "when does my payment end" is
   * full of pay words and is not a question about an amount.
   *
   * Payment TIMING never reaches here — "when will I be paid" is answered by
   * outOfScope long before the agent runs.
   */
  const wantsDates =
    /\b(start|starts|started|start date|end|ends|ended|ending|end date|expire|expires|expiry|how long|until when|last payment)\b|\bwhen (did|does|do)\b/.test(
      q,
    );

  if (wantsDates) {
    const args = company ? JSON.stringify({ company }) : "{}";
    return reply(await invokeTool(tools, "get_my_dates", args, ctx));
  }

  if (company) {
    return reply(
      await invokeTool(
        tools,
        "get_my_company",
        JSON.stringify({ company }),
        ctx,
      ),
    );
  }

  if (/(most|highest|lowest|least|top|rank)/.test(q)) {
    const sort = /(lowest|least)/.test(q) ? "lowest" : "highest";
    return reply(
      await invokeTool(
        tools,
        "rank_my_companies",
        JSON.stringify({ sort, limit: 1 }),
        ctx,
      ),
    );
  }

  if (/(how many|count|which companies|list)/.test(q)) {
    return reply(await invokeTool(tools, "count_my_companies", "{}", ctx));
  }

  if (wantsTotal) {
    return reply(await invokeTool(tools, "get_my_total", "{}", ctx));
  }

  if (wantsMoney) {
    return reply(await invokeTool(tools, "get_my_breakdown", "{}", ctx));
  }

  return {
    text: '[mock] I only understand pay and company questions in this mode. Try "what am I owed?" or "which company pays me most?"',
    hadDisplay: false,
    subjectCount: 0,
  };
}

function reply(result) {
  return {
    // the display IS the reply now, so show it — printing a stub instead made
    // mock mode useless for checking what people actually see
    text: result.display ?? result.summary,
    hadDisplay: Boolean(result.display),
    subjectCount: result.subjects?.length ?? 0,
    offer: result.offer,
  };
}
