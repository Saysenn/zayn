-- One row per human. The CRM has never had this — a person only existed
-- by virtue of appearing on a payment row, which is exactly what the
-- People page needs to stop being true.
--
-- DELIBERATELY THIN. This holds only what a deal has no column for.
-- Everything else (roles, groups, companies, amounts, phone, postcode,
-- bank details) stays derived from tb_mastersheet, so there is nothing to
-- keep in sync and nothing that can drift.
--
-- Phone/location/bank details in particular are NOT copied up here: they
-- legitimately vary per deal in the real sheet, and picking one to sit on
-- the person would force a false choice. The person page shows them as
-- "one value if consistent, a list if not".
--
-- person_id is the same name slug tb_mastersheet already uses (identity.js
-- personIdOf). No new identity scheme — a second one would mean the same
-- human resolving two different ways depending on which page created them.
--
-- No merge/dedupe column: the user's explicit rule is that a person
-- legitimately holds many deals across many companies, and duplicate
-- appearances are the data working correctly, not a problem to collapse.

CREATE TABLE IF NOT EXISTS tb_people (
  person_id    text PRIMARY KEY,
  display_name text NOT NULL,
  email        text NOT NULL DEFAULT '',
  notes        text NOT NULL DEFAULT '',

  -- Soft only. A person with historical deals is never hard-deleted.
  archived_at  timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- "Show me everyone who isn't archived" is the People page's default
-- query, and archived rows are a small slice.
CREATE INDEX IF NOT EXISTS tb_people_active_idx ON tb_people (person_id) WHERE archived_at IS NULL;

-- Fuzzy name search, same pg_trgm extension migration 014 already enabled.
CREATE INDEX IF NOT EXISTS tb_people_name_trgm_idx
  ON tb_people USING gin (display_name gin_trgm_ops);

-- Backfill from the deals that already exist. DISTINCT ON with a stable
-- ORDER BY so the same spelling wins every time this is re-run, rather
-- than whichever row the planner happened to reach first.
INSERT INTO tb_people (person_id, display_name)
SELECT DISTINCT ON (person_id) person_id, person_name
FROM tb_mastersheet
WHERE person_id <> ''
ORDER BY person_id, id
ON CONFLICT (person_id) DO NOTHING;
