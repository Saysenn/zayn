const test = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../../repos/masterSheetRows.repo');
const peopleRepo = require('../../repos/people.repo');
const settingsRepo = require('../../repos/settings.repo');
const { masterSheetTools } = require('./masterSheet');

// 2026-09-25. "what are the rates on everyone at ZZ Rate Co B" was sent with
// the company as a GROUP, and three real people came back "nobody matches".

const checkRates = masterSheetTools.find((t) => t.name === 'check_rates');

const deal = (id, person, company) => ({
  id, person_id: person.toLowerCase(), person_name: person, company, group_name: 'ALPHA',
  currency: 'GBP', payable_amount: 1000, monthly_amount: 1000, addon_percent: 0, fee_percent: 0,
});
const ROWS = [deal(1, 'Orla Quennell', 'Rate Co B'), deal(2, 'Dov Ashgrove', 'Rate Co B'), deal(3, 'Ines Pardew', 'Rate Co A')];
const fold = (s) => String(s ?? '').toLowerCase();

const withRepos = (run) => {
  const saved = {
    findAll: repo.findAll, searchFuzzy: repo.searchFuzzy, filterOptions: peopleRepo.filterOptions,
    rateMap: peopleRepo.rateMap, get: settingsRepo.get,
  };
  repo.findAll = async (f = {}) => {
    const rows = ROWS.filter((r) => (!f.company || fold(r.company) === fold(f.company))
      && (!f.group || fold(r.group_name) === fold(f.group)));
    return { rows, total: rows.length };
  };
  repo.searchFuzzy = async ({ q, group }) => ROWS.filter((r) => fold(r.person_name).includes(fold(q))
    && (!group || fold(r.group_name) === fold(group)));
  peopleRepo.filterOptions = async () => ({ groups: ['ALPHA'], companies: ['Rate Co A', 'Rate Co B'] });
  peopleRepo.rateMap = async () => new Map([['dov ashgrove', { addon: 0, fee: 2 }]]);
  settingsRepo.get = async () => ({ crypto_percent: 1 });
  return run().finally(() => {
    Object.assign(repo, { findAll: saved.findAll, searchFuzzy: saved.searchFuzzy });
    Object.assign(peopleRepo, { filterOptions: saved.filterOptions, rateMap: saved.rateMap });
    Object.assign(settingsRepo, { get: saved.get });
  });
};

test('EVERYONE ON A COMPANY is answered person by person', async () => {
  await withRepos(async () => {
    const out = await checkRates.handler({ company: 'Rate Co B', said: 'rates at rate co b' });
    assert.match(out.summary, /===== Orla Quennell =====/);
    assert.match(out.summary, /===== Dov Ashgrove =====/);
    assert.doesNotMatch(out.summary, /Ines Pardew/);
  });
});

test('A COMPANY SENT AS A GROUP is re-homed, never "nobody matches"', async () => {
  await withRepos(async () => {
    const out = await checkRates.handler({ group: 'Rate Co B', said: 'rates on everyone at rate co b' });
    assert.match(out.summary, /Dov Ashgrove/);
    assert.doesNotMatch(out.summary, /Nobody matches/);
  });
});

test('a real group is still a group', async () => {
  await withRepos(async () => {
    const out = await checkRates.handler({ group: 'ALPHA', said: 'crypto rate in alpha' });
    assert.match(out.summary, /Nothing in ALPHA is paid in coin/);
  });
});

// "is dov ashgrove on a 5% fee?" drew his cards and said "the full details
// are on screen": no answer at all. A rate question is answered by rates.
test('A RATE QUESTION THROUGH THE DETAILS TOOL GETS THE RATES', async () => {
  const details = masterSheetTools.find((t) => t.name === 'find_and_show_details');
  await withRepos(async () => {
    const out = await details.handler({ person: 'Dov Ashgrove', said: 'is dov ashgrove on a 5% fee?' });
    assert.equal(out.cards, undefined, 'cards drawn for a yes or no question');
    assert.match(out.summary, /2% fee/);
  });
});

test('and "show me his details and fee" still draws the card', async () => {
  const details = masterSheetTools.find((t) => t.name === 'find_and_show_details');
  await withRepos(async () => {
    const out = await details.handler({ person: 'Dov Ashgrove', said: 'show me dov ashgrove details and fee' });
    assert.ok(out.cards?.length > 0 || out.reply);
    assert.doesNotMatch(out.summary, /PROFILE, which applies/);
  });
});

// "total for ZZ Rate Co B" sent as a group came back "no such group", and
// the retry answered with another person's total.
test('A TOTAL FOR A COMPANY SENT AS A GROUP is the company\'s total', async () => {
  const total = masterSheetTools.find((t) => t.name === 'total_master_sheet');
  await withRepos(async () => {
    const out = await total.handler({ group: 'Rate Co B', said: 'what is the total for rate co b this month?' });
    assert.match(out.summary, /^Rate Co B, /);
    assert.doesNotMatch(out.summary, /NO GROUP/);
  });
});

test('ON ONE COMPANY each person is answered for that company\'s deals only', async () => {
  ROWS.push(deal(4, 'Orla Quennell', 'Rate Co A'));
  try {
    await withRepos(async () => {
      const out = await checkRates.handler({ company: 'Rate Co B', said: 'rates at rate co b' });
      assert.match(out.summary, /===== Orla Quennell =====\nThey hold 1 deal/);
    });
  } finally { ROWS.pop(); }
});

// "Is Dov on a 5% fee?" is a yes or no: the tool works it out and says it first.
test('A YES OR NO ABOUT A RATE OPENS WITH THE VERDICT', async () => {
  await withRepos(async () => {
    const out = await checkRates.handler({ person: 'Dov Ashgrove', said: 'is dov ashgrove on a 5% fee?' });
    assert.match(out.summary, /^OPEN YOUR ANSWER WITH THIS SENTENCE, word for word: "No\. Dov Ashgrove is on 2% fee, not 5%\."/);
    assert.equal(out.verdict.word, 'No');
    // Her "not 5%" is in the tool's own text, so the percent guard allows it.
    const { checkPercents } = require('../checkPercents');
    assert.equal(checkPercents('No. Dov Ashgrove is on 2% fee, not 5%.', [out]).ok, true);
  });
});

test('every person on a company gets their own verdict', async () => {
  await withRepos(async () => {
    const out = await checkRates.handler({ company: 'Rate Co B', said: 'are they on a 2% fee at rate co b?' });
    assert.match(out.summary, /"No\. Orla Quennell at Rate Co B is on 0% fee, not 2%\."/);
    assert.match(out.summary, /"Yes\. Dov Ashgrove at Rate Co B is on 2% fee\."/);
  });
});

test('an ordinary rates question has no verdict', async () => {
  await withRepos(async () => {
    const out = await checkRates.handler({ person: 'Dov Ashgrove', said: 'what is dov on?' });
    assert.equal(out.verdict, null);
    assert.doesNotMatch(out.summary, /OPEN YOUR ANSWER/);
  });
});

test('narrowed to a company, the verdict names it', async () => {
  await withRepos(async () => {
    const out = await checkRates.handler({ person: 'Dov Ashgrove', company: 'Rate Co B', said: 'is dov on a 2% fee?' });
    assert.match(out.verdict.line, /^Yes\. Dov Ashgrove at Rate Co B is on 2% fee\.$/);
  });
});

test('A BULK CHANGE FOR A COMPANY SENT AS A GROUP reaches that company', async () => {
  const bulk = masterSheetTools.find((t) => t.name === 'bulk_update_master_sheet');
  await withRepos(async () => {
    const out = await bulk.handler({ group: 'Rate Co B', set: { feePercent: 1 }, said: 'give everyone at rate co b a 1% fee' });
    assert.match(out.summary, /on 2 rows/);
    assert.match(out.summary, /Dov Ashgrove/);
  });
});
