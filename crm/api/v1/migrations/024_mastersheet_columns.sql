-- The four sheet columns the importer was silently throwing away, plus
-- the override guard that makes the CRM (not the spreadsheet) the owner.
--
-- FOUR MISSING COLUMNS
-- master.xlsx has 25 columns. mapSheetRow.js aliased 21 of them, so
-- `Door number`, `Accepting postals`, `Account number` and `Sort code`
-- were read off the sheet and dropped on the floor on every single upload.
-- Between 88 and 91 of 97 rows carry a value in each. Two of them are how
-- a person actually gets paid.
--
-- All four are TEXT, never numeric. The real values are not numbers:
--   door_number       "8", "Flat 2, 199 - 201", "In person meet"
--   accepting_postals "Yes", "No", "Handled Internally"
--   account_number    "13943089", "Will never be bank"
--   sort_code         "20 - 82 - 23"
-- Same lenient rule the rest of this table already follows: a messy value
-- survives to be corrected on the page rather than failing the insert.
--
-- MANUALLY_OVERRIDDEN_FIELDS
-- The structural fix. `assignments` had this guard and `calculator_rows`
-- had it — and both were just dropped, leaving the one surviving table
-- with no protection at all. Without it:
--
--   admin corrects Nathan £1,000 -> £3,000 in the CRM
--   next month's human-made sheet still says £1,000
--   upload runs, and Nathan is back on £1,000 with no warning and no trace
--
-- An array of column names rather than one boolean, matching the approach
-- migration 018 already used: a hand-corrected phone number must not stop
-- the payable amount from still tracking the sheet.
--
-- The wider point: until now the spreadsheet owned the data and the CRM
-- displayed it. For a system whose whole purpose is to replace that
-- spreadsheet, this is backwards. This column inverts it — the sheet
-- becomes a proposal, the CRM becomes the owner.

ALTER TABLE tb_mastersheet
  ADD COLUMN IF NOT EXISTS door_number       text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS accepting_postals text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_number    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sort_code         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manually_overridden_fields text[] NOT NULL DEFAULT '{}';
