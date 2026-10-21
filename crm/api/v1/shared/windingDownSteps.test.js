const test = require('node:test');
const assert = require('node:assert');
const { datesIn, stageInText, aheadOfPage, roadAhead, guideFor } = require('./windingDownSteps');

const TODAY = '2026-10-21';

test('dates a document gives, nearest first, with how near', () => {
  const got = datesIn('The petition will be heard on 21 November 2026. Pay before 7 November 2026. Sent 01/10/2026.', TODAY);
  assert.deepStrictEqual(got.map((d) => [d.day, d.when]), [
    ['2026-10-01', 'passed 20 days ago'], ['2026-11-07', 'in 17 days'], ['2026-11-21', 'in 31 days'],
  ]);
  assert.match(got[2].says, /petition will be heard/);
});

test('a date with no year is this year, or next when long past', () => {
  assert.strictEqual(datesIn('bank statements by 30 October', TODAY)[0].day, '2026-10-30');
  assert.strictEqual(datesIn('reply by 15 January', TODAY)[0].day, '2027-01-15');
  assert.strictEqual(datesIn('November 3rd', TODAY)[0].day, '2026-11-03');
});

test('no false dates: a figure is not a day', () => {
  assert.deepStrictEqual(datesIn('Debt: 48,210.55 GBP. Ref 31/02/2026 is no day.', TODAY), []);
});

test('the stage a document reads like, most final first', () => {
  assert.deepStrictEqual(stageInText('Order that the company be wound up, on the petition presented by HMRC'), { stage: 'hmrc_liq', kind: 'winding_up_order' });
  assert.deepStrictEqual(stageInText('HMRC winding up petition'), { stage: 'hmrc_liq', kind: 'petition' });
  assert.deepStrictEqual(stageInText('First Gazette notice: the registrar of companies gives notice'), { stage: 'active_proposal', kind: 'compulsory' });
  assert.deepStrictEqual(stageInText('Notice of final Gazette: the company has been dissolved'), { stage: 'dissolved', kind: null });
  assert.strictEqual(stageInText('Call with the accountant about payroll'), null);
});

test('documents further on than the page are said; as far or behind are not', () => {
  const docs = [{ file_name: 'order.pdf', text: 'The court ordered that the company be wound up.' }];
  assert.strictEqual(aheadOfPage(docs, 'hmrc_liq', 'petition').kind, 'winding_up_order');
  assert.strictEqual(aheadOfPage(docs, 'hmrc_liq', 'winding_up_order'), null);
  assert.strictEqual(aheadOfPage([{ file_name: 'p.pdf', text: 'winding up petition' }], 'hmrc_liq', 'winding_up_order'), null);
  assert.strictEqual(aheadOfPage([{ file_name: 's.pdf', text: 'statement of affairs' }], 'liquidation', null).kind, 'cvl');
  assert.strictEqual(aheadOfPage([{ file_name: 'p.pdf', text: 'winding up petition' }], 'hmrc_liq', null).kind, 'petition');
});

test('the road ahead and the usual process per stage', () => {
  assert.strictEqual(roadAhead('active_proposal'), 'Dissolved (Struck off) or Strike off suspended');
  assert.strictEqual(roadAhead(null), 'Active proposal or Liquidation');
  assert.strictEqual(roadAhead('dissolved'), '');
  assert.match(guideFor('hmrc_liq', 'petition'), /pay the debt/);
  assert.match(guideFor('own_liq', null), /MVL/);
});

test('a span from a date is worked out: "2 months from", "within 21 days of"', () => {
  const g = datesIn('unless cause is shown, at the expiration of 2 months from 1 October 2026 the name will be struck off', TODAY);
  assert.deepStrictEqual(g.map((d) => d.day), ['2026-10-01', '2026-12-01']);
  assert.match(g[1].says, /^2 months from 2026-10-01/);
  assert.strictEqual(datesIn('within 21 days of 14 October 2026', TODAY)[1].day, '2026-11-04');
});

test('the First Gazette wording is a proposal, never dissolved', () => {
  assert.deepStrictEqual(stageInText('The Registrar gives notice that unless cause is shown the name will be struck off the register and the company dissolved'), { stage: 'active_proposal', kind: 'compulsory' });
  assert.deepStrictEqual(stageInText('First Gazette notice: an application has been made for striking off'), { stage: 'active_proposal', kind: 'voluntary' });
});
