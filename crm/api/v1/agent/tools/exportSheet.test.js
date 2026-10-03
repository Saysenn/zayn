const test = require('node:test');
const assert = require('node:assert/strict');
const { stub } = require('../../testing/stubRepos');
const { currentMonth } = require('../../shared/presetMonth.helper');

// RELATIVE, never a literal. A month far from the business month with no
// year in `said` is now treated as a guess and dropped.
const MONTH = currentMonth();
const NEARBY = (() => { const [y,m]=MONTH.split('-').map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`; })();

/**
 * ***************************************************
 * * She hands over the LINK, and it says what is in it
 * ***************************************************
 *
 * The three ways this goes wrong, one describe block each:
 *   1. she invents a filter        -> a sheet quietly missing rows
 *   2. she hands the wrong shape   -> a bank run when they asked for cash
 *   3. the count and the file part -> a file whose description is wrong
 */

const ROWS = [
  {
    id: 1, person_id: 'gloria', person_name: 'Gloria', company: 'A J Rayson', group_name: 'NEXUS',
    role_label: 'Closer', payable_amount: 500, currency: 'GBP', payment_method: 'bank',
    monthly_amount: 500, payable_days: 31, preset_on: `${MONTH}-01`, payment_start_on: '2025-04-01',
  },
  {
    id: 2, person_id: 'gloria-diff', person_name: 'Gloria difference', company: 'Workforce',
    group_name: 'ALL GROUPS', role_label: 'Differnce', payable_amount: 150, currency: 'AED',
    payment_method: 'cash', monthly_amount: 150, payable_days: 31, preset_on: `${MONTH}-01`,
  },
  {
    id: 3, person_id: 'byron', person_name: 'Byron', company: 'Acqua resourcing', group_name: 'INDIGO',
    role_label: 'Mid 1', payable_amount: 700, currency: 'GBP', payment_method: 'cash',
    monthly_amount: 700, payable_days: 31, preset_on: `${MONTH}-01`, payment_start_on: '2026-07-19',
  },
  {
    id: 4, person_id: 'jakov', person_name: 'Jakov', company: 'Workforce', group_name: 'ALL GROUPS',
    role_label: 'Holding', payable_amount: 700, currency: 'EURO', payment_method: 'crypto',
    monthly_amount: 700, payable_days: 31, preset_on: `${MONTH}-01`,
  },
];

function load({ rows = ROWS } = {}) {
  const toolPath = require.resolve('./exportSheet.js');
  const paths = {
    rowsRepo: require.resolve('../../repos/masterSheetRows.repo.js'),
    settings: require.resolve('../../repos/settings.repo.js'),
    people: require.resolve('../../repos/people.repo.js'),
    exportQuery: require.resolve('../../masterSheet/exportQuery.js'),
    draft: require.resolve('../exportDraft.js'),
  };
  for (const p of [toolPath, ...Object.values(paths)]) delete require.cache[p];

  require.cache[paths.rowsRepo] = stub({
    async findAllRows() { return rows; },
    async searchFuzzy({ q }) {
      const needle = String(q).toLowerCase();
      return rows.filter((r) => String(r.person_name).toLowerCase().includes(needle));
    },
  });
  require.cache[paths.settings] = stub({
    async get() { return { color_uses_end_date: false }; },
  });
  // The group/company check reads these. Unstubbed it reached for a real
  // Postgres connection and the whole suite hung rather than failing.
  require.cache[paths.people] = stub({
    async filterOptions() {
      return {
        groups: [...new Set(rows.map((r) => r.group_name))],
        companies: [...new Set(rows.map((r) => r.company))],
      };
    },
  });

  return require(toolPath);
}

const call = (args) => load().exportSheet.handler(args);

/* ===============================
 * * It opens a panel, it does not export
 * =============================== */

test('THE WHOLE CARD COMES BACK IN ONE CALL', async () => {
  // It was a live panel that fetched its own lists and re-counted on every
  // tick. Everything the card draws now arrives here, so nothing can change
  // underneath the reader and nothing can disagree with the file.
  const out = await call({ template: 'cash', groups: ['INDIGO'] });
  const s = out.exportSession;

  assert.ok(s, 'no card came back');
  assert.equal(s.draft.template, 'cash');
  assert.deepEqual(s.draft.groups, ['INDIGO']);
  assert.equal(s.preview.rows, 1, 'one INDIGO cash row');
  assert.match(s.link, /^\/api\/v1\/export\/xlsx\?/);

  // The card's own three: the columns with the document's headers, the
  // preview rows, and the filename.
  assert.ok(s.columns.length > 0 && s.columns[0].header, 'no headers to draw');
  assert.ok(Array.isArray(s.rows), 'no preview rows');
  assert.ok(s.fileName.endsWith('.xlsx'));
});

test('the preview is FIVE rows at most, and only the shown columns', async () => {
  const s = (await call({ template: 'bank' })).exportSession;
  assert.ok(s.rows.length <= 5);
  if (s.rows.length) {
    const shown = new Set(s.columns.map((c) => c.key));
    for (const key of Object.keys(s.rows[0])) {
      assert.ok(shown.has(key), `${key} is in the preview but not in the file`);
    }
  }
});

test('IT BUILDS NOTHING. The panel is the answer to "give me a sheet"', async () => {
  const out = await call({});
  assert.ok(out.exportSession, 'it must still open, unfiltered');
  assert.equal(out.exportSession.build, false, 'it built on the first call');
  // Six defaults were chosen for them and they have seen none of them.
  assert.match(out.summary, /CARD IS ON THEIR SCREEN/);
  // Step one now: it asks WHICH SHAPE before anything else, in one short
  // question, without reciting the eight shapes sitting under it as buttons.
  assert.match(out.summary, /ASK WHICH SHAPE/);
  assert.match(out.summary, /do NOT list them/);
  assert.match(out.summary, /Step 1 of/);
});

test('STEP ONE HAS ONLY THE OFFICIAL DIANE SHEETS', async () => {
  const templates = (await call({})).exportSession.options.templates;

  assert.deepEqual(
    templates.map((template) => template.id),
    ['master-sheet', 'monthly-sheet', 'bank', 'cash', 'expensing', 'division-sheet'],
  );
  assert.deepEqual(
    templates.filter((template) => template.disabled).map((template) => ({
      id: template.id,
      availability: template.availability,
    })),
    [{ id: 'division-sheet', availability: 'Coming soon' }],
  );
  assert.ok(!templates.some((template) => ['breakdown', 'bank-details'].includes(template.id)));
});

test('DIANE CANNOT SELECT HIDDEN OR COMING SOON SHEETS', () => {
  const choices = load().exportSheet.parameters.properties.template.enum;
  assert.deepEqual(choices, ['master-sheet', 'monthly-sheet', 'bank', 'cash', 'expensing']);
});

test('it tells her NOT to read the card back', async () => {
  // Everything is on screen. Reading it out is the modal's job done worse.
  const out = await call({ template: 'bank' });
  assert.match(out.summary, /do NOT read the card back/i);
  assert.match(out.summary, /KEEP IT SHORT/);
});

/* ===============================
 * * 1. She cannot invent a filter
 * =============================== */

test('A SHEET IS BY GROUP. A hand picked set of people is REFUSED', async () => {
  /**
   * The capability was removed on purpose, for two reasons.
   *
   * THE AND TRAP: `applyFilters` intersects group and personId, so
   * "everyone in INDIGO plus Gloria from MILKMAN" matched nothing. One
   * question with two ways to answer it, and one of those quietly handed
   * over an empty file.
   *
   * AND THE GUESSWORK: every name went through `resolvePerson`, which can
   * refuse, ask which Gloria, or be handed a name she had shortened. A
   * group is a closed list: picked, never resolved.
   */
  const out = await call({ template: 'bank', people: ['Gloria', 'Byron'] });

  assert.equal(out.exportSession, undefined, 'it built a sheet by person');
  assert.match(out.summary, /A SHEET IS BY GROUP/);
  assert.match(out.summary, /ask which group/i, 'a refusal with no way forward is a dead end');
});

test('the query can no longer carry a person at all', async () => {
  // Guards the guard: refusing the argument is not the same as the filter
  // being gone. `personId` must not reach the export route by any path.
  const { query } = (await call({ template: 'bank', groups: ['NEXUS'], said: 'nexus' })).exportSession;
  assert.ok(!('personId' in query), 'a person filter is still reaching the file');
});

test('A GROUP NOBODY ASKED FOR IS DROPPED, not exported', async () => {
  // Live transcript. Told "carry on" she called this with groups INDIGO,
  // which nobody had mentioned, and the card narrowed from 21 rows to 9.
  // A sheet quietly missing twelve rows looks exactly like one that never
  // had them.
  const out = await call({ template: 'bank', groups: ['INDIGO'], said: 'carry on' });

  assert.deepEqual(out.exportSession.draft.groups, [], 'it kept the invented group');
  assert.match(out.summary, /IGNORED the group INDIGO/, 'a silent drop is its own bug');
});

test('a group they DID say is kept, and so is one already on the card', async () => {
  // Guards the guard. Without this the fix would refuse every group and
  // no filtered export could ever be built.
  // NEXUS, because that is where the fixture's bank row is. A group with
  // no matching rows gives no card at all, which would have tested the
  // empty path rather than the guard.
  const said = await call({ template: 'bank', groups: ['NEXUS'], said: 'the bank sheet for nexus' });
  assert.deepEqual(said.exportSession.draft.groups, ['NEXUS']);

  // Already chosen, so a later turn about something else keeps it.
  const carried = await call({
    template: 'bank',
    groups: ['NEXUS'],
    said: 'make it blue',
    open: { template: 'bank', groups: ['NEXUS'] },
  });
  assert.deepEqual(carried.exportSession.draft.groups, ['NEXUS']);
});

test('nothing the admin did not say reaches the query', async () => {
  const { query } = (await call({ template: 'cash' })).exportSession;
  for (const invented of ['group', 'personId', 'company', 'currency', 'status', 'needsReview']) {
    assert.ok(!(invented in query), `it invented ${invented}`);
  }
});

/* ===============================
 * * 2. The right shape
 * =============================== */

test('the PRESET is derived from the template, never asked twice', async () => {
  for (const [template, preset] of [['cash', 'cash'], ['bank', 'bank'], ['expensing', 'expensing']]) {
    // eslint-disable-next-line no-await-in-loop
    const out = await call({ template });
    assert.equal(out.exportSession.draft.preset, preset, `${template} took the wrong rows`);
  }
});

test('CRYPTO IS THE BANK SHAPE FILTERED, not a template', async () => {
  const { draft, query, preview } = (await call({ template: 'bank', method: 'crypto' })).exportSession;
  assert.equal(draft.template, 'bank', 'the bank COLUMNS are the point');
  assert.equal(query.method, 'crypto');
  // TWO METHOD FILTERS CANCEL OUT. The bank template derives the bank
  // preset, which filters to payment_method = bank, so this matched
  // NOTHING until the explicit method was made to win.
  assert.equal(draft.preset, 'expensing', 'the preset must step back');
  assert.equal(preview.rows, 1, 'Jakov is the only coin row in the fixture');
});

test('without a method the bank template still filters to bank', async () => {
  // Guards the guard: the step-back must not fire when nothing contradicts.
  const { draft, preview } = (await call({ template: 'bank' })).exportSession;
  assert.equal(draft.preset, 'bank');
  assert.equal(preview.rows, 1, 'Gloria is the only bank row');
});

test('an unknown template falls back rather than erroring', async () => {
  // An old link or a typo. Refusing is a worse answer than the usual shape.
  const out = await call({ template: 'driver' });
  assert.equal(out.exportSession.draft.template, 'monthly-sheet');
});

test('THE MONTH IS NEVER CARRIED FORWARD SILENTLY', async () => {
  // Last time's August is this time's mistake.
  const { draft } = (await call({})).exportSession;
  assert.match(draft.month, /^\d{4}-\d{2}$/);
  const asked = (await call({ month: NEARBY })).exportSession.draft.month;
  assert.equal(asked, NEARBY, 'a month they DID say is kept');
});

test('the breakdown design defaults to the SERVED default', async () => {
  const { DEFAULT_ID } = require('../../masterSheet/breakdowns');
  const { draft } = (await call({})).exportSession;
  assert.equal(draft.breakdownDesign, DEFAULT_ID, 'a second default would drift from the modal');
});

/* ===============================
 * * 3. The count and the file are one input
 * =============================== */

test('THE LINK CARRIES THE QUERY THAT WAS COUNTED', async () => {
  const { query, link, preview } = (await call({ template: 'cash', groups: ['INDIGO'] })).exportSession;
  const sent = new URLSearchParams(link.split('?')[1]);

  for (const [key, value] of Object.entries(query)) {
    assert.equal(sent.get(key), String(value), `${key} differs between the count and the link`);
  }
  assert.equal(preview.rows, 1);
});

test('the count comes from previewExport, not from a list she is holding', async () => {
  const { previewExport } = require('../../masterSheet/exportQuery');
  const { query, preview } = (await call({ template: 'bank' })).exportSession;
  const direct = await previewExport(query);
  assert.deepEqual(preview.rows, direct.rows);
  assert.deepEqual(preview.people, direct.people);
});

test('the filename is shown BEFORE the file, and is the real one', async () => {
  const { fileName } = (await call({ template: 'bank', groups: ['NEXUS'] })).exportSession;
  assert.match(fileName, /^NEXUS - BANK - \d{4}-\d{2}\.xlsx$/);
});

test('one file per group is a ZIP, and does nothing on a single group', async () => {
  const one = (await call({ groups: ['NEXUS'], multiFile: true })).exportSession;
  assert.match(one.fileName, /\.xlsx$/, 'a zip holding one file is worse than the file');

  const many = (await call({ multiFile: true })).exportSession;
  assert.match(many.fileName, /\.zip$/);
});


/* ===============================
 * * The four faults from the live transcript
 * =============================== */

test('1. A BARE GROUP NAME IS NOT A COMPANY', async () => {
  // "Give me the bank sheet for Nexus" was read as a company, matched
  // nothing, and she told them no such company existed while NEXUS sat
  // there as a group. They had to say "I mean group, Nexus group".
  const out = await call({ template: 'bank', company: 'Nexus' });
  assert.ok(out.exportSession, 'it refused something that plainly exists');
  assert.deepEqual(out.exportSession.draft.groups, ['NEXUS']);
  assert.equal(out.exportSession.draft.company, null, 'it stayed a company filter too');
  assert.match(out.summary, /GROUP, not a company/, 'a silent correction is its own bug');
});

test('a name that IS a company is left alone', async () => {
  // Guards the guard: the correction must not fire on a real company.
  const out = await call({ company: 'Workforce' });
  assert.equal(out.exportSession.draft.company, 'Workforce');
  assert.deepEqual(out.exportSession.draft.groups, []);
});

test('2. SHE CAN HIDE A COLUMN BY THE NAME THEY SAY IT', async () => {
  // She said she had unchecked door number, accepting postals and sort
  // code. She had called no tool at all: `columns` was an INCLUDE list, so
  // hiding three meant naming the other twenty three, which she could not.
  const out = await call({
    template: 'bank',
    hideColumns: ['door number', 'accepting postals', 'sort code'],
  });
  const { draft, query } = out.exportSession;

  assert.deepEqual(
    [...draft.hiddenColumns].sort(),
    ['accepting_postals', 'door_number', 'sort_code'],
  );
  // And it reaches the FILE, as an include list with those three absent.
  const included = query.columns.split(',');
  for (const gone of ['door_number', 'accepting_postals', 'sort_code']) {
    assert.ok(!included.includes(gone), `${gone} is still in the file`);
  }
  assert.ok(included.includes('person_name'), 'it dropped everything instead');
  assert.match(out.summary, /hid door number/, 'she cannot see what she hid');
});

test('hiding ACCUMULATES against the open panel', async () => {
  // Three separate "uncheck X" turns must not each start from scratch.
  const open = { template: 'bank', hiddenColumns: ['door_number'] };
  const out = await load().exportSheet.handler({
    template: 'bank', hideColumns: ['sort code'], open,
  });
  assert.deepEqual([...out.exportSession.draft.hiddenColumns].sort(), ['door_number', 'sort_code']);
});

test('showColumns brings one back', async () => {
  const open = { template: 'bank', hiddenColumns: ['door_number', 'sort_code'] };
  const out = await load().exportSheet.handler({
    template: 'bank', showColumns: ['door number'], open,
  });
  assert.deepEqual(out.exportSession.draft.hiddenColumns, ['sort_code']);
  assert.match(out.summary, /brought back/);
});

test('A DOCUMENT OPENS ON ITS OWN COLUMNS, not on all of them', async () => {
  // The panel opened with all twenty four ticked on a bank sheet, which is
  // the master sheet wearing bank headers. `inSend` is the set the modal
  // writes and the boss recognises.
  const bank = (await call({ template: 'bank' })).exportSession;
  const cash = (await call({ template: 'cash' })).exportSession;

  assert.equal(bank.query.columns.split(',').length, 8, 'a bank run is eight columns');
  assert.equal(cash.query.columns.split(',').length, 10);
  assert.ok(bank.draft.hiddenColumns.includes('door_number'), 'bank does not send the door number');
  assert.ok(!bank.draft.hiddenColumns.includes('sort_code'), 'but it certainly sends the sort code');
  assert.equal(bank.draft.columnsTouched, false, 'a default is not a choice');
});

test('an UNTOUCHED panel re-derives on a template change; a touched one does not', async () => {
  // "The bank columns" and "the cash columns" are different eights. But
  // once they have chosen, the choice is theirs and survives the switch.
  const fresh = await load().exportSheet.handler({
    template: 'cash', open: { template: 'bank', hiddenColumns: ['phone'], columnsTouched: false },
  });
  assert.ok(!fresh.exportSession.draft.hiddenColumns.includes('postcode'), 'cash sends the postcode');

  const theirs = await load().exportSheet.handler({
    template: 'cash', open: { template: 'bank', hiddenColumns: ['phone'], columnsTouched: true },
  });
  assert.ok(theirs.exportSession.draft.hiddenColumns.includes('phone'), 'their hide was thrown away');
});

test('SWITCHING TEMPLATE RE-DERIVES THE PRESET, or the rows are the old ones', async () => {
  // Live run: a month sheet switched to the bank sheet kept `expensing`,
  // which filters nothing. NEXUS came out at its whole group instead of
  // its bank rows. A payout file with extra people on it.
  const out = await load().exportSheet.handler({
    template: 'bank',
    open: { template: 'monthly-sheet', preset: 'expensing', groups: ['NEXUS'], month: '2026-08' },
  });
  assert.equal(out.exportSession.draft.preset, 'bank', 'it kept the old preset');
  assert.equal(out.exportSession.preview.rows, 1, 'Gloria is the only NEXUS bank row here');
});

test('a preset they NAMED this turn survives the switch', async () => {
  // Guards the guard: the re-derive must not overrule an explicit choice.
  const out = await load().exportSheet.handler({
    template: 'bank', preset: 'expensing',
    open: { template: 'monthly-sheet', preset: 'cash' },
  });
  assert.equal(out.exportSession.draft.preset, 'expensing');
});

test('A REQUIRED COLUMN CANNOT BE HIDDEN', async () => {
  // A bank run with no names is a file nobody can act on.
  const out = await call({ template: 'bank', hideColumns: ['name of individual'] });
  const included = out.exportSession.query.columns?.split(',') ?? [];
  assert.ok(included.length === 0 || included.includes('person_name'));
});

test('3. SAYING GO BUILDS IT', async () => {
  // Three times they said go and she described the panel back, because
  // building was a button she could not press.
  const out = await call({ template: 'bank', groups: ['NEXUS'], build: true });
  assert.equal(out.exportSession.build, true, 'nothing tells the browser to download');
  assert.match(out.summary, /^BUILT\./);
  assert.match(out.summary, /do NOT ask them to say go again/);
});

test('it never builds unless asked', async () => {
  const out = await call({ template: 'bank', groups: ['NEXUS'] });
  assert.equal(out.exportSession.build, false);
  assert.ok(!out.summary.startsWith('BUILT'));
});

test('4. IT EDITS THE OPEN PANEL rather than starting fresh', async () => {
  // "Make it blue" must not throw away the group, the month and the hides.
  const open = {
    template: 'bank', groups: ['NEXUS'], month: '2026-08',
    hiddenColumns: ['door_number'], columnsTouched: true, preset: 'bank',
  };
  const out = await load().exportSheet.handler({ primaryColor: 'blue', open });
  const { draft } = out.exportSession;

  assert.deepEqual(draft.groups, ['NEXUS'], 'the group was lost');
  assert.equal(draft.month, '2026-08', 'the month was lost');
  assert.deepEqual(draft.hiddenColumns, ['door_number'], 'the hidden columns were lost');
  assert.equal(draft.primaryColor, 'blue');
});

/* ===============================
 * * Nothing to export is a STOP
 * =============================== */

test('no rows means no panel and a reason, never an empty file', async () => {
  const out = await call({ template: 'cash', groups: ['NEXUS'] });
  assert.ok(!out.exportSession, 'it offered to build an empty workbook');
  assert.match(out.summary, /NOTHING MATCHES/);
  assert.match(out.summary, /Do NOT offer to build an empty one/);
});

/* ===============================
 * * Read only, and it must stay that way
 * =============================== */

test('the tool takes no argument that could write', async () => {
  const { exportSheet } = load();
  const params = Object.keys(exportSheet.parameters.properties);
  for (const writeish of ['paid', 'shouldBePaid', 'confirmed', 'update', 'fields']) {
    assert.ok(!params.includes(writeish), `export grew a write argument: ${writeish}`);
  }
  assert.match(exportSheet.description, /READ ONLY/);
});
