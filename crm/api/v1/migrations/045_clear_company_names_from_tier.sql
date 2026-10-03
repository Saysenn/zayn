-- ===============================
-- * Undo: company names written into the tier column.
-- ===============================
-- The upload diff's flagged rows offered a "Pick one" dropdown whose
-- options were NEAR-MATCHING COMPANY NAMES ("looks like a company we
-- already have"), and its onChange wrote the picked value to the TIER.
-- So answering "which company is this?" recorded the company's name as its
-- kind. `Umbrella company uk holdings`, `Churchill knight emplyment` and
-- `Red Horizon Resourcing` all ended up as tiers.
--
-- The tab is rewritten: the name picker and the tier picker are two
-- controls now and neither can write the other's column. This clears what
-- the old one stored.
--
-- SAFE BECAUSE THE TEST IS EXACT. A tier is cleared only when it equals, on
-- the same fold tb_companies' unique index uses, the name of a company we
-- hold. No real tier does: `Bench` is a company and `Benched` is a tier;
-- `Reliapay` is a company and `T2 for Reliapay` is a tier. Neither matches.
--
-- NULL, not ''. NULL means nobody has said what kind of company this is,
-- which is exactly true again once the wrong answer is removed.
UPDATE tb_companies c
   SET tier = NULL, updated_at = now()
 WHERE c.tier IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM tb_companies other
      WHERE lower(btrim(other.name)) = lower(btrim(c.tier))
   );
