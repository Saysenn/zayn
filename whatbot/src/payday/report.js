import { paydayConfig, periodName } from "../config/index.js";
import { identify } from "../employee/access.js";
import { pushOutcome } from "./crmOutbox.js";
import { logger } from "../system/logger.js";
import { allRecords, closeStale } from "./records.js";

/**
 * Tell the CRM about the people the sweep just gave up on, so its
 * record says no_response for someone who was never
 * going to answer.
 *
 * Sequential and awaited, unlike every other CRM call in this codebase.
 * This one runs from a report nobody is waiting on, once a month, and
 * firing a thousand requests at the CRM in parallel to save a few seconds
 * of a batch job is a bad trade. One failure is logged and skipped: the
 * Redis record is already correct, and the report below is built from that,
 * never from whether the CRM took the news.
 */
async function tellCrmNoResponse(period, closed) {
  for (const r of closed) {
    try {
      const ctx = await identify(r.phone, r.group);
      if (ctx) await pushOutcome(ctx.person, r.group, period, "no_response");
    } catch (err) {
      logger.error(
        { err, personId: r.personId, group: r.group },
        "failed to tell the CRM a check went unanswered",
      );
    }
  }
}

/**
 * The report. This is what the whole feature exists to produce: proof that
 * everyone was asked, plus a short list of who has a problem.
 *
 * Counted per person per group, because that is how they were asked. Somebody
 * with companies in two groups appears twice, and should — one can be fine
 * while the other is not.
 */
export async function paydaySummary(period) {
  const closed = await closeStale(period, paydayConfig.responseWindowDays);
  await tellCrmNoResponse(period, closed);

  const records = await allRecords(period);
  const count = (o) => records.filter((r) => r.outcome === o).length;

  const byGroup = {};
  for (const r of records) {
    const g = (byGroup[r.group] ??= { sent: 0, confirmed: 0, problems: 0 });
    g.sent++;
    if (r.outcome === "confirmed") g.confirmed++;
    // A short payment is a problem too. Counting only not_received would
    // report a group as clean while somebody in it was underpaid.
    if (r.outcome === "not_received" || r.outcome === "partial") g.problems++;
  }

  return {
    period,
    total: records.length,
    confirmed: count("confirmed"),
    partial: count("partial"),
    notReceived: count("not_received"),
    noResponse: count("no_response"),
    awaiting: count("sent"),
    problems: records
      .filter((r) => r.outcome === "not_received" || r.outcome === "partial")
      .map((r) => ({
        personId: r.personId,
        group: r.group,
        name: r.name,
        note: r.note,
        // Which problem, since payroll chases the two differently: chase a
        // failed payment, or chase the difference on one that worked.
        outcome: r.outcome,
      })),
    byGroup,
  };
}

/** one line for the log, and for whoever asks "how did it go" */
export const summaryLine = (s) =>
  `${periodName(s.period)}: ${s.confirmed} confirmed, ${s.partial} part paid, ${s.notReceived} problems, ${s.noResponse} no response, ${s.awaiting} still open`;

/**
 * The report payroll actually reads.
 *
 * Counted per person per group, because that is how people were asked — the
 * same person can be fine on one group's companies and unpaid on another's.
 * A per-group line matters too: one number failing is invisible in a total.
 */
export function formatSummary(s) {
  const lines = [
    `*${periodName(s.period)} payday check*`,
    `Asked: ${s.total}`,
    `Confirmed: ${s.confirmed}`,
    `Received only part: ${s.partial}`,
    `Nothing received: ${s.notReceived}`,
    `No response: ${s.noResponse}`,
  ];

  if (s.awaiting > 0) lines.push(`Still awaiting reply: ${s.awaiting}`);

  const groups = Object.entries(s.byGroup);
  if (groups.length > 0) {
    lines.push("", "*By group*");
    for (const [group, g] of groups.sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(
        `  ${group}: ${g.confirmed}/${g.sent} confirmed, ${g.problems} problems`,
      );
    }
  }

  if (s.problems.length > 0) {
    lines.push("", "*Needs payroll follow-up*");
    for (const p of s.problems) {
      // Which kind of problem, since the two are chased differently: a
      // payment that never landed, or one that landed short. Only marked
      // on the short ones, so the line stays as it was for the case it
      // already covered.
      const kind = p.outcome === "partial" ? " [part paid]" : "";
      lines.push(
        `  ${p.name} (${p.group})${kind}${p.note ? ` — ${p.note}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}
