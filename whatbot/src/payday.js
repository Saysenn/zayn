import { currentPeriod, paydayConfig } from "./config/index.js";
import { redis } from "./system/redis.js";
import { syncSheet } from "./sheet/syncSheet.js";
import { runPaydayCheck } from "./payday/runPaydayCheck.js";
import { formatSummary, paydaySummary } from "./payday/report.js";

/**
 * Run the payday check by hand. An entrypoint — a person types this.
 *
 *   npm run payday                     dry run over everyone
 *   npm run payday -- --limit 5        dry run over five people
 *   npm run payday -- --only +4477...  just that number — use this to test a
 *                                      real send against your own phone
 *   npm run payday -- --send           for real (needs PAYDAY_DRY_RUN=false)
 *   npm run payday -- --report         this month's summary
 *
 * This isn't only for testing. --report and a targeted --send are how payroll
 * would actually work month to month.
 *
 * The automatic version lives in worker.ts and calls the same code.
 */
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const value = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const period = value("--period") ?? currentPeriod();

if (has("--report")) {
  console.log("\n" + formatSummary(await paydaySummary(period)) + "\n");
} else {
  await syncSheet();

  if (has("--send") && paydayConfig.dryRun) {
    console.error(
      "\nPAYDAY_DRY_RUN is true — set it to false in .env for a real send.\n",
    );
    await redis.quit();
    process.exit(1);
  }

  const limit = value("--limit") ? Number(value("--limit")) : undefined;
  const only = value("--only");
  const result = await runPaydayCheck({ period, limit, only });

  // no match is silent otherwise — you'd read "eligible: 0" as "nobody is due"
  if (only && result.eligible === 0) {
    console.error(
      `\nNo active row on the sheet has the phone ${only}. Nothing was queued.\n`,
    );
    await redis.quit();
    process.exit(1);
  }

  console.log(
    `\n${result.dryRun ? "DRY RUN" : "SCHEDULED"} — ${result.period}`,
  );
  console.log(`  eligible:            ${result.eligible}`);
  console.log(`  scheduled:           ${result.scheduled}`);
  console.log(`  no number for group: ${result.skippedNoNumber}`);

  // "scheduled" is not "sent". the messages go out over the next day, so show
  // when each number actually finishes.
  for (const [group, { count, finishesInHours }] of Object.entries(
    result.perGroup,
  )) {
    console.log(
      `    ${group.padEnd(12)} ${String(count).padStart(4)} people, ~${finishesInHours}h`,
    );
  }
  console.log(
    result.dryRun
      ? "\n  Nothing was queued. Set PAYDAY_DRY_RUN=false for a real run.\n"
      : "\n  Queued. The worker must stay running for these to send.\n",
  );
}

await redis.quit();
