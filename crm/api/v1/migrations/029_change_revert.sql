-- Makes an edit undoable.
--
-- tb_mastersheet_changes has recorded old_value/new_value per field since
-- migration 015, but nothing could act on it — it was a record, not a
-- safety net. Now that every cell on People, Companies, the person page
-- and the master sheet is editable in place, a mistyped figure is one
-- keystroke away and there was no way back to the number that was there
-- before.
--
-- `reverted_at` is what stops a change being undone twice. Without it,
-- clicking Undo on the same entry a second time would write the old value
-- again on top of whatever was there by then — which, if someone had
-- since corrected the field properly, silently destroys the correction.
--
-- The revert itself is written as a NEW change entry (changed_via
-- 'admin'), not by deleting this one. An audit trail that erases its own
-- history to show a tidier state is not an audit trail, and "who undid
-- that, and when" is exactly the question this table exists to answer.
ALTER TABLE tb_mastersheet_changes
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz;

-- The history panel's query is "recent, not yet undone", and undone
-- entries are a small minority of the table.
CREATE INDEX IF NOT EXISTS tb_mastersheet_changes_open_idx
  ON tb_mastersheet_changes (changed_at DESC) WHERE reverted_at IS NULL;
