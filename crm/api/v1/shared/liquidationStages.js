// ***************************************************
// * WINDING DOWN'S STAGES, IN WORDS (his corrected flowchart, 2026-10-14)
// ***************************************************
//
// One set of labels for the export, Diane and anything else that says a
// stage, so none can drift. The values are liquidations.repo.js STAGE, in
// the process's order; migration 090 says what each one means. The page's
// own copy is web/src/configs/liquidationStages.js (a deliberate mirror).

const STAGE_LABEL = Object.freeze({
  active: 'Active',
  active_proposal: 'Active proposal',
  strike_off_suspended: 'Strike off suspended',
  strike_off_rejected: 'Strike off rejected / cancelled',
  liquidation: 'Liquidation',
  own_liq: 'Own liq',
  hmrc_liq: 'HMRC liq',
  dissolved: 'Dissolved',
  // Gone (migration 090), kept so an old history line still reads.
  strike_off: 'Strike off',
});

/** The kinds each stage can carry, in the order offered. Only these stages have any. */
const STAGE_KINDS = Object.freeze({
  active_proposal: Object.freeze({ compulsory: 'Compulsory', voluntary: 'Voluntary' }),
  own_liq: Object.freeze({ mvl: 'MVL', cvl: 'CVL' }),
  hmrc_liq: Object.freeze({ petition: 'Petition filed', winding_up_order: 'Winding-up order' }),
  dissolved: Object.freeze({ struck_off: 'Struck off', after_liquidation: 'After liquidation' }),
});

/** Whether `kind` belongs to `stage` (null always does: "not said"). */
const kindFits = (stage, kind) => kind == null || Boolean(STAGE_KINDS[stage]?.[kind]);

/** "Own liq (CVL)", "Active proposal", or "Not set". */
function stageText(stage, kind = null) {
  if (!stage) return 'Not set';
  const label = STAGE_LABEL[stage] ?? stage;
  const k = STAGE_KINDS[stage]?.[kind];
  return k ? `${label} (${k})` : label;
}

module.exports = { STAGE_LABEL, STAGE_KINDS, kindFits, stageText };
