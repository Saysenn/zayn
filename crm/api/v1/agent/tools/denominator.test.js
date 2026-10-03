const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const { masterSheetTools } = require('./masterSheet');

/**
 * ***************************************************
 * * A FILTERED COUNT MEANS NOTHING WITHOUT ITS DENOMINATOR
 * ***************************************************
 *
 * "Are all the INDIGO people paid in cash" was answered "there are 30 rows
 * in INDIGO paid by cash". INDIGO has 39, and nine are paid by bank. She
 * filtered BY the premise and read the matches back as agreement. The same
 * shape answered "confirm everyone in INDIGO is paid in cash" with a
 * confirmation.
 *
 * She cannot help doing this with a bare count, so the count never arrives
 * bare. THIRTY OF THIRTY NINE answers the question and thirty does not.
 *
 * AND PEOPLE ARE NOT ROWS. "36 people in INDIGO are paid in GBP" over 36
 * rows held by 28 people. A person holds several deals here, so both counts
 * are handed over rather than leaving her to pick a noun.
 */

const filter = masterSheetTools.find((t) => t.name === 'filter_master_sheet');

const deal = (id, person, method, currency) => ({
  id,
  person_id: person.toLowerCase(),
  person_name: person,
  company: `Co ${id}`,
  group_name: 'INDIGO',
  role_label: 'Mid 1',
  currency,
  payment_method: method,
  payable_amount: 100,
  payable_days: 30,
});

// Four rows, THREE people: Ann holds two. Cash on three of the four.
const ROWS = [
  deal(1, 'Ann', 'cash', 'GBP'),
  deal(2, 'Ann', 'cash', 'GBP'),
  deal(3, 'Bo', 'cash', 'GBP'),
  deal(4, 'Cy', 'bank', 'AED'),
];

const matches = (r, f) => (!f.paymentMethod || r.payment_method === f.paymentMethod)
  && (!f.currency || r.currency === f.currency);

const withRepo = (run, rows = ROWS) => {
  const saved = repo.findAll;
  repo.findAll = async (f = {}) => {
    const hit = rows.filter((r) => matches(r, f));
    return { rows: hit, total: hit.length };
  };
  return run().finally(() => { repo.findAll = saved; });
};

test('THE ACTUAL FAILURE: a filtered count carries what it is out of', async () => {
  await withRepo(async () => {
    const out = await filter.handler({ group: 'INDIGO', paymentMethod: 'cash', said: 'are they all cash' });
    assert.match(out.summary, /3 of 4 rows/);
    assert.match(out.summary, /THE OTHER 1 DOES NOT MATCH/);
    assert.match(out.summary, /the answer is NO/);
  });
});

test('and when they ALL match it says YES', async () => {
  // Every row in scope is cash here, so "are they all cash" really is yes.
  const allCash = ROWS.filter((r) => r.payment_method === 'cash');
  await withRepo(async () => {
    const out = await filter.handler({ group: 'INDIGO', paymentMethod: 'cash', said: 'all cash?' });
    assert.match(out.summary, /the answer to "are they all" is YES/);
  }, allCash);
});

test('FILTERING ON NOTHING IS NOT A YES', async () => {
  // The bug the first version of this note introduced: asked "everyone in
  // MILKMAN is on GBP right" she passed only the GROUP, so every row
  // matched and the note read as agreement. One of them was AED. A guard
  // that confirms a false premise is worse than the bias it replaced.
  await withRepo(async () => {
    const out = await filter.handler({ group: 'INDIGO', said: 'everyone in indigo is on gbp right' });
    assert.doesNotMatch(out.summary, /is YES/);
    assert.match(out.summary, /FILTERED ON NOTHING/);
    assert.match(out.summary, /does NOT answer "are they all"/);
  });
});

test('PEOPLE ARE NOT ROWS, and both counts are handed over', async () => {
  await withRepo(async () => {
    const out = await filter.handler({ group: 'INDIGO', paymentMethod: 'cash', said: 'who is on cash' });
    // Three rows, held by two people: Ann twice and Bo once.
    assert.match(out.summary, /3 ROWS, held by 2 people/);
    assert.match(out.summary, /never call a row count a number of people/);
  });
});

test('one person reads as a person, not "1 people"', async () => {
  await withRepo(async () => {
    const out = await filter.handler({ group: 'INDIGO', paymentMethod: 'bank', said: 'who is on bank' });
    assert.match(out.summary, /1 ROWS?, held by 1 person\b/);
  });
});

test('THE DENOMINATOR IS THE SCOPE, not the whole sheet', async () => {
  // "30 of 39 in INDIGO", never "30 of 96". The group is the scope the
  // question was asked inside, so it must not be filtered out of the count.
  let asked = null;
  await withRepo(async () => {
    const real = repo.findAll;
    repo.findAll = async (f) => { if (f.pageSize === 1) asked = f; return real(f); };
    await filter.handler({ group: 'INDIGO', paymentMethod: 'cash', said: 'cash in indigo' });
  });
  assert.equal(asked.group, 'INDIGO', 'the denominator ignored the group');
  assert.equal(asked.paymentMethod, undefined, 'the denominator applied the filter, so it equals the numerator');
});

/* ===============================
 * * And the same rule on companies
 * =============================== */

const companiesRepo = require('../../repos/companies.repo');
const active = masterSheetTools.find((t) => t.name === 'active_companies');

// `activeCompanies` reads `role`, the folded kind, not `role_label`, which
// is the sheet's own wording. A fixture that sets the wrong one makes every
// company look like it holds nobody.
const COMPANY_ROWS = [
  { ...deal(10, 'Dee', 'cash', 'GBP'), company: 'Has Both', role: 'director', role_label: 'Director' },
  { ...deal(11, 'Em', 'cash', 'GBP'), company: 'Has Both', role: 'mid', role_label: 'Mid 1' },
  { ...deal(12, 'Ef', 'cash', 'GBP'), company: 'No Director', role: 'mid', role_label: 'Mid 1' },
];

test('COMPANIES CANNOT BE GENERALISED OVER EITHER', async () => {
  // Asked how many companies there are she said "25 active companies, EACH
  // WITH A DIRECTOR AND ONE OR MORE MIDS". Two of the twenty five held
  // neither, and both said "not held" in the list she was reading.
  const saved = { findAll: repo.findAll, tierMap: companiesRepo.tierMap, plain: companiesRepo.findAllPlain };
  repo.findAll = async () => ({ rows: COMPANY_ROWS, total: COMPANY_ROWS.length });
  companiesRepo.tierMap = async () => new Map();
  companiesRepo.findAllPlain = async () => [];
  try {
    const out = await active.handler({ said: 'how many companies do we have' });
    assert.match(out.summary, /NOT ALL OF THEM ARE THE SAME/);
    assert.match(out.summary, /1 holds NO director/, 'the verb has to agree, she reads these aloud');
    assert.match(out.summary, /Do NOT say they each have a director or a mid, in any words/);
    // The finished sentence, because "do not generalise" produced "each
    // with various directors and mids assigned", the same claim in softer
    // words. A rule she has to apply is a rule she can dodge.
    assert.match(out.summary, /SAY IT LIKE THIS/);
  } finally {
    repo.findAll = saved.findAll;
    companiesRepo.tierMap = saved.tierMap;
    companiesRepo.findAllPlain = saved.plain;
  }
});

test('and when every company holds both, there is no such note', async () => {
  const saved = { findAll: repo.findAll, tierMap: companiesRepo.tierMap, plain: companiesRepo.findAllPlain };
  repo.findAll = async () => ({ rows: COMPANY_ROWS.slice(0, 2), total: 2 });
  companiesRepo.tierMap = async () => new Map();
  companiesRepo.findAllPlain = async () => [];
  try {
    const out = await active.handler({ said: 'how many companies' });
    assert.doesNotMatch(out.summary, /NOT ALL OF THEM ARE THE SAME/);
  } finally {
    repo.findAll = saved.findAll;
    companiesRepo.tierMap = saved.tierMap;
    companiesRepo.findAllPlain = saved.plain;
  }
});

test('"WHOSE" IS ANSWERED WITH NAMES, or she invents row ids to find them', async () => {
  // Asked whose deals were ending soon she got three cards and a summary
  // that told her not to read the fields back and named nobody. So she
  // called get_master_sheet_row_details three times with ids she had made
  // up, two of which hit real rows, and answered "Tobias Wright and Jim".
  // The three were KJ, Drew and Ruth Harper.
  await withRepo(async () => {
    const out = await filter.handler({ group: 'INDIGO', paymentMethod: 'cash', said: 'whose are on cash' });
    assert.match(out.summary, /THEY ARE: Ann and Bo\./, 'the names were withheld again');
    assert.match(out.summary, /do NOT look any row up by id/);
  });
});

test('and a LONG list gives a count, not a roll call', async () => {
  const many = Array.from({ length: 20 }, (_, i) => deal(100 + i, `P${i}`, 'cash', 'GBP'));
  await withRepo(async () => {
    const out = await filter.handler({ group: 'INDIGO', paymentMethod: 'cash', said: 'who is on cash' });
    assert.doesNotMatch(out.summary, /THEY ARE:/);
  }, many);
});

/* ===============================
 * * One row's amount is not the person's total
 * =============================== */

const details = masterSheetTools.find((t) => t.name === 'find_and_show_details');

test('SEVERAL DEALS MEAN NO TOTAL TO QUOTE', async () => {
  // "Show me gloria" drew four cards at GBP 500 each and she said "Gloria
  // is owed 500 GBP for September 2026". She is owed 2,000. Nothing caught
  // it: 500 is a real figure off a real row, so checkFigures is happy, and
  // it is a FIGURE not a count, so checkCounts never looks.
  const saved = repo.searchFuzzy;
  repo.searchFuzzy = async () => ROWS.filter((r) => r.person_name === 'Ann');
  try {
    const out = await details.handler({ name: 'Ann', said: 'show me ann' });
    assert.match(out.summary, /THESE ARE 2 SEPARATE DEALS AND THIS TOOL DID NOT ADD THEM UP/);
    assert.match(out.summary, /call total_master_sheet and use ITS figure/);
    // The line that taught the shape has to be gone for the many-row case.
    assert.doesNotMatch(out.summary, /"owed 500 for August"/);
  } finally {
    repo.searchFuzzy = saved;
  }
});

test('and ONE deal still gets the plain wording', async () => {
  const saved = repo.searchFuzzy;
  repo.searchFuzzy = async () => ROWS.filter((r) => r.person_name === 'Cy');
  try {
    const out = await details.handler({ name: 'Cy', said: 'show me cy' });
    assert.doesNotMatch(out.summary, /SEPARATE DEALS/);
    assert.match(out.summary, /owed 500 for August/);
  } finally {
    repo.searchFuzzy = saved;
  }
});
