const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const { parseMasterSheetImport } = require('./parseImport');
const { buildImportDiff } = require('./diffImport');
const { withCompanions } = require('./importColumns');

/**
 * ***************************************************
 * * HIS WORDS IN THE END DATE COLUMN, THROUGH THE IMPORT
 * ***************************************************
 *
 * AGAINST HIS REAL SEPTEMBER SHEET. Every count below was taken from the
 * file, not invented. If it is not on this machine the made up rows still
 * run: crm/api has to test on a machine holding only itself.
 *
 * The fault: 31 of its 92 rows hold a phrase here and every one was
 * dropped in silence. `endOn` came back null, the row was not flagged, and
 * the diff said nothing. Worse, "Reviewed monthly" meant the OPPOSITE of
 * what he wrote, because a deal with no end date is never reviewed.
 */

/**
 * ===============================
 * * THE PATH WAS WRONG, SO ALL FIVE OF THESE SKIPPED, SILENTLY
 * ===============================
 * It looked in `references/`, which holds the August files. His September
 * sheet sits in `docs/boss/` itself. `t.skip` reports as `ok` with a note,
 * so the suite read 1,723 tests and 1,718 passes and nobody subtracted.
 * Found 2026-09-22 while chasing that five.
 *
 * These are the tests that read his REAL file, which makes a silent skip
 * the worst kind here: the parse of the one sheet that matters was covered
 * by nothing at all.
 */
const SHEET = path.join(
  __dirname, '..', '..', '..', '..', 'docs', 'boss',
  'TECH UPDATED MASTERSHEET-1.xlsx',
);
const haveSheet = fs.existsSync(SHEET);

let parsed = null;
async function rows() {
  if (!parsed) parsed = (await parseMasterSheetImport(fs.readFileSync(SHEET))).rows;
  return parsed;
}

test('his 31 prose rows are all read, and none is lost', async (t) => {
  if (!haveSheet) { t.skip('the September sheet is not on this machine'); return; }
  const all = await rows();
  assert.equal(all.length, 92);
  const noted = all.filter((r) => r.endNote);
  assert.equal(noted.length, 31, 'every prose cell keeps its words');
  // And the end date is empty on all of them: a date column never holds
  // a sentence, and the note is where the sentence lives.
  assert.equal(noted.filter((r) => r.endOn === null).length, 31);
});

test('the two phrases split 19 and 12, and only one asks for a review', async (t) => {
  if (!haveSheet) { t.skip('the September sheet is not on this machine'); return; }
  const all = await rows();
  const count = (note) => all.filter((r) => r.endNote === note).length;
  assert.equal(count('Going concern'), 19);
  assert.equal(count('Reviewed monthly'), 12);

  // THE FLAG IS THE POINT. Without it those 12 fall out of the one screen
  // meant to ask about them, which is what his word asked for.
  const flagged = all.filter((r) => r.reviewMonthly);
  assert.equal(flagged.length, 12);
  assert.ok(flagged.every((r) => r.endNote === 'Reviewed monthly'));
  // And "Going concern" sets nothing: no end date is what it means, and
  // that is already what a null says.
  assert.ok(all.filter((r) => r.endNote === 'Going concern').every((r) => !r.reviewMonthly));
});

test('nothing in his file is a phrase the CRM does not know', async (t) => {
  if (!haveSheet) { t.skip('the September sheet is not on this machine'); return; }
  const all = await rows();
  assert.equal(all.filter((r) => r.endNoteKnown === false).length, 0);
  // So none of the 31 is flagged for review on account of its note: they
  // are understood, and flagging a third of the sheet every month is how
  // a review list stops being read.
  assert.equal(all.filter((r) => r.needsReview && r.endNote).length, 0);
});

test('the 12 reach Richard and Klaud, who no company status could', async (t) => {
  if (!haveSheet) { t.skip('the September sheet is not on this machine'); return; }
  const all = await rows();
  // Both sit on Workforce, which also carries 19 "Going concern" deals and
  // two with a real date. Liquidating it to reach these two would have
  // swept in the whole standing roster.
  for (const name of ['Richard', 'Klaud']) {
    const row = all.find((r) => String(r.personName).trim() === name && r.reviewMonthly);
    assert.ok(row, `${name} is not flagged`);
    assert.equal(row.company, 'Workforce');
  }
});

/**
 * ===============================
 * * AND A PHRASE NOBODY HAS TAUGHT IT
 * ===============================
 * Built here rather than taken from a file: the whole point is a word he
 * has not written yet. The words survive, no flag is set, and the ROW says
 * so, because silence is how the first 31 were lost.
 */
const HEADERS = [
  'Group', 'Role', 'Name of individual', 'Company in question',
  'Appointment date', 'Payment start date', 'Preset date',
  'Provisional payment end date', 'Monthly amount',
];

async function sheetOf(endCell) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Master sheet');
  ws.addRow(HEADERS);
  ws.addRow([
    'ALPHA', 'Director', 'Alex Example', 'Northstar Care',
    new Date(Date.UTC(2025, 0, 14)), new Date(Date.UTC(2025, 3, 14)),
    new Date(Date.UTC(2026, 8, 1)), endCell, 1000,
  ]);
  return wb.xlsx.writeBuffer();
}

test('an unknown phrase keeps its words, sets no flag, and FLAGS THE ROW', async () => {
  const buf = await sheetOf('Ends when the contract does');
  const { rows: got } = await parseMasterSheetImport(buf, { filename: 'x.xlsx' });
  const row = got[0];
  assert.equal(row.endNote, 'Ends when the contract does');
  assert.equal(row.endOn, null);
  assert.equal(row.reviewMonthly, false);
  assert.equal(row.needsReview, true);
  assert.match(row.reviewReason, /end date reads "Ends when the contract does"/);
});

test('a real date is left completely alone', async () => {
  const buf = await sheetOf(new Date(Date.UTC(2027, 0, 14)));
  const { rows: got } = await parseMasterSheetImport(buf, { filename: 'x.xlsx' });
  assert.equal(got[0].endNote, null);
  assert.equal(got[0].reviewMonthly, false);
  assert.equal(got[0].endOn, '2027-01-14');
});

test('a KNOWN phrase does not flag the row', async () => {
  for (const [phrase, flag] of [['Going concern', false], ['Reviewed monthly', true]]) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await sheetOf(phrase);
    // eslint-disable-next-line no-await-in-loop
    const { rows: got } = await parseMasterSheetImport(buf, { filename: 'x.xlsx' });
    assert.equal(got[0].endNote, phrase);
    assert.equal(got[0].reviewMonthly, flag, phrase);
    assert.doesNotMatch(got[0].reviewReason ?? '', /end date reads/, phrase);
  }
});

/**
 * ===============================
 * * AND THE WRITE PATH, WHICH IS WHERE IT DIED
 * ===============================
 * Every test above this line tests the PARSER, and the parser was always
 * right. The upload still wrote neither column on any EXISTING row: the
 * SET list is built from importColumns and neither was in it. All 92 rows
 * exist, so his September sheet would have captured none of the 31.
 *
 * That is the shape to watch for. A feature can be complete at both ends
 * and joined by nothing, and a suite that only ever asks the parser goes
 * green the whole time.
 */

async function sheetWithoutEndColumn() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Master sheet');
  const drop = HEADERS.indexOf('Provisional payment end date');
  ws.addRow(HEADERS.filter((_, i) => i !== drop));
  ws.addRow([
    'ALPHA', 'Director', 'Alex Example', 'Northstar Care',
    new Date(Date.UTC(2025, 0, 14)), new Date(Date.UTC(2025, 3, 14)),
    new Date(Date.UTC(2026, 8, 1)), 1000,
  ]);
  return wb.xlsx.writeBuffer();
}

test('the end date column makes BOTH his columns writable', async () => {
  const buf = await sheetOf('Going concern');
  const { columns } = await parseMasterSheetImport(buf, { filename: 'x.xlsx' });
  assert.ok(columns.includes('end_note'), 'his words');
  assert.ok(columns.includes('review_monthly'), 'and the flag they set');
});

test('a file with no end date column writes NEITHER', async () => {
  const buf = await sheetWithoutEndColumn();
  const { columns } = await parseMasterSheetImport(buf, { filename: 'x.xlsx' });
  assert.ok(!columns.includes('end_on'), 'the column it is read from');
  assert.ok(!columns.includes('end_note'), 'so not his words either');
  // The one that would really hurt: the liquidation checklist sets this by
  // hand, and a sheet with no end date column has no opinion on it.
  assert.ok(!columns.includes('review_monthly'), 'nor the flag the status screen sets');
});

test('his real sheet carries both, so the 31 would land', async (t) => {
  if (!haveSheet) { t.skip('the September sheet is not on this machine'); return; }
  const { columns } = await parseMasterSheetImport(fs.readFileSync(SHEET));
  assert.ok(columns.includes('end_note'));
  assert.ok(columns.includes('review_monthly'));
});

test('accepting the end date brings his words, rejecting it leaves them', () => {
  assert.deepEqual(
    withCompanions(['end_on']).sort(),
    ['end_note', 'end_on', 'review_monthly'],
  );
  // Half a cell is the fault this prevents: the date kept and the note
  // written would print "Going concern" over the date somebody chose.
  assert.deepEqual(withCompanions(['monthly_amount']), ['monthly_amount']);
});

const NOTE_COLUMNS = ['end_on', 'end_note', 'review_monthly'];
const noteValues = (r) => ({
  end_on: r.endOn ?? null,
  end_note: r.endNote ?? null,
  review_monthly: r.endNote === 'Reviewed monthly',
});

function diffOf(parsed, stored) {
  return buildImportDiff({
    rows: [{ syncKey: 'k', ...parsed }],
    columns: NOTE_COLUMNS,
    existing: new Map([['k', { id: 1, sync_key: 'k', end_on: null, end_note: null, review_monthly: false, ...stored }]]),
    valuesOf: noteValues,
  });
}

test('a note arriving on a row with no date is a CHANGE, not silence', () => {
  // Both dates null either side. Comparing the date alone called this
  // identical, so the row never reached the diff and was never written.
  const d = diffOf({ endOn: null, endNote: 'Going concern' }, {});
  assert.equal(d.changed.length, 1, 'the words are the change');
  assert.equal(d.changed[0].cells.length, 1, 'and the companions are not their own question');
  const [cell] = d.changed[0].cells;
  assert.equal(cell.column, 'end_on');
  assert.equal(cell.to, 'Going concern', 'his words, where "empty" used to read');
  assert.notEqual(cell.kind, 'cleared', 'a phrase is a value, not a clearing');
});

test('a date replaced by his words is not counted as a CLEARING', () => {
  const d = diffOf({ endOn: null, endNote: 'Reviewed monthly' }, { end_on: '2026-03-06' });
  const [cell] = d.changed[0].cells;
  assert.equal(cell.from, '2026-03-06');
  assert.equal(cell.to, 'Reviewed monthly');
  assert.equal(cell.kind, 'set');
  assert.equal(d.changed[0].clearedCount, 0, 'it reported 20 of these as wipes');
});

test('an ordinary row with no note on either side still says nothing', () => {
  const d = diffOf({ endOn: '2026-03-06', endNote: null }, { end_on: '2026-03-06' });
  assert.equal(d.changed.length, 0);
});

/**
 * ===============================
 * * AND WHAT A TYPED DATE DOES TO THE WORDS
 * ===============================
 * `update` needs a database, so the rule is pinned against its source.
 * Nothing here needs one: see run-it.md.
 *
 * A DELIBERATE MIRROR. crm/web keeps the same rule in its optimistic patch
 * (hooks/useMasterSheet.js `withEndNote`, pinned by its own test), because
 * a cache that kept the note printed "AUGUST TBC" over a saved date. The
 * two codebases share no file, so each states it and neither reads the
 * other.
 */
test('TYPING A REAL END DATE CLEARS HIS WORD, and leaves the review flag', () => {
  const repo = fs.readFileSync(
    path.join(__dirname, '..', 'repos', 'masterSheetRows.repo.js'), 'utf8',
  );
  assert.match(
    repo,
    /if \('endOn' in fields && fields\.endOn\) sets\.push\('end_note = NULL'\);/,
    'the cell would say two things about the same fact',
  );
  // Truthy, so CLEARING the date leaves the words that explain the blank.
  assert.doesNotMatch(repo, /if \('endOn' in fields\) sets\.push\('end_note = NULL'\)/);
  // The flag is a decision made elsewhere, and a deal can have both.
  assert.doesNotMatch(repo, /sets\.push\('review_monthly = false'\)/);
});

/**
 * ===============================
 * * NEITHER IS HAND WRITABLE, AND BOTH CAN NOW BE UNDONE
 * ===============================
 * Two different questions, and they used to have one answer.
 *
 * They stay OUT of COLUMN_FOR: an import writes them, no form does, and
 * putting them in would make them look typeable and oblige a route to
 * parse a field nothing sends.
 *
 * But the company cascade logs them now, so its one press undo can put a
 * cleared end date back. `revertFieldChange` reads COLUMN_FOR OR
 * RESTORABLE, and History's own button reads the same pair. Left as it
 * was, the panel would have hidden Undo on exactly the changes the undo
 * was built for. His call 2026-09-22.
 */
test('NEITHER COLUMN IS HAND WRITABLE, AND BOTH ARE STILL UNDOABLE', () => {
  const repo = fs.readFileSync(
    path.join(__dirname, '..', 'repos', 'masterSheetRows.repo.js'), 'utf8',
  );
  /**
   * SCOPED TO THE COLUMN_FOR BLOCK, not the whole file. Read against the
   * file it matched RESTORABLE below, which names the same two columns on
   * purpose: the guard was reading its own cure as the disease.
   */
  const columnFor = /const COLUMN_FOR = \{[\s\S]*?\n\};/.exec(repo)?.[0] ?? '';
  assert.ok(columnFor, 'COLUMN_FOR could not be found to check');
  assert.doesNotMatch(columnFor, /end_note: 'end_note'/, 'COLUMN_FOR would make it typable');
  assert.doesNotMatch(columnFor, /reviewMonthly: 'review_monthly'/);

  // The second list, which makes them restorable without making them
  // typeable.
  assert.match(repo, /const RESTORABLE = Object\.freeze\(\{/);
  for (const field of ['endNote', 'reviewMonthly', 'stoppedOn']) {
    assert.match(repo, new RegExp(`\\n\\s+${field}: '`), `${field} cannot be undone`);
  }

  // THE PANEL AND THE WRITE READ THE SAME PAIR. One of them alone is how
  // the button and the route disagreed and every press was a 409.
  // The panel asks the ONE predicate, and the predicate reads the pair.
  assert.match(repo, /revertible: .*isUndoableField\(row\.field\)/);
  assert.match(repo, /const isUndoableField = \(field\) => Boolean\(COLUMN_FOR\[field\] \?\? RESTORABLE\[field\]\)/);
  assert.match(repo, /COLUMN_FOR\[change\.field\] \?\? RESTORABLE\[change\.field\]/);
});
