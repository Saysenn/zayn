-- ***************************************************
-- * THE MONTHLY REVIEW: is this deal still running?
-- ***************************************************
--
-- Past its term a deal stops being automatic. Once a month the CRM asks,
-- per deal, and the answer moves money. See docs/closure.md section 5.

-- ===============================
-- * PER MONTH, NOT A COLUMN ON THE DEAL
-- ===============================
-- The same deal is asked again next month. One column on tb_mastersheet
-- would overwrite January with February and lose the history of a decision
-- that stopped somebody being paid, which is the one thing an audit asks
-- for. So it is its own table, one row per deal per period.
CREATE TABLE IF NOT EXISTS tb_monthly_review (
  id bigserial PRIMARY KEY,

  -- ON DELETE CASCADE, deliberately, and it is the only cascade here.
  -- A deleted deal is a pairing that should never have existed (see
  -- CLAUDE.md, Delete vs Remove); its review answers are about a deal that
  -- is gone, and an orphaned answer would sit in the queue forever with
  -- nothing to open.
  deal_id bigint NOT NULL REFERENCES tb_mastersheet(id) ON DELETE CASCADE,

  -- 'YYYY-MM', the CRM's existing convention (shared/presetMonth.helper).
  -- TEXT, not a date: this is a period, not a day, and storing it as a date
  -- invites somebody to compare it against `stopped_on` as if the two were
  -- the same kind of thing.
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- ===============================
  -- * THREE ANSWERS, AND ONLY ONE OF THEM DOES NOTHING
  -- ===============================
  --   yes    still running. The answer, and nothing else.
  --   final  paid in full this month, then it stops at the month's end.
  --   no     it already ended. Stops at the end of the last paid month.
  --
  -- 'final' is a SCHEDULED stop, which is the reason this feature exists:
  -- neither a button nor a date expresses "pay this one last time".
  answer text NOT NULL CHECK (answer IN ('yes', 'final', 'no')),

  -- Who said so. One shared admin login, so this is 'admin' or 'diane':
  -- the useful distinction is whether a person clicked it on the panel or
  -- asked her to, not which human, and the CRM has no user management.
  answered_by text NOT NULL DEFAULT 'admin',
  answered_at timestamptz NOT NULL DEFAULT now(),

  -- ONE ANSWER PER DEAL PER MONTH. Re-answering UPDATEs this row rather
  -- than adding a second, so the queue cannot show one deal twice and a
  -- bulk answer cannot silently double-write.
  UNIQUE (deal_id, period)
);

-- The queue is always "this period, what has not been answered", so the
-- period leads. The deal lookup is the unique index above.
CREATE INDEX IF NOT EXISTS tb_monthly_review_period_idx
  ON tb_monthly_review (period, answer);

COMMENT ON TABLE tb_monthly_review IS
  'One answer per deal per month to "is this still running?". See docs/closure.md section 5.';
