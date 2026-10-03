import { env } from "./env.js";

/**
 * The monthly "did you get paid?" check.
 *
 * Both switches are off by default — dryRun is true, sendDay is 0. You have to
 * deliberately turn both on.
 *
 * This is the one feature that can message the whole company at once, and there
 * is no undo.
 */
export const paydayConfig = {
  dryRun: env.PAYDAY_DRY_RUN,
  schedule: env.PAYDAY_SCHEDULE,
  sendGapMinutes: env.PAYDAY_SEND_GAP_MINUTES,
  responseWindowDays: env.PAYDAY_RESPONSE_DAYS,
  enabled: env.PAYDAY_SCHEDULE !== "off",
};

/** "2026-07". the sheet has no month column yet, so whatever is in it = this month. */
export function currentPeriod(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "July" — goes into the message we send them. */
export function periodName(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
}
