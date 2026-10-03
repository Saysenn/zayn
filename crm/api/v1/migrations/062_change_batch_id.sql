-- ***************************************************
-- * One act, one row in History, one Undo
-- ***************************************************
--
-- A company status change touches every deal on the company: it stops
-- them, or ticks them for the monthly review, or clears their end dates.
-- His call 2026-09-22: that is ONE thing that happened, so History should
-- show it once and Undo should put all of it back in one press.
--
-- ===============================
-- * A BATCH WAS GUESSED, AND A GUESS SPLITS
-- ===============================
-- `findChangeBatches` recovers a batch as "same actor, no gap longer than
-- 15 seconds between consecutive writes". That was the honest answer while
-- nothing recorded one, and it has two failures that matter here: a
-- cascade across a big company can take longer than the gap and split into
-- two History rows, so undoing one puts half the deals back; and two
-- unrelated edits inside the gap merge into one row, so undoing that one
-- reverts something nobody pointed at.
--
-- Both are silent. Neither is acceptable for a write that stops wages.
--
-- ===============================
-- * NULL IS NOT A GAP, IT IS THE OLD WORLD
-- ===============================
-- Every change already written has no batch, and backfilling one would be
-- inventing a fact about the past. So the column is nullable and the gap
-- recovery STAYS, for those rows only: a batch id when there is one, the
-- 15 second guess when there is not.

ALTER TABLE tb_mastersheet_changes
  ADD COLUMN IF NOT EXISTS batch_id uuid;

-- The History query asks "recent, not yet undone, grouped by batch", so
-- the id is only ever looked up among rows that are still open.
CREATE INDEX IF NOT EXISTS tb_mastersheet_changes_batch_idx
  ON tb_mastersheet_changes (batch_id)
  WHERE batch_id IS NOT NULL AND reverted_at IS NULL;
