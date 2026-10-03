-- ***************************************************
-- * A deal that is OVER, and why
-- ***************************************************
--
-- Nothing has ever ended a deal. His sheet cannot (column I returns 0 only
-- for "not started yet"), his end date column is written by 73 formulas and
-- read by ZERO, and the CRM's own `ended` branch is unreachable because
-- `color_uses_end_date` defaults false. Every deal ever opened still counts,
-- forever, and totals only grow. See docs/closure.md.

ALTER TABLE tb_mastersheet
  -- THE DAY IT STOPPED. Null is a live deal.
  --
  -- NOT `end_on`, which stays exactly as it is: that column is the sheet's
  -- own formula, appointment + one year, and it is PROVISIONAL. His words:
  -- "provisional as sometimes job finish early and or they last longer".
  -- It raises a question; this answers one.
  ADD COLUMN IF NOT EXISTS stopped_on date,

  -- ===============================
  -- * WHY IT STOPPED, AND IT IS NOT DECORATION
  -- ===============================
  -- The Archive page has to say why each row is there, and three different
  -- things stop a deal: a hand stop, a monthly review answered No or Final,
  -- and a company being closed. Only the second leaves a row in the review
  -- table, so deriving the reason would leave the other two blank on the one
  -- page whose whole job is explaining them.
  --
  -- A CLOSED SET, checked here rather than trusted: this drives what the
  -- Archive prints and whether Resume is allowed, and an unknown value
  -- would render as a blank cell on a row nobody could then un-stop.
  ADD COLUMN IF NOT EXISTS stopped_reason text
    CHECK (stopped_reason IS NULL OR stopped_reason IN (
      'stopped_by_hand',   -- somebody pressed Stop on the row
      'review_no',         -- the monthly review was answered No
      'review_final',      -- answered "yes, final month"
      'company_closed'     -- its company was closed or dissolved
    ));

-- ===============================
-- * BOTH OR NEITHER
-- ===============================
-- A stop date with no reason is a row the Archive cannot explain; a reason
-- with no date is a row that never left the sheet. Either alone is a bug
-- that would only surface as a blank column weeks later.
ALTER TABLE tb_mastersheet
  DROP CONSTRAINT IF EXISTS tb_mastersheet_stopped_pair;

ALTER TABLE tb_mastersheet
  ADD CONSTRAINT tb_mastersheet_stopped_pair
    CHECK ((stopped_on IS NULL) = (stopped_reason IS NULL));

-- The Archive page reads exactly this, newest stop first, and every other
-- page has to exclude it. Partial: live rows are the overwhelming majority
-- and they are not in this index at all.
CREATE INDEX IF NOT EXISTS tb_mastersheet_stopped_idx
  ON tb_mastersheet (stopped_on DESC) WHERE stopped_on IS NOT NULL;

COMMENT ON COLUMN tb_mastersheet.stopped_on IS
  'The day this deal ended. Null is live. Set by hand, by the monthly review, or by closing its company. See docs/closure.md.';
