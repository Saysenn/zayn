-- ***************************************************
-- * `upload` becomes `import`, everywhere including here
-- ***************************************************
--
-- The screen said Upload, the components said Upload, and the one word the
-- admin now reads is IMPORT: the button, the modal, the toasts, the
-- confirms and History's "by an import". This is the stored half of that.
--
-- SAFE IN EITHER DEPLOY ORDER, deliberately. The CHECK keeps 'upload' as
-- well as adding 'import', so code still writing the old word does not 500
-- between this running and the deploy landing. The UPDATE below rewrites
-- every row that already exists, so History reads one word.
--
-- 'upload' can be dropped from the CHECK once a release has passed with
-- nothing writing it. Nothing does today: the only producers were
-- syncUpsert's origin and the diff's bulk delete, both inside crm/api, and
-- whatbot stopped pushing to /sync/master-sheet when the CRM took over
-- ingestion (see whatbot/src/system/crmClient.js, "READ ONLY").

ALTER TABLE tb_mastersheet_changes DROP CONSTRAINT IF EXISTS tb_mastersheet_changes_changed_via_check;

ALTER TABLE tb_mastersheet_changes
  ADD CONSTRAINT tb_mastersheet_changes_changed_via_check
  CHECK (changed_via IN ('admin', 'diane', 'sync', 'upload', 'import'));

-- The rename itself. Reversible: the reverse is the same statement with the
-- two values swapped.
UPDATE tb_mastersheet_changes SET changed_via = 'import' WHERE changed_via = 'upload';
