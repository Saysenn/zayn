# Run it

Quick command reference for the CRM, Diane, history, and backups.

## CRM

```bash
# Apply all pending database migrations
# 066 (2026-09-25) is pending: puts real names back where a profile shows its slug
# 067 (2026-09-25) is pending: two indexes for the Archive's dead persons list
cd crm/api && npm run migrate

# Create or update the admin account
npm run seed-admin -- <username> <password> <secret-code>

# Start the API and web app
cd crm/api && npm run dev
cd crm/web && npm run dev

# Run API tests and the production web build
cd crm/api && npm test
cd crm/web && npm test
cd crm/web && npm run build
```

**`npm test` in `crm/api` carries `--test-force-exit`, 2026-09-16.** Any
test file that requires `configs/db` creates a real pg Pool, and its handle
keeps the event loop open after the last assertion, so the runner waited
forever. It looked like `askedForUsd.test.js` hanging; it is whichever file
happens to finish last. The flag is the fix, not a workaround: nothing here
needs a database, so nothing is being cut short.

```bash
cd crm/web && node --test --test-force-exit "src/**/*.test.js"
```

**Counts as of 2026-09-24:** `crm/api` 1960 tests and `crm/web` 749 tests,
**all pass on both sides.** The three long standing API failures were one
bug and are closed: see `todo.md` section 2. **Both suites green is the
baseline now, so any failure is something that just broke.**

Neither suite needs a database. `crm/api`'s master sheet tests read
`docs/boss/references/*.xlsx` where it exists and skip themselves where it
does not, so the API still tests on a machine holding only itself.

## Diane

```bash
# Run a real terminal conversation against the live sheet
cd crm/api
node scripts/dianeChat.js --say "show me the bank sheet for nexus"

# An audit of how she ANSWERS. Read only turns, one per line.
node scripts/dianeChat.js scripts/.audit.txt

# A saved conversation, one admin turn per line. READ ONLY, all three.
node scripts/dianeChat.js v1/agent/scenarios/sweep-boss.txt
node scripts/dianeChat.js v1/agent/scenarios/sweep-messy.txt
node scripts/dianeChat.js v1/agent/scenarios/forecasting.txt

# Repair missing or outdated conversation summaries
npm run summary:repair
npm run summary:repair -- 100
```

**TALK TO HER. The unit tests do not catch what she SAYS.** Every round of
this has found faults against a green suite. On 2026-09-18, with 1,604
passing: a scope word put in the wrong field so a queued deal came back
"not up for review", "everything has been answered" when the scope simply
missed, a payment start answered from a rule that had been replaced that
morning, and "show both" answering for one of the two.

`scripts/.audit.txt` is scratch and gitignored: put read only turns in it,
one per line.

### A scenario that WRITES

Seed the rows first, in `ZZTEST` and nowhere else, and delete them after.
`scratchOnly` is armed by the harness itself, so a write to any other group
THROWS rather than happening.

Every fault found on 2026-09-24 came from this: an instruction answered
with a lookup, a confirmation that could never complete, a bare "yes"
redoing a finished write, and a pending export promised for a tool that is
turned off. None of them is visible to a read only scenario, and all of
them were sitting behind a green suite.

**One turn per line, and the second line is the confirmation.** A write
tool answers the first call with a pending summary and changes nothing, so
a one line scenario only ever tests half of it.

```
set quillon marsh payable days to 19
yes, go ahead
```

Afterwards, remove the rows AND their `tb_mastersheet_changes` entries, by
GROUP rather than by id: an id list goes stale between runs and the one
that has moved is the one that gets missed.

### A DIFFERENT review conversation every time

A fixed script tests a fixed Diane. This prints a shuffled one, seeded so a
failure can be run again.

It writes the file itself, because `> /tmp/...` is a Windows shell away from
`Could not find a part of the path 'C:\tmp\review.txt'`.

```powershell
cd crm/api
node scripts/randomReviewScenario.js          # writes scripts/.review.txt
node scripts/dianeChat.js scripts/.review.txt

# the same conversation again, to reproduce a failure
node scripts/randomReviewScenario.js --seed 7
```

Seed the data with the closure drill below first, or the review queue is
empty and half the turns have nothing to answer.

**It covers the two COMPANY bulk tools as well, 2026-09-17.** They were
pinned by unit tests only and had never been said out loud to her. The
close block closes and reopens `ZZ Staying Co` across four adjacent turns,
so whatever order the blocks shuffle into, it leaves the data as it found
it and the review blocks still mean what they say.

## The closure feature, on fake data

Stopping, the Archive, the monthly review and liquidation, against the real
database. Every unit test for these is deliberately DB free, so this is the
only thing that touches the CHECK constraints, the pair constraint and the
cascade.

**Needs migrations 056, 057 and 058.**

```bash
cd crm/api
node scripts/closureDrill.js          # seed, drill, leave the rows there
node scripts/closureDrill.js --clean  # and remove them afterwards
```

Everything it writes is in the group `ZZTEST`, on two invented companies
and four invented people. `scratchOnly` is armed first, so a write to any
other group THROWS rather than happening.

**IT GUARDS `tb_people` TOO, from 2026-09-24.** It did not before, and
`update_person` writes a rate that reaches every deal the person holds, so
a rate test on the live sheet would have moved a real month. A person
counts as scratch only when EVERY deal they hold is: one ZZTEST row beside
four real ones is a real person.

**IT SPENDS REAL MONEY AND READS THE REAL SHEET.** Writes are confined to
ZZTEST by `v1/testing/scratchOnly`, armed before anything loads; reads are
always live.

**IT EXITS NON-ZERO WHEN IT FLAGS SOMETHING.** It used to print faults and
exit 0, so a run containing eleven of them read as green. It echoes each
tool's own summary under the tool name, so a figure in her reply can be
checked against the text it came from.

The browser saves conversations automatically when they end, become idle for
30 minutes, reach the checkpoint size, or the page is hidden.

## Monthly history

```bash
# Save an immutable snapshot for a specific month
cd crm/api
npm run snapshot:month -- 2026-08

# Reconstruct a missing snapshot from an exported month workbook
npm run snapshot:month -- 2026-08 --file "C:\path\month.xlsx"
```

The snapshot keeps the complete sheet rows, calculated totals, rates, and
formula settings. The API also checks automatically every minute on the final
day of the business month and catches up a missing previous month on day one.

## Backups

Set these in `crm/api/.env` to enable automatic verified backups:

```bash
BACKUP_DIR=/var/backups/crm
BACKUP_INTERVAL_HOURS=24
```

```bash
# Create a verified backup
cd crm/api && npm run backup

# Verify a dump and its manifest
npm run backup:verify -- /path/to/backup.dump

# Restore, only against a safe database
export BACKUP_RESTORE_CONFIRM="RESTORE DATABASE"
npm run backup:restore -- /path/to/backup.dump
```

Keep `BACKUP_DIR` outside the database disk and run the API under a process
manager so scheduled jobs restart with the service.

## Recovering a deleted deal

```bash
cd crm/api
node scripts/recoverFromSnapshot.js --month 2026-08 --list "rp backrunner"
node scripts/recoverFromSnapshot.js --month 2026-08 --key "<syncKey>" [--key ...]
node scripts/recoverFromSnapshot.js --month 2026-08 --key "<syncKey>" --write
```

Deleting from the upload diff writes immediately and keeps only a LABEL in
`tb_mastersheet_changes`, which cannot be turned back into a row.
`tb_month_snapshots` holds every column, so this reads the CRM's own
record rather than rebuilding one from a spreadsheet.

**It comes back ARCHIVED, always.** A recovered row is there to be audited,
not to be paid: it was deleted for a reason nobody has re-examined, and a
row that quietly rejoined the sheet would rejoin the month's total with it.
Un-archiving is a decision made on the Archive page.

**Read only without `--write`.** It never updates and never deletes; a key
already in the table is skipped, because what is there now is newer than
any snapshot.

**Run on 2026-09-24** for the three rows the 2026-09-20 upload delete took:
ids 517, 518 and 519. Live stayed 91, archived went 4 to 7, and September
did not move. Nothing is left to recover from that incident.

## Flagged sample data

```bash
cd crm/api
npm run seed-concerns
npm run seed-concerns -- --clear
```

These commands fill or clear the Flagged page with sample concerns.

## Whatbot one off syncs

```bash
cd whatbot
npm run sync
npm run sync:crm
npm run sync:master-sheet
npm run pull:master-sheet
```

These commands test the individual spreadsheet, Redis, and CRM sync paths.
