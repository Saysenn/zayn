-- "CRM changes should prevail" — the user's governing rule, now applied to
-- the calculator the same way master_sheet_rows already applies it.
--
-- Regenerating must:
--   ADD    rows that are new in the human-made xlsx
--   KEEP   every field a human edited (already handled by
--          manually_overridden_fields, migration 019)
--   KEEP   rows a human ADDED here, which is what this column adds — a
--          manual row has no source_key in any sheet, so the existing
--          `last_run < $1` sweep would delete it on the very next run.
--   REMOVE only generated rows the source sheets no longer contain
ALTER TABLE calculator_rows
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'generated'
    CHECK (source IN ('generated', 'manual'));

-- deleteStale() filters on this every run, and it's a small slice of the
-- table (a handful of hand-added rows against ~90 generated ones).
CREATE INDEX IF NOT EXISTS calculator_rows_source_idx ON calculator_rows (source);
