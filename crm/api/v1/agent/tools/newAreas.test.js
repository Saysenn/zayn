const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../../configs/db');
const { listLiquidations, updateLiquidation, liquidationDocument, stageFrom } = require('./liquidations');
const { updateFlags } = require('./flags');
const { setExchangeRate, looksWrong } = require('./fxRates');
const { currentDay } = require('../../shared/presetMonth.helper');
const { dayFrom } = require('../../shared/dayWords.helper');

// ***************************************************
// * DIANE ON THE LIQUIDATIONS PAGE, FLAGS AND RATES (2026-10-13)
// ***************************************************
//
// Against a real database: throwaway companies, people and rates, all taken
// out again. Skipped where the tables are not there yet (migrations 084-087).

const A = 'ZZ Diane Liq Alpha';
const B = 'ZZ Diane Liq Beta';
const OFF = 'ZZ Diane Not Liq';
let ready = true;
let savedRates = [];

test.before(async () => {
  try {
    await pool.query('SELECT 1 FROM tb_liquidations LIMIT 1');
    await pool.query('SELECT 1 FROM tb_agent_undo LIMIT 1');
  } catch {
    ready = false;
    return;
  }
  await pool.query("DELETE FROM tb_companies WHERE name LIKE 'ZZ Diane%'");
  await pool.query("DELETE FROM tb_liquidations WHERE company_key LIKE 'zz diane%'");
  await pool.query(`INSERT INTO tb_companies (name, status) VALUES ($1, 'liquidation'), ($2, 'liquidation'), ($3, 'active')`, [A, B, OFF]);
  await pool.query("DELETE FROM tb_concerns WHERE person_id LIKE 'zzdiane-%'");
  await pool.query(`INSERT INTO tb_concerns (person_id, group_name, category, message) VALUES
    ('zzdiane-wren', 'MILKMAN', 'wants-human', 't1'), ('zzdiane-wren', 'MILKMAN', 'wants-human', 't2'),
    ('zzdiane-wren', 'INDIGO', 'wants-human', 't3'), ('zzdiane-oak', 'MILKMAN', 'wants-human', 't4')`);
  savedRates = (await pool.query('SELECT * FROM tb_fx_rates')).rows;
});

test.after(async () => {
  if (ready) {
    await pool.query("DELETE FROM tb_liquidations WHERE company_key LIKE 'zz diane%'");
    await pool.query("DELETE FROM tb_companies WHERE name LIKE 'ZZ Diane%'");
    await pool.query("DELETE FROM tb_concerns WHERE person_id LIKE 'zzdiane-%'");
    await pool.query("DELETE FROM tb_agent_undo WHERE by_user = 'Diane' AND created_at > now() - interval '1 hour' AND (summary LIKE '%Liquidations page%' OR summary LIKE '%flags%' OR summary LIKE '%rate%')");
    // the rates exactly as they were
    await pool.query('DELETE FROM tb_fx_rates');
    for (const r of savedRates) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query('INSERT INTO tb_fx_rates (code, per_usd, usd_per_unit, updated_at, updated_by) VALUES ($1, $2, $3, $4, $5)',
        [r.code, r.per_usd, r.usd_per_unit, r.updated_at, r.updated_by]);
    }
  }
  await pool.end();
});

const skip = () => !ready;

// ---- the pure parts
test('a stage in their words is the stored one', () => {
  assert.equal(stageFrom('HMRC liq'), 'hmrc_liq');
  assert.equal(stageFrom('our own liquidation'), 'own_liq');
  assert.equal(stageFrom('strike off rejected'), 'strike_off_rejected');
  // No strike off stage since migration 090: on its own it is the proposal.
  assert.equal(stageFrom('strike-off'), 'active_proposal');
  assert.equal(stageFrom('not set'), null);
  assert.equal(stageFrom('banana'), undefined);
});

test('an upside down rate is caught, a close one is not', () => {
  assert.match(looksWrong('GBP', 0.74, 1.35), /UPSIDE DOWN/);
  assert.equal(looksWrong('GBP', 1.36, 1.3242), null);
  assert.match(looksWrong('GBP', 13.6, 1.3242), /away from today/);
});

// ---- liquidations
test('LIST: only companies in liquidation, Not set until chosen', { skip: skip() }, async () => {
  const out = await listLiquidations.handler({});
  assert.match(out.reply, /ZZ Diane Liq Alpha: Not set/);
  assert.doesNotMatch(out.reply, /ZZ Diane Not Liq/);
});

test('A MESSY REQUEST IS ONE PREVIEW, dates worked out in code, nothing written', { skip: skip() }, async () => {
  const out = await updateLiquidation.handler({
    items: [
      { company: A, stage: 'HMRC liq', deadline: 'friday', liquidator: 'Begbies', log: 'Begbies called for bank statements' },
      { company: B, stage: 'own liq', owner: 'admin' },
    ],
  });
  assert.equal(out.pending, true);
  const friday = dayFrom('friday', currentDay());
  // In full, as she says it (his call 2026-10-13: "Sun" was read as the word).
  const shown = require('../../shared/dayWords.helper').sayDay(friday);
  assert.ok(out.summary.includes(`deadline none → ${shown}`), out.summary);
  assert.match(out.summary, /stage Not set → HMRC liq/);
  assert.match(out.summary, /log "Begbies called for bank statements"/);
  assert.match(out.summary, /• ZZ Diane Liq Beta: stage Not set → Own liq; owner none → "admin"/);
  const row = (await pool.query("SELECT stage FROM tb_liquidations WHERE company_key = 'zz diane liq alpha'")).rows[0];
  assert.equal(row.stage, null, 'nothing is written before yes');
});

test('YES WRITES IT ALL, reads it back, and the status is untouched', { skip: skip() }, async () => {
  const out = await updateLiquidation.handler({
    confirmed: true,
    items: [
      { company: A, stage: 'HMRC liq', deadline: 'friday', liquidator: 'Begbies', log: 'Begbies called for bank statements' },
      { company: B, stage: 'own liq', owner: 'admin' },
    ],
  });
  assert.match(out.reply, /^Done\./);
  const a = (await pool.query("SELECT * FROM tb_liquidations WHERE company_key = 'zz diane liq alpha'")).rows[0];
  assert.equal(a.stage, 'hmrc_liq');
  assert.equal(a.liquidator, 'Begbies');
  assert.equal(String(a.deadline).slice(0, 10), dayFrom('friday', currentDay()));
  const comms = (await pool.query('SELECT body, by_user FROM tb_liquidation_comms WHERE liquidation_id = $1', [a.id])).rows;
  assert.deepEqual(comms.map((c) => [c.body, c.by_user]), [['Begbies called for bank statements', 'Diane']]);
  const hist = (await pool.query('SELECT by_user FROM tb_liquidation_history WHERE liquidation_id = $1', [a.id])).rows;
  assert.ok(hist.every((h) => h.by_user === 'Diane'));
  const status = (await pool.query("SELECT status FROM tb_companies WHERE name = $1", [A])).rows[0].status;
  assert.equal(status, 'liquidation');
});

test('BULK: the same change to every company matching `where`', { skip: skip() }, async () => {
  const pending = await updateLiquidation.handler({ where: { stage: 'own liq' }, set: { nextAction: 'Chase the liquidator' } });
  assert.equal(pending.pending, true);
  assert.match(pending.summary, /ZZ Diane Liq Beta: next action none → "Chase the liquidator"/);
});

test('UNDO puts the last change back, the contact line included', { skip: skip() }, async () => {
  // At once: "undo that" is the instruction (no preview to match a yes to).
  const out = await updateLiquidation.handler({ undo: true });
  assert.match(out.reply, /^Undone/);
  const a = (await pool.query("SELECT * FROM tb_liquidations WHERE company_key = 'zz diane liq alpha'")).rows[0];
  assert.equal(a.stage, null);
  assert.equal(a.liquidator, '');
  assert.equal(a.deadline, null);
  const comms = (await pool.query('SELECT count(*)::int n FROM tb_liquidation_comms WHERE liquidation_id = $1', [a.id])).rows[0].n;
  assert.equal(comms, 0);
});

test('A TYPO ASKS; a step puts a company on the page, anything else for it is refused', { skip: skip() }, async () => {
  const typo = await updateLiquidation.handler({ items: [{ company: 'ZZ Diane Liq Alpa', stage: 'hmrc' }] });
  assert.match(typo.summary, /NOTHING HAS BEEN CHANGED/);
  // A step for a company not winding down: shown with its status move, nothing written.
  const step = await updateLiquidation.handler({ items: [{ company: OFF, stage: 'hmrc' }] });
  assert.match(step.summary, /status Active → Winding down/);
  assert.doesNotMatch(step.summary, /NOTHING HAS BEEN CHANGED\. /);
  const off = await updateLiquidation.handler({ items: [{ company: OFF, deadline: 'friday' }] });
  assert.match(off.summary, /not winding down/);
});

test('A DAY IT CANNOT BE SURE OF IS ASKED, never guessed', { skip: skip() }, async () => {
  const out = await updateLiquidation.handler({ items: [{ company: A, deadline: 'sometime soon' }] });
  assert.match(out.summary, /not a day I can be sure of/);
});

test('ONE COMPANY IN FULL', { skip: skip() }, async () => {
  const out = await listLiquidations.handler({ company: B });
  // the undo above put Beta back too
  assert.match(out.reply, /ZZ Diane Liq Beta: Not set/);
  assert.match(out.reply, /Contact log \(0\)/);
});

test('A DOCUMENT NOT THERE IS SAID, with what is', { skip: skip() }, async () => {
  const out = await liquidationDocument.handler({ company: B, files: ['letter'], action: 'open' });
  assert.match(out.summary, /Not sure which[\s\S]*none matches/);
});

// ---- flags
test('FLAGS: a name in two groups is asked about, never guessed', { skip: skip() }, async () => {
  const out = await updateFlags.handler({ people: [{ name: 'zzdiane-wren' }], action: 'resolved' });
  assert.match(out.summary, /MILKMAN and INDIGO|INDIGO and MILKMAN/);
});

test('FLAGS: resolve shows first, writes on yes, undo puts them back', { skip: skip() }, async () => {
  const args = { people: [{ name: 'zzdiane-wren', group: 'MILKMAN' }, { name: 'zzdiane-oak' }], action: 'resolved' };
  const pending = await updateFlags.handler(args);
  assert.equal(pending.pending, true);
  assert.match(pending.summary, /zzdiane-wren \(MILKMAN\): 2 flags, open → resolved/);
  const done = await updateFlags.handler({ ...args, confirmed: true });
  assert.match(done.reply, /Done: 3 flags resolved/);
  await updateFlags.handler({ undo: true, confirmed: true });
  const open = (await pool.query("SELECT count(*)::int n FROM tb_concerns WHERE person_id IN ('zzdiane-wren','zzdiane-oak') AND status = 'open'")).rows[0].n;
  assert.equal(open, 4);
});

test('FLAGS: a delete can be undone, every flag back under its own id', { skip: skip() }, async () => {
  const ids = (await pool.query("SELECT id FROM tb_concerns WHERE person_id = 'zzdiane-oak' ORDER BY id")).rows.map((r) => r.id);
  await updateFlags.handler({ people: [{ name: 'zzdiane-oak' }], action: 'delete', confirmed: true });
  assert.equal((await pool.query("SELECT count(*)::int n FROM tb_concerns WHERE person_id = 'zzdiane-oak'")).rows[0].n, 0);
  await updateFlags.handler({ undo: true, confirmed: true });
  const back = (await pool.query("SELECT id FROM tb_concerns WHERE person_id = 'zzdiane-oak' ORDER BY id")).rows.map((r) => r.id);
  assert.deepEqual(back, ids);
});

test('FLAGS: a typo gets "did you mean"', { skip: skip() }, async () => {
  const out = await updateFlags.handler({ people: [{ name: 'zzdiane-oaks' }], action: 'resolved' });
  assert.match(out.summary, /Did you mean zzdiane-oak/);
});

// ---- rates
test('RATES: set the xe.com way, shown first, exact on yes, undone after', { skip: skip() }, async () => {
  const pending = await setExchangeRate.handler({ rates: [{ currency: 'GBP', usdPerUnit: '1.37' }] });
  assert.equal(pending.pending, true);
  assert.match(pending.summary, /→ 1 GBP = 1\.37 USD \(manual\)/);
  const done = await setExchangeRate.handler({ rates: [{ currency: 'GBP', usdPerUnit: '1.37' }], confirmed: true });
  assert.match(done.reply, /Now 1 GBP = 1\.37 USD/);
  const stored = (await pool.query("SELECT usd_per_unit FROM tb_fx_rates WHERE code = 'GBP'")).rows[0].usd_per_unit;
  assert.equal(String(stored), '1.37');
  const before = savedRates.find((r) => r.code === 'GBP');
  await setExchangeRate.handler({ undo: true, confirmed: true });
  const after = (await pool.query("SELECT usd_per_unit FROM tb_fx_rates WHERE code = 'GBP'")).rows[0];
  if (before) assert.equal(Number(after.usd_per_unit), Number(before.usd_per_unit ?? 1 / before.per_usd));
  else assert.equal(after, undefined);
});

test('RATES: EURO is EUR, USD is refused, nonsense is refused', { skip: skip() }, async () => {
  const euro = await setExchangeRate.handler({ rates: [{ currency: 'EURO', usdPerUnit: '1.17' }] });
  assert.match(euro.summary, /EUR: .* → 1 EUR = 1\.17 USD/);
  const usd = await setExchangeRate.handler({ rates: [{ currency: 'USD', usdPerUnit: '1' }] });
  assert.match(usd.summary, /USD is the base/);
  const junk = await setExchangeRate.handler({ rates: [{ currency: 'GBP', usdPerUnit: 'abc' }] });
  assert.match(junk.summary, /not a rate/);
});
