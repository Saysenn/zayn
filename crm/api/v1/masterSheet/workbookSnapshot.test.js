const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { workbookSnapshotData } = require('./workbookSnapshot');

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('INDIGO');
  sheet.addRow([
    'Role', 'Name of individual', 'Company in question', 'Appointment date',
    'Payment start date', 'Preset date', 'Payable days this month',
    'Method of payment', 'Monthly amount', 'Payable amount', 'Currency', 'Location',
  ]);
  sheet.addRow([
    'Closer', 'Gloria', 'Workforce', new Date('2025-01-01'),
    new Date('2025-04-01'), new Date('2026-08-01'), 31,
    'Cash', 500, 500, 'GBP', 'Abu Dhabi',
  ]);
  sheet.addRow([
    'Holding', 'Erkki', 'Workforce', null, null, null, 0,
    'Crypto', 1000, 1000, 'EURO', 'Euro',
  ]);
  // ONE WORKBOOK, BOTH SPELLINGS. `adjustmentLabel` wrote a dash until
  // 2026-09-14 and writes a colon now, and files already on disk are never
  // rewritten. A reader that took only one would recover a month with its
  // rates silently missing, so this file deliberately carries each.
  sheet.getCell('E6').value = 'Add ons';
  sheet.getCell('E7').value = 'Gloria - 5%';
  sheet.getCell('F7').value = 25;
  sheet.getCell('E9').value = 'Crypto charges';
  sheet.getCell('E10').value = 'Erkki: 1%';
  sheet.getCell('F10').value = 10;
  sheet.getCell('A12').value = 'Rate';
  sheet.getCell('B12').value = 1.25;
  sheet.getCell('C12').value = 'USD per GBP';
  sheet.getCell('B13').value = 3.6725;
  sheet.getCell('C13').value = 'AED per USD';
  sheet.getCell('A15').value = 'GBP Total';
  sheet.getCell('B15').value = 525;
  sheet.getCell('C15').value = 656.25;
  sheet.getCell('A16').value = 'EURO Total';
  sheet.getCell('B16').value = 1010;
  sheet.getCell('C16').value = 1111;
  return workbook.xlsx.writeBuffer();
}

test('a workbook snapshot reconstructs its adjustments and rates without live data', async () => {
  const data = await workbookSnapshotData(await workbookBuffer(), {
    month: '2026-08', filename: 'MONTH SHEET - 2026-08.xlsx',
  });

  assert.equal(data.rows.length, 2);
  assert.deepEqual(data.totals.grand, { GBP: 500, EURO: 1000 });
  assert.deepEqual(data.totals.addon, { GBP: 25 });
  assert.deepEqual(data.totals.crypto, { EURO: 10 });
  assert.deepEqual(data.totals.net, { GBP: 525, EURO: 1010 });
  assert.equal(data.totals.fx.usdPerGbp, 1.25);
  assert.equal(data.totals.fx.perUsd.AED, 3.6725);
  assert.equal(data.totals.fx.perUsd.EURO, 1010 / 1111);
  assert.equal(data.totals.source.type, 'workbook');
});

test('an imported snapshot keeps other preset months but excludes them from the figure', async () => {
  const buffer = await workbookBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  workbook.getWorksheet('INDIGO').getCell('F2').value = new Date('2024-09-01');

  const data = await workbookSnapshotData(await workbook.xlsx.writeBuffer(), {
    month: '2026-08', filename: 'MONTH SHEET - 2026-08.xlsx',
  });

  assert.equal(data.rows.length, 2);
  assert.deepEqual(data.totals.grand, { EURO: 1000 });
  assert.equal(data.totals.counted, 1);
});
