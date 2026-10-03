#!/usr/bin/env node
/**
 * ***************************************************
 * * The closure feature, end to end, on FAKE DATA
 * ***************************************************
 *
 * Stopping, the Archive, the monthly review and liquidation, exercised
 * against the REAL database because none of it has ever executed a query.
 * The unit tests pin the arithmetic and the guards with the pool stubbed;
 * this is the half they cannot reach: the CHECK constraints, the pair
 * constraint, the generated queue, the cascade.
 *
 *   node scripts/closureDrill.js            seed, drill, leave it there
 *   node scripts/closureDrill.js --clean    seed, drill, remove every row
 *
 * NEEDS MIGRATIONS 056, 057 AND 058. Run `npm run migrate` first.
 *
 * ===============================
 * * IT CANNOT TOUCH A REAL ROW, AND THAT IS ENFORCED NOT PROMISED
 * ===============================
 * `scratchOnly` is armed before anything else loads, so every write goes
 * through a group check and a row outside ZZTEST THROWS. The incident
 * behind it is in that file: a test of Diane's bulk update set three real
 * INDIGO rows to a 2023 preset and took GBP 2,700 out of September.
 *
 * Everything here is in the group ZZTEST, on companies that exist nowhere
 * in the real sheet, on two invented people. NEVER add a step that names a
 * real group, person or company.
 */
require('dotenv').config();
require('../v1/testing/scratchOnly').arm();

const rows = require('../v1/repos/masterSheetRows.repo');
const companies = require('../v1/repos/companies.repo');
const review = require('../v1/repos/monthlyReview.repo');
const { parseRole } = require('../v1/masterSheet/identity');
const { currentMonth, currentDay, lastDayOf } = require('../v1/shared/presetMonth.helper');
const { isOwedThisMonth, paymentStartState, START_STATE } = require('../v1/shared/owedThisMonth.helper');
// The shared cascade, the same one the page and Diane both go through.
const { applyCompanyStatus } = require('../v1/shared/companyStatus.helper');
// A day as words, never String(date).slice(0, 10). See its banner.
const { dayText } = require('../v1/shared/dayText.helper');

const GROUP = 'ZZTEST';
// Two companies, so the closure cascade has something to NOT reach.
const CLOSING = 'ZZ Closing Co';
const STAYING = 'ZZ Staying Co';

// `changed_via` IS A CLOSED SET (migration 033: admin, diane, sync,
// upload). The drill is a person at a keyboard, so it writes 'admin'.
const VIA = 'admin';

const PERIOD = currentMonth();
// Past its term, which is the whole trigger for the review.
const LONG_ENDED = `${Number(PERIOD.slice(0, 4)) - 1}-01-31`;

let failures = 0;
let checks = 0;

function check(what, got, want) {
  checks += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `\n       got ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
}

function ok(what, condition) {
  check(what, Boolean(condition), true);
}

async function refuses(what, run) {
  checks += 1;
  try {
    await run();
    failures += 1;
    console.log(`FAIL ${what}\n       it went through, and it must not`);
  } catch (err) {
    console.log(`ok   ${what} (${err.message.slice(0, 60)})`);
  }
}

/**
 * One fake deal. `endOn` decides whether the review asks about it.
 *
 * `role` IS NOT NULL (migration 013) and `create` does not derive it from
 * the label, so it is set here through the same `parseRole` the importer
 * and the hand add path use rather than a string typed twice.
 */
function deal(person, company, amount, endOn) {
  const ROLE_LABEL = 'Director';
  const { role, seat } = parseRole(ROLE_LABEL);
  return rows.create({
    syncKey: `zztest|${company}|${person}|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`,
    groupName: GROUP,
    personId: person.toLowerCase(),
    personName: person,
    company,
    role,
    seat,
    roleLabel: ROLE_LABEL,
    monthlyAmount: amount,
    currency: 'GBP',
    paymentMethod: 'bank',
    presetOn: `${PERIOD}-01`,
    paymentStartOn: `${Number(PERIOD.slice(0, 4)) - 2}-01-01`,
    endOn,
  });
}

/**
 * ===============================
 * * A DRILL THAT IS NOT ISOLATED PROVES NOTHING
 * ===============================
 * Every count here is scoped by group or company, so rows left behind by
 * an earlier run join them. The second run reported 7 rows where it seeded
 * 4, read another run's stop reason, and resumed a deal it had not closed:
 * five red checks, none of them about the code.
 *
 * So it starts from nothing. The CRM's own delete, under the armed guard,
 * which can only ever reach ZZTEST.
 */
async function clearScratch() {
  const { rows: live } = await rows.findAll({ group: GROUP, pageSize: 500 });
  const { rows: dead } = await rows.findAll({ group: GROUP, stopped: true, pageSize: 500 });
  const ids = [...live, ...dead].map((row) => row.id);
  if (ids.length === 0) return;
  await rows.removeMany(ids, { via: VIA });
  console.log(`# cleared ${ids.length} rows left by an earlier run\n`);
}

async function main() {
  console.log(`# closure drill, period ${PERIOD}, today ${currentDay()}\n`);
  await clearScratch();

  // ===============================
  // * SEED
  // ===============================
  const seeded = [
    await deal('ZZ Gloria', CLOSING, 2000, LONG_ENDED),   // due for review
    await deal('ZZ Paddy', CLOSING, 500, LONG_ENDED),     // due for review
    await deal('ZZ Nathan', STAYING, 750, null),          // ongoing, never asked
    await deal('ZZ Zane', STAYING, 300, LONG_ENDED),      // due, answered yes
  ];
  const [gloria, paddy, nathan, zane] = seeded;
  console.log(`# seeded ${seeded.length} rows: ${seeded.map((r) => r.id).join(', ')}\n`);

  try {
    // ===============================
    // * 1b  STOP, ARCHIVE, RESUME
    // ===============================
    console.log('## stopping');

    const live = await rows.findAll({ group: GROUP, pageSize: 100 });
    check('every seeded row is on the sheet', live.total, 4);

    await rows.stop(nathan.id, { on: currentDay(), reason: rows.STOPPED_REASON.BY_HAND });

    const afterStop = await rows.findAll({ group: GROUP, pageSize: 100 });
    check('a stopped row leaves the sheet', afterStop.total, 3);

    const archived = await rows.findAll({ group: GROUP, stopped: true, pageSize: 100 });
    check('and appears in the archive', archived.total, 1);
    check('carrying its reason', archived.rows[0].stopped_reason, 'stopped_by_hand');
    ok('and its date', Boolean(archived.rows[0].stopped_on));

    // THE ROW IS NOT GONE. That is the whole difference from a delete.
    const stillThere = await rows.findById(nathan.id);
    ok('the row itself still exists', stillThere !== null);
    check('with its money untouched', Number(stillThere.monthly_amount), 750);

    // ===============================
    // * A STOP TODAY IS A PART MONTH, AND IT IS STILL OWED
    // ===============================
    // The drill asserted "out of the month" here and went red, correctly.
    // A deal stopped on the 16th was paid up to the 16th, so this month is
    // owed and the cell is AMBER. Only a stop BEFORE the month drops it.
    check('the month it stops in is still owed', isOwedThisMonth(stillThere, {}), true);
    check(
      'and reads amber, a part month',
      paymentStartState(stillThere, {}),
      START_STATE.STARTED_THIS_MONTH,
    );

    // The same row, stopped before this month began.
    const earlier = { ...stillThere, stopped_on: `${PERIOD}-01` };
    earlier.stopped_on = new Date(Date.UTC(
      Number(PERIOD.slice(0, 4)), Number(PERIOD.slice(5, 7)) - 1, 0,
    )).toISOString().slice(0, 10);
    check('a stop BEFORE the month drops it', isOwedThisMonth(earlier, {}), false);
    check(
      'THE STOP IS NOT BEHIND THE END DATE SETTING',
      isOwedThisMonth(earlier, { useEndDate: true }),
      false,
    );

    await refuses(
      'an invented stop reason is refused by the CHECK',
      () => rows.stop(nathan.id, { on: currentDay(), reason: 'because i said so' }),
    );

    await rows.resume(nathan.id);
    const afterResume = await rows.findAll({ group: GROUP, pageSize: 100 });
    check('resume puts it back on the sheet', afterResume.total, 4);
    const back = await rows.findById(nathan.id);
    check('and clears BOTH columns', [back.stopped_on, back.stopped_reason], [null, null]);

    // ===============================
    // * 2  THE MONTHLY REVIEW
    // ===============================
    console.log('\n## the monthly review');

    const queue = await review.queue(PERIOD, { group: GROUP });
    check('only deals past their end date are asked about', queue.length, 3);
    ok('an ongoing deal is not in the queue', !queue.some((r) => r.id === nathan.id));

    const waiting = await review.pending(PERIOD);
    ok('pending counts at least our three', waiting.count >= 3);

    // YES changes nothing but the record.
    await review.answerOne(zane.id, PERIOD, 'yes', VIA);
    const afterYes = await rows.findById(zane.id);
    check('YES stops nothing', afterYes.stopped_on, null);
    check(
      'and an unanswered deal is still PAID',
      isOwedThisMonth(await rows.findById(gloria.id), {}),
      true,
    );

    // FINAL is a special case, then stops at its end.
    const final = await review.answerOne(paddy.id, PERIOD, 'final', VIA);
    check('FINAL stops at the end of THIS month', final.stoppedOn, lastDayOf(PERIOD));
    const paidOut = await rows.findById(paddy.id);
    check('so this month is still owed', isOwedThisMonth(paidOut, {}), true);
    check(
      'and the month it stops in is AMBER, a part month',
      paymentStartState(paidOut, {}),
      START_STATE.STARTED_THIS_MONTH,
    );

    // NO stops at the end of LAST month, which is a month less.
    const no = await review.answerOne(gloria.id, PERIOD, 'no', VIA);
    ok('NO stops a month earlier than FINAL', no.stoppedOn < final.stoppedOn);
    const cut = await rows.findById(gloria.id);
    check('so this month is NOT owed', isOwedThisMonth(cut, {}), false);
    check('and it reads red', paymentStartState(cut, {}), START_STATE.NOT_STARTED);
    check('with the review as its reason', cut.stopped_reason, 'review_no');

    // RE-ANSWERABLE: a misclick on a row that pays somebody is the
    // commonest correction there is.
    await review.answerOne(gloria.id, PERIOD, 'yes', VIA);
    const undone = await rows.findById(gloria.id);
    check('answering YES again clears the stop', undone.stopped_on, null);

    const queueAfter = await review.queue(PERIOD, { group: GROUP, answered: false });
    ok('an answered deal leaves the unanswered list', !queueAfter.some((r) => r.id === zane.id));

    const history = await review.forDeal(gloria.id);
    ok('every answer is kept, per month', history.length >= 1);

    await refuses(
      'an invented answer is refused',
      () => review.answerOne(gloria.id, PERIOD, 'probably', 'drill'),
    );

    // ===============================
    // * 3  LIQUIDATION AND CLOSURE
    // ===============================
    console.log('\n## liquidation and closure');

    await companies.update(CLOSING, { status: 'liquidation', liquidationTotal: '1250' });
    const winding = await companies.findByKey(CLOSING.toLowerCase());
    check('a company can be put into liquidation', winding.status, 'liquidation');
    check('and the settlement is recorded', Number(winding.liquidation_total), 1250);

    /**
     * ===============================
     * * THE TICK SAYS WHETHER. THE STATUS ONLY SAYS WHICH.
     * ===============================
     * His call 2026-09-21. The queue used to sweep in every live deal on a
     * liquidating company, which made the checklist a lie: it promises
     * "ticked deals join the Review list every month" and unticking one
     * removed nothing. Now the tick is the only way in besides a date, and
     * the company's status is carried on the row so the panel can group a
     * wind down apart from a passed date.
     *
     * STAYING is used, not CLOSING: its deals are Nathan (ongoing, NO end
     * date, so nothing else can put him in the queue) and Zane (answered).
     * Nathan is the whole point, and only the tick may move him.
     */
    const pendingBefore = await review.pending(PERIOD);
    ok(
      'an ongoing deal is not in the queue yet',
      !(await review.queue(PERIOD, { group: GROUP })).some((r) => r.id === nathan.id),
    );

    await companies.update(STAYING, { status: 'liquidation' });
    ok(
      'LIQUIDATION ALONE PUTS NOTHING IN THE QUEUE. The checklist decides',
      !(await review.queue(PERIOD, { group: GROUP })).some((r) => r.id === nathan.id),
    );
    check(
      'so the count does not move on a status alone',
      (await review.pending(PERIOD)).count,
      pendingBefore.count,
    );

    // THE TICK. The same write the status screen's checklist sends.
    await rows.setReviewMonthlyForCompany(STAYING, [nathan.id]);
    const ticked = (await review.queue(PERIOD, { group: GROUP })).find((r) => r.id === nathan.id);
    ok('TICKING IT PUTS IT IN, end date or not', Boolean(ticked));
    check(
      'and the row carries its company status, so the panel can group it',
      ticked?.company_status,
      'liquidation',
    );
    check(
      'THE PENDING COUNT GOES UP BY THAT DEAL',
      (await review.pending(PERIOD)).count,
      pendingBefore.count + 1,
    );

    // AND UNTICKING TAKES IT BACK OUT. A one way tick would leave a count
    // nobody could ever bring down, which is the lie in reverse.
    await rows.setReviewMonthlyForCompany(STAYING, []);
    ok(
      'unticking takes it back out',
      !(await review.queue(PERIOD, { group: GROUP })).some((r) => r.id === nathan.id),
    );
    check(
      'and the pending count comes back down',
      (await review.pending(PERIOD)).count,
      pendingBefore.count,
    );

    await companies.update(STAYING, { status: 'active' });

    const stillPaying = await rows.findAll({ group: GROUP, company: CLOSING, pageSize: 100 });
    ok('LIQUIDATION STOPS NOTHING. It is still paying', stillPaying.total >= 1);

    const badged = stillPaying.rows[0];
    check('and the deal row carries it, for the badge', badged.company_status, 'liquidation');

    // The amounts are set BY HAND, per deal. There is no factor anywhere.
    await rows.update(gloria.id, { monthlyAmount: 1250 }, VIA);
    await rows.update(paddy.id, { monthlyAmount: 0 }, VIA);
    const reduced = await rows.findById(gloria.id);
    check('an amount is set by hand', Number(reduced.monthly_amount), 1250);

    // Closing is the LAST act, and it stops every live deal on the company.
    await companies.update(CLOSING, { status: 'closed', closedOn: currentDay() });
    const closedDeals = await rows.stopCompany(CLOSING, { on: currentDay() });
    ok('closing stops every live deal on it', closedDeals.length >= 1);

    const sheetNow = await rows.findAll({ group: GROUP, company: CLOSING, pageSize: 100 });
    check('so none of them is on the sheet', sheetNow.total, 0);

    const archivedNow = await rows.findAll({
      group: GROUP, company: CLOSING, stopped: true, pageSize: 100,
    });
    ok('they are all in the archive', archivedNow.total >= 1);

    // ===============================
    // * BY REASON, NEVER BY POSITION
    // ===============================
    // The archive is newest stop first, and a review's "final month" is
    // dated the END of the month while a closure is dated today. So
    // `rows[0]` was the review's row, and two checks went red about code
    // that was doing exactly the right thing.
    const byClosure = archivedNow.rows.find((row) => row.stopped_reason === 'company_closed');
    ok('at least one row carries the company as its reason', Boolean(byClosure));

    // A DEAL THE REVIEW ALREADY STOPPED IS NOT RE-STAMPED. The closure
    // skips it (`stopped_on IS NULL`), so its own date and reason survive,
    // which is what makes the Archive able to say why each row is there.
    const byReview = archivedNow.rows.find((row) => row.stopped_reason === 'review_final');
    ok('and a review stop keeps ITS reason, not the closure\'s', Boolean(byReview));
    check('with its own date', byReview?.stopped_on?.toISOString?.().slice(0, 10)
      ?? String(byReview?.stopped_on).slice(0, 10), lastDayOf(PERIOD));

    // THE ONE RESUME THAT IS REFUSED, and only that one.
    const blocked = await rows.resume(byClosure.id);
    check('a company closure cannot be resumed on its own', blocked, null);
    const allowed = await rows.resume(byReview.id);
    ok('but a review stop on the same company still can', allowed !== null);

    const untouched = await rows.findAll({ group: GROUP, company: STAYING, pageSize: 100 });
    ok('THE OTHER COMPANY IS UNTOUCHED', untouched.total >= 1);

    // Reopening puts back only what the closure stopped.
    await companies.update(CLOSING, { status: 'active', closedOn: '' });
    const resumed = await rows.resumeCompany(CLOSING);
    ok('reopening brings its deals back together', resumed.length >= 1);
    const reopened = await companies.findByKey(CLOSING.toLowerCase());
    check('and clears the closure date', reopened.closed_on, null);

    // ===============================
    // * 4  GOING CONCERN, AND THE ONE PRESS UNDO
    // ===============================
    console.log('\n## going concern and undo');

    /**
     * HIS CALL 2026-09-22. The ticked deals carry his word "Going concern"
     * in the end date cell, which means they have NO end date, so ticking
     * clears the date. Unticking cannot put it back, and that is why the
     * whole cascade logs: History and Undo are the way back.
     *
     * THIS BLOCK IS THE REASON THE FEATURE WORKS. Every unit test here
     * runs with no database, so none of them could see that
     * `revertFieldChange` refused any field outside COLUMN_FOR: the
     * cascade logged `endNote` and `endOn`, the undo answered "not an
     * editable field", and the one press undo undid nothing at all.
     */
    const zane2 = await deal('ZZ Zane', STAYING, 900, LONG_ENDED);
    const beforeDate = (await rows.findById(zane2.id)).end_on;
    ok('the deal starts with a real end date', Boolean(beforeDate));

    const gc = await applyCompanyStatus(STAYING, {
      status: 'going_concern', goingConcernDealIds: [zane2.id],
    });
    const tagged = await rows.findById(zane2.id);
    check('TICKING WRITES HIS WORD', tagged.end_note, 'Going concern');
    check('AND CLEARS THE END DATE', tagged.end_on, null);
    ok('and the cascade hands back a batch id', /^[0-9a-f-]{36}$/.test(gc.batchId));

    /**
     * ONE ROW IN HISTORY, not one per field per deal. The batch is what
     * makes "undo that status change" a single press.
     */
    const batches = await rows.findChangeBatches({ hours: 720 });
    const mine = batches.find((b) => (b.changes ?? []).some((c) => c.rowId === zane2.id));
    ok('the change is in History at all', Boolean(mine));
    ok('and its fields include the cleared date', (mine?.fields ?? []).includes('endOn'));

    const reverted = await rows.revertChangeBatch(mine.ids);
    check('EVERY CHANGE IN THE BATCH UNDOES', reverted.failed.length, 0);

    const restoredRow = await rows.findById(zane2.id);
    /**
     * THROUGH `dayText`, NOT `String(...).slice(0, 10)`.
     *
     * This assertion was written the second way and failed on a restore
     * that had worked perfectly: pg hands a `date` back as a Date OBJECT,
     * so it stringified to "Fri Jan 31 2025 16:00:00 GMT-0800" and the
     * slice took "Fri Jan 31". The year was gone and the day was a weekday.
     *
     * That is the precise bug `shared/dayText.helper` was written for, and
     * its banner says so. Reading it here rather than repeating the slice
     * is the whole point of the helper existing.
     */
    check('AND THE DATE IS BACK, to the day', dayText(restoredRow.end_on), dayText(LONG_ENDED));
    check('with his word gone again', restoredRow.end_note, null);

    // AND IT CANNOT BE UNDONE TWICE, which would write the old value over
    // a correction somebody has since made.
    const twice = await rows.revertChangeBatch(mine.ids);
    check('a second undo refuses every one of them', twice.done.length, 0);

    await rows.removeMany([zane2.id], { via: VIA });

    await refuses(
      'an invented company status is refused by the CHECK',
      () => companies.update(CLOSING, { status: 'sort of closed' }),
    );
  } finally {
    console.log(`\n# ${checks - failures}/${checks} checks passed`);

    if (process.argv.includes('--clean')) {
      // THE CRM'S OWN DELETE, under the armed guard, so this can only ever
      // reach ZZTEST. Not a hand written DELETE against the database.
      const gone = await rows.removeMany(seeded.map((r) => r.id), { via: 'admin' });
      console.log(`# removed ${gone.length} seeded rows`);
      // The tb_companies row for the closing company stays, and nothing
      // deletes a company (CLAUDE.md). It is invisible either way: every
      // company read starts from the deals, so one with none is on no page
      // and in no picker. The same name is reused, so it never piles up.
      console.log('# its tb_companies row stays, with no deals. Invisible, and reused next run.');
    } else {
      console.log(`# left in place. Re-run with --clean to remove rows ${seeded.map((r) => r.id).join(', ')}`);
    }
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nthe drill itself broke:', err);
  process.exit(1);
});
