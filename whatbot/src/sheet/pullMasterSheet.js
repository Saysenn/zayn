import { logger } from "../system/logger.js";
import { fetchMasterSheet } from "../system/crmClient.js";
import { AssignmentSchema } from "../employee/types.js";
import * as assignmentStore from "../employee/storage.js";

/**
 * Pull the CRM's master sheet and make it our roster.
 *
 * This is the half of the loop that runs constantly (every few minutes),
 * and it is what makes the CRM the source of truth for answering: whatever
 * an admin fixed on the Master Sheet page is what the next person to ask
 * gets told, without waiting for a month-end sync.
 *
 * The rows arrive already in our own assignment shape — the CRM maps them
 * on its side (masterSheet/toAgentRow.js), so there is nothing to reshape
 * here, only to check.
 *
 * Validated rather than trusted. It is our own CRM, but this feeds real
 * figures to real people, and "the other end is ours" has never been a good
 * enough reason to skip the schema at an edge.
 */
export async function pullMasterSheet() {
  const body = await fetchMasterSheet();

  // null = unreachable, unauthorised, or not configured. crmClient already
  // logged why. Keeping the previous roster is always right here: a
  // network blip must not take the bot offline for everybody.
  if (!body) {
    logger.warn("master sheet pull failed — keeping the previous roster");
    return { pulled: 0, loaded: 0, ok: false };
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const assignments = [];
  const rejected = [];

  for (const row of rows) {
    const parsed = AssignmentSchema.safeParse(row);
    if (parsed.success) assignments.push(parsed.data);
    else {
      rejected.push({
        assignmentId: row?.assignmentId,
        reason: parsed.error.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("; "),
      });
    }
  }

  if (rejected.length > 0) {
    // Loud, and with examples: a row failing HERE means the CRM holds
    // something our own schema will not accept, which is a real data
    // problem someone has to fix on the Master Sheet page — not a blip.
    logger.error(
      { total: rejected.length, examples: rejected.slice(0, 5) },
      "rows from the CRM master sheet failed validation — MISSING from the roster",
    );
  }

  // Same rule as syncSheet.js, and the reason it is worth repeating: an
  // empty result almost always means something broke, not that payroll is
  // empty. replaceAll with nothing takes the bot offline for everyone.
  if (assignments.length === 0) {
    logger.error(
      { received: rows.length },
      "master sheet pull produced zero usable assignments — keeping previous data",
    );
    return { pulled: rows.length, loaded: 0, ok: false };
  }

  await assignmentStore.replaceAll(assignments);

  const people = new Set(assignments.map((a) => a.personId)).size;
  logger.info(
    { pulled: rows.length, loaded: assignments.length, people, rejected: rejected.length },
    "roster refreshed from the CRM master sheet",
  );

  return { pulled: rows.length, loaded: assignments.length, people, ok: true };
}
