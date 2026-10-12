# Master sheet flow

## Rule

**A CRM edit always wins.** Editing a cell claims that column on that row in
`manually_overridden_fields` (`tb_mastersheet`); the next upload's upsert
skips it. Enforced in SQL, per column per row.

## How data moves

1. An admin uploads the messy xlsx (Settings or the Master Sheet page).
   Parsed in memory, never written to disk; unreadable values are flagged,
   not dropped.
2. The admin, or Diane, cleans it in the CRM. Every cell is editable.
3. whatbot pulls the sheet into Redis every `MASTER_SHEET_PULL_MINUTES`
   (default 5, `whatbot/src/sheet/pullMasterSheet.js`) and answers WhatsApp
   from Redis. It never writes back.

One direction, one source. `syncSheet()` in whatbot is only for the offline
entry points (`chat.js`, `payday.js`, `smoke.js`, the evals); not scheduled.

## Month boundary

- Settings → Burn runs `masterSheet/closeMonth.js`: snapshot the month into
  `tb_month_snapshots`, then burn the working data.
- `masterSheet/snapshotScheduler.js` also snapshots on the business month's
  final day.
- Snapshots are read only and survive the burn.
- The next month starts from a newly uploaded sheet. Starting from last
  month's copy is not built (it needs a writable copy, not a snapshot), so
  have the new file ready before burning.

## Calculator

`v1/calculator/` works from its own uploaded sheet. Nothing here feeds it.
