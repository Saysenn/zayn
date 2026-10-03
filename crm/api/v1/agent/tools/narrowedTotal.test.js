const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const { masterSheetTools } = require('./masterSheet');
const { currentMonth } = require('../../shared/presetMonth.helper');

/**
 * ***************************************************
 * * A TOTAL NARROWS THE SAME WAY A LIST DOES
 * ***************************************************
 *
 * `filter_master_sheet` had seventeen ways to narrow and `total_master_sheet`
 * had two: a group and a month. So "what are we paying the cash people in
 * INDIGO" and "what is Nathan owed in cash" had no tool at all, and she does
 * not refuse when a filter is missing. She reaches for the nearest thing that
 * exists, and on a TOTAL that is money.
 *
 * ONE DEFINITION OF EACH FILTER, which is why the narrowing runs as the SQL
 * it already is rather than a second predicate written in JS. The list and
 * the figure cannot disagree about what "ended" or "cash" means.
 */

const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');
const MONTH = currentMonth();

const deal = (id, person, method, currency, amount) => ({
  id,
  person_id: person.toLowerCase().replace(/\s+/g, '-'),
  person_name: person,
  company: `Co ${id}`,
  group_name: 'INDIGO',
  currency,
  payment_method: method,
  payable_amount: amount,
  payable_days: 30,
  preset_on: `${MONTH}-01`,
  addon_percent: 0,
  fee_percent: 0,
});

const ROWS = [
  deal(1, 'Nathan', 'cash', 'GBP', 1000),
  deal(2, 'Nathan', 'cash', 'GBP', 300),
  deal(3, 'Nathan', 'bank', 'GBP', 700),
  deal(4, 'Priya', 'cash', 'AED', 500),
];

// The repo is the ONE definition of what a filter means, so the stub applies
// the filters rather than ignoring them. A stub that returned everything
// would let a broken intersection pass.
const matches = (r, f) => (!f.paymentMethod || r.payment_method === f.paymentMethod)
  && (!f.currency || r.currency === f.currency)
  && (!f.group || r.group_name === f.group);

const withRepos = (run) => {
  const saved = {
    findAll: repo.findAll, searchFuzzy: repo.searchFuzzy,
    rateMap: peopleRepo.rateMap, filterOptions: peopleRepo.filterOptions, get: settingsRepo.get,
  };
  repo.findAll = async (f = {}) => {
    const rows = ROWS.filter((r) => matches(r, f));
    return { rows, total: rows.length };
  };
  repo.searchFuzzy = async ({ q }) => {
    const want = String(q ?? '').toLowerCase();
    return ROWS.filter((r) => r.person_name.toLowerCase().includes(want));
  };
  peopleRepo.rateMap = async () => new Map();
  peopleRepo.filterOptions = async () => ({ groups: ['INDIGO'], companies: ROWS.map((r) => r.company) });
  settingsRepo.get = async () => ({ color_uses_end_date: false, crypto_percent: 0 });
  return run().finally(() => Object.assign(repo, saved) && Object.assign(peopleRepo, { rateMap: saved.rateMap, filterOptions: saved.filterOptions })
    && Object.assign(settingsRepo, { get: saved.get }));
};

test('ONE PERSON, NARROWED BY METHOD', async () => {
  await withRepos(async () => {
    const out = await total.handler({ person: 'Nathan', paymentMethod: 'cash', said: 'what is nathan owed in cash' });
    // 1000 + 300. The bank row is his and must not be in it.
    assert.deepEqual(out.total, { GBP: 1300 });
  });
});

test('and the WHOLE of him when nothing narrows it', async () => {
  await withRepos(async () => {
    const out = await total.handler({ person: 'Nathan', said: 'what is nathan owed' });
    assert.deepEqual(out.total, { GBP: 2000 });
  });
});

test('A NARROWED TOTAL SAYS IT IS NOT THE WHOLE TOTAL', async () => {
  // The figure is smaller than the person's real one. Without this she
  // reads it out as what they are owed.
  await withRepos(async () => {
    const out = await total.handler({ person: 'Nathan', paymentMethod: 'cash', said: 'nathan in cash' });
    assert.match(out.summary, /THIS IS NOT THEIR WHOLE TOTAL/);
    assert.match(out.summary, /1 row was left out/);
    assert.match(out.summary, /paid by cash/);
  });
});

test('and an UNNARROWED one does not', async () => {
  await withRepos(async () => {
    const out = await total.handler({ person: 'Nathan', said: 'what is nathan owed' });
    assert.doesNotMatch(out.summary, /THIS IS NOT THEIR WHOLE TOTAL/);
  });
});

test('SEVERAL PEOPLE NARROW TOO', async () => {
  await withRepos(async () => {
    const out = await total.handler({
      people: ['Nathan', 'Priya'], paymentMethod: 'cash', said: 'add nathan and priya, cash only',
    });
    assert.deepEqual(out.total, { GBP: 1300, AED: 500 });
  });
});

test('A FILTER THAT MATCHES NONE OF THEIR ROWS IS ZERO, and says why', async () => {
  await withRepos(async () => {
    const out = await total.handler({ person: 'Priya', paymentMethod: 'bank', said: 'priya by bank' });
    assert.deepEqual(out.total, {});
    assert.match(out.summary, /THIS IS NOT THEIR WHOLE TOTAL/);
  });
});

test('THE WHOLE SHEET NARROWS IN THE QUERY, not twice', async () => {
  let calls = 0;
  await withRepos(async () => {
    const real = repo.findAll;
    repo.findAll = async (f) => { calls += 1; return real(f); };
    const out = await total.handler({ paymentMethod: 'cash', said: 'what are we paying in cash' });
    assert.deepEqual(out.total, { GBP: 1300, AED: 500 });
    assert.equal(calls, 1, 'the no-person path narrowed twice, which is a second round trip');
  });
});

test('THE FILTERS GO TO THE REPO, never applied by hand here', async () => {
  // Two definitions of "cash" is how the list and the figure start
  // disagreeing. The SQL is the only one.
  let seen = null;
  await withRepos(async () => {
    const real = repo.findAll;
    repo.findAll = async (f) => { seen = f; return real(f); };
    await total.handler({ person: 'Nathan', paymentMethod: 'cash', currency: 'GBP', said: 'nathan cash gbp' });
  });
  assert.equal(seen.paymentMethod, 'cash');
  assert.equal(seen.currency, 'GBP');
});

// 2026-09-25: a company's total was headed "the whole sheet".
test('A TOTAL NARROWED TO A COMPANY IS NAMED FOR THE COMPANY', async () => {
  await withRepos(async () => {
    const out = await total.handler({ company: 'Co 1', said: 'what is the total for co 1 this month' });
    assert.match(out.summary, /^Co 1, /);
    assert.doesNotMatch(out.summary, /the whole sheet/);
  });
});

// 2026-09-28: a GROUP's total was headed "the whole sheet" too.
test('A TOTAL NARROWED TO A GROUP IS NAMED FOR THE GROUP', async () => {
  await withRepos(async () => {
    const out = await total.handler({ group: 'INDIGO', said: 'what is the total for indigo this month' });
    assert.match(out.summary, /^INDIGO, /);
    assert.doesNotMatch(out.summary, /the whole sheet/);
  });
});

test('and one narrowed by method says so rather than claiming the sheet', async () => {
  await withRepos(async () => {
    const out = await total.handler({ paymentMethod: 'cash', said: 'what do we pay in cash' });
    assert.match(out.summary, /^the whole sheet, paid by cash/);
  });
});

test('a company with other narrowing still LEADS the label', async () => {
  await withRepos(async () => {
    const out = await total.handler({ company: 'Co 1', presetWhen: 'current', said: 'total for co 1 this month' });
    assert.match(out.summary, /^Co 1, marked for this month/);
  });
});
