-- ***************************************************
-- * LIQUIDATION, AND DISSOLVED AS ITS OWN STATUS
-- ***************************************************
--
-- A company does not go from trading to gone. It winds down, at a
-- negotiated figure, over months. See docs/closure.md section 6.

-- ===============================
-- * FOUR VALUES, AND DISSOLVED IS THERE FOR AUDIT
-- ===============================
--   active       trading, paying in full
--   liquidation  winding down, paying reduced amounts set per deal
--   dissolved    legally gone
--   closed       we ended it
--
-- `dissolved` and `closed` are both terminal and both stop every deal on
-- the company. They differ only in what they SAY happened, which is the
-- whole point of having two: a single `closed` loses whether the company
-- ceased to exist or whether we walked away from it.
ALTER TABLE tb_companies
  DROP CONSTRAINT IF EXISTS tb_companies_status_check;

ALTER TABLE tb_companies
  ADD CONSTRAINT tb_companies_status_check
    CHECK (status IN ('active', 'liquidation', 'dissolved', 'closed'));

ALTER TABLE tb_companies
  -- The day it became terminal. Set on dissolved or closed, cleared on
  -- reopening, and it is what dates the stop written onto every deal.
  ADD COLUMN IF NOT EXISTS closed_on date,

  -- ===============================
  -- * A REFERENCE, NEVER A RULE
  -- ===============================
  -- What was agreed in the negotiation. NOTHING COMPUTES A DEAL'S AMOUNT
  -- FROM IT: a settlement of 1,000 can be a director at zero and a mid
  -- unchanged, so a multiplier cannot express it and there is no factor
  -- anywhere in the code.
  --
  -- It exists so the panel has something to check against, and so the
  -- audit question "what did we actually agree to pay them" has an answer.
  -- The deals say what they say; the settlement that produced them was
  -- nowhere. It WARNS on a mismatch, over or under, and never refuses.
  ADD COLUMN IF NOT EXISTS liquidation_total numeric(18, 2)
    CHECK (liquidation_total IS NULL OR liquidation_total >= 0);

COMMENT ON COLUMN tb_companies.liquidation_total IS
  'The settlement agreed when winding down. A number to compare against, never a multiplier. See docs/closure.md section 6.';

COMMENT ON COLUMN tb_companies.status IS
  'active | liquidation | dissolved | closed. The COMPANY status, the only thing the UI may call Status.';
