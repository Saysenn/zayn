import test from 'node:test';
import assert from 'node:assert/strict';
import { LIQ_STAGES, LIQ_GROUPS, STAGE_PICK_OPTIONS, stagePickOptions, stageLabel } from './liquidationStages.js';

// Winding down's stages as the process really runs (his corrected flowchart, 2026-10-14).

test('THE STAGES BY ROAD, in the process order, and no "Strike off" stage', () => {
  assert.deepEqual(LIQ_GROUPS, ['Start', 'Strike off', 'Liquidation', 'End']);
  assert.deepEqual(LIQ_STAGES.map((s) => [s.group, s.value]), [
    ['Start', 'active'],
    ['Strike off', 'active_proposal'], ['Strike off', 'strike_off_suspended'], ['Strike off', 'strike_off_rejected'],
    ['Liquidation', 'liquidation'], ['Liquidation', 'own_liq'], ['Liquidation', 'hmrc_liq'],
    ['End', 'dissolved'],
  ]);
});

test('EVERY STEP WITH KINDS CARRIES THEM, the roads are headings', () => {
  const kinds = Object.fromEntries(STAGE_PICK_OPTIONS.filter((o) => o.sub).map((o) => [o.value, o.sub.map((k) => k.value)]));
  assert.deepEqual(kinds, {
    active_proposal: ['compulsory', 'voluntary'],
    own_liq: ['mvl', 'cvl'],
    hmrc_liq: ['petition', 'winding_up_order'],
    dissolved: ['struck_off', 'after_liquidation'],
  });
  assert.deepEqual(STAGE_PICK_OPTIONS.filter((o) => o.heading).map((o) => o.heading), LIQ_GROUPS);
  // The filter picks a stage, not a kind.
  assert.ok(stagePickOptions({ withKinds: false }).every((o) => !o.sub));
});

test('THE LABEL SAYS THE KIND HELD, and only one that belongs', () => {
  assert.equal(stageLabel('own_liq', 'cvl'), 'Own liq · CVL');
  assert.equal(stageLabel('hmrc_liq', 'winding_up_order'), 'HMRC liq · Winding-up order');
  assert.equal(stageLabel('dissolved', 'struck_off'), 'Dissolved · Struck off');
  assert.equal(stageLabel('own_liq', 'compulsory'), 'Own liq');
  assert.equal(stageLabel(null), 'Not set');
});
