const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('../repos/expenses.repo');

/**
 * ***************************************************
 * * The filters, with no database
 * ***************************************************
 *
 * `buildWhere` is pure, and it is where the two faults live: a column name
 * off the query string reaching SQL, and a blank bound being read as zero.
 */

const MONTH = '2026-09';
const where = (filters) => repo.buildWhere({ month: MONTH, ...filters }).sql;

test('EVERY READ IS SCOPED TO ONE MONTH, and it is not optional', () => {
  // An unscoped read would total every month the table holds and look
  // exactly like one month's figure.
  assert.match(where({}), /spent_on >= \$1 AND spent_on < \$2/);
  for (const bad of [undefined, '', '2026', '2026-13', 'september', '2026-09-01']) {
    assert.throws(() => repo.buildWhere({ month: bad }), /month/, `${bad} must be refused`);
  }
});

test('the month is a HALF OPEN range, so the last day is in and the next month is out', () => {
  // `<= last day` loses anything stamped with a time; `< the 1st` cannot.
  assert.deepEqual(repo.monthBounds('2026-09'), { from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual(repo.monthBounds('2026-12'), { from: '2026-12-01', to: '2027-01-01' });
  assert.deepEqual(repo.monthBounds('2026-01'), { from: '2026-01-01', to: '2026-02-01' });
});

test('the bounds go in as PARAMETERS, never built into the string', () => {
  const built = repo.buildWhere({ month: MONTH });
  assert.deepEqual(built.params.slice(0, 2), ['2026-09-01', '2026-10-01']);
  assert.doesNotMatch(built.sql, /2026-09-01/);
});

test('EITHER BOUND ALONE IS A REAL FILTER', () => {
  const min = where({ amountField: 'aedAmount', amountMin: '1000' });
  assert.match(min, /aed_amount >= \$\d/);
  assert.doesNotMatch(min, /aed_amount <=/);

  const max = where({ amountField: 'aedAmount', amountMax: '50' });
  assert.match(max, /aed_amount <= \$\d/);
  assert.doesNotMatch(max, /aed_amount >=/);
});

test('AN EMPTY BOUND IS UNBOUNDED, NEVER ZERO', () => {
  // 0 is a real expense amount. A blank read as 0 would hide exactly the
  // rows somebody is hunting for.
  assert.doesNotMatch(
    where({ amountField: 'aedAmount', amountMin: '', amountMax: '' }),
    /aed_amount/,
  );
});

test('zero itself still filters', () => {
  assert.match(where({ amountField: 'aedAmount', amountMin: 0 }), /aed_amount >= \$\d/);
});

test('a column name off the query string is ALLOW LISTED, and an unknown one is ignored', () => {
  assert.match(where({ amountField: 'rawAmount', amountMin: '5' }), /raw_amount >= /);
  assert.match(where({ amountField: 'exchangeRate', amountMin: '5' }), /exchange_rate >= /);
  // Ignored rather than erroring, and never interpolated. The month's own
  // bounds are the only comparison left standing.
  const injected = where({ amountField: 'id; DROP TABLE tb_expenses', amountMin: '5' });
  assert.doesNotMatch(injected, /DROP TABLE/);
  assert.doesNotMatch(injected, /aed_amount|raw_amount|exchange_rate/);
});

test('search points at one column, or at all three', () => {
  const one = where({ q: 'careem', searchField: 'payee' });
  assert.match(one, /payee ILIKE \$\d/);
  assert.doesNotMatch(one, /description ILIKE/);

  const any = where({ q: 'careem' });
  for (const column of ['description', 'payee', 'spent_by']) {
    assert.match(any, new RegExp(`${column} ILIKE \\$\\d`));
  }
});

test('an unknown search field searches everything rather than erroring', () => {
  assert.match(where({ q: 'x', searchField: 'bank_details' }), /description ILIKE/);
});

test('SEARCH_COLUMNS is the authority, and it is these three', () => {
  // CONTRACT, pinned on this side only. The web's half is
  // EXPENSE_SEARCH_FIELDS in configs/searchFields.js, pinned by its own
  // test. The two repos share no file.
  assert.deepEqual(Object.keys(repo.SEARCH_COLUMNS).sort(), ['description', 'payee', 'spentBy']);
});

test('a currency is one currency whatever the casing', () => {
  assert.equal(repo.upperCurrency(' php '), 'PHP');
  assert.equal(repo.upperCurrency('Php'), 'PHP');
  assert.equal(repo.upperCurrency(''), null);
});

test('group and currency filters accept one value or several', () => {
  assert.match(where({ groups: 'MILKMAN' }), /group_name = ANY/);
  assert.match(where({ groups: ['MILKMAN', 'INDIGO'] }), /group_name = ANY/);
  assert.doesNotMatch(where({ groups: [] }), /group_name/);
});

test('neither aed_amount nor updated_at can be written from a body', () => {
  // Both are the server's: one is generated, one is stamped on every write.
  assert.ok(!repo.WRITABLE.includes('aedAmount'));
  assert.ok(!repo.WRITABLE.includes('updatedAt'));
  assert.ok(!repo.WRITABLE.includes('syncKey'));
});
