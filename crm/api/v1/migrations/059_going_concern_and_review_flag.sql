-- ***************************************************
-- * GOING CONCERN, AND A DEAL THAT ASKS TO BE REVIEWED
-- ***************************************************
--
-- His September sheet writes WORDS in the end date column on 31 of 92
-- rows, and the CRM dropped every one of them silently. Two phrases, and
-- they mean opposite things:
--
--   "Going concern"     19 rows. No end date, it keeps running. What a
--                       blank cell already means, so the null is correct.
--   "Reviewed monthly"  12 rows. Decided month by month rather than by a
--                       date. A null end date meant the exact OPPOSITE of
--                       what he wrote: the review queue asks whether the
--                       end date has passed, so null kept them OUT of the
--                       one screen that was meant to ask about them.

-- ===============================
-- * FIVE COMPANY STATUSES
-- ===============================
--   active         trading, paying in full
--   going_concern  trading, and expected to keep trading. His word.
--   liquidation    winding down, paying reduced amounts set per deal
--   dissolved      legally gone
--   closed         we ended it
--
-- `going_concern` is NOT terminal and behaves exactly like `active`
-- everywhere money is concerned: `isTerminal` is the only test that
-- branches on status, and it lists dissolved and closed alone.
ALTER TABLE tb_companies
  DROP CONSTRAINT IF EXISTS tb_companies_status_check;

ALTER TABLE tb_companies
  ADD CONSTRAINT tb_companies_status_check
    CHECK (status IN ('active', 'going_concern', 'liquidation', 'dissolved', 'closed'));

-- ===============================
-- * TWO COLUMNS, TWO JOBS
-- ===============================
-- Deliberately not one. `end_note` is what he WROTE and it only ever
-- displays; `review_monthly` is what the CRM DOES about it and it is read
-- by SQL. Driving a queue off free text would mean a spelling change in
-- his sheet silently emptying the review list.
--
-- The same split `payment_note` already uses for prose in the payment
-- start column: keep his words, never parse them into behaviour twice.
ALTER TABLE tb_mastersheet
  -- His own word from the end date column, kept verbatim. NULL on every
  -- ordinary row. The cell's tag reads this.
  ADD COLUMN IF NOT EXISTS end_note text,

  -- A third reason to be in the monthly review, beside a past end date and
  -- a company in liquidation. Set by the import from "Reviewed monthly",
  -- and by hand from the company status screen.
  ADD COLUMN IF NOT EXISTS review_monthly boolean NOT NULL DEFAULT false;

-- The review queue reads this on every list, so it is worth the index:
-- without it the third condition turns the queue into a full scan.
CREATE INDEX IF NOT EXISTS idx_mastersheet_review_monthly
  ON tb_mastersheet (review_monthly)
  WHERE review_monthly = true;
