const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEAL_STATUS, DEAL_STATUS_VALUES, DEAL_STATUS_LABEL, dealStatusOf, dealStatusWrites,
} = require('./dealStatus.helper');
const { GOING_CONCERN, REVIEWED_MONTHLY } = require('./endNote.helper');

/**
 * ***************************************************
 * * DEAL STATUS IS A NAME FOR TWO COLUMNS, NEVER A THIRD ONE
 * ***************************************************
 *
 * His call 2026-09-22. He asked for a per deal status on the master sheet
 * that also decides whether the deal is in the monthly review, and then
 * answered the question that settles its shape: setting it to Active must
 * take the deal out of the review AND show it unticked in the company's
 * checklist next visit.
 *
 * Those are one fact. Stored twice they can disagree, and then the
 * checklist and the column say different things about one deal.
 */

test('THREE STATUSES, and they are the company words for a LIVE deal', () => {
  assert.deepEqual([...DEAL_STATUS_VALUES].sort(), ['active', 'going_concern', 'review']);
  // Company status is those three plus liquidation, dissolved and closed.
  // Two vocabularies for one idea is how "assignment" and "appointment"
  // both survived for a month.
  const companies = fs.readFileSync(
    path.join(__dirname, '..', 'repos', 'companies.repo.js'), 'utf8',
  );
  for (const value of DEAL_STATUS_VALUES) {
    assert.match(companies, new RegExp(`'${value}'`), `${value} is not a company word`);
  }
});

test('THE LABELS ARE HIS WORDS, exactly as his sheet writes them', () => {
  // The export prints these into the end date cell, so a different
  // spelling here is a file he opens with a word he never used.
  assert.equal(DEAL_STATUS_LABEL[DEAL_STATUS.GOING_CONCERN], GOING_CONCERN);
  assert.equal(DEAL_STATUS_LABEL[DEAL_STATUS.REVIEW], REVIEWED_MONTHLY);
  assert.equal(DEAL_STATUS_LABEL[DEAL_STATUS.ACTIVE], 'Active');
});

// ===============================
// * Reading it off a row
// ===============================

test('A PLAIN ROW IS ACTIVE', () => {
  assert.equal(dealStatusOf({}), DEAL_STATUS.ACTIVE);
  assert.equal(dealStatusOf({ end_note: null, review_monthly: false }), DEAL_STATUS.ACTIVE);
  assert.equal(dealStatusOf(null), DEAL_STATUS.ACTIVE);
});

test('HIS WORD IS GOING CONCERN, and the tick is review', () => {
  assert.equal(dealStatusOf({ end_note: GOING_CONCERN }), DEAL_STATUS.GOING_CONCERN);
  assert.equal(dealStatusOf({ review_monthly: true }), DEAL_STATUS.REVIEW);
});

/**
 * A ROW CAN HOLD BOTH. The import never writes that combination, but the
 * review checklist can tick a deal that already carried his word, so the
 * reader has to resolve it rather than pretend it cannot happen.
 *
 * HIS WORD WINS, the same priority the end date tag has always used, so
 * the column and the exported cell can never disagree.
 */
test('A MIXED ROW READS AS HIS WORD, not the tick', () => {
  assert.equal(
    dealStatusOf({ end_note: GOING_CONCERN, review_monthly: true }),
    DEAL_STATUS.GOING_CONCERN,
  );
});

test('A THIRD PHRASE IS NOT A STATUS', () => {
  // He invents phrases. One nobody has taught it keeps its words on the
  // row and is reported by the import; it does not become a status.
  assert.equal(dealStatusOf({ end_note: 'AUGUST TBC' }), DEAL_STATUS.ACTIVE);
});

test('AND THE WORD IS MATCHED WHOLE, not loosely', () => {
  assert.equal(dealStatusOf({ end_note: 'Going concern ' }), DEAL_STATUS.GOING_CONCERN);
  assert.equal(dealStatusOf({ end_note: 'Not a going concern' }), DEAL_STATUS.ACTIVE);
});

// ===============================
// * Writing it
// ===============================

test('EVERY WRITE SETS BOTH COLUMNS', () => {
  // Setting one and leaving the other is how the mixed state gets made.
  for (const status of DEAL_STATUS_VALUES) {
    const w = dealStatusWrites(status);
    assert.ok('endNote' in w && 'reviewMonthly' in w, `${status} leaves a column unset`);
  }
});

test('ACTIVE CLEARS BOTH, which is what takes it out of the review', () => {
  assert.deepEqual(dealStatusWrites(DEAL_STATUS.ACTIVE), {
    endNote: null, reviewMonthly: false, clearsEndDate: false,
  });
});

test('REVIEW SETS THE TICK AND NOTHING ELSE', () => {
  assert.deepEqual(dealStatusWrites(DEAL_STATUS.REVIEW), {
    endNote: null, reviewMonthly: true, clearsEndDate: false,
  });
});

/**
 * ONLY HIS WORD CLEARS A DATE, and it is the one destructive part: "Going
 * concern" means there IS no end date, so leaving one would print his word
 * over a real date. Unticking cannot bring it back, which is why the write
 * logs and History can.
 */
test('GOING CONCERN WRITES HIS WORD AND CLEARS THE DATE', () => {
  assert.deepEqual(dealStatusWrites(DEAL_STATUS.GOING_CONCERN), {
    endNote: GOING_CONCERN, reviewMonthly: false, clearsEndDate: true,
  });
});

test('AND THE OTHER TWO NEVER TOUCH A DATE', () => {
  assert.equal(dealStatusWrites(DEAL_STATUS.ACTIVE).clearsEndDate, false);
  assert.equal(dealStatusWrites(DEAL_STATUS.REVIEW).clearsEndDate, false);
});

test('AN INVENTED STATUS WRITES NOTHING', () => {
  // The route refuses it too, but a helper that silently returned a
  // default would write the default.
  for (const bad of ['closed', 'liquidation', '', null, undefined, 'ACTIVE']) {
    assert.equal(dealStatusWrites(bad), null, String(bad));
  }
});

/**
 * ===============================
 * * A ROUND TRIP, which is the whole contract
 * ===============================
 * Write a status, read it back off the row it produced, get the same
 * status. If this ever fails, the column and the checklist are about to
 * disagree about a deal.
 */
test('WRITING THEN READING GIVES BACK THE SAME STATUS', () => {
  for (const status of DEAL_STATUS_VALUES) {
    const w = dealStatusWrites(status);
    const row = { end_note: w.endNote, review_monthly: w.reviewMonthly };
    assert.equal(dealStatusOf(row), status, `${status} did not survive a round trip`);
  }
});

test('AND A WRITE UNMIXES A MIXED ROW', () => {
  // The reader resolves the mixed state; the writer removes it, so a row
  // anybody touches can never be mixed again.
  const w = dealStatusWrites(DEAL_STATUS.REVIEW);
  const row = { end_note: w.endNote, review_monthly: w.reviewMonthly };
  assert.equal(row.end_note, null, 'his word survived a write that is not his word');
  assert.equal(dealStatusOf(row), DEAL_STATUS.REVIEW);
});

/**
 * ===============================
 * * IT IS NOT A STORED COLUMN
 * ===============================
 * The point of the whole design. A `deal_status` column would be a third
 * place for one fact to live, and the checklist reads the other two.
 */
test('NOTHING WRITES A deal_status COLUMN', () => {
  const repo = fs.readFileSync(
    path.join(__dirname, '..', 'repos', 'masterSheetRows.repo.js'), 'utf8',
  );
  assert.doesNotMatch(repo, /deal_status/, 'deal status became a third source of truth');

  const migrations = path.join(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(migrations)) {
    const sql = fs.readFileSync(path.join(migrations, file), 'utf8');
    assert.doesNotMatch(sql, /deal_status/, `${file} adds the column this design avoids`);
  }
});

/**
 * ===============================
 * * THE FILTER ASKS THE SAME QUESTION AS THE READER
 * ===============================
 * Diane could not answer "how many deals are reviewed monthly" at all: she
 * reached for the monthly review QUEUE and gave its 17 unanswered against
 * the 12 rows that carry the status. Found 2026-09-24.
 *
 * A second reading of the pair would disagree with the first the day his
 * word and the tick both land on one row, so the SQL is checked against
 * `dealStatusOf` row by row rather than against a count somebody typed.
 */
test('dealStatusSql mirrors dealStatusOf, branch for branch', () => {
  const { dealStatusSql } = require('./dealStatus.helper');
  // Every combination the two columns can hold, including the mixed one.
  const ROWS = [
    { end_note: null, review_monthly: false },
    { end_note: null, review_monthly: true },
    { end_note: GOING_CONCERN, review_monthly: false },
    { end_note: GOING_CONCERN, review_monthly: true },
    { end_note: '  Going concern  ', review_monthly: false },
    { end_note: 'something else', review_monthly: false },
    { end_note: undefined, review_monthly: undefined },
  ];

  // The fragment, evaluated in JavaScript the way Postgres would.
  const matches = (sql, row) => {
    const his = String(row.end_note ?? '').trim() === GOING_CONCERN;
    const ticked = Boolean(row.review_monthly);
    if (sql.startsWith('btrim')) return his;
    if (sql.includes('AND coalesce')) return !his && ticked;
    return !his && !ticked;
  };

  for (const row of ROWS) {
    const truth = dealStatusOf(row);
    for (const status of DEAL_STATUS_VALUES) {
      assert.equal(
        matches(dealStatusSql(status), row),
        status === truth,
        `${JSON.stringify(row)} is ${truth}, and ${status} disagreed`,
      );
    }
  }
});

test('an unknown status is refused rather than filtering on nothing', () => {
  // A fragment for a value outside the set would either throw or, worse,
  // match everything. The repo ignores null and the schema enum stops her
  // sending one.
  const { dealStatusSql } = require('./dealStatus.helper');
  assert.equal(dealStatusSql('nonsense'), null);
  assert.equal(dealStatusSql(''), null);
  assert.equal(dealStatusSql(undefined), null);
});

test('HIS WORD WINS in the filter too, not just the reader', () => {
  const { dealStatusSql } = require('./dealStatus.helper');
  // A row carrying both is Going concern. The review fragment has to
  // exclude it, or one row is counted under two statuses.
  assert.match(dealStatusSql(DEAL_STATUS.REVIEW), /^NOT \(/);
  assert.match(dealStatusSql(DEAL_STATUS.ACTIVE), /^NOT \(/);
});

test('the alias reaches every column, so a join cannot make it ambiguous', () => {
  const { dealStatusSql } = require('./dealStatus.helper');
  const sql = dealStatusSql(DEAL_STATUS.REVIEW, 'm');
  assert.match(sql, /m\.end_note/);
  assert.match(sql, /m\.review_monthly/);
});

/**
 * ===============================
 * * THE ROUTE CARRIES IT, OR THE FILTER IS DROPPED IN SILENCE
 * ===============================
 * A repo destructures the keys it knows, so a param the route forgets to
 * forward runs the query UNFILTERED and the whole sheet comes back
 * described as something narrower. That is the fault `knownArgs.js` exists
 * for on Diane's side; the route has no such guard, so it is pinned here.
 */
test('the master sheet route forwards dealStatus to the repo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'masterSheet.js'), 'utf8');
  assert.match(src, /dealStatus: req\.query\.dealStatus \|\| undefined,/);
});

test('findAll TAKES it, and takes a list as well as one value', () => {
  // Diane's filter is plural like the rest, so a list arrives as an array.
  // Taking only a string would drop it, and a dropped filter answers with
  // the whole sheet.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'repos', 'masterSheetRows.repo.js'), 'utf8',
  );
  assert.match(src, /companyStatus, dealStatus,/, 'findAll does not destructure it');
  assert.match(src, /listValues\(dealStatus, DEAL_STATUS_VALUES\)/);
  // OR, never AND: two statuses means either, and one row can only be one.
  assert.match(src, /parts\.join\(' OR '\)/);
});

test('her filter offers the same three, from the same list', () => {
  const { masterSheetTools } = require('../agent/tools/masterSheet');
  const filter = masterSheetTools.find((t) => t.name === 'filter_master_sheet');
  const param = filter.parameters.properties.dealStatus;
  assert.ok(param, 'she cannot narrow by deal status');
  // pluralFilter wraps it in an array; the values are the shared set.
  assert.deepEqual(param.items.enum, [...DEAL_STATUS_VALUES]);
  // SHE MAY SET IT SINCE 2026-09-29, through the one deal tool, previewed:
  // "mark zayn milkman reviewed monthly" wrote the words into the label
  // cell when she had no real door to it.
  const row = masterSheetTools.find((t) => t.name === 'update_master_sheet_row');
  assert.deepEqual(row.parameters.properties.dealStatus.enum, [...DEAL_STATUS_VALUES]);
  assert.match(param.description, /update_master_sheet_row with dealStatus/);
});

test('the QUEUE and the STATUS are named apart in her description', () => {
  // "How many deals are reviewed monthly" called list_monthly_review and
  // answered with its 17 unanswered against the 12 rows that carry the
  // status. A confident number, about a different question.
  const { masterSheetTools } = require('../agent/tools/masterSheet');
  const filter = masterSheetTools.find((t) => t.name === 'filter_master_sheet');
  assert.match(filter.parameters.properties.dealStatus.description, /list_monthly_review is the QUEUE/);
});
