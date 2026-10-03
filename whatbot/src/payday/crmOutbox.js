import { crmConfigured, recordPaymentStatus } from "../system/crmClient.js";
import { logger } from "../system/logger.js";
import * as store from "../employee/storage.js";
import { markCrmSynced, unsyncedRecords } from "./records.js";

/**
 * Getting payday outcomes into the CRM, and keeping them there.
 *
 * The push itself has always been best-effort and unawaited: a person on
 * WhatsApp must never wait on our internal HTTP, and the CRM being down must
 * never cost them a reply. What was missing is the other half — nothing
 * remembered a failed push, so an outage meant the CRM simply never learned
 * that somebody said their wages hadn't arrived. No error surfaced anywhere,
 * because from the reply path's point of view nothing had gone wrong.
 *
 * So every outcome is written to Redis with `crmSynced: false` and cleared
 * only when the CRM confirms. This file is both halves of that: the push
 * that clears the flag, and the sweep that retries whatever still carries it.
 *
 * Redis stays the source of truth throughout. The CRM is a mirror, and a
 * mirror that catches up on its own is the whole point.
 */

/**
 * Push one outcome, and remember it landed.
 *
 * Returns true only when every assignment in that group was accepted. A
 * person with no assignments in the group is vacuously true: there is
 * nothing to send, so there is nothing to retry.
 */
export async function pushOutcome(person, group, period, outcome, note) {
  const results = await recordPaymentStatus(
    person,
    group,
    period,
    outcome,
    note,
  );

  // request() answers null for every failure, configured or not, so this is
  // "did all of them land" without needing to know why one didn't.
  const ok = results.every((r) => r !== null);
  if (ok) await markCrmSynced(period, group, person.personId, outcome);
  return ok;
}

/**
 * Retry everything the CRM still hasn't taken this period.
 *
 * Rebuilds each person from the roster rather than storing assignment IDs on
 * the record: the roster is what `recordPaymentStatus` needs, it is already
 * in memory, and a stored copy would go stale the first time the sheet moved
 * somebody between groups.
 *
 * A record whose person is no longer on the roster is dropped with a log
 * rather than retried forever — they have left, and there is no assignment
 * left in the CRM for the outcome to attach to.
 */
export async function retryUnsynced(period) {
  // Nothing to retry against. Not a failure, and not worth a log line every
  // few minutes for a deployment that simply has no CRM.
  if (!crmConfigured()) return { pending: 0, pushed: 0, failed: 0 };

  const pending = await unsyncedRecords(period);
  if (pending.length === 0) return { pending: 0, pushed: 0, failed: 0 };

  const rows = await store.findAll();
  let pushed = 0;
  let failed = 0;

  for (const rec of pending) {
    const person = store.personFrom(rows, rec.personId);
    if (!person) {
      logger.warn(
        { personId: rec.personId, group: rec.group, period },
        "payday outcome cannot be retried — nobody on the roster holds this personId",
      );
      failed++;
      continue;
    }

    const ok = await pushOutcome(
      person,
      rec.group,
      period,
      rec.outcome,
      rec.note,
    );
    if (ok) pushed++;
    else failed++;
  }

  // Only worth saying when something actually moved. A CRM that has been
  // down for an hour would otherwise log the same failure every few minutes.
  if (pushed > 0)
    logger.info({ period, pushed, failed }, "payday outcomes caught up to the CRM");

  return { pending: pending.length, pushed, failed };
}
