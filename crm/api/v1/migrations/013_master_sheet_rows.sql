-- The CRM's own master sheet — the final, admin-polished version of the
-- messy human-made sheet, and (per the user's confirmed flow) the thing
-- whatbot answers questions from once it's been polished.
--
-- Flow this table sits in the middle of:
--   1. Every 5 min, whatbot PULLS these rows (GET /agent/master-sheet) and
--      replaces its own Redis roster with them, so it always answers off
--      the admin's latest polish, not off the raw uploaded file.
--   2. At start of month, whatbot PUSHES (POST /agent/sync/master-sheet) —
--      either the newly-uploaded human sheet (origin: 'upload') or, if
--      nothing was uploaded, last month's pulled-down copy of THIS table
--      (origin: 'repull'), which re-seeds the CRM from its own prior
--      finalized state.
--   3. In between, the admin CRUDs these rows on the Master Sheet page.
--
-- Deliberately NOT the same table as `assignments`: that one is a 15-min
-- mirror of the sheet whose whole contract is "sync overwrites everything"
-- (assignments.repo.js's upsert, companies.repo.js's touch()). This one is
-- the opposite — the admin's edits are the point, and a sync must never
-- silently undo them. Two different jobs, so two different tables.
--
-- The calculator is explicitly NOT part of this loop — it stays an
-- independent consumer of its own uploaded sheet (see v1/calculator.js).
CREATE TABLE IF NOT EXISTS master_sheet_rows (
  id serial PRIMARY KEY,

  -- whatbot's own assignmentId (group|company|role|seat|person|row) when
  -- the row came from a sheet, or a generated "manual-<n>" when an admin
  -- added it here. The upsert target for every sync, and what whatbot
  -- reads back as assignmentId on pull, so a round-trip is lossless.
  --
  -- Never person+company+role: the same person legitimately holds the same
  -- role on the same company twice with different payable days, and
  -- collapsing those deletes someone's wages (whatbot's own rule).
  sync_key text NOT NULL UNIQUE,

  -- 'synced'  — arrived from whatbot's sheet parse
  -- 'manual'  — the admin added this person by hand ("if anyone's missing
  --             in the CRM master sheet, the admin should be able to put
  --             the data in"). Never deleted by a sync, at any origin.
  source text NOT NULL DEFAULT 'synced' CHECK (source IN ('synced', 'manual')),

  person_id text NOT NULL,
  person_name text NOT NULL,
  phone text NOT NULL DEFAULT '',

  -- role is whatbot's normalized enum ('director'/'mid'/'admin'/...),
  -- role_label is what the sheet literally says ("Mid 1", "Visa co D").
  -- Both kept: the enum is what logic filters on, the label is what a
  -- human recognises on the page and in the exported xlsx.
  role text NOT NULL,
  seat integer,
  role_label text NOT NULL,

  group_name text NOT NULL,
  company text, -- null on ALL BOOKS/TAKEOFF rows, which pay against the group itself

  assigned_on date,
  payment_start_on date,
  preset_on date,
  end_on date,

  payable_days integer NOT NULL DEFAULT 0,
  monthly_amount numeric NOT NULL DEFAULT 0,
  payable_amount numeric NOT NULL DEFAULT 0,

  currency text NOT NULL DEFAULT 'GBP',
  payment_method text NOT NULL DEFAULT 'cash',
  location text NOT NULL DEFAULT '',

  -- The newer "tech" template's columns. Free text on purpose — they're
  -- carried through the sheet -> CRM -> sheet round trip verbatim, not
  -- parsed the way dates and money are. Note should_be_paid/paid here are
  -- the SHEET's own columns, unrelated to calculator_overrides (which is
  -- the calculator's separate CRM-side override, still keyed its own way).
  postcode text NOT NULL DEFAULT '',
  label text NOT NULL DEFAULT '',
  should_be_paid text NOT NULL DEFAULT '',
  paid text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  bank_details text NOT NULL DEFAULT '',

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),

  -- The sync takes the human sheet AS-IS — duplicates, half-filled rows,
  -- unrecognised currencies and all. A row whatbot's own strict parse
  -- would have rejected still lands here, flagged, with the reason it
  -- failed, because this table is where a human cleans it up. That's the
  -- opposite of whatbot's Redis roster, which still refuses bad rows
  -- outright (a wrong figure reaching someone's WhatsApp is worse than a
  -- missing one) — two destinations, two standards, one parse.
  --
  -- Note this is deliberately NOT a CHECK-constrained column set: currency
  -- and payment_method are plain text here precisely so a messy value
  -- survives to be corrected rather than failing the insert.
  needs_review boolean NOT NULL DEFAULT false,
  review_reason text NOT NULL DEFAULT '',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The page's default view is grouped, and the sync's delete-what's-missing
-- step filters on source — both hit these constantly.
CREATE INDEX IF NOT EXISTS master_sheet_rows_group_idx ON master_sheet_rows (group_name);
CREATE INDEX IF NOT EXISTS master_sheet_rows_source_idx ON master_sheet_rows (source);
CREATE INDEX IF NOT EXISTS master_sheet_rows_person_idx ON master_sheet_rows (person_id);
-- Partial: "show me what needs cleaning up" is the query, and it's a small
-- slice of a table that's mostly fine.
CREATE INDEX IF NOT EXISTS master_sheet_rows_review_idx ON master_sheet_rows (needs_review) WHERE needs_review;
