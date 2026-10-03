-- Field-level history for master_sheet_rows — user asked three times for
-- "what exactly got edited on this row," and "this row was touched" (the
-- cheap version already built) never actually answered that. This does.
--
-- Scoped to edits only (update()), not every sync — a monthly sync can
-- touch 100+ rows across 20 fields each, and most of those don't actually
-- change value to value, so this only ever logs a genuine before/after
-- difference, whatever the source. Row creation and deletion aren't
-- field-diffed here (nothing to diff against, or nothing left to query) —
-- see masterSheetRows.repo.js's create()/remove() if that's ever needed.
CREATE TABLE IF NOT EXISTS master_sheet_field_changes (
  id serial PRIMARY KEY,
  row_id integer NOT NULL REFERENCES master_sheet_rows(id) ON DELETE CASCADE,
  -- Denormalized snapshot, not a join target — still readable in isolation,
  -- and (if a fuller "history survives deletion" is ever wanted) the join
  -- to master_sheet_rows can be dropped later without losing readability.
  person_name text NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  -- 'admin'  — edited through the Master Sheet page's form
  -- 'diane'  — edited through the polishing agent's update tool
  -- 'sync'   — whatbot's month-start push overwrote it
  changed_via text NOT NULL CHECK (changed_via IN ('admin', 'diane', 'sync')),
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- "What changed on row X" and "what changed recently" are the two real
-- queries — one per row, one across the whole table ordered by time.
CREATE INDEX IF NOT EXISTS master_sheet_field_changes_row_idx ON master_sheet_field_changes (row_id);
CREATE INDEX IF NOT EXISTS master_sheet_field_changes_time_idx ON master_sheet_field_changes (changed_at DESC);
