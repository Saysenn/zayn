-- THE STAGES, AS THE PROCESS RUNS (his call 2026-10-14, his flowchart).
--
-- Companies House's strike off: Active, then an Active proposal (the First
-- Gazette notice: compulsory, or voluntary when the directors apply), then
-- either Strike off suspended (somebody objected) and Strike off rejected /
-- cancelled, or Strike off and Dissolved. Liquidation is its own road: Own
-- liq (voluntary) or HMRC liq (compulsory, a petition), and "Liquidation"
-- when nobody has said which yet. Every existing stage keeps its meaning.
--
-- `proposal_kind` says which kind of Active proposal it is. Only that stage
-- has one: the API clears it when the stage moves on.
ALTER TABLE tb_liquidations DROP CONSTRAINT IF EXISTS tb_liquidations_stage_check;
ALTER TABLE tb_liquidations ADD CONSTRAINT tb_liquidations_stage_check CHECK (
  stage IS NULL OR stage IN (
    'active', 'active_proposal', 'strike_off_suspended', 'strike_off_rejected',
    'liquidation', 'strike_off', 'own_liq', 'hmrc_liq', 'dissolved'
  )
);

ALTER TABLE tb_liquidations ADD COLUMN IF NOT EXISTS proposal_kind text
  CHECK (proposal_kind IS NULL OR proposal_kind IN ('compulsory', 'voluntary', 'first_gazette'));
