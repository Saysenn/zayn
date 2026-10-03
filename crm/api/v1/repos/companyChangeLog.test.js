const test = require('node:test');
const assert = require('node:assert/strict');

// ***************************************************
// * A company's own detail is logged, and undone onto the company
// ***************************************************
//
// 2026-09-28: "undo the tier change" had nothing to undo, company edits were
// never logged. The pool is scripted; what is pinned is what is written.

// `answers` maps a pattern to the rows that statement returns.
function loadRepo(answers = []) {
  const dbPath = require.resolve('../../configs/db.js');
  const repoPath = require.resolve('./companies.repo.js');
  const ran = [];
  const query = async (sql, params) => {
    ran.push({ sql, params });
    const hit = answers.find(([pattern]) => pattern.test(sql));
    return { rows: hit ? hit[1] : [], rowCount: 0 };
  };
  delete require.cache[repoPath];
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true, exports: { query, connect: async () => ({ query, release() {} }) },
  };
  const repo = require(repoPath);
  delete require.cache[repoPath];
  delete require.cache[dbPath];
  return { repo, ran };
}

const HELD = /FROM tb_companies WHERE lower\(name\) = \$1 FOR UPDATE/;
const UPSERT = /INSERT INTO tb_companies \(name, status, notes/;
const LOG = /INSERT INTO tb_mastersheet_changes/;
const logs = (ran) => ran.filter((r) => LOG.test(r.sql)).map((r) => r.params);

test('A TIER CHANGE IS LOGGED ONCE, as the company field, with who did it', async () => {
  const { repo, ran } = loadRepo([
    [HELD, [{ tier: 'T2', old_group: null, notes: 'kept', liquidation_total: null }]],
    [UPSERT, [{ name: 'Workforce', tier: 'T3', old_group: null, notes: 'kept', liquidation_total: null }]],
  ]);
  await repo.update('Workforce', { tier: 'T3' }, { via: 'diane', batchId: 'b1' });
  assert.deepEqual(logs(ran), [['workforce', 'companyTier', 'T2', 'T3', 'diane', 'b1']]);
  assert.ok(ran.some((r) => r.sql === 'COMMIT'));
});

test('NOTHING THAT DID NOT MOVE IS LOGGED, and a numeric reads the same both ways', async () => {
  const { repo, ran } = loadRepo([
    [HELD, [{ tier: 'T2', notes: '', liquidation_total: '500.00' }]],
    [UPSERT, [{ tier: 'T2', notes: null, liquidation_total: 500 }]],
  ]);
  await repo.update('Workforce', { status: 'active' });
  assert.deepEqual(logs(ran), []);
});

const CHANGE = { id: 11, row_id: 4, field: 'companyTier', old_value: 'T2', new_value: 'T3' };
const OWNER = /SELECT lower\(regexp_replace.*AS ckey FROM tb_mastersheet WHERE id = \$1/;
const NOW = /AS value FROM tb_companies/;

test('UNDO PUTS THE COMPANY BACK and closes every entry of that act', async () => {
  const { repo, ran } = loadRepo([
    [OWNER, [{ ckey: 'workforce' }]],
    [NOW, [{ value: 'T3' }]],
    [HELD, [{ tier: 'T3' }]],
    [UPSERT, [{ name: 'Workforce', tier: 'T2' }]],
    [/UPDATE tb_mastersheet_changes/, [{ id: 11 }, { id: 12 }]],
  ]);
  const out = await repo.revertCompanyField(CHANGE);
  assert.equal(out.ok, true);
  assert.deepEqual(out.covers, [11, 12]);
  const upsert = ran.find((r) => UPSERT.test(r.sql));
  assert.equal(upsert.params[3], 'T2', 'the tier goes back');
  assert.deepEqual(logs(ran), [['workforce', 'companyTier', 'T3', 'T2', 'admin', null]], 'the undo is logged too');
});

test('A VALUE THAT MOVED SINCE IS NOT OVERWRITTEN', async () => {
  const { repo, ran } = loadRepo([[OWNER, [{ ckey: 'workforce' }]], [NOW, [{ value: 'T4' }]]]);
  const out = await repo.revertCompanyField(CHANGE);
  assert.equal(out.ok, false);
  assert.match(out.reason, /it is T4 now, not T3/);
  assert.ok(!ran.some((r) => UPSERT.test(r.sql)), 'nothing written');
  assert.ok(ran.some((r) => r.sql === 'ROLLBACK'));
});

test('A TIER THAT WAS NOTHING GOES BACK TO NOTHING, through the clear', async () => {
  const { repo, ran } = loadRepo([[OWNER, [{ ckey: 'workforce' }]], [NOW, [{ value: 'T3' }]], [UPSERT, [{}]]]);
  await repo.revertCompanyField({ ...CHANGE, old_value: null });
  assert.equal(ran.find((r) => UPSERT.test(r.sql)).params[3], '');
});

test('AN UPLOADED TIER IS LOGGED AS THE UPLOAD', async () => {
  const { repo, ran } = loadRepo([
    [/FOR UPDATE$/, [{ ckey: 'workforce', tier: 'T2' }]],
    [/WHERE lower\(regexp_replace\(btrim\(name\).*ANY\(\$1::text\[\]\)$/, [{ ckey: 'workforce', tier: 'Visa co' }]],
  ]);
  await repo.setTiers([{ company: 'Workforce', tier: 'Visa co' }]);
  assert.deepEqual(logs(ran), [['workforce', 'companyTier', 'T2', 'Visa co', 'upload', null]]);
});

// The undo route and Diane both land in the rows repo; it must hand a company
// field to the company, never write it onto the deal.
test('THE ROWS UNDO HANDS A COMPANY FIELD TO THE COMPANY', async () => {
  const { loadWith } = require('../testing/stubRepos');
  const handed = [];
  const rowsRepo = loadWith(require.resolve('./masterSheetRows.repo.js'), {
    [require.resolve('../../configs/db.js')]: {
      async query() { return { rows: [{ ...CHANGE, reverted_at: null, row_exists: true }] }; },
    },
    [require.resolve('./companies.repo.js')]: {
      async revertCompanyField(change) { handed.push(change.id); return { ok: true, covers: [] }; },
    },
  });
  assert.equal(rowsRepo.isUndoableField('companyTier'), true);
  const out = await rowsRepo.revertFieldChange(CHANGE.id);
  assert.equal(out.ok, true);
  assert.deepEqual(handed, [CHANGE.id]);
});
