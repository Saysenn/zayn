const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../testing/stubRepos');

/**
 * ***************************************************
 * * ONE CASCADE, AND BOTH CALLERS REACH IT
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-17. The cascade lived inside the PATCH route, and
 * Diane's `update_company` calls the repo directly. So closing a company
 * on the page stopped every deal on it, and closing the SAME company by
 * asking her stopped none of them. One act, two answers, on money going
 * out.
 *
 * Breaking the cascade turned nothing red, which is how a hole like this
 * survives a green suite. These are the tests that were missing.
 */

const SUBJECT = require.resolve('./companyStatus.helper');
const COMPANIES = require.resolve('../repos/companies.repo');
const ROWS = require.resolve('../repos/masterSheetRows.repo');
const CLOCK = require.resolve('./presetMonth.helper');

// What findAll was actually asked for. The preview is only correct if it
// reads the right half of the sheet, and both halves come off one function.
let seen = [];

/** The repos, faked, plus a log of every cascade they were asked to run. */
function load(before) {
  const did = [];
  seen = [];
  const helper = loadWith(SUBJECT, {
    [COMPANIES]: {
      findByKey: async () => before,
      update: async (key, fields) => { did.push({ update: key, fields }); return { name: 'Acqua' }; },
      isTerminal: (status) => ['closed', 'dissolved'].includes(status),
    },
    [ROWS]: {
      stopCompany: async (name, opts) => { did.push({ stopped: name, ...opts }); return [1, 2, 3]; },
      resumeCompany: async (name, opts) => { did.push({ resumed: name, ...opts }); return [1, 2]; },
      setReviewMonthlyForCompany: async (name, ids, opts) => {
        did.push({ reviewed: name, ids, ...opts }); return [];
      },
      setGoingConcernForCompany: async (name, ids, opts) => {
        did.push({ goingConcern: name, ids, ...opts }); return [];
      },
      findAll: async (args) => {
        seen.push(args ?? {});
        return { rows: [{ monthly_amount: 500, currency: 'GBP' }], total: 1 };
      },
      REOPEN_THE_COMPANY: 'company_closed',
    },
    [CLOCK]: { currentDay: () => '2026-09-17' },
  });
  return { helper, did };
}

const ACTIVE = { name: 'Acqua', status: 'active' };
const CLOSED = { name: 'Acqua', status: 'closed' };

test('CLOSING STOPS EVERY DEAL ON THE COMPANY', async () => {
  const { helper, did } = load(ACTIVE);
  const out = await helper.applyCompanyStatus('acqua', { status: 'closed' });
  // `ids: undefined` is the cascade being told nothing, which the repo
  // reads as every live deal. The test below that one pins the difference.
  //
  // The stamp rides along on every cascade write now (see the batch tests
  // at the foot of this file), so the three fields that describe the ACT
  // are asserted rather than the whole object.
  const stopped = did.find((d) => d.stopped);
  assert.equal(stopped.stopped, 'Acqua');
  assert.equal(stopped.on, '2026-09-17');
  assert.equal(stopped.ids, undefined);
  assert.deepEqual(out.deals, { stopped: [1, 2, 3] });
  assert.equal(out.becameTerminal, true);
});

/**
 * ===============================
 * * AND THE CONFIRM CAN NARROW IT
 * ===============================
 * The closure dialog ticks the deals a closure stops, all of them by
 * default. Unticking one is the exception: a deal settled separately, or
 * one somebody is keeping alive on purpose.
 *
 * `undefined` AND `[]` ARE NOT THE SAME ANSWER. Diane has no checklist and
 * sends nothing, so nothing must mean every live deal; an empty array is a
 * human saying none of them. Collapsing the two would make her closures
 * silently stop nothing.
 */
test('NOT MENTIONING THE IDS STOPS EVERY DEAL', async () => {
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', { status: 'closed' });
  assert.equal(did.find((d) => d.stopped).ids, undefined);
});

test('TICKING SOME STOPS ONLY THOSE', async () => {
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', { status: 'closed', stopDealIds: [2, 3] });
  assert.deepEqual(did.find((d) => d.stopped).ids, [2, 3]);
});

test('AN EMPTY LIST IS A REAL ANSWER, and it is not "all of them"', async () => {
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', { status: 'closed', stopDealIds: [] });
  assert.deepEqual(did.find((d) => d.stopped).ids, []);
});

test('stopDealIds IS NEVER WRITTEN TO THE COMPANY ROW', async () => {
  // It is an instruction for the cascade, not a column. Spreading it into
  // the update is how an unknown field reaches the SET list.
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', { status: 'closed', stopDealIds: [1] });
  const { fields } = did.find((d) => d.update);
  assert.equal('stopDealIds' in fields, false);
});

test('AND DISSOLVING DOES THE SAME, because they differ only in what they SAY', async () => {
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', { status: 'dissolved' });
  assert.ok(did.some((d) => d.stopped), 'dissolved must cascade too');
});

test('IT DATES THE CLOSURE FROM THE BUSINESS CLOCK', async () => {
  // A closure dated off a UTC host is yesterday for seven hours a day, and
  // that date stops every deal.
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', { status: 'closed' });
  assert.equal(did.find((d) => d.update).fields.closedOn, '2026-09-17');
});

test('REOPENING PUTS THEM BACK, and clears the date', async () => {
  const { helper, did } = load(CLOSED);
  const out = await helper.applyCompanyStatus('acqua', { status: 'active' });
  assert.equal(did.find((d) => d.resumed).resumed, 'Acqua');
  assert.equal(did.find((d) => d.update).fields.closedOn, '', 'cleared, not left behind');
  assert.deepEqual(out.deals, { resumed: [1, 2] });
});

test('LIQUIDATION CASCADES NOTHING. It is still paying', async () => {
  const { helper, did } = load(ACTIVE);
  const out = await helper.applyCompanyStatus('acqua', { status: 'liquidation' });
  assert.equal(did.some((d) => d.stopped || d.resumed), false);
  assert.equal(out.deals, null);
});

test('A NOTE ON AN ALREADY CLOSED COMPANY CASCADES NOTHING', async () => {
  // Only on the way IN. Re-running a cascade that already happened would
  // re-stamp the date on deals stopped weeks ago.
  const { helper, did } = load(CLOSED);
  const out = await helper.applyCompanyStatus('acqua', { notes: 'gone in June' });
  assert.equal(did.some((d) => d.stopped || d.resumed), false);
  assert.equal(out.becameTerminal, false);
  assert.equal(out.reopened, false);
});

test('CLOSING AN ALREADY CLOSED COMPANY CASCADES NOTHING EITHER', async () => {
  const { helper, did } = load(CLOSED);
  await helper.applyCompanyStatus('acqua', { status: 'closed' });
  assert.equal(did.some((d) => d.stopped), false);
});

test('A FIELD NOT MENTIONED IS NOT SENT', async () => {
  // `closedOn: undefined` is a key nobody mentioned, and "not mentioned"
  // is a real third state the repo keeps apart from "cleared".
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', { tier: 'T2' });
  assert.deepEqual(Object.keys(did.find((d) => d.update).fields), ['tier']);
});

test('wouldStop COUNTS THE LIVE DEALS AND THEIR MONEY, before anything is written', async () => {
  const { helper } = load(ACTIVE);
  assert.deepEqual(await helper.wouldStop('Acqua'), { count: 1, money: 500, currency: 'GBP' });
  const asked = seen.at(-1);
  assert.equal(asked.stopped, undefined, 'the live rows, not the archive');
});

/**
 * ===============================
 * * AND THE REOPEN OWES THE SAME NUMBER
 * ===============================
 * A bulk reopen moves somebody's pay exactly as a close does, so its
 * preview says how many deals come back and what they are worth.
 *
 * ONLY WHAT THE CLOSURE STOPPED, which is the rule `resumeCompany` writes
 * by: a deal stopped BY HAND beforehand was its own decision and stays
 * stopped. Asking for every stopped deal here would promise back rows the
 * reopen never touches, which is an undelete, not a reopen.
 */
test('wouldResume COUNTS ONLY WHAT THE CLOSURE STOPPED', async () => {
  const { helper } = load(CLOSED);
  assert.deepEqual(await helper.wouldResume('Acqua'), { count: 1, money: 500, currency: 'GBP' });

  const asked = seen.at(-1);
  assert.equal(asked.stopped, true, 'the archive, not the live sheet');
  assert.equal(asked.stoppedReason, 'company_closed', 'a hand stop is not the closure to undo');
});

/**
 * ===============================
 * * AND BOTH CALLERS GO THROUGH IT
 * ===============================
 * Source text, because the point is which function they call. A caller
 * reaching `companiesRepo.update` directly is the bug, and it looks
 * perfectly reasonable on the line it sits on.
 */
test('THE ROUTE AND update_company BOTH USE THE HELPER', () => {
  const { readFileSync } = require('node:fs');
  const read = (f) => readFileSync(require.resolve(f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const file of ['../companies.js', '../agent/tools/masterSheet.js', '../agent/tools/companies.js']) {
    assert.match(read(file), /applyCompanyStatus\(/, `${file} must cascade through the helper`);
  }
});

test('AND NEITHER WRITES A STATUS STRAIGHT TO THE REPO', () => {
  const { readFileSync } = require('node:fs');
  const read = (f) => readFileSync(require.resolve(f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // bulk_update_companies calls the repo directly and correctly: it CANNOT
  // carry a status, which its own test pins.
  const bulk = read('../agent/tools/companies.js');
  assert.equal('status' in require('../agent/tools/companies').bulkUpdateCompanies.parameters.properties, false);
  assert.match(bulk, /companiesRepo\.update\(/, 'the tidy up may write directly');
});

/**
 * ***************************************************
 * * ONE ACT, ONE BATCH, ONE ROW IN HISTORY
 * ***************************************************
 *
 * His call 2026-09-22. A company status change touches every deal on the
 * company, and that is ONE thing that happened: History should show it
 * once and Undo should put all of it back in one press.
 *
 * Before this the cascade wrote no change entry AT ALL, so a status change
 * left nothing in History to undo, and `findChangeBatches` recovered
 * batches by guessing at a 15 second gap. A cascade slower than the gap
 * split into two rows, and undoing one put half the deals back.
 */

/** Every stamp the cascade handed to a repo write this call. */
const stampsIn = (did) => did
  .filter((d) => d.batchId !== undefined)
  .map((d) => ({ via: d.via, batchId: d.batchId }));

test('EVERY CASCADE WRITE CARRIES THE SAME BATCH ID', async () => {
  const { helper, did } = load(ACTIVE);
  const out = await helper.applyCompanyStatus('acqua', {
    status: 'closed',
    reviewMonthlyDealIds: [1],
    goingConcernDealIds: [2],
  });

  const stamps = stampsIn(did);
  assert.ok(stamps.length >= 3, 'the stop, the review flag and the note all log');
  const ids = new Set(stamps.map((s) => s.batchId));
  assert.equal(ids.size, 1, 'three writes, three batches, three rows in History');
  assert.equal(out.batchId, [...ids][0], 'and the caller is told which one to point Undo at');
});

test('TWO SEPARATE ACTS GET TWO SEPARATE BATCHES', async () => {
  const first = load(ACTIVE);
  const a = await first.helper.applyCompanyStatus('acqua', { status: 'closed' });
  const second = load(ACTIVE);
  const b = await second.helper.applyCompanyStatus('acqua', { status: 'closed' });

  assert.notEqual(a.batchId, b.batchId, 'one id for both would undo the wrong one');
  assert.match(a.batchId, /^[0-9a-f-]{36}$/);
});

/**
 * THE THIRD ID LIST, and it asks a different question from the other two:
 * not which are reviewed and not which stop, but which carry his word
 * "Going concern" and therefore have no end date.
 */
test('GOING CONCERN IDS REACH THEIR OWN WRITE, and only when asked', async () => {
  const asked = load(ACTIVE);
  await asked.helper.applyCompanyStatus('acqua', {
    status: 'going_concern', goingConcernDealIds: [7, 9],
  });
  assert.deepEqual(asked.did.find((d) => d.goingConcern)?.ids, [7, 9]);

  const notAsked = load(ACTIVE);
  await notAsked.helper.applyCompanyStatus('acqua', { status: 'going_concern' });
  assert.equal(notAsked.did.some((d) => d.goingConcern), false, 'undefined is not []');
});

test('AND AN EMPTY LIST CLEARS THEM ALL, which is a real answer', async () => {
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', {
    status: 'going_concern', goingConcernDealIds: [],
  });
  assert.deepEqual(did.find((d) => d.goingConcern)?.ids, []);
});

test('THE ID LISTS ARE NEVER WRITTEN TO THE COMPANY ROW', async () => {
  // They are instructions for the cascade, not columns. Spreading one into
  // the update is how an unknown field reaches the SET list.
  const { helper, did } = load(ACTIVE);
  await helper.applyCompanyStatus('acqua', {
    status: 'going_concern', goingConcernDealIds: [1], reviewMonthlyDealIds: [2], stopDealIds: [3],
  });
  const { fields } = did.find((d) => d.update);
  for (const key of ['goingConcernDealIds', 'reviewMonthlyDealIds', 'stopDealIds', 'via']) {
    assert.equal(key in fields, false, `${key} reached the company row`);
  }
});
