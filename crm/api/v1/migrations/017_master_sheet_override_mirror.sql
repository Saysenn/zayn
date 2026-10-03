-- The other half of #11's bidirectional sync (payment_status -> master
-- sheet was migration 016) — the admin's should-be-paid/paid overrides
-- from the People page now mirror onto the matching master_sheet_rows
-- row too.
--
-- Separate columns, NOT the sheet's own `should_be_paid`/`paid` text
-- columns — those represent whatever the boss's team literally typed
-- into the sheet (raw, often blank), a different fact from the admin's
-- own structured business-decision override (calculator_overrides).
-- Overwriting the sheet's own column with the override would blur two
-- different sources of truth into one field, exactly what payment_outcome
-- (migration 016) was kept separate to avoid — same reasoning here.
ALTER TABLE master_sheet_rows
  ADD COLUMN IF NOT EXISTS override_should_be_paid boolean,
  ADD COLUMN IF NOT EXISTS override_paid boolean,
  ADD COLUMN IF NOT EXISTS override_paid_at timestamptz;
