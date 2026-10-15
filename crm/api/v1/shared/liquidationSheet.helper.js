const ExcelJS = require('exceljs');
const { PALETTE, DEFAULT_PALETTE, paletteFor } = require('../expenses/expenseColumns');

// ***************************************************
// * THE LIQUIDATIONS PAGE, AS A SHEET (feature.md 16, his call 2026-10-13)
// ***************************************************
//
// The rows the page is showing, in its own columns and order, so the file
// says what the screen said. One sheet, header in the expenses' default
// colour, frozen and filterable. Text cut nowhere: the screen clips, the
// file is where the whole of it is read.

// One set of stage words for the file, Diane and the rest (2026-10-14).
const { STAGE_LABEL, stageText } = require('./liquidationStages');

const MONEY_FMT = '#,##0.00';

const COLUMNS = [
  { header: 'Company', key: 'company', width: 28 },
  { header: 'Director', key: 'director', width: 22 },
  { header: 'Mid', key: 'mid', width: 22 },
  { header: 'Group', key: 'group', width: 16 },
  { header: 'Status', key: 'stage', width: 18 },
  { header: 'Current instructions', key: 'instructions', width: 40 },
  { header: 'Deadline', key: 'deadline', width: 12 },
  { header: 'Next action', key: 'nextAction', width: 36 },
  { header: 'Owner', key: 'owner', width: 16 },
  { header: 'Supporting docs', key: 'docs', width: 10 },
  { header: 'Blamed?', key: 'blamed', width: 9 },
  { header: 'Liquidator', key: 'liquidator', width: 22 },
  { header: 'Last comm date', key: 'lastCommOn', width: 14 },
  { header: 'Last comm', key: 'lastComm', width: 40 },
  { header: 'Note', key: 'note', width: 36 },
  { header: 'Currency', key: 'currency', width: 9 },
  { header: 'Settlement', key: 'settlement', width: 14 },
  { header: 'Allocated a month', key: 'allocated', width: 16 },
];

// What the export modal offers. The company is always written: a row of
// stages belonging to nothing is not a tracker.
const REQUIRED = ['company'];
const PICKABLE = COLUMNS.map((c) => ({ field: c.key, label: c.header, required: REQUIRED.includes(c.key) }));

/** The columns asked for, in the page's order, the company always among them. */
function columnsFrom(wanted) {
  if (!Array.isArray(wanted) || wanted.length === 0) return COLUMNS;
  const asked = new Set([...wanted, ...REQUIRED]);
  return COLUMNS.filter((c) => asked.has(c.key));
}

const dateOf = (v) => (v ? new Date(`${String(v instanceof Date ? v.toISOString() : v).slice(0, 10)}T00:00:00Z`) : null);

function buildLiquidationSheet(rows, { columns, palette } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Liquidations', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  const skin = paletteFor(palette);
  const used = columnsFrom(columns);
  sheet.columns = used;

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: skin.ink } };
  if (skin.fill) header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: skin.fill } };

  for (const r of rows) {
    sheet.addRow({
      company: r.company_name,
      director: r.director ?? null,
      mid: r.mid ?? null,
      group: (r.groups ?? []).join(', ') || null,
      // A stage with a kind says it: "Own liq (CVL)".
      stage: stageText(r.stage, r.stage_kind),
      instructions: r.instructions ?? null,
      deadline: dateOf(r.deadline),
      nextAction: r.next_action ?? null,
      owner: r.owner ?? null,
      docs: r.doc_count ?? 0,
      blamed: r.blamed ? 'Yes' : 'No',
      liquidator: r.liquidator ?? null,
      lastCommOn: dateOf(r.last_comm?.said_on),
      lastComm: r.last_comm?.body ?? null,
      note: r.note ?? null,
      currency: r.currency ?? null,
      settlement: r.settlement != null ? Number(r.settlement) : null,
      allocated: r.settlement != null ? Number(r.allocated ?? 0) : null,
    });
  }
  const has = (key) => used.some((c) => c.key === key);
  for (const key of ['deadline', 'lastCommOn'].filter(has)) sheet.getColumn(key).numFmt = 'dd/mm/yyyy';
  for (const key of ['settlement', 'allocated'].filter(has)) sheet.getColumn(key).numFmt = MONEY_FMT;
  for (const key of ['instructions', 'nextAction', 'lastComm', 'note'].filter(has)) sheet.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: used.length } };
  return workbook;
}

module.exports = {
  buildLiquidationSheet, STAGE_LABEL, PICKABLE, PALETTE, DEFAULT_PALETTE,
};
