# Run it

Command reference. All CRM commands run from `crm/api` unless shown.

## CRM

```bash
cd crm/api && npm run migrate                      # apply pending migrations
npm run seed-admin -- <username> <password> <secret-code>   # create or update the admin
cd crm/api && npm run dev                          # API
cd crm/web && npm run dev                          # web app
cd crm/api && npm test                             # API tests
cd crm/web && npm test                             # web tests
cd crm/web && npm run build                        # production build (into crm/api/public)
```

- Neither test suite needs a database. Both green is the baseline: any
  failure is something that just broke.
- `npm test` in `crm/api` passes `--test-force-exit` (`scripts/test.js`):
  files that load `configs/db` open a pg Pool that would keep the runner
  alive.

## Diane in the terminal

Real model, real database, **costs money**. Run only when asked.

```bash
node scripts/dianeChat.js --say "show me the bank sheet for nexus"
node scripts/dianeChat.js scripts/.audit.txt              # your own read-only turns
node scripts/dianeChat.js v1/agent/scenarios/sweep-boss.txt
node scripts/dianeChat.js v1/agent/scenarios/sweep-messy.txt
node scripts/dianeChat.js v1/agent/scenarios/forecasting.txt
npm run summary:repair                                   # fix missing conversation summaries
npm run summary:repair -- 100
```

- Unit tests do not catch what she **says**. Talk to her after changes.
- A scenario file is one admin turn per line; `#` lines are ignored.
  `scripts/.audit.txt` and `scripts/.review.txt` are gitignored scratch.
- **Writes are confined to `ZZTEST`.** `v1/testing/scratchOnly` is armed
  first, so a write to any other group throws. Reads are always live.
- A write scenario needs the confirmation on the next line, or it only tests
  half the tool:

  ```
  set quillon marsh payable days to 19
  yes, go ahead
  ```

- Clean up afterwards by **group**, not id: the rows and their
  `tb_mastersheet_changes` entries.
- The script exits non-zero when it flags a fault, and prints each tool's
  summary so figures can be checked.

### A random review conversation

```bash
node scripts/randomReviewScenario.js          # writes scripts/.review.txt
node scripts/dianeChat.js scripts/.review.txt
node scripts/randomReviewScenario.js --seed 7 # same conversation again
```

Seed data with the closure drill first, or the review queue is empty.

## Closure drill (stopping, Archive, monthly review, liquidation)

The only check that touches the real constraints and cascade. Needs
migrations 056–058. Everything goes in group `ZZTEST`; `scratchOnly`
guards `tb_people` too (a person is scratch only if every deal they hold is).

```bash
node scripts/closureDrill.js          # seed and drill, keep the rows
node scripts/closureDrill.js --clean  # seed, drill, then remove the rows
```

## Monthly history

```bash
npm run snapshot:month -- 2026-08                          # save a snapshot
npm run snapshot:month -- 2026-08 --file "/path/month.xlsx" # rebuild one from an export
```

A snapshot keeps the full rows, totals, rates and formula settings. The API
also takes one on the last day of the business month and catches up a
missed month on day one.

## Backups

In `crm/api/.env`:

```bash
BACKUP_DIR=/var/backups/crm
BACKUP_INTERVAL_HOURS=24
```

```bash
npm run backup                                     # create a verified backup
npm run backup:verify -- /path/to/backup.dump
export BACKUP_RESTORE_CONFIRM="RESTORE DATABASE"   # restore, safe database only
npm run backup:restore -- /path/to/backup.dump
```

Keep `BACKUP_DIR` off the database disk.

## Recover a deleted deal

```bash
node scripts/recoverFromSnapshot.js --month 2026-08 --list "rp backrunner"
node scripts/recoverFromSnapshot.js --month 2026-08 --key "<syncKey>" [--key ...]
node scripts/recoverFromSnapshot.js --month 2026-08 --key "<syncKey>" --write
```

- Reads `tb_month_snapshots` (every column). `tb_mastersheet_changes` only
  keeps a label.
- Read-only without `--write`. Never updates or deletes; a key already in
  the table is skipped.
- A recovered row always comes back **archived**. Un-archive it on the
  Archive page.

## Sample data and syncs

```bash
npm run seed-concerns              # fill the Flagged page
npm run seed-concerns -- --clear   # clear it

cd whatbot
npm run sync                # local workbook or Google Sheet into WhatBot
npm run pull:master-sheet   # CRM master sheet becomes WhatBot's roster
```
