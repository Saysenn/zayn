const test = require('node:test');
const assert = require('node:assert/strict');
const { namesList, asNews, stageFrom, kindFrom } = require('./liquidations');
const { stageText, kindFits } = require('../../shared/liquidationStages');

test('THE STAGES AS THE PROCESS REALLY RUNS (his corrected flowchart, 2026-10-14)', () => {
  const cases = {
    active: 'active',
    'active proposal': 'active_proposal',
    'first gazette': 'active_proposal',
    'proposal to strike off': 'active_proposal',
    // "strike off" alone is the proposal: there is no strike off stage any more.
    'strike off': 'active_proposal',
    'strike off suspended': 'strike_off_suspended',
    'someone objected': 'strike_off_suspended',
    'strike off rejected': 'strike_off_rejected',
    'strike off cancelled': 'strike_off_rejected',
    liquidation: 'liquidation',
    'own liq': 'own_liq',
    'voluntary liquidation': 'own_liq',
    'creditors voluntary': 'own_liq',
    'hmrc liq': 'hmrc_liq',
    'winding up order': 'hmrc_liq',
    'petition filed': 'hmrc_liq',
    // Struck off IS dissolved.
    'struck off': 'dissolved',
    dissolved: 'dissolved',
    'not set': null,
  };
  for (const [said, want] of Object.entries(cases)) assert.equal(stageFrom(said), want, said);
});

test('EVERY STAGE WITH KINDS READS THEM, and a kind never lands on the wrong stage', () => {
  assert.equal(kindFrom('active_proposal', 'compulsory'), 'compulsory');
  assert.equal(kindFrom('active_proposal', 'voluntary, we applied'), 'voluntary');
  assert.equal(kindFrom('active_proposal', 'first gazette'), undefined, 'the notice is no kind');
  assert.equal(kindFrom('own_liq', 'a CVL, it cannot pay its debts'), 'cvl');
  assert.equal(kindFrom('own_liq', 'insolvent'), 'cvl', '"insolvent" has "solvent" in it');
  assert.equal(kindFrom('own_liq', 'MVL, solvent'), 'mvl');
  assert.equal(kindFrom('hmrc_liq', 'hmrc filed a petition'), 'petition');
  assert.equal(kindFrom('hmrc_liq', 'the court made the winding-up order'), 'winding_up_order');
  assert.equal(kindFrom('dissolved', 'struck off'), 'struck_off');
  assert.equal(kindFrom('dissolved', 'after the liquidation'), 'after_liquidation');
  assert.equal(kindFrom('active', 'compulsory'), undefined);
  assert.equal(kindFits('own_liq', 'cvl'), true);
  assert.equal(kindFits('own_liq', 'compulsory'), false);
  assert.equal(kindFits('active', null), true);
  assert.equal(stageText('own_liq', 'cvl'), 'Own liq (CVL)');
  assert.equal(stageText('hmrc_liq', 'winding_up_order'), 'HMRC liq (Winding-up order)');
  assert.equal(stageText('own_liq', 'compulsory'), 'Own liq');
  assert.equal(stageText(null), 'Not set');
});

// Her liquidation answers name every document; "update on" is news (2026-10-14).

test('DOCUMENTS NAMED IN FULL, the first eight then how many more', () => {
  assert.equal(namesList(['call notes.txt']), 'call notes.txt');
  assert.equal(namesList(['a.pdf', 'b.csv', 'c.txt']), 'a.pdf, b.csv and c.txt');
  const ten = Array.from({ length: 10 }, (_, i) => `doc ${i + 1}.pdf`);
  assert.equal(namesList(ten), `${ten.slice(0, 8).join(', ')} and 2 more`);
  assert.equal(namesList([]), '');
});

test('"ANY UPDATE ON QUARRY LANE" ASKS FOR NEWS; "update its deadline" is still a change', () => {
  assert.equal(asNews('any update on quarry lane'), 'any news on quarry lane', '"any" stays, so it is still a question');
  assert.equal(asNews('give me an update on pinecrest'), 'give me an news on pinecrest');
  assert.equal(asNews('updates on quarry lane?'), 'news on quarry lane?');
  assert.equal(asNews('update quarry lanes deadline to friday'), 'update quarry lanes deadline to friday');
});
