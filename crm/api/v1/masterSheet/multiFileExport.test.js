const test = require('node:test');
const assert = require('node:assert');

const { rowsByGroup } = require('../shared/rowsByGroup.helper');
const { exportFileName, exportScope } = require('../shared/exportFileName.helper');
const { templateFor, fileLabelOf } = require('../templates/xlsx');

/**
 * ONE FILE PER GROUP, zipped.
 *
 * The failure this guards against is silent and expensive: a group missing
 * from the archive is somebody not paid, and two groups sharing a filename
 * is one overwriting the other inside the zip with no warning from either
 * the server or the unzipper.
 */

const deal = (group, name, over = {}) => ({
  group_name: group,
  person_name: name,
  company: 'A J Rayson',
  role: 'mid',
  role_label: 'Mid 1',
  monthly_amount: '500',
  payable_amount: '500',
  payable_days: 31,
  currency: 'GBP',
  payment_method: 'cash',
  ...over,
});

const rows = [
  deal('MILKMAN', 'Zayn'),
  deal('INDIGO', 'Gloria'),
  deal('MILKMAN', 'Drew'),
  // A real group, and the reason the export modal's "everything" option is
  // called All rather than All groups.
  deal('ALL GROUPS', 'Maid'),
];

test('every row lands in exactly one group and none is dropped', () => {
  const by = rowsByGroup(rows);
  assert.strictEqual(by.size, 3);
  const total = [...by.values()].reduce((n, r) => n + r.length, 0);
  assert.strictEqual(total, rows.length);
  assert.deepStrictEqual(by.get('MILKMAN').map((r) => r.person_name), ['Zayn', 'Drew']);
});

test('the order is stable, so the same selection zips the same way twice', () => {
  assert.deepStrictEqual([...rowsByGroup(rows).keys()], ['ALL GROUPS', 'INDIGO', 'MILKMAN']);
  const shuffled = [rows[3], rows[1], rows[0], rows[2]];
  assert.deepStrictEqual([...rowsByGroup(shuffled).keys()], ['ALL GROUPS', 'INDIGO', 'MILKMAN']);
});

test('a row with no group is kept under its own name, never dropped', () => {
  // Dropping it would silently leave somebody out of a payout run, which
  // is the one failure a payout file must not have.
  const by = rowsByGroup([...rows, deal(null, 'Nobody'), deal('', 'Alsonobody')]);
  assert.strictEqual(by.get('(no group)').length, 2);
  assert.strictEqual([...by.values()].reduce((n, r) => n + r.length, 0), 6);
});

test('"ALL GROUPS" is a group like any other, not the everything bucket', () => {
  const by = rowsByGroup(rows);
  assert.deepStrictEqual(by.get('ALL GROUPS').map((r) => r.person_name), ['Maid']);
});

test('each group gets its own filename, and no two collide', () => {
  const label = fileLabelOf(templateFor('bank'));
  const names = [...rowsByGroup(rows).keys()]
    .map((g) => `${exportFileName(g, label, '2026-08')}.xlsx`);
  assert.deepStrictEqual(names, [
    'ALL GROUPS - BANK - 2026-08.xlsx',
    'INDIGO - BANK - 2026-08.xlsx',
    'MILKMAN - BANK - 2026-08.xlsx',
  ]);
  // Two entries of one name inside a zip is one silently overwriting the
  // other, and nothing reports it.
  assert.strictEqual(new Set(names).size, names.length);
});

test('the zip itself is named without a group, since it holds several', () => {
  // exportScope is given no groups on purpose in the multi-file path: the
  // archive is not "MILKMAN's", it is the run.
  assert.strictEqual(
    exportFileName(exportScope([], []), 'CASH', '2026-08'),
    'CASH - 2026-08',
  );
});

test('every template builds a real workbook per group', () => {
  const by = rowsByGroup(rows);
  for (const id of ['monthly-sheet', 'cash', 'bank', 'expensing', 'master-sheet']) {
    const template = templateFor(id);
    for (const [group, groupRows] of by) {
      const wb = template.build(groupRows, { tiers: new Map() });
      assert.ok(wb.worksheets.length > 0, `${id} produced no sheet for ${group}`);
    }
  }
});
