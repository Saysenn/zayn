const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * ***************************************************
 * * Searching one named column
 * ***************************************************
 *
 * A COLUMN NAME OFF THE QUERY STRING IS NEVER INTERPOLATED. It is looked up
 * in an allow-list, and an unknown key falls back to searching everything
 * rather than erroring, so a stale link returns a list and not a 500.
 *
 * The repo runs SQL, so the pool is stubbed and what is asserted is the
 * statement it built: which columns it named, and that the typed text only
 * ever arrives as a parameter.
 */

function loadRepo() {
  const dbPath = require.resolve('../../configs/db.js');
  const repoPath = require.resolve('../repos/masterSheetRows.repo.js');
  const seen = {};

  delete require.cache[repoPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    // The pool IS the export, not `{ pool }`.
    exports: {
      async query(sql, params) {
        // The list query is the one with the CTE; ignore any others.
        if (String(sql).includes('WITH filtered AS')) {
          seen.sql = sql;
          seen.params = params;
        }
        return { rows: [{ total: 0, rows: [] }] };
      },
    },
  };

  return { repo: require(repoPath), seen };
}

const run = async (args) => {
  const { repo, seen } = loadRepo();
  await repo.findAll(args);
  return seen;
};

test('no field searches the four the box always covered', async () => {
  const { sql, params } = await run({ q: 'gloria' });
  for (const col of ['person_name', 'company', 'role_label', 'phone']) {
    assert.ok(sql.includes(`${col} ILIKE`), `${col} should be searched`);
  }
  assert.ok(params.includes('%gloria%'));
});

test('a named field searches that column and nothing else', async () => {
  const { sql, params } = await run({ q: 'south east', searchField: 'location' });
  assert.ok(sql.includes('location ILIKE'), 'location should be searched');
  for (const col of ['person_name', 'company', 'role_label', 'phone']) {
    assert.ok(!sql.includes(`${col} ILIKE`), `${col} must NOT be searched`);
  }
  assert.ok(params.includes('%south east%'));
});

test('every offered field maps to a real column', async () => {
  const fields = {
    location: 'location',
    postcode: 'postcode',
    bankDetails: 'bank_details',
    accountNumber: 'account_number',
    sortCode: 'sort_code',
    notes: 'notes',
    doorNumber: 'door_number',
  };
  for (const [key, column] of Object.entries(fields)) {
    const { sql } = await run({ q: 'x', searchField: key });
    assert.ok(sql.includes(`${column} ILIKE`), `${key} should search ${column}`);
  }
});

test('an unknown field searches everything rather than erroring', async () => {
  // A stale link naming a column that has since gone. Same rule the amount
  // filter follows: ignored, never a 500.
  const { sql } = await run({ q: 'gloria', searchField: 'nonsense; DROP TABLE tb_mastersheet' });
  assert.ok(sql.includes('person_name ILIKE'), 'it should fall back to ANY');
  assert.ok(!sql.includes('DROP TABLE'), 'and the value must never reach the SQL');
});

test('the typed text is a parameter, never pasted into the statement', async () => {
  const nasty = "' OR 1=1 --";
  const { sql, params } = await run({ q: nasty, searchField: 'notes' });
  assert.ok(!sql.includes('OR 1=1'), 'the query string must not appear in the SQL');
  assert.ok(params.includes(`%${nasty}%`), 'it travels as a parameter');
});

/**
 * ===============================
 * * Currency and method are FILTERS
 * ===============================
 * Closed sets of three or four off the sheet's own values, so they are
 * picked rather than typed, and they are deliberately NOT search fields.
 */
test('currency and method each narrow on their own column', async () => {
  const { sql, params } = await run({ currency: 'AED', paymentMethod: 'bank' });
  assert.ok(sql.includes('upper(currency) = upper('), 'currency should be filtered');
  assert.ok(sql.includes('lower(payment_method) = lower('), 'method should be filtered');
  assert.ok(params.includes('AED') && params.includes('bank'));
});

test('both are case folded, so EURO and Euro are one currency', async () => {
  // canonical.js has had to fix this column's casing before, and an
  // exact-case filter silently returns nothing for a real value.
  const { sql } = await run({ currency: 'euro' });
  assert.ok(sql.includes('upper(currency) = upper('), 'the fold is the point');
});

test('the picked value is a parameter, never pasted into the statement', async () => {
  const nasty = "GBP' OR 1=1 --";
  const { sql, params } = await run({ currency: nasty });
  assert.ok(!sql.includes('OR 1=1'));
  assert.ok(params.includes(nasty));
});

test('neither filter is applied when it is not picked', async () => {
  const { sql } = await run({ q: 'gloria' });
  assert.ok(!sql.includes('upper(currency)'), 'no currency picked, no clause');
  assert.ok(!sql.includes('lower(payment_method)'), 'no method picked, no clause');
});

test('a field with no query narrows nothing', async () => {
  // The picker on its own is not a filter: it aims the box, and an empty
  // box means no search at all.
  const { sql } = await run({ searchField: 'postcode' });
  assert.ok(!sql.includes('ILIKE'), 'no q means no search clause');
});
