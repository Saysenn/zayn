const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

const rows = [
  {
    id: 14, person_id: 'nicola', person_name: 'Nicola', company: 'Ackerman Pearce payroll',
    group_name: 'INDIGO', role_label: 'Mid 1', monthly_amount: 1400, payable_days: 30,
    payable_amount: 1400, preset_on: '2026-09-01', payment_start_on: '2026-05-07', currency: 'GBP',
  },
  {
    id: 19, person_id: 'nicola', person_name: 'Nicola', company: 'Social work partners PR',
    group_name: 'INDIGO', role_label: 'Mid 1', monthly_amount: 600, payable_days: 0,
    payable_amount: 0, preset_on: '2026-09-01', payment_start_on: '2026-11-03', currency: 'GBP',
  },
];

function loadTool() {
  const toolPath = require.resolve('./masterSheet.js');
  const repoPath = require.resolve('../../repos/masterSheetRows.repo.js');
  const socketPath = require.resolve('../../sockets/index.js');
  for (const path of [toolPath, repoPath, socketPath]) delete require.cache[path];

  let live = rows.map((row) => ({ ...row }));
  require.cache[repoPath] = stub({
    async searchFuzzy() { return live; },
    async findById(id) { return live.find((row) => row.id === Number(id)) ?? null; },
    async update(id, fields) {
      live = live.map((row) => row.id === Number(id)
        ? { ...row, payment_start_on: fields.paymentStartOn ?? row.payment_start_on }
        : row);
      return live.find((row) => row.id === Number(id));
    },
  });
  require.cache[socketPath] = {
    id: socketPath, filename: socketPath, loaded: true, exports: { broadcast() {} },
  };

  return require(toolPath).masterSheetTools.find((tool) => tool.name === 'update_master_sheet_row');
}

test('an edit can resolve one live deal from person and company', async () => {
  const tool = loadTool();
  const out = await tool.handler({
    targetPerson: 'Nicola',
    targetCompany: 'Ackerman Pearce payroll',
    paymentStartOn: '2026-06-01',
    said: 'change Nicola at Ackerman Pearce payroll payment start to 1 June 2026',
  });

  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].company, 'Ackerman Pearce payroll');
  assert.match(out.reply, /Ackerman Pearce payroll/);
  assert.match(out.reply, /2026-06-01/);
});

test('an unspecified edit asks for the deal and field without showing full cards', async () => {
  const tool = loadTool();
  const out = await tool.handler({ targetPerson: 'Nicola', said: 'update Nicola details please' });

  assert.equal(out.cards, undefined);
  assert.equal(out.list.rows.length, 2);
  assert.match(out.reply, /which company/i);
  assert.match(out.reply, /what should change/i);
});
