-- WINDING DOWN, AS THE PROCESS REALLY RUNS (his corrected flowchart,
-- 2026-10-14). Two roads from Active, both ending in Dissolved:
--   strike off   Active proposal (compulsory or voluntary: the First
--                Gazette notice) -> Strike off suspended if somebody
--                objects -> Strike off rejected / cancelled, or Dissolved
--   liquidation  Liquidation (kind not said yet) -> Own liq (MVL or CVL)
--                or HMRC liq (petition filed, then winding-up order)
--                -> Dissolved
--
-- "Strike off" alone goes: struck off IS dissolved, so it named no step of
-- its own. A row on it becomes an Active proposal. "First gazette" is no
-- kind either: both kinds of proposal have that notice.
--
-- The kind is one column for every stage that has kinds, checked per
-- stage, so a kind can never sit on a stage it does not belong to.

UPDATE tb_liquidations SET stage = 'active_proposal' WHERE stage = 'strike_off';

ALTER TABLE tb_liquidations RENAME COLUMN proposal_kind TO stage_kind;
ALTER TABLE tb_liquidations DROP CONSTRAINT IF EXISTS tb_liquidations_proposal_kind_check;
UPDATE tb_liquidations SET stage_kind = NULL WHERE stage_kind = 'first_gazette';

ALTER TABLE tb_liquidations DROP CONSTRAINT IF EXISTS tb_liquidations_stage_check;
ALTER TABLE tb_liquidations ADD CONSTRAINT tb_liquidations_stage_check CHECK (
  stage IS NULL OR stage IN (
    'active', 'active_proposal', 'strike_off_suspended', 'strike_off_rejected',
    'liquidation', 'own_liq', 'hmrc_liq', 'dissolved'
  )
);

ALTER TABLE tb_liquidations ADD CONSTRAINT tb_liquidations_stage_kind_check CHECK (
  stage_kind IS NULL
  OR (stage = 'active_proposal' AND stage_kind IN ('compulsory', 'voluntary'))
  OR (stage = 'own_liq' AND stage_kind IN ('mvl', 'cvl'))
  OR (stage = 'hmrc_liq' AND stage_kind IN ('petition', 'winding_up_order'))
  OR (stage = 'dissolved' AND stage_kind IN ('struck_off', 'after_liquidation'))
);

-- The history keeps the words it was written with: an old "strike_off" in
-- it is still read as "Strike off" (see shared/liquidationStages.js).
