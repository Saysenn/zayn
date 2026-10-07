const pool = require('../../configs/db');
const { expenseKey } = require('../expenses/expenseIdentity');

// ***************************************************
// * The only place tb_expenses is touched
// ***************************************************
//
// A STANDALONE LEDGER: nothing here reads tb_mastersheet, and nothing here
// reads tb_fx_rates. Every row's AED comes from its own stored rate through
// the generated column. See docs/expense.md.

// Postgres snake_case, API camelCase. Anything absent is the same word in
// both. Mirrored by useExpenses.js on the web side.
const COLUMN_FOR = {
  spentOn: 'spent_on',
  rawAmount: 'raw_amount',
  exchangeRate: 'exchange_rate',
  groupName: 'group_name',
  spentBy: 'spent_by',
  aedAmount: 'aed_amount',
  archivedAt: 'archived_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  syncKey: 'sync_key',
  // who sent it in, and the master sheet person who spent it (migration 077)
  savedBy: 'saved_by',
  spentByPersonId: 'spent_by_person_id',
  spentByPhone: 'spent_by_phone',
};

// What a create or an update may set. `aed_amount` is generated and
// `updated_at` is the server's, so neither can be written from a body.
const WRITABLE = [
  'spentOn', 'description', 'payee', 'currency',
  'rawAmount', 'exchangeRate', 'groupName', 'spentBy',
  // fuel, travel, food, office, bills or other (migration 075)
  'category',
  // set by the SERVER only (routes and the expense brain, via
  // expenses/spender.js), never taken from a body as sent (migration 077)
  'savedBy', 'spentByPersonId', 'spentByPhone',
];

// ===============================
// * ALLOW LISTS, NEVER INTERPOLATION
// ===============================
// A column name off the query string is looked up here and an unknown value
// is IGNORED rather than erroring, the same way the master sheet's is.

// The authority for the search box. Mirrored by EXPENSE_SEARCH_FIELDS in
// web/src/configs/searchFields.js.
const SEARCH_COLUMNS = {
  description: 'description',
  payee: 'payee',
  spentBy: 'spent_by',
};
const SEARCH_ANY = Object.values(SEARCH_COLUMNS);

const AMOUNT_COLUMNS = {
  aedAmount: 'aed_amount',
  rawAmount: 'raw_amount',
  exchangeRate: 'exchange_rate',
};

const DEFAULT_SORT = 'spent_on DESC, id DESC';

// ===============================
// * ONE MONTH AT A TIME, ALWAYS
// ===============================
// The page is the CURRENT month and nothing else, his call 2026-09-14. The
// month is decided by the route from the BUSINESS's clock, never by the
// browser and never by the query string, so two people in two zones read
// the same ledger.
//
// BOUNDS, not to_char: `spent_on >= first AND < next first` uses the
// (spent_on DESC) index; a function on the column would not.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthBounds(month) {
  if (!MONTH.test(String(month ?? ''))) {
    throw new Error(`${month} is not a 'YYYY-MM' month`);
  }
  const [year, index] = String(month).split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const nextYear = index === 12 ? year + 1 : year;
  const nextIndex = index === 12 ? 1 : index + 1;
  return { from: `${year}-${pad(index)}-01`, to: `${nextYear}-${pad(nextIndex)}-01` };
}

/** The sheet's own rule: one currency per casing. */
function upperCurrency(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return code || null;
}

/** A list filter accepts one value or several; empty means no filter. */
function asList(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== '' && v != null);
}

function numberOrNull(value) {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Every filter the list route accepts, as WHERE fragments.
 *
 * Pulled out so the rows query and the count/total query cannot disagree
 * about what is being filtered, which is how a total ends up describing a
 * different set from the rows above it.
 */
function buildWhere({
  month, q, searchField, groups, currencies,
  amountField, amountMin, amountMax, savedBy, linked,
} = {}) {
  const params = [];
  const where = [];

  // ALWAYS SCOPED, never optional: an unscoped read would total every month
  // the table holds and look exactly like one month's figure.
  const bounds = monthBounds(month);
  params.push(bounds.from, bounds.to);
  where.push(`spent_on >= $${params.length - 1} AND spent_on < $${params.length}`);

  const groupList = asList(groups);
  if (groupList.length) {
    params.push(groupList);
    where.push(`group_name = ANY($${params.length}::text[])`);
  }

  // WHO SENT IT IN; '(blank)' is the ones from before migration 077
  const savedList = asList(savedBy);
  if (savedList.length) {
    params.push(savedList.filter((v) => v !== '(blank)'));
    where.push(`(saved_by = ANY($${params.length}::text[])${savedList.includes('(blank)') ? ' OR saved_by IS NULL' : ''})`);
  }

  // LINKED TO A PERSON or not: the "not linked" ones are his to pick
  if (linked === 'yes') where.push('(spent_by_person_id IS NOT NULL OR spent_by_phone IS NOT NULL)');
  if (linked === 'no') where.push("(spent_by_person_id IS NULL AND spent_by_phone IS NULL AND spent_by IS NOT NULL AND btrim(spent_by) <> '')");

  const currencyList = asList(currencies).map(upperCurrency).filter(Boolean);
  if (currencyList.length) {
    params.push(currencyList);
    where.push(`currency = ANY($${params.length}::text[])`);
  }

  // EITHER BOUND ALONE IS A REAL FILTER, and an empty box is unbounded
  // rather than zero: 0 is a real expense amount, and reading a blank as 0
  // would hide exactly the rows somebody is hunting.
  const amountColumn = AMOUNT_COLUMNS[amountField];
  if (amountColumn) {
    const min = numberOrNull(amountMin);
    const max = numberOrNull(amountMax);
    if (min !== null) {
      params.push(min);
      where.push(`${amountColumn} >= $${params.length}`);
    }
    if (max !== null) {
      params.push(max);
      where.push(`${amountColumn} <= $${params.length}`);
    }
  }

  if (q) {
    params.push(`%${q}%`);
    const at = params.length;
    const columns = SEARCH_COLUMNS[searchField] ? [SEARCH_COLUMNS[searchField]] : SEARCH_ANY;
    where.push(`(${columns.map((c) => `${c} ILIKE $${at}`).join(' OR ')})`);
  }

  return { params, sql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

/**
 * The page: rows, how many there are, and what they come to.
 *
 * `aedTotal` is SUM(aed_amount), never a raw amount multiplied by a rate.
 * It describes the SAME filtered set as the rows, which is why both come
 * off one `buildWhere`.
 */
async function findAll(filters = {}) {
  const { page = 1, pageSize = 50 } = filters;
  const { params, sql } = buildWhere(filters);

  const limitAt = params.length + 1;
  const offsetAt = params.length + 2;

  const rowsPromise = pool.query(
    `SELECT * FROM tb_expenses
     ${sql}
     ORDER BY ${DEFAULT_SORT}
     LIMIT $${limitAt} OFFSET $${offsetAt}`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  const summaryPromise = pool.query(
    `SELECT COUNT(*)::int AS total,
            COALESCE(SUM(aed_amount), 0)::numeric AS aed_total,
            COUNT(*) FILTER (WHERE exchange_rate IS NULL)::int AS missing_rate
       FROM tb_expenses ${sql}`,
    params,
  );

  const [rows, summary] = await Promise.all([rowsPromise, summaryPromise]);
  const s = summary.rows[0];
  return {
    rows: rows.rows,
    total: s.total,
    aedTotal: Number(s.aed_total),
    missingRate: s.missing_rate,
  };
}

function findById(id) {
  return pool
    .query('SELECT * FROM tb_expenses WHERE id = $1', [id])
    .then((r) => r.rows[0] ?? null);
}

/**
 * What the dropdowns offer, and the rate suggestion.
 *
 * All of it DERIVED from the expenses themselves, so a value nobody has
 * used yet never appears and one somebody typed last week always does. The
 * seeded floor is the web's job (`unionOptions`), not the database's.
 */
async function options() {
  const [lists, rates] = await Promise.all([
    pool.query(
      `SELECT
         ARRAY(SELECT DISTINCT group_name FROM tb_expenses
                WHERE group_name IS NOT NULL AND btrim(group_name) <> '' ORDER BY 1) AS groups,
         ARRAY(SELECT DISTINCT currency   FROM tb_expenses ORDER BY 1)              AS currencies,
         ARRAY(SELECT DISTINCT payee      FROM tb_expenses
                WHERE payee IS NOT NULL AND btrim(payee) <> '' ORDER BY 1)          AS payees,
         ARRAY(SELECT DISTINCT spent_by   FROM tb_expenses
                WHERE spent_by IS NOT NULL AND btrim(spent_by) <> '' ORDER BY 1)    AS spent_by,
         ARRAY(SELECT DISTINCT saved_by   FROM tb_expenses
                WHERE saved_by IS NOT NULL AND btrim(saved_by) <> '' ORDER BY 1)    AS saved_by`,
    ),
    // THE MOST RECENTLY ENTERED RATE PER CURRENCY, dated by created_at
    // because that is when the rate was current. Never today's rate from
    // anywhere else: expenses do not read tb_fx_rates.
    pool.query(
      `SELECT DISTINCT ON (currency) currency, exchange_rate, created_at
         FROM tb_expenses
        WHERE exchange_rate IS NOT NULL
        ORDER BY currency, created_at DESC`,
    ),
  ]);

  const l = lists.rows[0];
  const lastRateByCurrency = {};
  for (const r of rates.rows) {
    lastRateByCurrency[r.currency] = {
      rate: Number(r.exchange_rate),
      takenAt: r.created_at,
    };
  }

  return {
    groups: l.groups ?? [],
    currencies: l.currencies ?? [],
    payees: l.payees ?? [],
    spentBy: l.spent_by ?? [],
    savedBy: l.saved_by ?? [],
    lastRateByCurrency,
  };
}

/** Only the writable fields, translated, with the currency folded. */
function writableValues(fields = {}) {
  const out = {};
  for (const key of WRITABLE) {
    if (fields[key] === undefined) continue;
    out[COLUMN_FOR[key] ?? key] = key === 'currency' ? upperCurrency(fields[key]) : fields[key];
  }
  // AED IS 1 AED, whoever writes it. The form fixes it at 1; a body without a
  // rate stored NULL, so AED 320 read as "no AED amount" and the month said
  // AED 0.00. Only fills a gap: a rate that was sent is left alone.
  if (out.currency === 'AED' && (out.exchange_rate === undefined || out.exchange_rate === null || out.exchange_rate === '')) {
    out.exchange_rate = 1;
  }
  return out;
}

/**
 * A NEW "SPENT BY" IS LINKED AGAIN, whoever wrote it (his call 2026-10-07):
 * a name changed on the page, by Diane or by WhatBot must never leave the
 * old person's link behind, or the old person would still see it. A write
 * that sets the link itself (the expense brain, the page's picker) is left
 * as it is. The typed name is never changed here.
 */
async function relink(values, current = null, list = null) {
  if (!('spent_by' in values) || 'spent_by_person_id' in values || 'spent_by_phone' in values) return values;
  // eslint-disable-next-line global-require
  const spender = require('../expenses/spender');
  const l = await spender.linkSpender({ name: values.spent_by, group: values.group_name ?? current?.group_name ?? null, list });
  values.spent_by_person_id = l.status === 'linked' ? l.personId : null;
  values.spent_by_phone = null;
  return values;
}

/** The match key, rebuilt from whatever the row will hold after this write. */
function keyFor(fields) {
  return expenseKey({
    spentOn: fields.spent_on,
    payee: fields.payee,
    rawAmount: fields.raw_amount,
    currency: fields.currency,
    description: fields.description,
  });
}

async function create(fields = {}) {
  const values = await relink(writableValues(fields));
  values.sync_key = keyFor(values);

  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO tb_expenses (${columns.join(', ')})
          VALUES (${placeholders.join(', ')})
       RETURNING *`,
    Object.values(values),
  );
  return rows[0];
}

/**
 * A field write. `updated_at` is set HERE, never accepted from a body.
 *
 * The key is rebuilt from the row as it will stand, so correcting an amount
 * or a date keeps the import's matching honest.
 */
async function update(id, fields = {}) {
  const values = writableValues(fields);
  if (Object.keys(values).length === 0) return findById(id);

  const current = await findById(id);
  if (!current) return null;
  await relink(values, current);
  values.sync_key = keyFor({ ...current, ...values });

  const columns = Object.keys(values);
  const sets = columns.map((c, i) => `${c} = $${i + 2}`);
  const { rows } = await pool.query(
    `UPDATE tb_expenses
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, ...Object.values(values)],
  );
  return rows[0] ?? null;
}

/**
 * A whole accepted import, in ONE transaction.
 *
 * All or nothing: half an imported file is worse than none, because the
 * only way to tell which half landed is to read every row.
 */
async function createMany(list = []) {
  if (list.length === 0) return [];
  // the people read ONCE for a whole import, not once per row
  // eslint-disable-next-line global-require
  const people = list.some((f) => f.spentBy !== undefined && f.spentByPersonId === undefined && f.spentByPhone === undefined)
    ? await require('../expenses/spender').people() : null;
  const prepared = [];
  for (const fields of list) {
    // eslint-disable-next-line no-await-in-loop
    prepared.push(await relink(writableValues(fields), null, people));
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const made = [];
    for (const values of prepared) {
      values.sync_key = keyFor(values);
      const columns = Object.keys(values);
      const { rows } = await client.query(
        `INSERT INTO tb_expenses (${columns.join(', ')})
              VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
           RETURNING *`,
        Object.values(values),
      );
      made.push(rows[0]);
    }
    await client.query('COMMIT');
    return made;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Every row in the month, for the import to compare a file against. */
function findForMonth(month) {
  const bounds = monthBounds(month);
  return pool
    .query(
      `SELECT id, spent_on, description, payee, currency, raw_amount, sync_key
         FROM tb_expenses
        WHERE spent_on >= $1 AND spent_on < $2`,
      [bounds.from, bounds.to],
    )
    .then((r) => r.rows);
}

/**
 * ONE PERSON'S OWN EXPENSES, for WhatsApp (his call 2026-10-07): what they
 * SPENT (never what they only saved), in ONE group, ONE month. By the id
 * their verified phone is, or an admin's own phone; never by a name.
 */
async function spentByPerson({ personId = null, phone = null, group, month }) {
  if (!group || (!personId && !phone)) return [];
  const bounds = monthBounds(month);
  const { rows } = await pool.query(
    `SELECT id, spent_on, description, payee, currency, raw_amount, exchange_rate, aed_amount, category, group_name, spent_by
       FROM tb_expenses
      WHERE archived_at IS NULL
        AND upper(group_name) = upper($1)
        AND spent_on >= $2 AND spent_on < $3
        AND ((spent_by_person_id IS NOT NULL AND spent_by_person_id = $4)
          OR (spent_by_phone IS NOT NULL AND spent_by_phone = $5))
      ORDER BY spent_on, id`,
    [group, bounds.from, bounds.to, personId, phone],
  );
  return rows;
}

/** A master sheet person by id, for the page's picker (migration 077). */
function personById(personId) {
  return pool
    .query('SELECT person_id, display_name FROM tb_people WHERE person_id = $1', [String(personId)])
    .then((r) => r.rows[0] ?? null);
}

/** The months there are live expenses in, newest first ('YYYY-MM'). */
function monthsWithExpenses() {
  return pool
    .query("SELECT DISTINCT to_char(spent_on, 'YYYY-MM') AS m FROM tb_expenses WHERE archived_at IS NULL ORDER BY 1 DESC LIMIT 36")
    .then((r) => r.rows.map((row) => row.m));
}

async function remove(id) {
  const { rows } = await pool.query(
    'DELETE FROM tb_expenses WHERE id = $1 RETURNING id',
    [id],
  );
  return rows[0] ?? null;
}

module.exports = {
  findAll, findById, findForMonth, options, create, createMany, update, remove, spentByPerson, personById, monthsWithExpenses,
  COLUMN_FOR, SEARCH_COLUMNS, AMOUNT_COLUMNS, WRITABLE,
  // Pure, and the part worth pinning: the month scope, the allow lists and
  // what a blank bound means. Exported so they can be tested with no
  // database.
  buildWhere, upperCurrency, monthBounds,
};
