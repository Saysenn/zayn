const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWith } = require('../../testing/stubRepos');

/**
 * ***************************************************
 * * Diane changes MANY companies at once
 * ***************************************************
 *
 * `bulk_close_companies` is the widest write in the CRM: one call can stop
 * dozens of people being paid. Every guard on it is pinned here, and the
 * one that matters most is that the FIRST call writes nothing.
 */

const SUBJECT = require.resolve('./companies');
const COMPANIES = require.resolve('../../repos/companies.repo');
const HELPER = require.resolve('../../shared/companyStatus.helper');
// THE NEAR MISS LIST. Empty by default, which is "cannot tell": the resolver
// then reports an unknown name exactly as it always did.
const PEOPLE = require.resolve('../../repos/people.repo');

/** The repos, faked, plus a log of everything the tools asked them to do. */
function load({
  names = ['Northstar Care', 'Acqua', 'Relia PA'], deals = {}, sheet = [], statuses = {},
} = {}) {
  const wrote = [];
  const tools = loadWith(SUBJECT, {
    [PEOPLE]: { filterOptions: async () => ({ groups: [], companies: sheet }) },
    [COMPANIES]: {
      names: async () => names,
      findByKey: async (key) => (statuses[key] ? { name: key, status: statuses[key] } : null),
      update: async (key, fields) => { wrote.push({ update: key, fields }); return { name: key }; },
    },
    [HELPER]: {
      applyCompanyStatus: async (key, fields) => {
        wrote.push({ status: key, fields });
        // The real helper returns `resumed` on the way back to active and
        // `stopped` on the way out. A stub that always said `stopped` would
        // let a reopen reporting the wrong word pass.
        const moved = deals[key] ?? [];
        return {
          company: { name: key },
          deals: fields.status === 'active' ? { resumed: moved } : { stopped: moved },
        };
      },
      wouldStop: async (name) => ({
        count: (deals[name.toLowerCase()] ?? []).length,
        money: (deals[name.toLowerCase()] ?? []).length * 1000,
        currency: 'GBP',
      }),
      wouldResume: async (name) => ({
        count: (deals[name.toLowerCase()] ?? []).length,
        money: (deals[name.toLowerCase()] ?? []).length * 1000,
        currency: 'GBP',
      }),
    },
  });
  return { tools, wrote };
}

// ===============================
// * bulk_update_companies, which stops nothing
// ===============================

test('THE TIDY UP IS TWO CALLS, and the first writes nothing', async () => {
  const { tools, wrote } = load();
  const out = await tools.bulkUpdateCompanies.handler({
    companies: ['Northstar Care', 'Acqua'], tier: 'T2',
  });
  assert.equal(wrote.length, 0);
  assert.equal(out.pending, true);
  assert.match(out.summary, /2 companies/);
});

test('AND IT SAYS NOTHING STOPS, which is what survives', async () => {
  const { tools } = load();
  const out = await tools.bulkUpdateCompanies.handler({ companies: ['Acqua'], tier: 'T2' });
  assert.match(out.summary, /No deal stops/);
});

test('CONFIRMED, it writes each one through the same update the page uses', async () => {
  const { tools, wrote } = load();
  const out = await tools.bulkUpdateCompanies.handler({
    companies: ['Northstar Care', 'Acqua'], tier: 'T2', confirmed: true,
  });
  assert.deepEqual(wrote.map((w) => w.update), ['northstar care', 'acqua']);
  assert.deepEqual(wrote[0].fields, { tier: 'T2' });
  assert.match(out.reply, /Nothing stopped/);
});

test('AN EMPTY STRING CLEARS, and is not read as "not mentioned"', async () => {
  const { tools, wrote } = load();
  await tools.bulkUpdateCompanies.handler({ companies: ['Acqua'], oldGroup: '', confirmed: true });
  assert.deepEqual(wrote[0].fields, { oldGroup: '' });
});

test('IT CANNOT SET A STATUS. Ending them is the other tool', async () => {
  // Letting this one carry a status would put the widest write in the CRM
  // inside the tool whose description says it is a tidy up.
  const { tools } = load();
  assert.equal('status' in tools.bulkUpdateCompanies.parameters.properties, false);
});

test('NOTHING TO CHANGE ASKS, rather than writing', async () => {
  const { tools, wrote } = load();
  const out = await tools.bulkUpdateCompanies.handler({ companies: ['Acqua'], confirmed: true });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /Nothing to change/);
});

// ===============================
// * names she may not invent
// ===============================

test('A COMPANY THAT DOES NOT EXIST IS REPORTED, never quietly skipped', async () => {
  // "I updated 5 of 6" with no word about the sixth is the shape of answer
  // that hides a typo in somebody's pay.
  const { tools, wrote } = load();
  const out = await tools.bulkUpdateCompanies.handler({
    companies: ['Acqua', 'Nowhere Ltd'], tier: 'T2', confirmed: true,
  });
  assert.deepEqual(wrote.map((w) => w.update), ['acqua']);
  assert.match(out.reply, /No company called "nowhere ltd"/);
});

test('NONE OF THEM EXISTING WRITES NOTHING AT ALL', async () => {
  const { tools, wrote } = load();
  const out = await tools.bulkUpdateCompanies.handler({
    companies: ['Nowhere Ltd'], tier: 'T2', confirmed: true,
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /do not report anything as done/);
});

test('A NAME IS MATCHED ON ITS FOLDED SPELLING', async () => {
  // "Relia PA" and "relia  pa" are one company, and both spellings are in
  // the live sheet.
  const { tools, wrote } = load();
  await tools.bulkUpdateCompanies.handler({
    companies: ['relia  pa'], tier: 'T2', confirmed: true,
  });
  assert.deepEqual(wrote.map((w) => w.update), ['relia pa']);
});

test('TOO MANY IS REFUSED, not silently capped', async () => {
  const many = Array.from({ length: 40 }, (_, i) => `Co ${i}`);
  const { tools, wrote } = load({ names: many });
  const out = await tools.bulkUpdateCompanies.handler({
    companies: many, tier: 'T2', confirmed: true,
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /40 companies/);
  assert.match(out.summary, /narrow it/);
});

// ===============================
// * bulk_close_companies, which ends them
// ===============================

test('THE FIRST CALL WRITES NOTHING, and says the DEALS and the MONEY', async () => {
  // A bulk close that only reports afterwards is a number nobody could
  // have checked.
  const { tools, wrote } = load({ deals: { 'northstar care': [1, 2, 3], acqua: [4] } });
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Northstar Care', 'Acqua'], status: 'closed',
  });
  assert.equal(wrote.length, 0);
  assert.equal(out.pending, true);
  assert.match(out.summary, /2 companies/);
  assert.match(out.summary, /STOP 4 live deals/);
  assert.match(out.summary, /4,000\.00 a month/);
});

test('AND IT SAYS WHAT SURVIVES', async () => {
  const { tools } = load({ deals: { acqua: [1] } });
  const out = await tools.bulkCloseCompanies.handler({ companies: ['Acqua'], status: 'closed' });
  assert.match(out.summary, /kept and moves to the Archive/);
  assert.match(out.summary, /already paid are untouched/);
  assert.match(out.summary, /back to active brings its deals back/);
});

test('CONFIRMED, it goes through the SHARED cascade', async () => {
  // Calling the repo directly is how her closes stopped nothing while the
  // page's stopped everybody.
  const { tools, wrote } = load({ deals: { acqua: [1, 2] } });
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Acqua'], status: 'closed', confirmed: true,
  });
  assert.deepEqual(wrote.map((w) => w.status), ['acqua']);
  assert.match(out.reply, /2 deals stopped and moved to the Archive/);
});

test('DISSOLVED IS OFFERED, because it is a different FACT', async () => {
  const { tools, wrote } = load({ deals: { acqua: [1] } });
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Acqua'], status: 'dissolved', confirmed: true,
  });
  assert.equal(wrote[0].fields.status, 'dissolved');
  assert.match(out.reply, /dissolved/);
});

test('LIQUIDATION IS REFUSED. It is not an ending', async () => {
  // It keeps paying, at amounts set per deal on a panel. Treating it as an
  // ending would stop everybody on a company that is still being paid.
  const { tools, wrote } = load();
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Acqua'], status: 'liquidation', confirmed: true,
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /not an ending/);
  assert.match(out.summary, /keeps paying/);
  assert.equal('liquidation' in tools.bulkCloseCompanies.parameters.properties.status.enum, false);
});

// ===============================
// * AND THE UNDO, one act rather than twenty five
// ===============================
// Reopening was one company per call while closing took twenty five, so
// undoing a mistake cost twenty five confirmations.

test('REOPENING IS TWO CALLS TOO, and says how many come BACK', async () => {
  const { tools, wrote } = load({ deals: { 'northstar care': [1, 2, 3], acqua: [4] } });
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Northstar Care', 'Acqua'], status: 'active',
  });
  assert.equal(wrote.length, 0);
  assert.equal(out.pending, true);
  assert.match(out.summary, /PUT BACK 4 deals/);
  assert.match(out.summary, /4,000\.00 a month/);
});

test('AND IT SAYS WHAT DOES NOT COME BACK', async () => {
  // Only what the closure stopped. A deal stopped by hand was its own
  // decision, and promising it back would be an undelete, not a reopen.
  const { tools } = load({ deals: { acqua: [1] } });
  const out = await tools.bulkCloseCompanies.handler({ companies: ['Acqua'], status: 'active' });
  assert.match(out.summary, /Only the deals their closure stopped/);
  assert.match(out.summary, /stopped by hand, or by a monthly review, stays in the Archive/);
});

test('CONFIRMED, it reopens through the same shared cascade', async () => {
  const { tools, wrote } = load({ deals: { acqua: [1, 2] } });
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Acqua'], status: 'active', confirmed: true,
  });
  assert.deepEqual(wrote.map((w) => w.status), ['acqua']);
  assert.equal(wrote[0].fields.status, 'active');
  assert.match(out.reply, /2 deals back on the master sheet/);
});

test('A REOPEN NEVER REPORTS ITSELF AS A CLOSURE', async () => {
  // The count came off `deals.stopped` for both directions once, so a
  // reopen said "0 deals stopped and moved to the Archive".
  const { tools } = load({ deals: { acqua: [1, 2] } });
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Acqua'], status: 'active', confirmed: true,
  });
  assert.doesNotMatch(out.reply, /Archive/);
  assert.doesNotMatch(out.reply, /stopped/);
});

test('TOO MANY IS REFUSED HERE TOO', async () => {
  const many = Array.from({ length: 40 }, (_, i) => `Co ${i}`);
  const { tools, wrote } = load({ names: many });
  const out = await tools.bulkCloseCompanies.handler({
    companies: many, status: 'closed', confirmed: true,
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /narrow it/);
});

test('THREE TOOLS, and only one of them can end anything', () => {
  const { tools } = load();
  assert.deepEqual(
    tools.companyTools.map((t) => t.name),
    ['bulk_update_companies', 'bulk_close_companies', 'list_companies'],
  );
  // BOTH WRITES take the two call shape: each reaches many rows. The
  // listing is read only and must NOT ask for a confirmation, or people
  // learn to click through one that means nothing.
  for (const t of [tools.bulkUpdateCompanies, tools.bulkCloseCompanies]) {
    assert.ok('confirmed' in t.parameters.properties, t.name);
  }
  assert.equal('confirmed' in tools.listCompanies.parameters.properties, false);
  // The two endings, and the one way back. Liquidation is in neither: it
  // stops nothing and its amounts are set per deal on one screen.
  // And the two marks that stop nothing, added 2026-09-30.
  assert.deepEqual(
    tools.bulkCloseCompanies.parameters.properties.status.enum,
    ['closed', 'dissolved', 'active', 'going_concern', 'review'],
  );
});

// ===============================
// * list_companies. READ ONLY, and it NAMES them
// ===============================
// "Which companies are in liquidation" reached filter_master_sheet, found
// no rows and answered "no deals are on companies in liquidation", which is
// a different sentence: it leaves open whether such companies exist. Asked
// three ways, she never named a company, because that tool counts deals.

const COMPANIES_REPO = require.resolve('../../repos/companies.repo');

function loadList({ rows = [] } = {}) {
  const asked = [];
  const tools = loadWith(SUBJECT, {
    [PEOPLE]: { filterOptions: async () => ({ groups: [], companies: [] }) },
    [COMPANIES_REPO]: {
      COMPANY_STATUS: {
        ACTIVE: 'active', LIQUIDATION: 'liquidation', DISSOLVED: 'dissolved', CLOSED: 'closed',
      },
      names: async () => [],
      findAll: async (args) => { asked.push(args); return { rows, total: rows.length }; },
    },
    [HELPER]: { applyCompanyStatus: async () => ({}), wouldStop: async () => ({}), wouldResume: async () => ({}) },
  });
  return { tools, asked };
}

const winding = {
  ckey: 'acqua', name: 'Acqua', status: 'liquidation', groups: ['ALPHA'],
  deal_count: 3, handler_count: 2, liquidation_total: 1250,
};

test('it NAMES the companies, with who is on them', async () => {
  const { tools } = loadList({ rows: [winding] });
  const out = await tools.listCompanies.handler({ status: ['liquidation'] });

  assert.match(out.summary, /Acqua/);
  assert.match(out.summary, /3 deals/);
  assert.match(out.summary, /2 handlers/);
  assert.deepEqual(out.companies, [{ name: 'Acqua', status: 'liquidation', deals: 3, handlers: 2 }]);
});

test('AND SAYS LIQUIDATION IS STILL BEING PAID', async () => {
  // A list under that heading otherwise reads as companies that have
  // stopped, and that is money nobody chases.
  const { tools } = loadList({ rows: [winding] });
  const out = await tools.listCompanies.handler({ status: ['liquidation'] });
  assert.match(out.summary, /STILL BEING PAID/);
  assert.match(out.summary, /still being paid/);
});

test('the settlement is read back where there is one', async () => {
  const { tools } = loadList({ rows: [winding] });
  const out = await tools.listCompanies.handler({ status: ['liquidation'] });
  assert.match(out.summary, /settlement 1,250\.00/);
});

test('a group narrows it, and the sentence says so', async () => {
  const { tools, asked } = loadList({ rows: [] });
  const out = await tools.listCompanies.handler({ status: ['liquidation'], group: 'ALPHA' });
  assert.equal(asked[0].group, 'ALPHA');
  assert.equal(out.reply, 'No company in ALPHA is in liquidation.');
});

// "No company is liquidation" was the sentence. These are nouns, and only
// two of the four read as adjectives.
test('nothing found reads as English', async () => {
  const { tools } = loadList({ rows: [] });
  const out = await tools.listCompanies.handler({ status: ['liquidation'] });
  assert.equal(out.reply, 'No company is in liquidation.');

  const closed = await tools.listCompanies.handler({ status: ['closed'] });
  assert.equal(closed.reply, 'No company is closed.');
});

test('one company asked about by name, and it does not exist', async () => {
  const { tools, asked } = loadList({ rows: [] });
  const out = await tools.listCompanies.handler({ name: 'Nowhere Ltd' });
  assert.equal(asked[0].q, 'Nowhere Ltd');
  assert.match(out.reply, /no company called "Nowhere Ltd"/);
});

test('several statuses are one answer, never one company twice', async () => {
  // The repo takes ONE status, so several is several reads. A company has
  // one status, so it cannot legitimately appear in two of them.
  const { tools, asked } = loadList({ rows: [winding] });
  const out = await tools.listCompanies.handler({ status: ['liquidation', 'closed'] });
  assert.deepEqual(asked.map((a) => a.status), ['liquidation', 'closed']);
  assert.equal(out.companies.length, 1);
});

// 2026-09-28: "undo the tier change" came here and proposed clearing the tier, a
// guessed old value. An undo is the undo tool's, on the "yes" as well.
test('AN UNDO IS REFUSED HERE, and sent to the undo tool', async () => {
  const { tools, wrote } = load();
  const out = await tools.bulkUpdateCompanies.handler({ companies: ['Acqua'], tier: '', said: 'undo the tier change on Acqua' });
  assert.match(out.summary, /Call undo_master_sheet_change/);
  const yes = await tools.bulkUpdateCompanies.handler({
    companies: ['Acqua'], tier: '', confirmed: true, said: 'yes', saidRecent: 'undo the tier change on Acqua yes',
  });
  assert.match(yes.summary, /Call undo_master_sheet_change/);
  assert.equal(wrote.length, 0);
  // A plain set is untouched by it.
  const set = await tools.bulkUpdateCompanies.handler({ companies: ['Acqua'], tier: 'T2', said: 'set the tier of Acqua to T2' });
  assert.equal(set.pending, true);
});

// 2026-09-28: it wrote and told no page, so the runtime read "done" as a false claim.
test('A WRITE TELLS THE PAGES, which is how the runtime knows it wrote', async () => {
  const { watchWrites } = require('../../shared/writeTap.helper');
  const { tools } = load();
  const { wrote } = await watchWrites(() => tools.bulkUpdateCompanies.handler({ companies: ['Acqua'], tier: 'T2', confirmed: true }));
  assert.equal(wrote, true);
});

// 2026-09-28: asked the tier, she said "not set" off a line that never carried one.
test('THE LIST SAYS THE TIER EITHER WAY', async () => {
  const { tools } = loadList({ rows: [{ ...winding, tier: 'T3', old_group: 'Milky' }, { ...winding, ckey: 'b', name: 'B' }] });
  const out = await tools.listCompanies.handler({});
  assert.match(out.summary, /Acqua \(ALPHA\): liquidation, tier T3, old group Milky/);
  assert.match(out.summary, /B \(ALPHA\): liquidation, no tier,/);
});

// ===============================
// * 2026-09-30, the admin's audit of the company tools
// ===============================

test('A TYPO IN A BULK ACT GETS "DID YOU MEAN", and writes nothing at all', async () => {
  const { tools, wrote } = load({ sheet: ['Northstar Care', 'Acqua', 'Relia PA'] });
  const out = await tools.bulkCloseCompanies.handler({
    companies: ['Acqa', 'Northstar Care'], status: 'closed', confirmed: true, said: 'close Acqa and Northstar Care',
  });
  assert.equal(wrote.length, 0);
  assert.match(out.summary, /NOTHING HAS BEEN CHANGED/);
  assert.match(out.summary, /closest is "Acqua"/);
});

test('MONTHLY REVIEW IS ONE BULK CALL, previewed, and stops nothing', async () => {
  const { tools, wrote } = load({ deals: { acqua: [1, 2] } });
  const first = await tools.bulkCloseCompanies.handler({ companies: ['Acqua', 'Relia PA'], status: 'review' });
  assert.equal(wrote.length, 0);
  assert.equal(first.pending, true);
  assert.match(first.summary, /mark them under monthly review/);
  assert.match(first.summary, /No deal stops/);
  assert.doesNotMatch(first.summary, /STOP d/);

  const done = await tools.bulkCloseCompanies.handler({ companies: ['Acqua'], status: 'review', confirmed: true });
  assert.equal(wrote[0].fields.status, 'review');
  assert.match(done.reply, /No deal stopped/);
  assert.match(done.reply, /No deal was ticked for the monthly review/);
});

test('A MARK ON A CLOSED COMPANY SAYS WHAT COMES BACK', async () => {
  const { tools } = load({ deals: { acqua: [1, 2] }, statuses: { acqua: 'closed' } });
  const out = await tools.bulkCloseCompanies.handler({ companies: ['Acqua'], status: 'going_concern' });
  assert.match(out.summary, /PUTS BACK 2 deals/);
});

test('THE LIST IS DRAWN, one row per company, linked by its page key', async () => {
  const { tools } = loadList({
    rows: [{ ...winding, ckey: 'acqua ltd', name: 'Acqua Ltd', tier: 'T2', monthly_totals: { GBP: 1200, AED: 500 } }],
  });
  const out = await tools.listCompanies.handler({ status: ['liquidation'] });
  assert.equal(out.list.kind, 'companies');
  assert.deepEqual(out.list.rows[0], {
    id: 'Acqua Ltd',
    name: 'Acqua Ltd',
    status: 'liquidation',
    statusLabel: 'Liquidation',
    groups: 'ALPHA',
    dealsText: '3 deals, 2 handlers',
    amount: 'GBP 1,200.00 and AED 500.00',
    tier: 'T2',
    oldGroup: '',
    href: '/companies/acqua%20ltd',
  });
  assert.match(out.summary, /ALREADY LISTED ON SCREEN/);
});

test('NOTHING FOUND DRAWS NOTHING', async () => {
  const { tools } = loadList({ rows: [] });
  const out = await tools.listCompanies.handler({ status: ['review'] });
  assert.equal(out.list, undefined);
  assert.equal(out.reply, 'No company is under monthly review.');
});
