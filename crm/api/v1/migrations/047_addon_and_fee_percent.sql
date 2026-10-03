-- ===============================
-- * Two percentages, opposite directions.
-- ===============================
-- addon_percent  ADDED    what the person earns on top
-- fee_percent    DEDUCTED what comes off their total
--
-- fee_percent KEEPS ITS NAME AND CHANGES ITS MEANING, so every value it
-- holds today moves to addon_percent first: those were add ons, written
-- when a fee was the only percentage there was. Leaving them put would
-- turn Gloria's +5% into -5% without touching the cell.
--
-- Zeroing fee_percent afterwards is what makes the code change safe. A
-- reader not yet updated still ADDS fee_percent, which is now 0, so it
-- contributes nothing. It fails to zero, never to an inverted sign.
--
-- GUARDED, NOT `IF NOT EXISTS`. Re-running a bare copy would read the
-- zeroed fee_percent back over the add ons and wipe them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tb_people' AND column_name = 'addon_percent'
  ) THEN
    ALTER TABLE tb_people
      ADD COLUMN addon_percent numeric(5,2) NOT NULL DEFAULT 0
        CHECK (addon_percent >= 0 AND addon_percent <= 100);

    UPDATE tb_people SET addon_percent = fee_percent WHERE fee_percent <> 0;
    UPDATE tb_people SET fee_percent = 0 WHERE fee_percent <> 0;
  END IF;
END $$;

-- ===============================
-- * The same two, per DEAL.
-- ===============================
-- A person's rate is their standing arrangement; a deal's is this piece of
-- work. They STACK: 5% on the person plus 3% here is 8% on this row.
-- Both start at 0, so nothing that exists today changes value.
ALTER TABLE tb_mastersheet
  ADD COLUMN IF NOT EXISTS addon_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (addon_percent >= 0 AND addon_percent <= 100);

ALTER TABLE tb_mastersheet
  ADD COLUMN IF NOT EXISTS fee_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (fee_percent >= 0 AND fee_percent <= 100);
