const pool = require('../../configs/db');
const { paymentPeriodSql, payStatusSql } = require('../shared/paymentPeriod.helper');
const { personRatesSql } = require('../shared/personRates.helper');
const { ratedMonthlyTotals } = require('../shared/rates.helper');
const { PROFILE_RATE_FIELD, PROFILE_COLUMN_FOR_LOG } = require('../shared/profileRateLog.helper');
const { personPayStateSql } = require('../shared/personPayState.helper');
// A profile write changes the dead list's names and contacts, held in the rows cache.
const { invalidatingRows } = require('./invalidatingRows');

/**
 * tb_people + the deals grouped by person.
 *
 * The People page is a VIEW of tb_mastersheet, not a copy of it. A person
 * "has" seven companies because seven deals carry their person_id, not
 * because anything wrote a list somewhere. That is why nothing here can
 * drift out of step with the master sheet: there is nothing to keep in
 * step.
 *
 * tb_people itself is deliberately thin — display name, email and notes.
 * Everything a person appears to have (roles, groups,
 * companies, money, phone, bank details) is aggregated from their deals
 * on read.
 *
 * PHONE, POSTCODE AND BANK DETAILS ARE NOT SINGULAR. They legitimately
 * differ between one person's deals in the real sheet, so this returns
 * the DISTINCT set of each rather than picking one and pretending. The
 * page shows a single value when the set has one member and a list when
 * it doesn't.
 *
 * DUPLICATES ARE NOT A PROBLEM TO SOLVE. A person holding several deals
 * across several companies is the data working correctly (user's explicit
 * rule), so there is no merge, no canonical-row election, no dedupe.
 */

// A person's own columns, falling back to the name on their deals when
// tb_people has no row yet. The deals are the source of who exists; the
// profile row is created lazily on first edit, so a LEFT JOIN that misses
// is normal rather than an error.
const PERSON_COLUMNS = `
  COALESCE(p.display_name, a.person_name) AS display_name,
  COALESCE(p.email, '')                   AS email,
  COALESCE(p.notes, '')                   AS notes`;

/**
 * What counts as ONE company on a person's page: a company IN A GROUP,
 * never a bare name.
 *
 * Zayn handles Workforce for INDIGO and Workforce for MILKMAN. Those are
 * two engagements, paid separately, and counting the name alone made his
 * page read "1 active of 1" directly above a table listing both. It is
 * also the identity dealKey already uses, where the group is part of what
 * makes a pairing distinct.
 *
 * Two ROLES on one company in one group still count once, which is what
 * the distinct count was for in the first place.
 */
const companyKeySql = (prefix = 'd.') =>
  `(lower(btrim(COALESCE(${prefix}group_name, ''))), lower(btrim(COALESCE(${prefix}company, ''))))`;

/**
 * Builds the WHERE clause every listing shares.
 *
 * Filters apply to the DEALS, not to the person — "show me Directors"
 * means "people who hold at least one Director deal", and the aggregate
 * they come back with is built from the matching deals only. Filtering to
 * a role and then showing that person's totals across every other role
 * would make the number on screen answer a question nobody asked.
 */
function dealFilters({ role, group, company, method, currency, status, needsReview, q }, params) {
  // A deal whose handler was removed has no person to aggregate under, so
  // it is not a row on this page. Without the NULL check every orphaned
  // deal in the table would collapse into one nameless person, which is
  // exactly what the nullable person_id was meant to avoid (migration 030).
  // Those rows are not lost: they are on the Master Sheet page, flagged,
  // under its "Missing a person or company" filter.
  const where = ["person_id IS NOT NULL", "person_id <> ''"];

  if (role) {
    params.push(role);
    // role_label, not role — the filter list is built from what the
    // uploaded document actually says ("Mid 1", "Mid 2", "Differnce"),
    // at full granularity. User's rule: trust the sheet.
    where.push(`role_label = $${params.length}`);
  }
  if (group) {
    params.push(group);
    where.push(`upper(group_name) = upper($${params.length})`);
  }
  if (company) {
    params.push(company);
    where.push(`lower(btrim(company)) = lower(btrim($${params.length}))`);
  }
  if (method) {
    params.push(method);
    where.push(`payment_method = $${params.length}`);
  }
  if (currency) {
    params.push(currency);
    where.push(`upper(currency) = upper($${params.length})`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (needsReview !== undefined) {
    params.push(needsReview);
    where.push(`needs_review = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(person_name ILIKE $${params.length} OR phone ILIKE $${params.length})`);
  }

  return where.join(' AND ');
}

/**
 * The People page: one row per human, with everything the table shows
 * already aggregated. One round trip, including the unfiltered total.
 *
 * Money is summed PER CURRENCY and never blended — the roster is paid in
 * GBP, AED and EURO, and a single added-up number across the three would
 * be meaningless. Comes back as {"GBP": 8900, "AED": 3675}.
 */
/**
 * ===============================
 * * "GLORIA DIFFERENCE" IS GLORIA'S, ON THE PEOPLE PAGE TOO
 * ===============================
 * His call 2026-10-07. The sheet pays a top up as its own "person"; Diane
 * already counts it as the person's (agent/tools/resolvePerson.js, baseOf).
 * Here a deal's OWNER is the person whose name it extends with "difference"
 * (or "diff"), when that person exists; anyone else owns their own deals.
 * The deal rows are not touched: only who they are listed under.
 */
const DIFF = '\\s+(difference|differnce|differance|diff)\\s*$';
const ownerSql = (t) => `COALESCE((
  SELECT b.person_id FROM tb_mastersheet b
  WHERE ${t}.person_name ~* '${DIFF}'
    AND lower(trim(b.person_name)) = lower(trim(regexp_replace(${t}.person_name, '${DIFF}', '', 'i')))
    AND b.person_id <> ${t}.person_id
  LIMIT 1), ${t}.person_id)`;

async function findAll(filters = {}) {
  const { page = 1, pageSize = 25, cryptoPercent = 0, shouldBePaid, paid, paymentReceived } = filters;
  const params = [];
  const whereSql = dealFilters(filters, params);

  // PERSON filters, unlike dealFilters: they test the person's state across
  // every live deal, so they go on the joined row rather than the deals.
  const personWhere = [];
  if (shouldBePaid) { params.push(shouldBePaid); personWhere.push(`should_be_paid_state = $${params.length}`); }
  if (paid) { params.push(paid); personWhere.push(`paid_state = $${params.length}`); }
  if (paymentReceived) { params.push(paymentReceived); personWhere.push(`payment_received = $${params.length}`); }

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const result = await pool.query(
    `WITH deals AS (
       SELECT *, ${paymentPeriodSql('')} AS payment_period, ${personRatesSql()}, ${ownerSql('tb_mastersheet')} AS owner_id
       FROM tb_mastersheet WHERE ${whereSql}
     ),
     -- THE PARTS, not a SUM: add on first and the fee off the total is not
     -- a sum SQL should own. rates.helper rates them below.
     totals AS (
       SELECT owner_id AS person_id, currency, jsonb_agg(jsonb_build_object(
         'monthly_amount', monthly_amount, 'payment_method', payment_method,
         'addon_percent', addon_percent, 'fee_percent', fee_percent,
         'person_addon_percent', person_addon_percent, 'person_fee_percent', person_fee_percent)) AS parts
       FROM deals WHERE stopped_on IS NULL GROUP BY owner_id, currency -- a stopped deal is owed nothing
     ),
     totals_json AS (
       SELECT person_id, jsonb_object_agg(currency, parts) AS monthly_parts
       FROM totals GROUP BY person_id
     ),
     agg AS (
       SELECT
         d.owner_id                                              AS person_id,
         COALESCE(MAX(d.person_name) FILTER (WHERE d.person_id = d.owner_id), MAX(d.person_name)) AS person_name,
         -- whose deals are listed here as well: "Gloria difference"
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.person_name) FILTER (WHERE d.person_id <> d.owner_id), NULL) AS includes,
         ARRAY_AGG(DISTINCT d.role_label ORDER BY d.role_label)  AS roles,
         ARRAY_AGG(DISTINCT d.group_name ORDER BY d.group_name)  AS groups,
         COUNT(DISTINCT ${companyKeySql()})::int                 AS company_count,
         -- Companies they are CURRENTLY on, not deals. The People page
         -- reads "1 of 3 active" as companies, so counting deals here
         -- would show 4 of 6 for someone on three companies and quietly
         -- mean something else.
         COUNT(DISTINCT ${companyKeySql()})
           FILTER (WHERE d.payment_period = 'active')::int       AS active_company_count,
         COUNT(*)::int                                           AS deal_count,
         COUNT(*) FILTER (WHERE d.payment_period = 'active')::int AS active_count,
         -- Is this person still being paid at all: 'paying' while any one
         -- of their deals is still in its period, 'ended' once every last
         -- one has finished.
         ${payStatusSql('d')}                                     AS pay_status,
         BOOL_OR(d.needs_review)                                 AS needs_review,
         -- "One or more of this person's companies was removed." The deal
         -- survived the company being deleted and still owes them money,
         -- so it has to be visible from their side too — otherwise the
         -- only trace is a row on the Master Sheet page nobody thinks to
         -- look at.
         BOOL_OR(d.orphaned_company)                             AS missing_company,
         COUNT(*) FILTER (WHERE d.orphaned_company)::int          AS missing_company_count,
         -- The reasons themselves, not just "something is wrong". A person
         -- is an aggregate of deals, so there is no single column at fault
         -- to hang the flag on the way the Master Sheet page can; the least
         -- this can do is say WHY when asked, rather than making someone
         -- open the person to find out.
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.review_reason)
           FILTER (WHERE d.needs_review AND d.review_reason <> ''), NULL) AS review_reasons
       FROM deals d GROUP BY d.owner_id
     ),
     -- EVERY LIVE DEAL THE PERSON HOLDS, not just the ones the filters
     -- matched: a switch on this row writes to all of them, so it has to
     -- show all of them. See shared/personPayState.helper.
     pay AS (
       SELECT ${ownerSql('m')} AS person_id,
              ARRAY_AGG(m.id ORDER BY m.id) AS live_deal_ids,
              ${personPayStateSql('m')}
       FROM tb_mastersheet m
       WHERE m.person_id IS NOT NULL AND m.person_id <> '' AND m.stopped_on IS NULL
       GROUP BY 1
     ),
     joined AS (
       SELECT a.*, COALESCE(t.monthly_parts, '{}'::jsonb) AS monthly_parts, ${PERSON_COLUMNS},
              COALESCE(pay.live_deal_ids, '{}') AS live_deal_ids,
              pay.should_be_paid_state, pay.paid_state, pay.payment_received
       FROM agg a
       LEFT JOIN totals_json t ON t.person_id = a.person_id
       LEFT JOIN tb_people p   ON p.person_id = a.person_id
       LEFT JOIN pay           ON pay.person_id = a.person_id
       WHERE ${personWhere.length ? personWhere.join(' AND ') : 'true'}
     )
     SELECT
       (SELECT COUNT(*)::int FROM joined) AS total,
       COALESCE(
         (SELECT json_agg(j) FROM (
            SELECT * FROM joined ORDER BY display_name, person_id
            LIMIT $${limitParam} OFFSET $${offsetParam}
          ) j),
         '[]'
       ) AS rows`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  const rows = (result.rows[0].rows ?? []).map(({ monthly_parts: parts, ...row }) => ({
    ...row, monthly_totals: ratedMonthlyTotals(parts, { cryptoPercent }),
  }));
  return { rows, total: result.rows[0].total };
}

/**
 * The person detail page: the person, plus every deal they hold.
 *
 * Deliberately unfiltered — the detail page shows the whole picture, not
 * whatever slice the list happened to be filtered to when it was clicked.
 */
async function findById(personId) {
  const result = await pool.query(
    `WITH deals AS (
       -- The person's own two rates travel WITH the deal: the page rates
       -- every figure it shows, and without them it showed the deal's half
       -- of a stacked rate and said nothing. See shared/rates.helper.js.
       SELECT *, ${paymentPeriodSql('')} AS payment_period, ${personRatesSql()}
       FROM tb_mastersheet WHERE person_id = $1 OR ${ownerSql('tb_mastersheet')} = $1
     ),
     totals AS (
       SELECT currency, SUM(monthly_amount) AS subtotal FROM deals WHERE stopped_on IS NULL GROUP BY currency
     )
     SELECT
       $1::text AS person_id,
       COALESCE(p.display_name, (SELECT MAX(person_name) FROM deals)) AS display_name,
       COALESCE(p.email, '') AS email,
       COALESCE(p.notes, '') AS notes,
       -- THEIR OWN TWO RATES. An add on is ADDED and a fee is DEDUCTED
       -- after it, and both STACK with the ones on each deal. ::float so
       -- they arrive as numbers rather than pg numeric strings, which
       -- would concatenate the moment anything added them up.
       COALESCE(p.addon_percent, 0)::float AS addon_percent,
       COALESCE(p.fee_percent, 0)::float AS fee_percent,
       p.created_at,
       -- The fields that legitimately vary between one person's deals.
       -- Returned as sets so the page can show "one value" or "several"
       -- honestly instead of silently picking the first.
       (SELECT ARRAY_AGG(DISTINCT phone)             FROM deals WHERE phone <> '')             AS phones,
       (SELECT ARRAY_AGG(DISTINCT location)          FROM deals WHERE location <> '')          AS locations,
       (SELECT ARRAY_AGG(DISTINCT door_number)       FROM deals WHERE door_number <> '')       AS door_numbers,
       (SELECT ARRAY_AGG(DISTINCT postcode)          FROM deals WHERE postcode <> '')          AS postcodes,
       (SELECT ARRAY_AGG(DISTINCT accepting_postals) FROM deals WHERE accepting_postals <> '') AS accepting_postals,
       (SELECT ARRAY_AGG(DISTINCT bank_details)      FROM deals WHERE bank_details <> '')      AS bank_details,
       (SELECT ARRAY_AGG(DISTINCT account_number)    FROM deals WHERE account_number <> '')    AS account_numbers,
       (SELECT ARRAY_AGG(DISTINCT sort_code)         FROM deals WHERE sort_code <> '')         AS sort_codes,
       (SELECT ARRAY_AGG(DISTINCT role_label ORDER BY role_label) FROM deals)                  AS roles,
       (SELECT ARRAY_AGG(DISTINCT group_name ORDER BY group_name) FROM deals)                  AS groups,
       (SELECT COUNT(*)::int FROM deals)                                                       AS deal_count,
       (SELECT COUNT(*) FILTER (WHERE payment_period = 'active')::int FROM deals)              AS active_count,
       (SELECT CASE WHEN COUNT(*) FILTER (WHERE payment_period = 'active') > 0
                    THEN 'paying' ELSE 'ended' END FROM deals)                                  AS pay_status,
       -- These two exist on findAll's aggregate too. Missing here, the
       -- detail page's Companies card read "undefined active of
       -- undefined" — the counts are per COMPANY, not per deal, because
       -- that card is labelled Companies.
       (SELECT COUNT(DISTINCT ${companyKeySql('')})::int FROM deals)                           AS company_count,
       (SELECT COUNT(DISTINCT ${companyKeySql('')}) FILTER (WHERE payment_period = 'active')::int FROM deals) AS active_company_count,
       (SELECT jsonb_object_agg(currency, subtotal) FROM totals)                               AS monthly_totals,
       -- The header's switches and tag, over live deals. See personPayState.helper.
       pay.should_be_paid_state, pay.paid_state, pay.payment_received,
       COALESCE((SELECT json_agg(d ORDER BY d.group_name, d.company, d.role_label) FROM deals d), '[]') AS deals
     FROM (SELECT 1) _
     LEFT JOIN tb_people p ON p.person_id = $1
     LEFT JOIN (SELECT ${personPayStateSql('d')} FROM deals d WHERE d.stopped_on IS NULL HAVING COUNT(*) > 0) pay ON true`,
    [personId],
  );

  const row = result.rows[0];
  // A person with no tb_people row AND no deals doesn't exist. A person
  // with deals but no tb_people row does — the sheet is the source of who
  // exists, and the profile row is created lazily on first edit.
  if (!row || (row.deal_count === 0 && !row.created_at)) return null;
  return row;
}

/**
 * Filter options, built from the data rather than a hardcoded list.
 *
 * The user's rule is "trust the sheet": if next month's upload introduces
 * a role nobody has seen before, it appears in the filter by itself. A
 * constant in the frontend would have to be edited every time the boss
 * invents a job title, and until someone noticed, those people would be
 * invisible behind every filter.
 */
async function filterOptions() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT ARRAY_AGG(x ORDER BY x) FROM (SELECT DISTINCT role_label AS x FROM tb_mastersheet WHERE role_label <> '') r)  AS roles,
       (SELECT ARRAY_AGG(x ORDER BY x) FROM (SELECT DISTINCT group_name AS x FROM tb_mastersheet WHERE group_name <> '') g)  AS groups,
       (SELECT ARRAY_AGG(x ORDER BY x) FROM (SELECT DISTINCT btrim(company) AS x FROM tb_mastersheet WHERE btrim(COALESCE(company,'')) <> '') c) AS companies,
       (SELECT ARRAY_AGG(x ORDER BY x) FROM (SELECT DISTINCT payment_method AS x FROM tb_mastersheet WHERE payment_method <> '') m) AS methods,
       (SELECT ARRAY_AGG(x ORDER BY x) FROM (SELECT DISTINCT currency AS x FROM tb_mastersheet WHERE currency <> '') cu) AS currencies,
       (SELECT ARRAY_AGG(x ORDER BY x) FROM (SELECT DISTINCT location AS x FROM tb_mastersheet WHERE location <> '') l) AS locations,
       -- NAME AND ID TOGETHER. A picker that narrows an export has to send
       -- the id: person_id is exact, where a name is matched as text and a
       -- short one catches more people than anybody means. DISTINCT ON so a
       -- person holding nine deals is one option, not nine.
       (SELECT JSON_AGG(p ORDER BY p.name)
          FROM (SELECT DISTINCT ON (person_id) person_id AS "personId", person_name AS name
                  FROM tb_mastersheet
                 WHERE person_name <> '' AND person_id IS NOT NULL
                 ORDER BY person_id, person_name) p) AS people`,
  );
  const r = rows[0];
  return {
    roles: r.roles ?? [],
    groups: r.groups ?? [],
    companies: r.companies ?? [],
    methods: r.methods ?? [],
    currencies: r.currencies ?? [],
    locations: r.locations ?? [],
    // Everyone already on the roster, so picking an existing person is a
    // pick rather than a retype that creates a near-duplicate.
    people: r.people ?? [],
  };
}

/**
 * Upsert rather than insert: the sheet decides who exists, so a person
 * usually already has deals by the time anyone edits their profile. This
 * is the row being created lazily on that first edit.
 */
/**
 * ===============================
 * * A PROFILE RATE IS LOGGED ON EVERY DEAL IT REACHES
 * ===============================
 * It reaches all of them, and it was written nowhere at all: a 5% add on
 * appearing on eight rows had no entry in History and nothing to undo.
 * `tb_mastersheet_changes` is the one change log, and it is keyed by ROW,
 * so a profile change is one entry per deal, named for the LEVEL it was
 * set at so it can never be read as the deal's own rate.
 *
 * The field names are the camelCase the log already speaks. They are NOT
 * `COLUMN_FOR` keys on tb_mastersheet: an undo puts the PROFILE back, via
 * `revertProfileRate` below, never the row.
 */
// `via` and `batchId` because Diane's rate writes were logged as 'admin', and
// one act across five people has to come back as ONE batch to undo.
async function logProfileRates(client, personId, before, after, { via = 'admin', batchId = null } = {}) {
  for (const { column, field } of Object.values(PROFILE_RATE_FIELD)) {
    const was = Number(before?.[column] ?? 0);
    const now = Number(after?.[column] ?? 0);
    if (was === now) continue;
    // ONE ENTRY PER DEAL, written from the deals themselves: the log is
    // keyed by row, and a person with no deals leaves no entries.
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO tb_mastersheet_changes
         (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
       SELECT id, person_name, $2, $3, $4, $5, $6 FROM tb_mastersheet WHERE person_id = $1`,
      [personId, field, String(was), String(now), via, batchId],
    );
  }
}

/**
 * ===============================
 * * THE FIRST EDIT WROTE THE SLUG AS THEIR NAME
 * ===============================
 * The lazy insert defaulted display_name to person_id, so one rate edit
 * turned "Gloria difference" into "gloria-difference" on the People page.
 * Default to the name on their deals; the slug only when there are none.
 */
const NAME_FROM_DEALS = `(SELECT person_name FROM tb_mastersheet
                           WHERE person_id = $1 AND btrim(COALESCE(person_name, '')) <> ''
                           ORDER BY id LIMIT 1)`;

async function upsert({
  personId, displayName, email, notes, addonPercent, feePercent,
}, { via = 'admin', batchId = null } = {}) {
  // ITS OWN CONNECTION, because the read, the write and the log entries
  // are one act: a rate logged against a value that moved underneath it is
  // a History line that never happened.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: held } = await client.query(
      'SELECT addon_percent, fee_percent FROM tb_people WHERE person_id = $1',
      [personId],
    );
    const { rows } = await client.query(
      // EVERY FIELD IS OPTIONAL AND A NULL MEANS "LEAVE IT". One PATCH sets
      // a note and another sets a rate, so a parameter that was not sent
      // has to keep what is there rather than writing a default over it.
      `INSERT INTO tb_people (person_id, display_name, email, notes, addon_percent, fee_percent)
       VALUES ($1::text, COALESCE($2::text, ${NAME_FROM_DEALS}, $1::text),
               COALESCE($3::text, ''), COALESCE($4::text, ''),
               COALESCE($5::numeric, 0), COALESCE($6::numeric, 0))
       ON CONFLICT (person_id) DO UPDATE SET
         -- $2, never EXCLUDED: EXCLUDED carries the insert's fallback, so a
         -- rate edit wrote that fallback over a name somebody had chosen.
         display_name  = COALESCE($2::text, tb_people.display_name),
         email         = COALESCE($3::text, tb_people.email),
         notes         = COALESCE($4::text, tb_people.notes),
         addon_percent = COALESCE($5::numeric, tb_people.addon_percent),
         fee_percent   = COALESCE($6::numeric, tb_people.fee_percent),
         updated_at    = now()
       RETURNING *`,
      [
        personId, displayName ?? null, email ?? null, notes ?? null,
        addonPercent ?? null, feePercent ?? null,
      ],
    );
    await logProfileRates(client, personId, held[0], rows[0], { via, batchId });
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ===============================
 * * UNDOING A PROFILE RATE PUTS THE PROFILE BACK
 * ===============================
 * One profile change is one log entry per deal, all one act. The first entry
 * reverted writes tb_people and closes its siblings, so the rest of a batch
 * reads as already covered, not as failures. `covers` names them.
 *
 * Refused when the profile has moved since: putting back 0 over a later 8
 * would undo a change nobody pointed at.
 */
async function revertProfileRate(change, { via = 'admin' } = {}) {
  const column = PROFILE_COLUMN_FOR_LOG[change.field];
  if (!column) return { ok: false, reason: `"${change.field}" is not a profile rate.` };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: owner } = await client.query(
      'SELECT person_id FROM tb_mastersheet WHERE id = $1',
      [change.row_id],
    );
    const personId = owner[0]?.person_id;
    if (!personId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'The deal it belonged to has no person any more.' };
    }
    const { rows: held } = await client.query(
      'SELECT addon_percent, fee_percent FROM tb_people WHERE person_id = $1 FOR UPDATE',
      [personId],
    );
    const now = Number(held[0]?.[column] ?? 0);
    if (now !== Number(change.new_value)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: `their profile has changed since: it is ${now}% now, not ${Number(change.new_value)}%`,
      };
    }
    const { rows: after } = await client.query(
      `UPDATE tb_people SET ${column} = $2::numeric, updated_at = now()
        WHERE person_id = $1 RETURNING addon_percent, fee_percent`,
      [personId, Number(change.old_value) || 0],
    );
    await logProfileRates(client, personId, held[0], after[0], { via });
    // THE SAME ACT: same field, same transaction time, same person. The time
    // is read in SQL: a JS Date drops the microseconds and matches nothing.
    const { rows: covered } = await client.query(
      `UPDATE tb_mastersheet_changes c SET reverted_at = now()
         FROM tb_mastersheet m
        WHERE m.id = c.row_id AND m.person_id = $1
          AND c.field = $2 AND c.reverted_at IS NULL
          AND c.changed_at = (SELECT changed_at FROM tb_mastersheet_changes WHERE id = $3)
      RETURNING c.id`,
      [personId, change.field, change.id],
    );
    await client.query('COMMIT');
    return {
      ok: true,
      personId,
      field: change.field,
      value: change.old_value,
      covers: covered.map((r) => r.id),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * person_id -> { addon, fee }, for every profile carrying one.
 *
 * ONE ROUND TRIP for a whole month. The breakdown, the totals, the export
 * and Diane all rate every row they touch, and asking per person would be
 * a query per row. Only the profiles that carry a rate come back, so a
 * sheet with none costs one empty result.
 *
 * The keys are what `shared/rates.helper.js` `ratesFor` expects, which is
 * why they are `addon` and `fee` rather than the column names.
 */
async function rateMap() {
  const { rows } = await pool.query(
    `SELECT person_id,
            COALESCE(addon_percent, 0)::float AS addon,
            COALESCE(fee_percent, 0)::float   AS fee
       FROM tb_people
      WHERE COALESCE(addon_percent, 0) <> 0 OR COALESCE(fee_percent, 0) <> 0`,
  );
  return new Map(rows.map((r) => [r.person_id, { addon: r.addon, fee: r.fee }]));
}

/**
 * ===============================
 * * THERE IS NO `remove`, AND THERE MUST NOT BE ONE
 * ===============================
 * NOTHING DELETES A PERSON. Decided 2026-09-14: both DELETE routes,
 * `peopleRepo.remove`, `rowsRepo.orphanPerson` and Diane's `delete_person`
 * went in one change, so detaching is impossible and nothing can create a
 * new orphan. REMOVE, on a deal's trash button, is the only one left and
 * it ends one PAIRING. See `.claude/CLAUDE.md` "Delete vs Remove".
 */

/**
 * People who share a phone number, or whose names are near-identical.
 *
 * Surfaced, never acted on. The user's rule is explicit — no merging —
 * so this exists to let a human notice that "Dean Cole" and "Darren cole"
 * are two people and that four rows share one phone, not to do anything
 * about it automatically.
 */
async function possibleDuplicates() {
  const { rows } = await pool.query(
    `SELECT phone, ARRAY_AGG(DISTINCT person_name ORDER BY person_name) AS names
     FROM tb_mastersheet
     WHERE phone <> '' AND phone !~* 'handled|internal|never'
     GROUP BY phone
     HAVING COUNT(DISTINCT person_id) > 1`,
  );
  return rows;
}

module.exports = {
  findAll, findById, filterOptions, rateMap, possibleDuplicates,
  upsert: invalidatingRows(upsert),
  revertProfileRate: invalidatingRows(revertProfileRate),
};
