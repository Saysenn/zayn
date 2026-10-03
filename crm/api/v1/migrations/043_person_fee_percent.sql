-- ===============================
-- * A person's fee percentage, ADDED to what is owed.
-- ===============================
-- The export tells a group what to SEND US, so this is on top of the
-- payable amount, never taken out of it. Somebody on 5% costs the group
-- their payable amount plus five percent.
--
-- ON THE PERSON, not the deal: it is a fact about them, and storing it per
-- deal would be the same number copied onto every company they handle,
-- drifting the first time one was corrected.
--
-- NULL AND 0 ARE THE SAME HERE and that is fine: both mean no fee. Unlike
-- the payment overrides, there is no third "nobody decided" state to
-- protect, because a missing percentage costs nothing.
ALTER TABLE tb_people
  ADD COLUMN IF NOT EXISTS fee_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (fee_percent >= 0 AND fee_percent <= 100);
