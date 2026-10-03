const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * ***************************************************
 * * old_group: three states, not two
 * ***************************************************
 *
 * A value, cleared, or NOT MENTIONED. The third is what a file with no
 * "Old group" column says, and only one of his three files carries one, so
 * it is the common case rather than an edge.
 *
 * The pool is stubbed and what is asserted is the statement built and the
 * parameters bound. No database.
 */

function loadRepo() {
  const dbPath = require.resolve('../../configs/db.js');
  const repoPath = require.resolve('./companies.repo.js');
  const seen = {};

  delete require.cache[repoPath];
  // A read is one pool query. A write runs in a transaction, where the company
  // WRITE is what is asserted; the reads and the log around it land in `all`.
  seen.all = [];
  const record = (sql, params) => {
    seen.sql = sql;
    seen.params = params;
  };
  const query = async (sql, params) => {
    record(sql, params);
    return { rows: [{}], rowCount: 0 };
  };
  const inTransaction = async (sql, params) => {
    seen.all.push({ sql, params });
    if (/INSERT INTO tb_companies/.test(sql)) record(sql, params);
    return { rows: [{}], rowCount: 0 };
  };
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { query, connect: async () => ({ query: inTransaction, release() {} }) },
  };
  return { repo: require(repoPath), seen };
}

test('an empty old group is bound as NULL, so COALESCE keeps what is stored', async () => {
  const { repo, seen } = loadRepo();
  await repo.setTiers([
    { company: 'Reliapay', tier: 'TBC', oldGroup: 'Wallaby 1' },
    { company: 'Gab', tier: 'Visa co', oldGroup: '' },
    { company: 'Bench', tier: 'In prep' },
  ]);

  // names, tiers, oldGroups
  assert.deepEqual(seen.params[0], ['Reliapay', 'Gab', 'Bench']);
  assert.deepEqual(seen.params[2], ['Wallaby 1', null, null]);
  assert.ok(
    seen.sql.includes('old_group = COALESCE(i.old_group, c.old_group)'),
    'an unmentioned old group must never clear a stored one',
  );
});

test('a new company is inserted with its old group', async () => {
  const { repo, seen } = loadRepo();
  await repo.setTiers([{ company: 'Souracore', tier: 'TBC', oldGroup: 'NA' }]);
  assert.ok(seen.sql.includes('INSERT INTO tb_companies (name, status, tier, old_group)'));
  assert.deepEqual(seen.params[2], ['NA']);
});

test('update keeps the three states apart on both columns', async () => {
  const { repo, seen } = loadRepo();
  await repo.update('reliapay', { oldGroup: '' });
  // '' clears, NULL leaves alone. Without the distinction there is no way
  // back to "nobody has said", only to some other value.
  assert.ok(seen.sql.includes("WHEN $5::text = ''    THEN NULL"));
  assert.ok(seen.sql.includes('WHEN $5::text IS NULL THEN tb_companies.old_group'));
  assert.equal(seen.params[4], '');
});

test('update not mentioning the old group binds NULL and leaves it', async () => {
  const { repo, seen } = loadRepo();
  await repo.update('reliapay', { tier: 'T2' });
  assert.equal(seen.params[3], 'T2');
  assert.equal(seen.params[4], null);
});

test('the old group filter is a parameter, never pasted into the statement', async () => {
  const { repo, seen } = loadRepo();
  await repo.findAll({ oldGroup: "Milky' OR 1=1 --" });
  assert.ok(!seen.sql.includes('OR 1=1'));
  assert.ok(seen.params.includes("Milky' OR 1=1 --"));
  // Folded on case only. It must never be matched against group_name: our
  // groups are NEXUS and MILKMAN, his are Milky and Wallaby 1.
  assert.ok(seen.sql.includes('lower(btrim(c.old_group))'));
  assert.ok(!/old_group[^)]*group_name/.test(seen.sql));
});

test('no old group picked applies no clause at all', async () => {
  const { repo, seen } = loadRepo();
  await repo.findAll({});
  assert.ok(!seen.sql.includes('c.old_group)) = lower'));
});
