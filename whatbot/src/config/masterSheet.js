import { env } from "./env.js";

/**
 * The master-sheet pull: the worker's only roster source.
 *
 * One schedule, one direction. Every few minutes the CRM's polished sheet
 * becomes our roster, and nothing is ever pushed back — the CRM owns the
 * deals, because that is where a human imports the messy sheet and cleans
 * it up.
 *
 * There used to be a flag here gating this against a local-xlsx sync. Both
 * wrote the same Redis keys from different sources, so whichever ran last
 * silently won, and the switch was one more thing to get wrong.
 */
export const masterSheetConfig = {
  pullIntervalMinutes: env.MASTER_SHEET_PULL_MINUTES,
};
