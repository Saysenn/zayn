import { logger } from "../system/logger.js";
import { runPaydayCheck } from "./runPaydayCheck.js";

/**
 * Every Friday at 16:00 UTC.
 *
 * Cron cannot say "last Friday of the month" — there is no day-of-month that
 * means it. So the schedule fires on all four or five Fridays and
 * runScheduledPaydayCheck throws away the ones that are not the last.
 *
 * 16:00, not 09:00, because the money lands that day. Asking somebody at nine
 * in the morning whether their pay arrived collects "not yet" from everybody
 * whose bank clears in the afternoon, and each of those is recorded as a
 * payroll problem and put in front of HR. The afternoon costs nothing.
 *
 * The sends then spread over the following ~24 hours at
 * PAYDAY_SEND_GAP_MINUTES apart, per number — so the tail lands on Saturday,
 * which is deliberate. Nobody minds a weekend message about their wages.
 */
export const PAYDAY_CRON = "0 16 * * 5";

/**
 * Is this the last Friday of its month?
 *
 * UTC throughout, like every other date in this codebase — a local-time
 * boundary would make the answer depend on where the machine is, and the
 * machine has moved before.
 *
 * The test is simply: it is a Friday, and seven days later is next month.
 */
export function isLastFridayOfMonth(d) {
  if (d.getUTCDay() !== 5) return false;

  const weekLater = new Date(d.getTime());
  weekLater.setUTCDate(weekLater.getUTCDate() + 7);
  return weekLater.getUTCMonth() !== d.getUTCMonth();
}

/**
 * The scheduled entry point. Runs the check, or does nothing at all.
 *
 * Only the schedule goes through here. `npm run payday` calls runPaydayCheck
 * directly and works on any day of any month — a hand run must never be told
 * "not today" by a calendar, since the reason for running one by hand is
 * usually that the automatic one did not happen.
 */
export async function runScheduledPaydayCheck(now = new Date()) {
  if (!isLastFridayOfMonth(now)) {
    logger.debug(
      { date: now.toISOString().slice(0, 10) },
      "not the last Friday — no payday check",
    );
    return null;
  }

  logger.info(
    { date: now.toISOString().slice(0, 10) },
    "last Friday of the month — payday check",
  );
  return runPaydayCheck();
}
