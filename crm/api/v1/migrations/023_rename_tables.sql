-- Every surviving table gains a `tb_` prefix (user's convention).
--
-- `admins` becomes `tb_accounts` rather than `tb_admins` — the row is a
-- login credential, not a person, and "account" is what it actually is.
--
-- `master_sheet_rows` becomes `tb_mastersheet`. The old name described
-- where the data came from (rows of a sheet); the new one names what it
-- is: the master sheet itself, the CRM's source of truth. Each row is a
-- DEAL — one person, one company, one role, one amount — which is the
-- boss's own word for it and the vocabulary the whole refactor now uses.
--
-- Postgres carries indexes, constraints, sequences and foreign keys
-- through a table rename automatically, so nothing below needs restating.
-- Index NAMES keep their old spelling (master_sheet_rows_group_idx etc.);
-- that is cosmetic only and deliberately not churned here.

ALTER TABLE admins                     RENAME TO tb_accounts;
ALTER TABLE master_sheet_rows          RENAME TO tb_mastersheet;
ALTER TABLE master_sheet_field_changes RENAME TO tb_mastersheet_changes;
ALTER TABLE concerns                   RENAME TO tb_concerns;
ALTER TABLE logs                       RENAME TO tb_logs;
ALTER TABLE app_settings               RENAME TO tb_settings;
ALTER TABLE messages                   RENAME TO tb_messages;
ALTER TABLE thread_reads               RENAME TO tb_thread_reads;
ALTER TABLE group_receipts             RENAME TO tb_group_receipts;
