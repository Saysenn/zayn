-- The calculator's computed line items, stored rather than only written
-- to xlsx. Until now every generate produced expensing/cash/bank/admin
-- files on disk and nothing else, so the preview was a dumb cell grid
-- with no row identity — nothing to attach a toggle, an edit, or a bulk
-- action to. This is what makes those possible.
--
-- ONE ROW PER PERSON-ASSIGNMENT, not one per output file. The four files
-- are filtered views of the same computed set (see buildBreakdowns.js):
--   expensing  everyone
--   cash       payment_method = 'cash'
--   bank       payment_method = 'bank'
--   admin      staff = true
-- Storing per-file would mean the same person three times, and an edit
-- that had to be applied three times to stay consistent.
CREATE TABLE IF NOT EXISTS calculator_rows (
  id serial PRIMARY KEY,

  -- Identity across regenerates. The scanned sheet has no stable per-row
  -- id, so this is group|company|person plus a dedupe index — the index
  -- matters because the same person legitimately appears twice on the
  -- same company with different payable days, and collapsing those two
  -- into one row deletes a real payment (whatbot's own rule, and the
  -- reason calculator_overrides' text-only key is a known weakness).
  source_key text NOT NULL,
  dedupe_index integer NOT NULL DEFAULT 0,

  group_name text NOT NULL,
  role_label text,
  staff boolean NOT NULL DEFAULT false,
  person_name text NOT NULL,
  company text,

  appointment_on date,
  payment_start_on date,
  preset_on date,
  end_on date,

  payable_days integer NOT NULL DEFAULT 0,
  payment_method text,
  monthly_amount numeric NOT NULL DEFAULT 0,
  payable_amount numeric NOT NULL DEFAULT 0,
  currency text,
  location text NOT NULL DEFAULT '',
  postcode text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  bank_details text NOT NULL DEFAULT '',

  -- Resolved at generate time from calculator_overrides, then editable
  -- here directly. Kept on the row (not read live from that table) so a
  -- generated run is a snapshot of what was decided at the time.
  should_be_paid boolean NOT NULL DEFAULT true,
  should_be_paid_note text,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,

  -- The sheet couldn't resolve something (a "TBC" deal, an unrecognised
  -- payment method). Kept visible rather than dropped, same rule the
  -- xlsx output already follows.
  needs_review boolean NOT NULL DEFAULT false,

  -- Which columns a human edited by hand. Regenerating recomputes
  -- everything EXCEPT these, so an edit survives the next run instead of
  -- being silently rebuilt away — user's explicit choice, and the same
  -- approach assignments.manually_overridden_fields already uses.
  manually_overridden_fields text[] NOT NULL DEFAULT '{}',

  -- Which generate run last touched this row. A row whose run number has
  -- fallen behind is one the latest source sheets no longer contain.
  last_run integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_key, dedupe_index)
);

CREATE INDEX IF NOT EXISTS calculator_rows_group_idx ON calculator_rows (group_name);
CREATE INDEX IF NOT EXISTS calculator_rows_method_idx ON calculator_rows (payment_method);
CREATE INDEX IF NOT EXISTS calculator_rows_staff_idx ON calculator_rows (staff) WHERE staff;
