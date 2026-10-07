const test = require('node:test');
const assert = require('node:assert');
const rowsRepo = require('../../repos/masterSheetRows.repo');
const { currentMonth } = require('../../shared/presetMonth.helper');
const { parkForMonth, whatItDoes } = require('./parkForMonth');

const next = (() => { const [y, m] = currentMonth().split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();

test('"ADD 500 NEXT MONTH" says what changes: the finished value, never "update master sheet deal"', async () => {
  const real = rowsRepo.findById;
  rowsRepo.findById = async (id) => ({ id, person_name: 'Alex Example', company: 'Workforce', group_name: 'BETA', monthly_amount: '4000' });
  try {
    const out = await parkForMonth.handler({ tool: 'update_master_sheet_row', args: { id: 38, add: { monthlyAmount: 500 } }, months: [next] });
    assert.match(out.reply, /monthly amount 4000 → 4500/);
    assert.doesNotMatch(out.reply, /update master sheet deal/);
  } finally {
    rowsRepo.findById = real;
  }
});

test('AN OLD VAGUE PARKED CHANGE is read back from what it will write', () => {
  assert.equal(
    whatItDoes({ said: 'Alex Example · Workforce · BETA: update master sheet deal', args: { id: 38, add: { monthlyAmount: 500 }, confirmed: true } }),
    'Alex Example · Workforce · BETA: monthly amount +500 (on its value then)',
  );
  assert.equal(whatItDoes({ said: 'X: monthly amount 4000 → 4500', args: {} }), 'X: monthly amount 4000 → 4500', 'a clear one is left alone');
});
