-- The constraint 033 thought it was replacing was still there under its
-- OLD NAME, and still rejecting every upload.
--
-- Migration 023 renamed master_sheet_field_changes to
-- tb_mastersheet_changes. Postgres renames a table's constraints with it
-- only if they were auto-named at that moment; this one kept
-- `master_sheet_field_changes_changed_via_check`. So the table carried two
-- CHECKs on changed_via:
--
--   master_sheet_field_changes_changed_via_check   admin | diane | sync
--   tb_mastersheet_changes_changed_via_check       admin | diane | sync | upload
--
-- Both apply. 033's DROP ... IF EXISTS named the new one, which did not
-- exist yet, so it dropped nothing and added the permissive one beside a
-- restrictive one that nobody could see. Every commit failed on the old
-- constraint with a 500, which surfaced in the UI as "Something went
-- wrong. Please try again."
--
-- Dropped by its real name. The permissive constraint 033 added stays and
-- is now the only one.

ALTER TABLE tb_mastersheet_changes
  DROP CONSTRAINT IF EXISTS master_sheet_field_changes_changed_via_check;
