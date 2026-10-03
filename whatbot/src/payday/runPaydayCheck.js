import {
  allGroups,
  currentPeriod,
  numberForGroup,
  paydayConfig,
} from "../config/index.js";
import { logger } from "../system/logger.js";
import { withRedisTimeout } from "../system/redis.js";
import { jobIdOf } from "../system/jobId.js";
import * as store from "../employee/storage.js";
import { paydaySendQueue } from "./sendQueue.js";

/**
 * Schedules the monthly "did you receive your pay?" check.
 *
 * One message per person PER GROUP. Somebody holding companies in Milkman and
 * Indigo is asked twice, from two different numbers, each covering only that
 * group's companies — because that is how they are paid and how they think
 * about it. Merging them into one message would show them a company on a thread
 * it has nothing to do with.
 *
 * A group we own no number for is skipped entirely. That is how Takeoff stays
 * out of this without a special case: no number, no messages.
 *
 * This sends nothing. It works out who is due and enqueues one delayed job per
 * person per group, spaced by PAYDAY_SEND_GAP_MINUTES *within each group* — so
 * the numbers work through their own people side by side rather than one long
 * queue.
 *
 * The spacing is the point. Messaging people who did not message us first is
 * what gets a WhatsApp account banned, and pace is the main defence.
 *
 * Safety, in order of importance:
 *  - dryRun is the default; a real send has to be switched on deliberately
 *  - jobId is unique per person per group per period, so a re-run schedules nothing twice
 *  - a second atomic claim inside sendPaydayMessage catches anything that slips
 *  - opt-outs are checked at send time, not here — people opt out mid-run
 */
export async function runPaydayCheck(opts = {}) {
  const period = opts.period ?? currentPeriod();

  const result = {
    period,
    eligible: 0,
    scheduled: 0,
    skippedNoNumber: 0,
    skippedNoPhone: 0,
    dryRun: paydayConfig.dryRun,
    perGroup: {},
  };

  const all = await store.findAll();

  // One candidate per person per group, not per assignment. Nathan holds three
  // companies in Indigo and gets ONE Indigo message covering all three.
  const byPersonGroup = new Map();
  for (const a of all) {
    if (a.status !== "active") continue;
    const key = `${a.group}|${a.personId}`;
    byPersonGroup.set(key, [...(byPersonGroup.get(key) ?? []), a]);
  }

  let candidates = [...byPersonGroup.values()];

  /**
   * `only` is one phone number, and it is the difference between testing a real
   * send and messaging a stranger.
   *
   * A real send needs PAYDAY_DRY_RUN=false, which unlocks the entire roster;
   * `--limit 1` then picks whoever happens to sort first. This narrows it to a
   * number you chose — normally your own — before anything is queued. It is
   * also how payroll chases one person who says they weren't paid.
   *
   * Matched against every assignment in the pair, since only some rows carry
   * the phone. No match means nobody is messaged, which is the right way round.
   */
  if (opts.only) {
    const wanted = opts.only.replace(/[\s()-]/g, "");
    candidates = candidates.filter((rows) =>
      rows.some((a) => a.phone === wanted),
    );
  }

  if (opts.limit) candidates = candidates.slice(0, opts.limit);
  result.eligible = candidates.length;

  const gapMs = paydayConfig.sendGapMinutes * 60_000;

  // Position within each group, so every number starts at zero.
  const positionInGroup = new Map();

  for (const rows of candidates) {
    const first = rows[0];
    const { group, personId, personName } = first;

    const from = numberForGroup(group);
    if (!from) {
      // A group we own no number for. Skipping is the safe choice — sending
      // from another group's number would show this person a sender they have
      // never heard of, which is what gets a bot reported.
      result.skippedNoNumber++;
      continue;
    }

    const phone = rows.find((a) => a.phone)?.phone;
    if (!phone) {
      result.skippedNoPhone++;
      continue;
    }

    const position = positionInGroup.get(group) ?? 0;
    positionInGroup.set(group, position + 1);

    if (paydayConfig.dryRun) {
      result.scheduled++;
      continue;
    }

    await withRedisTimeout(
      paydaySendQueue.add(
        "payday-send",
        {
          period,
          personId,
          name: personName,
          group,
          phone,
          firstName: personName.split(" ")[0] ?? personName,
          from,
          // whatever most of their assignments here use, for the follow-up wording
          paymentMethod: commonest(rows.map((a) => a.paymentMethod)),
        },
        // Re-running the schedule is harmless: BullMQ rejects a job ID it has
        // already seen, so nobody is queued twice for the same period.
        {
          jobId: jobIdOf("payday", period, group, personId),
          delay: position * gapMs,
        },
      ),
    );
    result.scheduled++;
  }

  for (const [group, count] of positionInGroup) {
    result.perGroup[group] = {
      count,
      finishesInHours: Math.round(((count - 1) * gapMs) / 3_600_000),
    };
  }

  // A group with people but no number silently excludes everyone in it —
  // worth naming, not just counting. Takeoff is expected to show up here.
  const unmapped = [...new Set(candidates.map((rows) => rows[0].group))].filter(
    (g) => !numberForGroup(g),
  );
  if (unmapped.length > 0) {
    logger.info(
      { groups: unmapped, configured: allGroups() },
      "groups with no WhatsApp number — nobody in them is being messaged",
    );
  }

  logger.info(
    { ...result },
    paydayConfig.dryRun
      ? "payday check DRY RUN — nothing scheduled"
      : "payday check scheduled",
  );
  return result;
}

/** the value that appears most often. ties go to the first one seen. */
function commonest(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort(([, a], [, b]) => b - a)[0]?.[0] ?? "cash";
}
