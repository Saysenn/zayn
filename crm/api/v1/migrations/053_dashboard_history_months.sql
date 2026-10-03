-- ***************************************************
-- * How far back the dashboard OFFERS to look
-- ***************************************************
--
-- A DISPLAY CAP, NEVER A RETENTION RULE. His call 2026-09-09, and the
-- distinction is the whole point of the column.
--
-- The obvious version of this setting would have driven the pruner too, so
-- moving it from 12 to 3 would delete nine immutable month snapshots on the
-- next scheduler tick: permanently, automatically, on a cron, with nobody
-- watching. A snapshot froze the sheet as it stood that day and cannot be
-- rebuilt from anything.
--
-- So retention stays a constant. `SNAPSHOT_MONTHS` in
-- shared/snapshotWindow.helper.js keeps twelve months whatever this says,
-- and this only decides which ranges the dashboard's dropdown offers.
--
-- The good property that falls out: RAISING IT IS INSTANT AND FREE. The
-- months were never thrown away, so going from 3 to 12 draws a year of real
-- history the moment it is saved.
--
-- 3, 6 or 12. Constrained here rather than trusted from the route, because
-- an unknown value would leave the dropdown with nothing to select.

ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS dashboard_history_months smallint NOT NULL DEFAULT 3;

ALTER TABLE tb_settings
  DROP CONSTRAINT IF EXISTS tb_settings_dashboard_history_months_check;

ALTER TABLE tb_settings
  ADD CONSTRAINT tb_settings_dashboard_history_months_check
  CHECK (dashboard_history_months IN (3, 6, 12));
