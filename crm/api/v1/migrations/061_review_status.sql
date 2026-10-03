-- ***************************************************
-- * A company can be under review without winding down
-- ***************************************************
--
-- His call 2026-09-21: "the company is subject for monthly review". NOT
-- liquidation, and the difference is money. Liquidation is a negotiation
-- with a settlement and an amount set per deal; this only says ask me
-- about this company every month.
--
-- Both ask through the CHECKLIST, per deal, never across the whole
-- company. See 062 for the half of that change that lives in the queue.

ALTER TABLE tb_companies DROP CONSTRAINT IF EXISTS tb_companies_status_check;

ALTER TABLE tb_companies ADD CONSTRAINT tb_companies_status_check
  CHECK (status IN ('active', 'going_concern', 'review', 'liquidation', 'dissolved', 'closed'));
