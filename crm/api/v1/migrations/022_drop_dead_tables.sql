-- The refactor's first cut: five tables that no longer have a job.
--
-- whatbot no longer syncs anything INTO the CRM (user's explicit decision).
-- It pulls the master sheet every 5 minutes to answer WhatsApp questions,
-- and it writes back exactly two things — `paid` and `confirmed` — straight
-- onto the master sheet row. Nothing else crosses the boundary.
--
-- That removes the reason `assignments` and `companies` existed: both were
-- 15-minute mirrors of whatbot's own xlsx parse. `payment_status` was keyed
-- to `assignments` and dies with it; the same fact now lives on the master
-- sheet row itself (payment_outcome, added in migration 016).
--
-- The calculator page is removed entirely (there is no earnings cascade in
-- the boss's real sheet — every row is a flat negotiated amount, so the
-- whole "computation" is one line of arithmetic). Its two tables go with
-- it: `calculator_rows` is recomputed from master_sheet_rows on demand, and
-- `calculator_overrides` duplicated should_be_paid/paid, which
-- master_sheet_rows already carries as override_should_be_paid/override_paid
-- (migration 017).
--
-- Order matters: payment_status references assignments, so it goes first.

DROP TABLE IF EXISTS payment_status;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS calculator_rows;
DROP TABLE IF EXISTS calculator_overrides;
