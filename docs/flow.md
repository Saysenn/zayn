# Master sheet flow

## The governing principle (user's own words, settled)

**A CRM edit always wins. Nothing ever overwrites it.**

This is not a per-feature preference, it's the point of the CRM. The
reasoning: at the end of each month everything is wiped and the month
starts again, either from a freshly uploaded human sheet or from last
month's archived copy. So a sync has no business overwriting an edit made
*this* month, because the edit and the sync are both describing the same
short-lived working copy, and the human's version is the one that's been
checked.

The mechanism is `manually_overridden_fields` on `tb_mastersheet`: editing
a column claims it, and the next upload's upsert skips that column on that
row instead of reverting the correction. It is enforced in SQL, per column
per row, so the decision cannot be lost between a read and a write.

## How it actually works now

This used to describe two possible designs, one built and one proposed.
The proposed one is what exists; the old one is gone, not paused.

1. **A human uploads the messy xlsx into the CRM** (Settings, or the
   Master Sheet page). It is parsed in memory, never written to disk, and
   lands in `tb_mastersheet` with anything unreadable flagged rather than
   dropped.
2. **The admin, or Diane, cleans it up there.** That is the CRM's job:
   every cell is editable in place, and the flags say what needs looking
   at.
3. **whatbot pulls that sheet every few minutes into Redis**, and answers
   every WhatsApp question from Redis. It never pushes anything back.

One direction, one source. What was removed to get there:

- whatbot's 15-minute local-xlsx sync, which fed a roster from its own
  file. Two schedules writing the same Redis keys meant whichever ran last
  silently won.
- whatbot's month-start push into the CRM, and its upload folder. That
  route needed a human to place a file, so it was never really automatic,
  and it failed silently.
- `FEATURE_MASTER_SHEET_LOOP`, which switched between them. With one path
  there is nothing to switch.
- The `assignments` and `companies` tables (migration 022). People and
  Companies read `tb_mastersheet` directly now, so their feed cannot go
  cold and there is nothing to mirror.

`syncSheet()` still exists in whatbot, but only for the offline entry
points (`chat.js`, `payday.js`, `smoke.js`, the evals). It is not
scheduled.

## The month boundary

At month end, all working data is deleted (Settings → Burn this month,
Reset master sheet). The next month starts from one of two places:

1. A new messy human sheet, uploaded into the CRM, or
2. **Last month's archived copy** — so nobody ever starts from zero.

**The RECORD is kept; the RESTORE is not built.** `tb_month_snapshots`
preserves every row and figure before a month is rolled or burned, and it
survives the burn (shipped 2026-09-04, see `state.md`). But a snapshot is
READ ONLY, forever, and deliberately so: the instant one can be edited it
stops being evidence. So it cannot itself be the next month's starting
point.

Restoring last month as a starting point is therefore still unbuilt, and it
needs its own writable copy rather than a snapshot.

Until it exists, a burn with no new sheet to hand leaves the CRM empty and
whatbot answering from whatever it last pulled. Have the file ready first.

## Where the calculator sits

Outside all of this, deliberately. `v1/calculator/` computes from its own
uploaded sheet and has its own outputs. It is not part of the loop and
nothing here feeds it.

---

For the current shape of the system see `state.md`. For settled decisions
and their reasoning see `.claude/CLAUDE.md`.
