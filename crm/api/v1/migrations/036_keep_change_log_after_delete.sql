-- A deleted row's own history is deleted with it, so a delete cannot be
-- recorded at all.
--
-- tb_mastersheet_changes.row_id is ON DELETE CASCADE, which is right for
-- edits: an entry saying "the payable amount went from 500 to 750" is
-- about a row, and with the row gone it describes nothing. But it also
-- means the one entry worth keeping, "this row was deleted", is removed by
-- the very act it records.
--
-- Six NEXUS deals went on 2026-08-23 and there is no trace of when or by
-- what. `remove` and `removeMany` wrote straight to the table, exactly as
-- uploads used to before migration 033.
--
-- SET NULL rather than CASCADE. The entry survives the row, `row_id` goes
-- to NULL, and findFieldChanges already LEFT JOINs and reports
-- `row_exists` false, so the panel says "the row is gone" instead of
-- offering an Undo that would 404.

ALTER TABLE tb_mastersheet_changes ALTER COLUMN row_id DROP NOT NULL;

ALTER TABLE tb_mastersheet_changes
  DROP CONSTRAINT IF EXISTS master_sheet_field_changes_row_id_fkey;
ALTER TABLE tb_mastersheet_changes
  DROP CONSTRAINT IF EXISTS tb_mastersheet_changes_row_id_fkey;

ALTER TABLE tb_mastersheet_changes
  ADD CONSTRAINT tb_mastersheet_changes_row_id_fkey
  FOREIGN KEY (row_id) REFERENCES tb_mastersheet(id) ON DELETE SET NULL;
