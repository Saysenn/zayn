-- ***************************************************
-- * `pay_this_month` IS NOW `special_case_deal`
-- ***************************************************
--
-- His call 2026-09-23, hours after 064 shipped it. The old name says what
-- the switch DOES and sounds like one more way of paying somebody. What it
-- actually does is except one row from the rule the other ninety one
-- follow, and the name should say that before it is flipped rather than
-- after somebody wonders why a row disagrees with its own dates.
--
-- The toggle reads "Make this deal Special Case", and the column, the wire
-- field and every helper now read the same way. NEVER TWO IN CIRCULATION:
-- there is no `pay_this_month` left anywhere in either codebase.
--
-- ===============================
-- * A RENAME, NOT A NEW COLUMN
-- ===============================
-- ADD + copy + DROP would lose the DEFAULT and the NOT NULL, and would
-- read as two columns to anything mid-flight. `RENAME COLUMN` carries the
-- type, the default, the not-null and any grants with it, in one lock.
--
-- IDEMPOTENT BOTH WAYS. `IF EXISTS` on the old name is not enough on its
-- own: running this twice must not fail, and neither must running it
-- against a database that only ever saw the new name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tb_mastersheet' AND column_name = 'pay_this_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tb_mastersheet' AND column_name = 'special_case_deal'
  ) THEN
    ALTER TABLE tb_mastersheet RENAME COLUMN pay_this_month TO special_case_deal;
  END IF;
END $$;

-- For a database that never ran 064 at all.
ALTER TABLE tb_mastersheet
  ADD COLUMN IF NOT EXISTS special_case_deal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tb_mastersheet.special_case_deal IS
  'This deal is a special case for its preset month: paid although the payment start says nothing is owed. Forces the full month. Read by shared/owedThisMonth.helper.js, so the total, the cell colour and the badge all follow it together.';

-- ===============================
-- * THE CHANGE LOG KEEPS ITS OWN HISTORY
-- ===============================
-- `tb_mastersheet_changes.field` holds the CAMELCASE wire name, so rows
-- written before today say `payThisMonth`. They are renamed too: History
-- and Undo match on that string, and a row nobody can undo because it is
-- filed under a name the code no longer uses is worse than no history.
UPDATE tb_mastersheet_changes
   SET field = 'specialCaseDeal'
 WHERE field = 'payThisMonth';
