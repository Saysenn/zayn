-- payment_status mirrored onto master_sheet_rows — user's own design:
-- whatbot keeps updating payment_status the way it already does (via
-- POST /api/v1/agent/payment-status, keyed to assignments.id per period),
-- and that same write now also mirrors onto the matching master_sheet_rows
-- row, so the master sheet reflects the real confirmation state too.
--
-- Only "current period" fields, not a period-keyed history table like
-- payment_status itself — master_sheet_rows is live current state, not a
-- ledger (matches the "burn the month" rule already governing this
-- table: it only ever represents present/future, not a record of the past).
ALTER TABLE master_sheet_rows
  ADD COLUMN IF NOT EXISTS payment_outcome text,
  ADD COLUMN IF NOT EXISTS payment_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_note text;
