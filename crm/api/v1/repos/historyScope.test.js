const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const pool = require('../../configs/db');
const repo = require('./masterSheetRows.repo');

async function capture(filters, rows = []) {
  const real = pool.query;
  let seen;
  let answer;
  pool.query = async (text, params) => {
    seen = { text, params };
    return { rows };
  };
  try {
    answer = await repo.findFieldChanges(filters);
  } finally {
    pool.query = real;
  }
  return { ...seen, answer };
}

test('person history is scoped by stable person id across all current deals', async () => {
  const { text, params } = await capture({ personId: 'abe' });

  assert.match(text, /m\.person_id = \$5::text/);
  assert.equal(params[4], 'abe');
});

test('company history uses the same reusable scope instead of returning global edits', async () => {
  const { text, params } = await capture({ company: 'A J Rayson' });

  assert.match(text, /regexp_replace\(lower\(coalesce\(m\.company, ''\)\)/);
  assert.equal(params[5], 'A J Rayson');
});

test('recent history can scope by person name when a stable id is not available', async () => {
  const { text, params } = await capture({ person: 'Nicola' });

  assert.match(text, /c\.person_name, m\.person_name/);
  assert.equal(params[6], 'Nicola');
});

/**
 * ***************************************************
 * * A CAP YOU CANNOT SEE IS THE BUG
 * ***************************************************
 *
 * History asked for a flat 200 and the route threw the count away, so a
 * week with 300 edits showed the newest 200 under a line reading "Edits
 * from the last 7 days" and nothing said it had cut. Found and closed
 * 2026-09-29, when the modal became a page and the list became the whole
 * audit trail rather than a glance.
 */
test('A PAGE IS AN OFFSET, and the slice is the page size', async () => {
  const { text, params } = await capture({ limit: 25, offset: 50 });

  assert.match(text, /LIMIT \$2 OFFSET \$11/);
  assert.equal(params[1], 25, 'the limit is the page size');
  assert.equal(params[10], 50, 'page 3 of 25 starts at 50');
});

test('AND THE TOTAL COMES BACK BESIDE THE PAGE', async () => {
  // Counted over the SCOPED set, before the slice: a total that counted the
  // page would always equal the page and the pager would never appear.
  const { text, answer } = await capture(
    { withTotal: true },
    [{ id: 1, row_id: 7, field: 'notes', row_exists: true, total_count: 312 }],
  );

  assert.match(text, /COUNT\(\*\)::int AS total_count FROM scoped/);
  assert.equal(answer.total, 312);
  assert.equal(answer.rows.length, 1);
  // The count is not smuggled onto the row it was read from.
  assert.equal('total_count' in answer.rows[0], false);
});

test('AND THE ROUTE ACTUALLY PAGES, rather than asking for one big slice', () => {
  // The repo has taken `offset` and `withTotal` all along; only the route
  // was throwing them away, which is why the bug survived a repo that could
  // already answer it.
  const route = readFileSync(require.resolve('../masterSheet.js'), 'utf8');
  const from = route.indexOf("router.get('/master-sheet/changes'");
  // To the NEXT route, not to the first `});`: the repo call ends with one.
  const body = route.slice(from, route.indexOf('router.', from + 10));

  assert.match(body, /offset: \(page - 1\) \* pageSize/);
  assert.match(body, /withTotal: true/);
  assert.match(body, /res\.json\(\{ changes: rows, total/, 'the count reaches the browser');
  // A named ceiling, not a literal buried in the expression.
  assert.match(route, /const CHANGES_MAX_PAGE_SIZE = \d+/);
  assert.match(body, /CHANGES_MAX_PAGE_SIZE/);
});
