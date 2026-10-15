-- ===============================
-- * CLOSED AND DISSOLVED ARE ONE STATUS (his call 2026-10-14)
-- ===============================
-- "Closed and dissolved are the same thing on our process." Two endings
-- that did the same thing (stop every live deal) asked people to pick a
-- word with no difference behind it. One ending is kept: closed.
--
-- HOW IT ENDED lives on the Winding down page now: its stage Dissolved,
-- with Struck off or After liquidation (migration 090). A company reaching
-- that stage is closed.
--
-- Nothing is lost: closed_on and every stopped deal stay as they were, so
-- a reopen still puts back what the closure stopped.

UPDATE tb_companies SET status = 'closed' WHERE status = 'dissolved';

-- A close parked for a later month carries its status in its args.
UPDATE tb_scheduled_actions
   SET args = jsonb_set(args, '{status}', '"closed"')
 WHERE status = 'parked' AND args->>'status' = 'dissolved';

ALTER TABLE tb_companies DROP CONSTRAINT IF EXISTS tb_companies_status_check;
ALTER TABLE tb_companies ADD CONSTRAINT tb_companies_status_check
  CHECK (status IN ('active', 'going_concern', 'review', 'liquidation', 'closed'));
