import { identify } from "../employee/access.js";
import { pushOutcome } from "./crmOutbox.js";
import { logger } from "../system/logger.js";
import { isOptedOut } from "../system/optOut.js";
import { sendText } from "../whatsapp/sendMessage.js";
import { paydayOpening } from "./paydayMessages.js";
import { claimSend, recordSent, releaseClaim } from "./records.js";

/**
 * Sends one person's payday check for one group, at the delay runPaydayCheck
 * gave it.
 *
 * Two independent guards against sending twice, because a duplicate here means
 * messaging someone about their pay twice and there is no way to recall it:
 *   1. jobId is `payday-<period>-<group>-<personId>` — BullMQ refuses a duplicate.
 *      Dashes, not colons: BullMQ rejects a colon outright. See queue.jobIdOf
 *   2. claimSend is an atomic HSETNX — Redis picks a winner if two ever race
 */
export async function sendPaydayMessage(job) {
  const { period, personId, name, group, phone, firstName, from } = job;

  // Checked here rather than at scheduling time: someone can opt out during the
  // day this run takes, and their message has not been sent yet.
  if (await isOptedOut(phone)) {
    logger.debug(
      { personId, group, period },
      "payday check skipped — opted out",
    );
    return;
  }

  if (!(await claimSend(period, group, personId))) {
    logger.debug(
      { personId, group, period },
      "payday check skipped — already claimed",
    );
    return;
  }

  try {
    await sendText(phone, from, paydayOpening(firstName, period, group));
    await recordSent({
      personId,
      group,
      name,
      period,
      phone,
      sentAt: new Date().toISOString(),
    });
    // The CRM's Confirmed column starts at "awaiting reply" rather than
    // blank, so an admin can tell "we asked, they haven't answered" from
    // "nobody has asked them". Best-effort, never awaited into the send
    // path — the Redis record above is the source of truth either way.
    //
    // identify() rather than a passed-in person: recordPaymentStatus needs
    // the assignment IDs to write one row per assignment, and this job
    // carries only the identity it needed to send a message.
    identify(phone, group)
      .then((ctx) => {
        if (ctx) return pushOutcome(ctx.person, group, period, "sent");
      })
      .catch((err) =>
        logger.error({ err, personId }, "failed to tell the CRM a check was sent"),
      );
    logger.info({ personId, group, period }, "payday check sent");
  } catch (err) {
    // Hand the claim back before rethrowing, or BullMQ's retry would find the
    // slot taken and skip the person it was retrying for.
    await releaseClaim(period, group, personId);
    throw err;
  }
}
