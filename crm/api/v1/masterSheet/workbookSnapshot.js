const crypto = require('node:crypto');
const path = require('node:path');
const ExcelJS = require('exceljs');

const rowsRepo = require('../repos/masterSheetRows.repo');
const snapshotsRepo = require('../repos/monthSnapshots.repo');
const { parseMasterSheetImport } = require('./parseImport');
const { figuresFor } = require('./takeSnapshot');
const { DEFAULT_LOCAL_LOCATIONS } = require('../shared/awayLocations.helper');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// THE READER LIVES BESIDE THE WRITER NOW. It was spelled out here while
// `adjustmentLabel` wrote the string there, so the day the dash became a
// colon only one of the two knew. See shared/rates.helper.
const { RATE_LINE } = require('../shared/rates.helper');
const CURRENCY_TOTAL = /^([A-Z]{3,5}) Total$/;
const HEADINGS = new Map([
  ['add ons', 'addon'],
  ['fees', 'fee'],
  ['crypto charges', 'crypto'],
]);

const fold = (value) => String(value ?? '').trim().toLocaleLowerCase('en');
const numberAt = (sheet, row, column) => Number(sheet.getRow(row).getCell(column).value);

function addAdjustment(found, { group, name, kind, percent }) {
  if (!name || !Number.isFinite(percent)) return;
  found.set([fold(group), fold(name), kind, percent].join('|'), {
    group, name, kind, percent,
  });
}

function evidenceFrom(workbook) {
  const adjustments = new Map();
  const cryptoRates = new Set();
  const usdPerGbp = [];
  const aedPerUsd = [];
  const inferredRates = new Map();

  for (const sheet of workbook.worksheets) {
    const blocks = new Map();
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const cell = sheet.getRow(row).getCell(column);
        const text = String(cell.text ?? '').trim();
        const heading = HEADINGS.get(fold(text));
        if (heading) {
          blocks.set(column, heading);
          continue;
        }

        const rate = RATE_LINE.exec(text);
        if (rate) {
          const namedKind = { 'add on': 'addon', fee: 'fee', crypto: 'crypto' }[fold(rate[3])];
          const kind = namedKind ?? blocks.get(column);
          if (kind === 'crypto') cryptoRates.add(Number(rate[2]));
          if (kind && kind !== 'crypto') {
            addAdjustment(adjustments, {
              group: sheet.name, name: rate[1].trim(), kind, percent: Number(rate[2]),
            });
          }
        }

        if (/^USD per GBP$/i.test(text)) {
          const value = numberAt(sheet, row, column - 1);
          if (value > 0) usdPerGbp.push(value);
        }
        if (/^AED per USD$/i.test(text)) {
          const value = numberAt(sheet, row, column - 1);
          if (value > 0) aedPerUsd.push(value);
        }

        const total = CURRENCY_TOTAL.exec(text);
        if (total) {
          const native = numberAt(sheet, row, column + 1);
          const usd = numberAt(sheet, row, column + 2);
          if (native > 0 && usd > 0) {
            const values = inferredRates.get(total[1]) ?? [];
            values.push(native / usd);
            inferredRates.set(total[1], values);
          }
        }

        const oldCrypto = /^(\d+(?:\.\d+)?)% fee$/i.exec(text);
        const above = String(sheet.getRow(Math.max(1, row - 1)).getCell(column).text ?? '').trim();
        if (oldCrypto && /^Crypto$/i.test(above)) cryptoRates.add(Number(oldCrypto[1]));
      }
    }
  }

  if (cryptoRates.size > 1) throw new Error('The workbook contains more than one crypto percentage.');
  const perUsd = {};
  for (const [currency, values] of inferredRates) {
    perUsd[currency] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (aedPerUsd.length > 0) perUsd.AED = aedPerUsd[0];

  return {
    adjustments: [...adjustments.values()],
    cryptoPercent: [...cryptoRates][0] ?? 0,
    fx: usdPerGbp.length > 0 ? {
      usdPerGbp: usdPerGbp[0], perUsd, source: 'workbook', asOf: null,
    } : null,
  };
}

function snapshotRows(parsedRows, evidence) {
  const rows = parsedRows.map((row) => ({
    id: `workbook:${row.syncKey}`,
    sync_key: row.syncKey,
    source: 'workbook_snapshot',
    ...rowsRepo.upsertValuesByColumn(row),
    addon_percent: 0,
    fee_percent: 0,
    person_addon_percent: 0,
    person_fee_percent: 0,
    manually_overridden_fields: [],
  }));

  const rates = new Map();
  for (const adjustment of evidence.adjustments) {
    const key = [fold(adjustment.group), fold(adjustment.name), adjustment.kind].join('|');
    const previous = rates.get(key);
    if (previous !== undefined && previous !== adjustment.percent) {
      throw new Error(`${adjustment.name} has several ${adjustment.kind} percentages in ${adjustment.group}.`);
    }
    rates.set(key, adjustment.percent);
  }

  for (const [key, percent] of rates) {
    const [group, name, kind] = key.split('|');
    const matched = rows.filter((row) => fold(row.group_name) === group && fold(row.person_name) === name);
    if (matched.length === 0) throw new Error(`Could not match ${name}'s ${kind} in ${group} to a deal.`);
    for (const row of matched) row[`${kind}_percent`] = percent;
  }
  return rows;
}

async function workbookSnapshotData(buffer, { month, filename = 'workbook.xlsx' } = {}) {
  if (!MONTH.test(String(month))) throw new Error(`Not a month: ${month}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const evidence = evidenceFrom(workbook);
  const parsed = await parseMasterSheetImport(buffer, { filename });
  if (parsed.rows.length === 0) throw new Error('The workbook contains no deals.');
  if (parsed.stats.flagged > 0) throw new Error(`The workbook contains ${parsed.stats.flagged} flagged deals.`);

  const rows = snapshotRows(parsed.rows, evidence);
  const totals = figuresFor(rows, month, {
    useEndDate: false,
    rates: new Map(),
    cryptoPercent: evidence.cryptoPercent,
    // Older workbooks do not carry the settings page's local-location
    // list. The historical exporter used this default, so store the same
    // rule instead of consulting whatever the live setting becomes later.
    localLocations: DEFAULT_LOCAL_LOCATIONS,
    fx: evidence.fx,
  });
  totals.source = {
    type: 'workbook',
    filename: path.basename(filename),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
  return { rows, totals, stats: parsed.stats };
}

async function takeWorkbookSnapshot(buffer, options) {
  const data = await workbookSnapshotData(buffer, options);
  return snapshotsRepo.take(options.month, data.rows, data.totals);
}

module.exports = { workbookSnapshotData, takeWorkbookSnapshot, evidenceFrom };
