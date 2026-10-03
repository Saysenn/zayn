-- ***************************************************
-- * WORK PARKED FOR A LATER MONTH
-- ***************************************************
--
-- "Add 5% to Nathan for the next 3 months", said in October. Nothing
-- happens now; three rows land here, due November, December and January,
-- and the boot screen applies each one on the first sign in of its month.
--
-- ===============================
-- * THE RESOLVED CALL, NOT THE SENTENCE
-- ===============================
-- `args` is the finished tool call, worked out and CONFIRMED while the
-- admin was present. The runner never calls the model: re-deciding in
-- January what a sentence from October meant is a second chance to get it
-- wrong, unattended, three months after anybody could object.
--
-- So `said` is kept for the report and the audit trail, and is never read
-- back as an instruction.
--
-- ===============================
-- * ABSOLUTE MONTHS ONLY
-- ===============================
-- `due_month` is 'YYYY-MM', resolved when it is parked. A relative phrase
-- stored and re-read is how "next month" means something different on the
-- day it runs. The regex is the guard, not a convention.
--
-- ===============================
-- * NO DUPLICATE RUNS, WHATEVER THE BROWSER
-- ===============================
-- The boot screen may ask on every sign in. What actually runs is decided
-- HERE, by `status`: only 'parked' is eligible, and the runner claims a row
-- with an atomic compare-and-swap before touching anything. A second tab,
-- a second device or a third sign in finds nothing to do.
--
-- `attempts` lives on the row for the same reason. The preset roll counts
-- its tries in localStorage, which is per browser — switch machines and it
-- starts again. A retry budget that means anything has to be server side.

CREATE TABLE IF NOT EXISTS tb_scheduled_actions (
  id           bigserial PRIMARY KEY,

  -- 'YYYY-MM', resolved at parking time. Never a relative phrase.
  due_month    text NOT NULL CHECK (due_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- The finished call. `tool` is checked against an allow list in code
  -- (v1/agent/parkable.js) rather than here: the list is a decision about
  -- which tools replay safely, and it belongs next to them.
  tool         text  NOT NULL,
  args         jsonb NOT NULL,

  -- THE WORLD AS IT WAS WHEN THIS WAS AGREED. Checked before the write and
  -- the row is skipped if any of it moved. Optimistic concurrency: the
  -- admin approved a change to a row that looked like this, so a row that
  -- no longer looks like this is not the one they approved.
  expect       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Frozen at parking time. 'All INDIGO deals' is the ids that matched
  -- THEN, never a filter re-run on the day.
  target_ids   integer[] NOT NULL DEFAULT '{}',

  -- The admin's own sentence. For the report and the log, never replayed.
  said         text NOT NULL,
  parked_at    timestamptz NOT NULL DEFAULT now(),
  parked_via   text NOT NULL DEFAULT 'diane',

  -- parked     waiting for its month
  -- running    claimed by a runner, not yet finished
  -- done       applied
  -- skipped    the world moved; outcome says how
  -- failed     tried `attempts` times and threw
  -- expired    its month passed without running. Never run late.
  -- superseded a later park replaced it
  status       text NOT NULL DEFAULT 'parked'
                 CHECK (status IN ('parked','running','done','skipped','failed','expired','superseded')),

  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at   timestamptz,
  ran_at       timestamptz,

  -- One id for everything a month's run wrote, so History shows the run as
  -- ONE act with ONE Undo. See migration 062.
  batch_id     uuid,

  -- Why it ended the way it did, in the words the welcome page reads out.
  outcome      text,
  superseded_by bigint REFERENCES tb_scheduled_actions(id) ON DELETE SET NULL
);

COMMENT ON TABLE tb_scheduled_actions IS
  'Tool calls parked for a later month. Applied by the boot screen on that month''s first sign in.';

-- The runner's only question: what is due this month and still waiting.
CREATE INDEX IF NOT EXISTS tb_scheduled_actions_due_idx
  ON tb_scheduled_actions (due_month)
  WHERE status = 'parked';

-- The welcome page's standing list, and the supersede check.
CREATE INDEX IF NOT EXISTS tb_scheduled_actions_open_idx
  ON tb_scheduled_actions (due_month, parked_at DESC)
  WHERE status IN ('parked','running');

-- Reporting a finished run reads by batch.
CREATE INDEX IF NOT EXISTS tb_scheduled_actions_batch_idx
  ON tb_scheduled_actions (batch_id)
  WHERE batch_id IS NOT NULL;

-- ===============================
-- * A FIFTH SOURCE OF CHANGE
-- ===============================
-- History already separates 'admin', 'diane', 'sync' and 'import' because
-- WHICH document a decision was made in front of is worth seeing. A write
-- that happens at month start from a plan agreed weeks earlier is a fifth,
-- and reading it as ordinary 'diane' would hide exactly what is unusual
-- about it: nobody was there.
--
-- It is NOT 'sync', so it still claims the field against the next import
-- (see manually_overridden_fields in masterSheetRows.repo.js). The admin
-- decided this; the delay does not make it the sheet's own value.
ALTER TABLE tb_mastersheet_changes DROP CONSTRAINT IF EXISTS tb_mastersheet_changes_changed_via_check;
ALTER TABLE tb_mastersheet_changes
  ADD CONSTRAINT tb_mastersheet_changes_changed_via_check
  CHECK (changed_via IN ('admin', 'diane', 'sync', 'import', 'scheduled'));
