const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const { parseMasterSheetImport } = require('./parseImport');
const { recomputePayable } = require('../shared/recomputePayable.helper');
const { resolveDerived } = require('../shared/resolveDerived.helper');
const { suggestDates } = require('../shared/suggestDates.helper');

/**
 * ***************************************************
 * * Against the real file, and against made up rows
 * ***************************************************
 *
 * THE REAL FILE FIRST. docs/boss/references/master.xlsx is the sheet in
 * live use, and every count below was taken from it rather than invented.
 * If it is not on this machine the file's own tests still run: crm/api has
 * to test on a machine holding only itself, and the reference sheets are
 * not part of the deployable.
 *
 * No database. The parser is pure and so are the three helpers.
 */

const MASTER = path.join(
  __dirname, '..', '..', '..', '..', 'docs', 'boss', 'references', 'master.xlsx',
);
const haveMaster = fs.existsSync(MASTER);

let parsed = null;
async function rows() {
  if (!parsed) parsed = (await parseMasterSheetImport(fs.readFileSync(MASTER))).rows;
  return parsed;
}

test('the live sheet still parses to 96 deals', async (t) => {
  if (!haveMaster) { t.skip('master.xlsx is not on this machine'); return; }
  assert.equal((await rows()).length, 96);
});

test('THE SIX PROSE ROWS keep his words and are flagged', async (t) => {
  if (!haveMaster) { t.skip('master.xlsx is not on this machine'); return; }
  const flagged = (await rows()).filter((r) => /payment start reads/.test(r.reviewReason ?? ''));
  assert.equal(flagged.length, 6, 'four AUGUST END FULL and two OCTOBER END FULL');
  for (const r of flagged) {
    assert.equal(r.needsReview, true);
    assert.match(r.notes, /^Payment start: (AUGUST|OCTOBER) END FULL$/);
    assert.match(r.reviewReason, /read as appointment \+ 90 days/);
  }
});

test('and their FIGURES did not move: the flag costs nothing', async (t) => {
  if (!haveMaster) { t.skip('master.xlsx is not on this machine'); return; }
  const byName = new Map((await rows()).map((r) => [`${r.personName}|${r.company}`, r]));
  // His own August send paid MILKMAN's pair from 2026-08-03. Appointment
  // 2026-05-05 + 90 is exactly that, and the CRM still says so.
  const james = [...byName.values()].find((r) => r.personName === 'James King');
  assert.equal(james.paymentStartOn, '2026-08-03');
});

test('THE TWELVE Ongoing ROWS are blank, unflagged and unsuggested', async (t) => {
  if (!haveMaster) { t.skip('master.xlsx is not on this machine'); return; }
  const ongoing = (await rows()).filter((r) => !r.assignedOn && !r.paymentStartOn);
  assert.equal(ongoing.length, 12);
  for (const r of ongoing) {
    assert.ok(!/payment start reads/.test(r.reviewReason ?? ''), 'never flagged for being blank');
    // The standing roster would otherwise land in the export panel every
    // single month, which is how a review list stops being read.
    assert.equal(suggestDates({
      assigned_on: r.assignedOn, payment_start_on: r.paymentStartOn, end_on: r.endOn,
    }), null);
  }
});

/**
 * ===============================
 * * HIS DATES ARE HIS. OURS ARE ONLY FOR THE CELLS HE LEFT AS PROSE
 * ===============================
 * Two rules now, and which applies depends on who wrote the cell.
 *
 *   a REAL date in his file   ->  kept exactly, and his is appointment + 90
 *   prose we rescued          ->  ours, which pulls a FIRST WEEK
 *                                 appointment back to the last Friday of
 *                                 month 3 so it is paid in month 3
 *
 * This used to assert +90 across all 84 and passed because both rules
 * agreed. They do not any more: Tobias wright was appointed 5 Aug, inside
 * the first week, and his start cell is prose.
 */
test('a REAL date in his file is kept, and his is always appointment + 90', async (t) => {
  if (!haveMaster) { t.skip('master.xlsx is not on this machine'); return; }
  const fromHisFile = (await rows())
    .filter((r) => r.assignedOn && r.paymentStartOn && !/payment start reads/.test(r.reviewReason ?? ""));
  assert.equal(fromHisFile.length, 78);
  for (const r of fromHisFile) {
    const appt = new Date(`${r.assignedOn}T00:00:00Z`);
    const plus90 = new Date(appt.getTime() + 90 * 86400000).toISOString().slice(0, 10);
    assert.equal(r.paymentStartOn, plus90, `${r.personName} drifted from his own formula`);
  }
});

test('a RESCUED prose row follows ours, first week included', async (t) => {
  if (!haveMaster) { t.skip('master.xlsx is not on this machine'); return; }
  const rescued = (await rows())
    .filter((r) => r.assignedOn && r.paymentStartOn && /payment start reads/.test(r.reviewReason ?? ""));
  assert.equal(rescued.length, 6);

  const firstFriday = (y, m) => {
    let d = 1;
    while (new Date(Date.UTC(y, m, d)).getUTCDay() !== 5) d += 1;
    return d;
  };
  for (const r of rescued) {
    const appt = new Date(`${r.assignedOn}T00:00:00Z`);
    const weekOne = appt.getUTCDate() <= firstFriday(appt.getUTCFullYear(), appt.getUTCMonth());
    if (weekOne) {
      // Last Friday of month 3, worked out here rather than by calling the
      // helper, so this cannot pass by agreeing with itself.
      const end = new Date(Date.UTC(appt.getUTCFullYear(), appt.getUTCMonth() + 3, 0));
      while (end.getUTCDay() !== 5) end.setUTCDate(end.getUTCDate() - 1);
      assert.equal(r.paymentStartOn, end.toISOString().slice(0, 10), `${r.personName}`);
    } else {
      const plus90 = new Date(appt.getTime() + 90 * 86400000).toISOString().slice(0, 10);
      assert.equal(r.paymentStartOn, plus90, `${r.personName}`);
    }
  }
});

test('the cascade is a no-op on a row that already agrees with it', async (t) => {
  if (!haveMaster) { t.skip('master.xlsx is not on this machine'); return; }
  // Re-typing the same appointment date must not move a single figure.
  const sample = (await rows()).filter((r) => r.assignedOn && r.paymentStartOn).slice(0, 20);
  for (const r of sample) {
    const current = {
      assigned_on: r.assignedOn,
      payment_start_on: r.paymentStartOn,
      end_on: r.endOn,
      preset_on: r.presetOn,
      monthly_amount: r.monthlyAmount,
      payable_days: r.payableDays,
      payable_amount: r.payableAmount,
    };
    const fields = { assignedOn: r.assignedOn };
    recomputePayable(current, fields);
    if (fields.paymentStartOn) {
      assert.equal(
        fields.paymentStartOn, r.paymentStartOn,
        `${r.personName}: re-typing the appointment moved the payment start`,
      );
    }
    if (fields.payableAmount != null) {
      assert.equal(fields.payableAmount, r.payableAmount, `${r.personName}: the amount moved`);
    }
  }
});

/**
 * ===============================
 * * A whole upload, built here, with the guard in the middle
 * ===============================
 * The regression that caught my own first fix. Not a fixture file: an xlsx
 * written in memory with the ExcelJS already installed, the same way
 * upload.test.js does it.
 */

const HEADERS = [
  'Group', 'Role:', 'Name of individual:', 'Company in question:',
  'Appointment date', 'Payment start date:', 'Preset date:', 'Monthly amount:',
];

async function uploadOf(rowValues) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(HEADERS);
  for (const r of rowValues) ws.addRow(r);
  return parseMasterSheetImport(Buffer.from(await wb.xlsx.writeBuffer()));
}

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

test('a file the CRM has corrected does not un-correct itself', async () => {
  // The admin set the rate to 2000. The file still says 1100 and brings a
  // NEW payment start. monthly_amount is claimed, the start is not.
  const { rows: parsedRows } = await uploadOf([
    ['MILKMAN', 'Director', 'Rae Example', 'Monument', utc(2026, 4, 15), utc(2026, 7, 14), utc(2026, 7, 1), 1100],
  ]);
  const incoming = parsedRows[0];

  const stored = {
    payment_start_on: utc(2026, 4, 20),
    preset_on: utc(2026, 7, 1),
    monthly_amount: 2000,
    payable_days: 31,
    payable_amount: 2000,
  };
  const writable = new Set([
    'payment_start_on', 'preset_on', 'monthly_amount', 'payable_days', 'payable_amount',
  ]);

  const fixed = resolveDerived(incoming, stored, new Set(['monthly_amount']), writable);
  // The file's start wins, the admin's rate wins, and the amount follows
  // BOTH. Before the fix it took the file's amount, computed off 1100.
  assert.equal(fixed.payableDays, 18, '14 July to 31 July');
  assert.equal(fixed.payableAmount, 1161.29, '2000 / 31 * 18');
  assert.notEqual(fixed.payableAmount, incoming.payableAmount, 'not the file own figure');
});

test('a row with nothing claimed is left exactly as the parser computed it', async () => {
  const { rows: parsedRows } = await uploadOf([
    ['MILKMAN', 'Director', 'Rae Example', 'Monument', utc(2026, 4, 15), utc(2026, 7, 14), utc(2026, 7, 1), 1100],
  ]);
  const incoming = parsedRows[0];
  const writable = new Set([
    'payment_start_on', 'preset_on', 'monthly_amount', 'payable_days', 'payable_amount',
  ]);
  const stored = { ...incoming, payment_start_on: incoming.paymentStartOn };
  assert.equal(resolveDerived(incoming, stored, new Set(), writable), null);
  // And the parser's own figures are the sheet's.
  assert.equal(incoming.payableDays, 18);
  assert.equal(incoming.payableAmount, 638.71, '1100 / 31 * 18');
});

/**
 * ===============================
 * * A BLANK CELL IS NOT A MISSING ONE, AND AN UPLOAD NEVER FILLS IT
 * ===============================
 * An upload leaves a genuinely empty payment start empty. It is not the
 * same fact as prose or a broken formula cache: a blank means "Ongoing",
 * a long standing arrangement with no recorded start, and a full month.
 * Twelve rows of his live sheet are exactly that.
 *
 * So the upload writes nothing and the export panel OFFERS the date
 * instead. The one place the appointment fills a blank by itself is a deal
 * created by hand, where the admin typed the appointment a moment ago and
 * left the rest for the CRM.
 */

test('an upload leaves a blank payment start blank, and it means a full month', async () => {
  const { rows: parsedRows } = await uploadOf([
    ['MILKMAN', 'Director', 'Rae Example', 'Monument', utc(2026, 1, 20), null, utc(2026, 7, 1), 1000],
  ]);
  assert.equal(parsedRows[0].paymentStartOn, null, 'not derived behind the admin');
  assert.equal(parsedRows[0].payableAmount, 1000, 'blank is Ongoing, so the whole month');
});

test('and the panel offers the date rather than writing it', async () => {
  const { rows: parsedRows } = await uploadOf([
    ['MILKMAN', 'Director', 'Rae Example', 'Monument', utc(2026, 1, 20), null, utc(2026, 7, 1), 1000],
  ]);
  const r = parsedRows[0];
  const out = suggestDates({
    assigned_on: r.assignedOn, payment_start_on: r.paymentStartOn, end_on: r.endOn,
  });
  assert.equal(out.direction, 'forward', 'his own formula, so it is not a guess');
  assert.equal(out.fields.paymentStartOn, '2026-04-20');
  assert.equal(out.fields.endOn, '2027-01-20');
});

test('a deal created by hand DOES fill both from the appointment', async () => {
  // The other half of the same rule: here the admin typed the appointment
  // and left the rest, so the CRM finishes the row the way his sheet does.
  const fields = {
    assignedOn: new Date('2026-01-20T00:00:00Z'),
    paymentStartOn: null,
    endOn: null,
    presetOn: new Date('2026-07-01T00:00:00Z'),
    monthlyAmount: 1000,
    payableDays: null,
    payableAmount: null,
  };
  recomputePayable({}, fields, { onCreate: true });
  // A STRING, the way a date column is written. See asDateString.
  assert.equal(fields.paymentStartOn, '2026-04-20');
  assert.equal(fields.endOn, '2027-01-20');
  assert.equal(fields.payableAmount, 1000);
});
