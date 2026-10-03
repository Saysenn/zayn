-- An upload can be undone, because now it is written down.
--
-- syncUpsert wrote straight to tb_mastersheet and never touched the change
-- log, so nothing an upload did appeared in History and none of it could
-- be reverted. That is why two real bugs were unrecoverable: a sheet with
-- a renamed end date column wiped every end date, and a partial sheet
-- deleted every deal it did not mention, with no record of either.
--
-- 'upload' rather than reusing 'sync': whatbot's own push is a different
-- act from a human uploading a file, and History should be able to say
-- which one changed a value.

ALTER TABLE tb_mastersheet_changes DROP CONSTRAINT IF EXISTS tb_mastersheet_changes_changed_via_check;

ALTER TABLE tb_mastersheet_changes
  ADD CONSTRAINT tb_mastersheet_changes_changed_via_check
  CHECK (changed_via IN ('admin', 'diane', 'sync', 'upload'));
