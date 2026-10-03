const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * Ids carried over from an earlier answer
 * ***************************************************
 *
 * THE INCIDENT. Asked for Zayn, she showed Zayn. Asked for Gloria, she
 * correctly said the name matched several people and asked which. Told
 * "show everything", she called get_master_sheet_row_details with ZAYN'S
 * IDS, still in her context, and narrated Zayn and Jim as Gloria's deals.
 *
 * The tool did warn. It warned in the summary and returned the cards
 * anyway, and the cards are what reach the screen. Prompting is not a
 * guard, so the guard is now the cards being withheld.
 */

const ROWS = {
  11: { id: 11, person_id: 'zayn', person_name: 'Zayn', company: 'Workforce', group_name: 'INDIGO', payable_amount: 3675, currency: 'AED' },
  12: { id: 12, person_id: 'zayn', person_name: 'Zayn', company: 'Workforce', group_name: 'MILKMAN', payable_amount: 3675, currency: 'AED' },
  13: { id: 13, person_id: 'jim', person_name: 'Jim', company: 'Relia PA', group_name: 'MILKMAN', payable_amount: 125, currency: 'GBP' },
  20: { id: 20, person_id: 'gloria', person_name: 'Gloria', company: 'Workforce', group_name: 'INDIGO', payable_amount: 500, currency: 'GBP' },
  21: { id: 21, person_id: 'gloria', person_name: 'Gloria', company: 'Workforce', group_name: 'MILKMAN', payable_amount: 500, currency: 'GBP' },
  // A SECOND, DIFFERENT Gloria. Same name, own person_id: the case a
  // name-keyed guard would wave through.
  22: { id: 22, person_id: 'gloria-nexus', person_name: 'Gloria', company: 'Gloria - Workforce', group_name: 'NEXUS', payable_amount: 500, currency: 'GBP' },
};

function load() {
  const toolPath = require.resolve('./masterSheet.js');
  const paths = {
    rowsRepo: require.resolve('../../repos/masterSheetRows.repo.js'),
    people: require.resolve('../../repos/people.repo.js'),
    companies: require.resolve('../../repos/companies.repo.js'),
    concerns: require.resolve('../../repos/concerns.repo.js'),
    settings: require.resolve('../../repos/settings.repo.js'),
    sockets: require.resolve('../../sockets/index.js'),
  };
  for (const p of [toolPath, ...Object.values(paths)]) delete require.cache[p];


  require.cache[paths.rowsRepo] = stub({
    async findById(id) { return ROWS[id] ?? null; },
    async searchFuzzy() { return [ROWS[20], ROWS[22]]; },
    async findAll() { return { rows: [], total: 0 }; },
  });
  require.cache[paths.people] = stub({ async rateMap() { return new Map(); } });
  require.cache[paths.companies] = stub({ async tierMap() { return new Map(); } });
  require.cache[paths.concerns] = stub({});
  require.cache[paths.settings] = stub({ async get() { return { color_uses_end_date: false }; } });
  require.cache[paths.sockets] = { id: 'x', filename: 'x', loaded: true, exports: { broadcast() {} } };

  const { masterSheetTools } = require(toolPath);
  return (n) => masterSheetTools.find((t) => t.name === n);
}

test('ids spanning several people SHOW NOTHING', async () => {
  const tool = load();
  const out = await tool('get_master_sheet_row_details').handler({ ids: [11, 12, 13] });

  assert.equal(out.cards, undefined, 'no cards may reach the screen');
  assert.match(out.summary, /NOTHING HAS BEEN SHOWN/);
  assert.match(out.summary, /3 DIFFERENT PEOPLE|2 DIFFERENT PEOPLE/);
});

test('it names them so she cannot describe them as somebody else', async () => {
  const tool = load();
  const out = await tool('get_master_sheet_row_details').handler({ ids: [11, 12, 13] });
  for (const name of ['Zayn', 'Jim']) assert.ok(out.summary.includes(name), name);
  assert.match(out.summary, /Do NOT describe these rows/);
});

test('one person, many rows, still shows every card', async () => {
  // The rule is about WHICH PERSON, never how many rows. Gloria on two
  // companies is two cards and no question at all.
  const tool = load();
  const out = await tool('get_master_sheet_row_details').handler({ ids: [20, 21] });
  assert.equal(out.cards.length, 2);
});

test('several people ON PURPOSE must name who the ids are expected to belong to', async () => {
  const tool = load();
  const out = await tool('get_master_sheet_row_details').handler({
    ids: [11, 12, 13], severalPeople: true, expectedPeople: ['Zayn', 'Jim'],
  });

  assert.equal(out.cards.length, 3);
  assert.match(out.summary, /DIFFERENT PEOPLE/, 'still says whose they are');
  assert.match(out.summary, /never add their figures together/i);
});

test('the disambiguation shows ALL matches through the same name lookup, never ids', async () => {
  const tool = load();
  const out = await tool('find_and_show_details').handler({ name: 'glorious' });

  assert.equal(out.cards, undefined, 'nothing shown until they pick');
  assert.match(out.summary, /allMatches true/);
  assert.doesNotMatch(out.summary, /get_master_sheet_row_details|20, 22/);

  const both = await tool('find_and_show_details').handler({
    name: 'glorious', allMatches: true, said: 'show me both',
  });
  assert.deepEqual(both.cards.map((card) => card.id), [22, 20]);
  assert.match(both.summary, /ONLY these 2 people/);
});

test('allMatches cannot show several people unless the admin actually said all or both', async () => {
  const tool = load();
  const out = await tool('find_and_show_details').handler({
    name: 'glorious', allMatches: true, said: 'show me Gloria details',
  });
  assert.equal(out.cards, undefined);
  assert.match(out.summary, /ask which ONE/);
});

test('severalPeople cannot turn unrelated remembered ids into the requested people', async () => {
  const tool = load();
  const out = await tool('get_master_sheet_row_details').handler({
    ids: [11, 12, 13], severalPeople: true, expectedPeople: ['Gloria', 'Gloria difference'],
  });
  assert.equal(out.cards, undefined);
  assert.match(out.summary, /NOTHING HAS BEEN SHOWN/);
});

test('the tool cannot be talked out of it: the flag is the only way', async () => {
  // A guard that a phrasing can bypass is the prompt again.
  const tool = load();
  for (const args of [{ ids: [11, 13] }, { ids: [11, 13], severalPeople: false }]) {
    const out = await tool('get_master_sheet_row_details').handler(args);
    assert.equal(out.cards, undefined, JSON.stringify(args));
  }
});
