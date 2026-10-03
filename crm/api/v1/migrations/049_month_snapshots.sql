-- ***************************************************
-- * A month, kept exactly as it stood
-- ***************************************************
--
-- The sheet is one live table with no memory: the moment a preset rolls to
-- October, September is gone and nothing can be asked about it again. This
-- is the record forecasting reads.
--
-- THE ROW EXACTLY AS THE TABLE HELD IT. snake_case keys, no rounding, no
-- renaming, no narrowing to the columns forecasting is expected to want. A
-- column left out in September cannot be added back in December, and the
-- questions are not known yet. 96 rows a month costs nothing.
--
-- THE FIGURES ARE STORED, NOT RECOMPUTED. Recomputing September under
-- today's rules answers a different question, and would answer it
-- differently again next time a rule changes.
--
-- READ ONLY, FOREVER. No edit path, no undo, no upload touches it. The
-- instant one can be corrected it stops being evidence. Enforced below by
-- a rule, not only by convention: the application is not the only thing
-- that can reach this table.

CREATE TABLE IF NOT EXISTS tb_month_snapshots (
  -- 'YYYY-MM'. TEXT rather than a date: a month is not a day, and storing
  -- the 1st invites somebody to read it as one.
  month       text PRIMARY KEY CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  taken_at    timestamptz NOT NULL DEFAULT now(),
  -- Every column of every deal, as the table held them.
  rows        jsonb NOT NULL,
  -- The month's own figures: per group, per currency, and the rate used.
  totals      jsonb NOT NULL,
  -- How many rows are in `rows`, so a count never means parsing the
  -- document. Checked against it on the way in.
  row_count   integer NOT NULL CHECK (row_count >= 0)
);

COMMENT ON TABLE tb_month_snapshots IS
  'One immutable record per month. Never updated, never recomputed. See feature 1.';

-- ===============================
-- * IMMUTABLE, AT THE DATABASE
-- ===============================
--
-- "Read only forever" written in a comment is a convention; a verification
-- script, a migration or a stray UPDATE walks straight past it. This makes
-- the promise the table's own.
--
-- A snapshot may be INSERTED and, deliberately, DELETED: a month taken by
-- mistake has to be removable, and a delete is loud and total where an
-- update is quiet and partial. What must never happen is a figure changing
-- underneath a month that has already been read.
CREATE OR REPLACE RULE tb_month_snapshots_immutable AS
  ON UPDATE TO tb_month_snapshots DO INSTEAD NOTHING;
