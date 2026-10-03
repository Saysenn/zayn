const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../configs/db');
const rowsRepo = require('../repos/masterSheetRows.repo');

test('dashboard audit search and row scope stay parameterized and paginated', async () => {
  const realQuery = pool.query;
  let captured;
  pool.query = async (text, params) => {
    captured = { text, params };
    return { rows: [{ id: 1, total_count: 8 }] };
  };
  try {
    const result = await rowsRepo.findFieldChanges({
      rowIds: [7, 8, 8, 'bad'],
      q: 'Company One',
      limit: 10,
      offset: 20,
      withTotal: true,
    });
    assert.match(captured.text, /c\.row_id = ANY\(\$9::int\[\]\)/);
    assert.match(captured.text, /concat_ws/);
    assert.match(captured.text, /ILIKE \$10::text/);
    assert.match(captured.text, /LIMIT \$2 OFFSET \$11/);
    assert.deepEqual(captured.params[8], [7, 8]);
    assert.equal(captured.params[9], '%Company One%');
    assert.equal(captured.params[10], 20);
    assert.equal(result.total, 8);
    assert.equal('total_count' in result.rows[0], false);
  } finally {
    pool.query = realQuery;
  }
});

test('an empty filtered dashboard scope cannot return global changes', async () => {
  const realQuery = pool.query;
  let params;
  pool.query = async (text, values) => {
    params = values;
    return { rows: [] };
  };
  try {
    await rowsRepo.findFieldChanges({ rowIds: [], withTotal: true });
    assert.deepEqual(params[8], []);
  } finally {
    pool.query = realQuery;
  }
});

test('an audit page past the end still returns the true total', async () => {
  const realQuery = pool.query;
  pool.query = async () => ({ rows: [{ id: null, total_count: 8 }] });
  try {
    const result = await rowsRepo.findFieldChanges({ offset: 20, withTotal: true });
    assert.equal(result.total, 8);
    assert.deepEqual(result.rows, []);
  } finally {
    pool.query = realQuery;
  }
});
