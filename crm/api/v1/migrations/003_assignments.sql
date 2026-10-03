-- Mirrors the sheet, column-for-column. sync_key is whatbot's own
-- appointmentId (`group|company|role|seat|person|rowcCol`, see
-- whatbot/src/sheet/parseSheet.js) — the upsert target for the 15-min sync,
-- so a re-sync updates the same row instead of duplicating it.
--
-- employee_id is the RAW "Employee ID" sheet column (may be blank).
-- person_id is whatbot's normalized identity (refIdOf/personIdOf — see
-- parseSheet.js), the key the agent actually looks handlers up by, since
-- that's the identity whatbot itself resolves a WhatsApp sender to.
CREATE TABLE IF NOT EXISTS assignments (
  id serial PRIMARY KEY,
  sync_key text UNIQUE NOT NULL,
  employee_id text,
  person_id text NOT NULL,
  role text,
  group_name text,
  person_name text,
  company text,
  phone text,
  assigned_on date,
  payment_start_on date,
  preset_on date,
  end_on date,
  payable_days integer,
  payment_method text,
  monthly_amount numeric,
  payable_amount numeric,
  currency text,
  location text,
  synced_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_person_id_idx ON assignments (person_id);
