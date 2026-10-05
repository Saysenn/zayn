const pool = require('../../configs/db');
const { paymentPeriodSql } = require('../shared/paymentPeriod.helper');
const { personRatesSql } = require('../shared/personRates.helper');
const { ratedMonthlyTotals } = require('../shared/rates.helper');
const {
  COMPANY_LOGGED_FIELD, COMPANY_COLUMN_FOR_LOG, COMPANY_PROP_FOR_LOG, loggedText,
} = require('../shared/companyFieldLog.helper');

/**
 * ===============================
 * * FOUR STATUSES, AND TWO OF THEM END EVERY DEAL
 * ===============================
 * The COMPANY status, the only thing the UI may call Status (CLAUDE.md:
 * three different things have been called that). Migration 058's CHECK
 * pins the same four.
 *
 * `dissolved` and `closed` are both terminal and behave identically here.
 * They differ only in what they SAY happened, which is the whole point of
 * having two: one company ceased to exist, the other we walked away from,
 * and an audit asks which.
 *
 * `liquidation` IS STILL PAYING, reduced, per deal. It is not terminal and
 * nothing here works out an amount from it: see docs/closure.md section 6.
 */
const COMPANY_STATUS = Object.freeze({
  ACTIVE: 'active',
  /**
   * HIS OWN WORD, from the end date column of the September sheet, on 19
   * deals. It means trading and expected to keep trading, so it behaves
   * exactly like ACTIVE for money: `isTerminal` is the only test that
   * branches on status and it names dissolved and closed alone.
   *
   * It exists as a status rather than only a note so the Companies page can
   * be filtered to them and the end date cell can say why it is blank.
   */
  GOING_CONCERN: 'going_concern',
  /**
   * HIS CALL 2026-09-21: "the company is subject for monthly review".
   *
   * NOT LIQUIDATION, and the difference is money. Liquidation is a
   * negotiation with a settlement and an amount set per deal; this only
   * says ask me about this company every month. Nothing here sets a figure.
   *
   * Like liquidation it asks the question through the CHECKLIST, never
   * across the whole company: see the queue's own banner.
   */
  REVIEW: 'review',
  LIQUIDATION: 'liquidation',
  DISSOLVED: 'dissolved',
  CLOSED: 'closed',
});

const TERMINAL = Object.freeze([COMPANY_STATUS.DISSOLVED, COMPANY_STATUS.CLOSED]);

const isTerminal = (status) => TERMINAL.includes(status);

/**
 * ===============================
 * * THE TWO STATUSES THAT ASK ABOUT THEIR DEALS EVERY MONTH
 * ===============================
 * A company winding down is asked about every month, end date or not, and
 * so is one he has put under review. Both ask the SAME way: through the
 * checklist on the status screen, per deal.
 *
 * THEY DO NOT PUT EVERY DEAL IN THE QUEUE. That is what changed on
 * 2026-09-21: the SQL used to ask "is this company in liquidation", so the
 * checklist promised "ticked deals join the Review list" and unticking one
 * removed nothing. His call: he marks a company and then chooses which of
 * its deals it actually touches.
 *
 * The broadcast that tells the pages the queue moved reads this too:
 * written twice, a status change added rows and nothing on screen was told,
 * so the Review button kept its old count until a reload.
 */
const REVIEWED_MONTHLY = Object.freeze([COMPANY_STATUS.LIQUIDATION, COMPANY_STATUS.REVIEW]);

const isReviewedMonthly = (status) => REVIEWED_MONTHLY.includes(status);

/**
 * tb_companies + the deals grouped by company.
 *
 * Same shape as people.repo.js and for the same reason: the Companies
 * page is a VIEW of tb_mastersheet. A company "has" four handlers because
 * four deals name it, not because a list is stored anywhere.
 *
 * NO STORED MONTHLY AMOUNT, NO STORED HANDLER LIST. Both were asked for
 * and both are wrong, for the same reason — they would be a second copy
 * of a fact the deals already hold, and would be stale the first time
 * anyone edited a deal. The monthly total is SUM(monthly_amount) computed
 * here, per currency, on every read.
 *
 * There is also no single per-company rate to store even if we wanted
 * one: 20 of the 28 multi-handler companies in the real sheet pay their
 * handlers different negotiated amounts (Souracore pays its Director
 * £1,800 and its Mid £700; Red Horizon pays its Mid MORE than its
 * Director). The amount belongs to the deal.
 *
 * COMPANIES ARE MATCHED CASE-INSENSITIVELY AND WHITESPACE-INSENSITIVELY.
 * The sheet contains "Relia PA" and "Relia Pa" — one company typed twice —
 * and "Reliapay back runner " with a trailing space. Grouping on the raw
 * text would show them as separate companies with separate teams. The
 * normalized form is the grouping key everywhere below; the display name
 * comes from tb_companies when it has a row, so renaming there is what
 * fixes the spelling for good.
 *
 * A COMPANY IS NOT SCOPED TO A GROUP. `Workforce` spans INDIGO, MILKMAN,
 * MANBAT and ALL BOOKS across 21 deals, and the user confirmed that is
 * one company. The group belongs to the deal.
 */

// The one normalization rule, written once. Any query that groups deals
// by company must use exactly this or two views of the same page will
// disagree about how many companies there are.
const CKEY = `lower(regexp_replace(btrim(company), '\\s+', ' ', 'g'))`;

/**
 * The Companies page. One row per company with its team already counted
 * and its money already summed, per currency, never blended.
 */
async function findAll({
  q, group, status, oldGroup, page = 1, pageSize = 25, cryptoPercent = 0,
} = {}) {
  const params = [];
  const where = [`company IS NOT NULL`, `btrim(company) <> ''`];

  if (group) {
    params.push(group);
    where.push(`upper(group_name) = upper($${params.length})`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`company ILIKE $${params.length}`);
  }

  let statusSql = '';
  if (status) {
    params.push(status);
    statusSql = `AND COALESCE(c.status, 'active') = $${params.length}`;
  }

  // HIS OWN EARLIER GROUP NAME, never one of ours. Folded on case only:
  // the values are free text he typed (Milky, Wallaby 1, V3) and must not
  // be matched against group_name.
  let oldGroupSql = '';
  if (oldGroup) {
    params.push(oldGroup);
    oldGroupSql = `AND lower(btrim(c.old_group)) = lower(btrim($${params.length}))`;
  }

  /**
   * A COMPANY WITH NO DEALS IS STILL A COMPANY when they ask by status. This
   * list is built FROM the deals, so "which companies are a going concern?"
   * answered "none" while ZZ Staying Co was one, with no deals. 2026-10-03.
   * Only for a status or old group question: the plain page lists what the
   * sheet holds, as before.
   */
  const emptyToo = Boolean(status || oldGroup) && !group;
  const qParam = q ? params.findIndex((v) => v === `%${q}%`) + 1 : null;

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const result = await pool.query(
    `WITH deals AS (
       SELECT *, ${CKEY} AS ckey, ${paymentPeriodSql('')} AS payment_period, ${personRatesSql()}
       FROM tb_mastersheet WHERE ${where.join(' AND ')}
     ),
     -- THE PARTS, not a SUM. See people.repo findAll.
     totals AS (
       SELECT ckey, currency, jsonb_agg(jsonb_build_object(
         'monthly_amount', monthly_amount, 'payment_method', payment_method,
         'addon_percent', addon_percent, 'fee_percent', fee_percent,
         'person_addon_percent', person_addon_percent, 'person_fee_percent', person_fee_percent)) AS parts
       FROM deals WHERE stopped_on IS NULL GROUP BY ckey, currency -- a stopped deal is owed nothing
     ),
     totals_json AS (
       SELECT ckey, jsonb_object_agg(currency, parts) AS monthly_parts
       FROM totals GROUP BY ckey
     ),
     agg AS (
       SELECT
         d.ckey,
         MAX(btrim(d.company))                                  AS sheet_name,
         ARRAY_AGG(DISTINCT d.group_name ORDER BY d.group_name) AS groups,
         COUNT(*)::int                                          AS deal_count,
         COUNT(DISTINCT d.person_id)::int                       AS handler_count,
         COUNT(*) FILTER (WHERE d.payment_period = 'active')::int AS active_count,
         BOOL_OR(d.needs_review)                                AS needs_review,
         -- "One or more handlers on this company were removed." The deal
         -- survived the person being deleted, so the company still has a
         -- seat with nobody in it, and this is where somebody would look.
         BOOL_OR(d.orphaned_person)                             AS missing_handler,
         COUNT(*) FILTER (WHERE d.orphaned_person)::int         AS missing_handler_count
       FROM deals d GROUP BY d.ckey
     ),
     joined AS (
       SELECT
         a.*,
         COALESCE(t.monthly_parts, '{}'::jsonb) AS monthly_parts,
         c.company_id,
         -- The canonical spelling wins when tb_companies has a row for
         -- this company; otherwise whatever the sheet last called it.
         COALESCE(c.name, a.sheet_name)          AS name,
         COALESCE(c.status, 'active')            AS status,
         c.closed_on                             AS closed_on,
         c.liquidation_total::float              AS liquidation_total,
         -- No COALESCE: NULL means nobody has said what kind of company
         -- this is, which is a different fact from any tier we could
         -- invent as a default.
         c.tier                                  AS tier,
         -- His own earlier name for the group. No COALESCE for the same
         -- reason tier has none: nobody has said is not the same as blank.
         c.old_group                             AS old_group,
         COALESCE(c.notes, '')                   AS notes
       FROM agg a
       LEFT JOIN totals_json t ON t.ckey = a.ckey
       LEFT JOIN tb_companies c ON lower(c.name) = a.ckey
       WHERE true ${statusSql} ${oldGroupSql}
         -- LIVE DEALS ONLY, like the dashboard's count: a company whose every
         -- deal is stopped by hand is not listed (it showed 32 against the
         -- dashboard's 30). A closed or liquidating one stays, because
         -- closing stops its deals and it must still be reopenable. 2026-10-05.
         AND (EXISTS (SELECT 1 FROM deals l WHERE l.ckey = a.ckey AND l.stopped_on IS NULL)
              OR COALESCE(c.status, 'active') <> 'active')
       ${emptyToo ? `UNION ALL
       SELECT ${keySql('c.name')}, c.name, ARRAY[]::text[], 0, 0, 0, false, false, 0,
              '{}'::jsonb, c.company_id, c.name, COALESCE(c.status, 'active'), c.closed_on,
              c.liquidation_total::float, c.tier, c.old_group, COALESCE(c.notes, '')
         FROM tb_companies c
        WHERE NOT EXISTS (SELECT 1 FROM agg a WHERE a.ckey = ${keySql('c.name')})
          ${q ? `AND c.name ILIKE $${qParam}` : ''} ${statusSql} ${oldGroupSql}` : ''}
     )
     SELECT
       (SELECT COUNT(*)::int FROM joined) AS total,
       COALESCE(
         (SELECT json_agg(j) FROM (
            SELECT * FROM joined ORDER BY name LIMIT $${limitParam} OFFSET $${offsetParam}
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
 * One company and its full team. `key` is the normalized name, which is
 * what the list rows carry — not the company_id, because a company that
 * only exists in the deals has no tb_companies row yet.
 */
async function findByKey(key) {
  const ckey = String(key ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const result = await pool.query(
    `WITH deals AS (
       -- The HANDLER's own two rates, carried so the page can rate the
       -- figures it shows. They stack with the deal's: see
       -- shared/rates.helper.js.
       SELECT *, ${paymentPeriodSql('')} AS payment_period, ${personRatesSql()}
       FROM tb_mastersheet
       WHERE company IS NOT NULL AND ${CKEY} = $1
     ),
     totals AS (
       SELECT currency, SUM(monthly_amount) AS subtotal FROM deals WHERE stopped_on IS NULL GROUP BY currency
     )
     SELECT
       $1::text AS ckey,
       COALESCE(c.name, (SELECT MAX(btrim(company)) FROM deals)) AS name,
       c.company_id,
       COALESCE(c.status, 'active') AS status,
       c.closed_on                  AS closed_on,
       -- ::float so it reaches the browser as a number, not a pg numeric
       -- string that would concatenate when added to a deal's amount.
       c.liquidation_total::float   AS liquidation_total,
       c.tier                       AS tier,
       c.old_group                  AS old_group,
       COALESCE(c.notes, '')        AS notes,
       (SELECT ARRAY_AGG(DISTINCT group_name ORDER BY group_name) FROM deals) AS groups,
       (SELECT COUNT(*)::int FROM deals)                                      AS deal_count,
       (SELECT COUNT(DISTINCT person_id)::int FROM deals)                     AS handler_count,
       (SELECT COUNT(*)::int FROM deals WHERE orphaned_person)                AS missing_handler_count,
       (SELECT jsonb_object_agg(currency, subtotal) FROM totals)              AS monthly_totals,
       COALESCE((SELECT json_agg(d ORDER BY d.role_label, d.person_name) FROM deals d), '[]') AS deals
     FROM (SELECT 1) _
     LEFT JOIN tb_companies c ON lower(c.name) = $1`,
    [ckey],
  );

  const row = result.rows[0];
  if (!row || (row.deal_count === 0 && !row.company_id)) return null;
  return row;
}

/**
 * Rename a company, and carry the rename onto every deal that names it.
 *
 * This is the Companies page's real job — the user's words: "assigning
 * and cleaning the datas". "Relia PA" and "Relia Pa" are one company, and
 * renaming has to fix BOTH the canonical row and the 4 deals, or the next
 * upload's grouping key silently splits them again.
 *
 * One transaction: a rename that updated tb_companies but not the deals
 * would leave a company nothing points at.
 */
async function rename(ckey, newName) {
  const from = String(ckey ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const to = String(newName ?? '').trim().replace(/\s+/g, ' ');
  if (!to) throw new Error('A company name cannot be empty');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /**
     * ===============================
     * * THE COMPANY ROW IS RENAMED, NOT REPLACED
     * ===============================
     * This upserted a row under the NEW name and never touched the old one.
     * Live 2026-10-03: "Souracore" -> "Souracore Ltd" left Souracore (tier
     * TBC, old group NA) behind and made a bare Souracore Ltd with neither.
     *
     * Old row only: it takes the new name, keeping everything on it.
     * Both exist: a merge into the new one, filling its blanks from the
     * old, then the old row goes. Neither: a plain new row, as before.
     */
    const rowOf = async (key) => (await client.query(
      `SELECT * FROM tb_companies WHERE ${keySql('name')} = $1 FOR UPDATE`, [key],
    )).rows[0] ?? null;
    const old = await rowOf(from);
    const target = await rowOf(companyKey(to));
    if (old && (!target || target.company_id === old.company_id)) {
      await client.query(
        'UPDATE tb_companies SET name = $2, updated_at = now() WHERE company_id = $1',
        [old.company_id, to],
      );
    } else if (old && target) {
      await client.query(
        `UPDATE tb_companies t
            SET name = $2,
                tier = COALESCE(NULLIF(t.tier, ''), o.tier),
                old_group = COALESCE(NULLIF(t.old_group, ''), o.old_group),
                notes = CASE WHEN COALESCE(t.notes, '') = '' THEN o.notes
                             WHEN COALESCE(o.notes, '') = '' OR o.notes = t.notes THEN t.notes
                             ELSE t.notes || E'\n' || o.notes END,
                status = CASE WHEN t.status = 'active' THEN o.status ELSE t.status END,
                closed_on = COALESCE(t.closed_on, o.closed_on),
                liquidation_total = COALESCE(t.liquidation_total, o.liquidation_total),
                updated_at = now()
           FROM tb_companies o
          WHERE t.company_id = $1 AND o.company_id = $3`,
        [target.company_id, to, old.company_id],
      );
      await client.query('DELETE FROM tb_companies WHERE company_id = $1', [old.company_id]);
    } else if (target) {
      await client.query('UPDATE tb_companies SET name = $2, updated_at = now() WHERE company_id = $1', [target.company_id, to]);
    } else {
      await client.query('INSERT INTO tb_companies (name) VALUES ($1)', [to]);
    }

    // Every deal carrying any spelling of the old name now carries the
    // new one exactly. Deliberately NOT marked as a manual override: this
    // is a spelling correction, not a business decision about this deal,
    // and freezing the company column would stop a genuine future rename
    // in the sheet from ever landing.
    const updated = await client.query(
      `UPDATE tb_mastersheet SET company = $2, updated_at = now()
       WHERE company IS NOT NULL AND ${CKEY} = $1`,
      [from, to],
    );

    await client.query('COMMIT');
    return { renamed: to, dealsUpdated: updated.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Status and notes. The name goes through rename() so the deals follow.
 *
 * Creates the tb_companies row on first edit if the company so far only
 * exists in the deals — taking its display name from the sheet's own
 * spelling, NOT from the lowercased grouping key, which would write
 * "relia pa" into the page as the company's name.
 */
// The key every company is matched on: trimmed, spaces collapsed, lowercased. In SQL, CKEY on any column.
const keySql = (column) => CKEY.replace('company', column);
const companyKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// The logged columns as they stand, read with the write so the log and it agree.
const LOGGED_COLUMNS = Object.values(COMPANY_LOGGED_FIELD).map(({ column }) => column).join(', ');

/**
 * ONE ENTRY PER DEAL on the company, the way a profile rate is logged: the log
 * is keyed by row, so History and undo reach a tier change. No deals, no entries.
 */
async function logCompanyFields(client, key, before, after, { via = 'admin', batchId = null } = {}) {
  for (const { column, field } of Object.values(COMPANY_LOGGED_FIELD)) {
    const was = loggedText(column, before?.[column]);
    const now = loggedText(column, after?.[column]);
    if (was === now) continue;
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO tb_mastersheet_changes
         (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
       SELECT id, COALESCE(person_name, ''), $2, $3, $4, $5, $6
         FROM tb_mastersheet WHERE company IS NOT NULL AND ${CKEY} = $1`,
      [key, field, was, now, via, batchId],
    );
  }
}

// Runs `fn(client)` in one transaction, so a write and its log land together.
async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query(out?.ok === false ? 'ROLLBACK' : 'COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(ckey, fields, stamp = {}) {
  return inTransaction((client) => writeCompany(client, companyKey(ckey), fields, stamp));
}

async function writeCompany(client, key, {
  status, notes, tier, oldGroup, liquidationTotal, closedOn,
}, stamp = {}) {
  const { rows: held } = await client.query(
    `SELECT ${LOGGED_COLUMNS} FROM tb_companies WHERE lower(name) = $1 FOR UPDATE`,
    [key],
  );
  const { rows } = await client.query(
    `INSERT INTO tb_companies (name, status, notes, tier, old_group, liquidation_total, closed_on)
     SELECT
       COALESCE(
         (SELECT MAX(btrim(company)) FROM tb_mastersheet WHERE company IS NOT NULL AND ${CKEY} = $1::text),
         $1::text
       ),
       COALESCE($2::text, 'active'),
       COALESCE($3::text, ''),
       $4::text,
       $5::text,
       NULLIF($6::text, '')::numeric,
       NULLIF($7::text, '')::date
     ON CONFLICT (lower(name)) DO UPDATE SET
       status = COALESCE($2::text, tb_companies.status),
       notes  = COALESCE($3::text, tb_companies.notes),
       -- THE SAME THREE STATES tier and old_group have, and passed as text
       -- for exactly that reason: a figure, cleared with '', or not
       -- mentioned. A renegotiated settlement has to be able to go back to
       -- "nobody has agreed a number", which a nullable number cannot say.
       liquidation_total = CASE WHEN $6::text IS NULL THEN tb_companies.liquidation_total
                                WHEN $6::text = ''    THEN NULL
                                ELSE $6::numeric END,
       -- Written by the route when the status becomes terminal and cleared
       -- when it stops being, so it always agrees with the status beside it.
       closed_on = CASE WHEN $7::text IS NULL THEN tb_companies.closed_on
                        WHEN $7::text = ''    THEN NULL
                        ELSE $7::date END,
       -- '' clears it, NULL leaves it. Without the distinction there is no
       -- way back to "nobody has said", only to some other tier.
       tier   = CASE WHEN $4::text IS NULL THEN tb_companies.tier
                     WHEN $4::text = ''    THEN NULL
                     ELSE $4::text END,
       -- Same three states, and for the same reason: his own earlier group
       -- name is either recorded, cleared, or not mentioned by this write.
       old_group = CASE WHEN $5::text IS NULL THEN tb_companies.old_group
                        WHEN $5::text = ''    THEN NULL
                        ELSE $5::text END,
       updated_at = now()
     RETURNING *`,
    [
      key, status ?? null, notes ?? null, tier ?? null, oldGroup ?? null,
      // `?? null` and not `|| null`: '' is the CLEAR and must survive.
      liquidationTotal ?? null, closedOn ?? null,
    ],
  );
  await logCompanyFields(client, key, held[0] ?? null, rows[0], stamp);
  return rows[0];
}

/**
 * ===============================
 * * PUT A COMPANY DETAIL BACK
 * ===============================
 * Keyed by the logged ROW, so the company is read off that deal. Refused when
 * the value has moved since: undo restores what was replaced, never a guess.
 */
async function revertCompanyField(change, { via = 'admin' } = {}) {
  const column = COMPANY_COLUMN_FOR_LOG[change.field];
  if (!column) return { ok: false, reason: `"${change.field}" is not a company detail.` };
  return inTransaction(async (client) => {
    const { rows: owner } = await client.query(
      `SELECT ${CKEY} AS ckey FROM tb_mastersheet WHERE id = $1 AND company IS NOT NULL`,
      [change.row_id],
    );
    const key = owner[0]?.ckey;
    if (!key) return { ok: false, reason: 'The deal it belonged to has no company any more.' };
    const { rows: held } = await client.query(
      `SELECT ${column} AS value FROM tb_companies WHERE lower(name) = $1 FOR UPDATE`,
      [key],
    );
    const now = loggedText(column, held[0]?.value);
    if (now !== loggedText(column, change.new_value)) {
      return {
        ok: false,
        reason: `the company has changed since: it is ${now ?? 'blank'} now, not ${change.new_value ?? 'blank'}`,
      };
    }
    // '' is the CLEAR in the three states, so "was nothing" goes back to nothing.
    const prop = COMPANY_PROP_FOR_LOG[change.field];
    const saved = await writeCompany(client, key, { [prop]: change.old_value ?? '' }, { via });
    // THE SAME ACT: same field, same time, same company. Time read in SQL, as the profile undo does.
    const { rows: covered } = await client.query(
      `UPDATE tb_mastersheet_changes c SET reverted_at = now()
         FROM tb_mastersheet m
        WHERE m.id = c.row_id AND m.company IS NOT NULL
          AND ${keySql('m.company')} = $1
          AND c.field = $2 AND c.reverted_at IS NULL
          AND c.changed_at = (SELECT changed_at FROM tb_mastersheet_changes WHERE id = $3)
      RETURNING c.id`,
      [key, change.field, change.id],
    );
    return {
      ok: true,
      company: saved?.name ?? key,
      field: change.field,
      value: change.old_value,
      covers: covered.map((r) => r.id),
    };
  });
}

/**
 * Every company that has a tier, keyed the way deals are matched.
 *
 * For the export's per-group summary table, which prints a company's tier
 * beside its director and mid. Companies with no tier are left out
 * entirely rather than mapped to '': the caller then cannot tell the
 * difference between "no tier" and "no row", and both print the same
 * blank cell anyway.
 */
async function tierMap() {
  const { rows } = await pool.query(
    "SELECT lower(btrim(name)) AS ckey, tier FROM tb_companies WHERE tier IS NOT NULL AND tier <> ''",
  );
  return new Map(rows.map((r) => [r.ckey, r.tier]));
}

/**
 * ===============================
 * * Tiers accepted off an upload's company table.
 * ===============================
 * One statement, not a loop: seventeen round trips for one accepted tab is
 * seventeen chances to half-write it.
 *
 * MATCHED ON A FOLDED NAME, the same fold tb_companies' own unique index
 * uses (migration 026), so "Relia PA" and "Relia Pa" are one company here
 * as everywhere else.
 *
 * A name with no row is INSERTED. The diff has already decided which names
 * are safe to create: anything resembling a company we hold is flagged
 * there and never reaches this.
 *
 * @param {{company: string, tier: string}[]} pairs
 * @returns {Promise<number>} rows written
 */
async function setTiers(pairs, stamp = {}) {
  const clean = (pairs ?? []).filter((p) => String(p?.company ?? '').trim());
  if (clean.length === 0) return 0;
  return inTransaction((client) => writeTiers(client, clean, { via: 'upload', ...stamp }));
}

async function writeTiers(client, clean, stamp) {
  // Before and after, so an accepted tier is logged and can be undone like a hand edit.
  const keys = [...new Set(clean.map((p) => companyKey(p.company)))];
  const NOW_HELD = `SELECT ${keySql('name')} AS ckey, ${LOGGED_COLUMNS} FROM tb_companies
                     WHERE ${keySql('name')} = ANY($1::text[])`;
  const byKey = async (sql) => new Map(((await client.query(sql, [keys])).rows ?? []).map((r) => [r.ckey, r]));
  const before = await byKey(`${NOW_HELD} FOR UPDATE`);

  const names = clean.map((p) => String(p.company).trim());
  const tiers = clean.map((p) => String(p.tier ?? '').trim());
  // NULL, NOT '', for an old group nobody sent. An empty string would say
  // "he cleared it", and a file with no Old group column says nothing about
  // it at all. COALESCE below keeps whatever is stored in that case.
  const oldGroupValues = clean.map((p) => {
    const v = String(p.oldGroup ?? '').trim();
    return v === '' ? null : v;
  });

  const { rowCount } = await client.query(
    `WITH incoming AS (
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) AS t(name, tier, old_group)
     ),
     updated AS (
       UPDATE tb_companies c
          SET tier = i.tier,
              old_group = COALESCE(i.old_group, c.old_group),
              updated_at = now()
         FROM incoming i
        WHERE lower(btrim(c.name)) = lower(btrim(i.name))
        RETURNING lower(btrim(c.name)) AS ckey
     )
     INSERT INTO tb_companies (name, status, tier, old_group)
     SELECT i.name, 'active', i.tier, i.old_group
       FROM incoming i
      WHERE lower(btrim(i.name)) NOT IN (SELECT ckey FROM updated)
     ON CONFLICT DO NOTHING`,
    [names, tiers, oldGroupValues],
  );
  const after = await byKey(NOW_HELD);
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    await logCompanyFields(client, key, before.get(key) ?? null, after.get(key) ?? null, stamp);
  }
  return rowCount + clean.length;
}

/** Just the stored rows, for the upload diff to compare against. */
async function findAllPlain() {
  const { rows } = await pool.query('SELECT company_id, name, tier, old_group FROM tb_companies');
  return rows;
}

/**
 * The tiers actually in use, so the picker offers what the sheet writes.
 *
 * Suggestions, never a whitelist: he types `T2 for Reliapay` into this
 * column and nothing may reject it. See shared/companyTiers.js.
 */
async function tiersInUse() {
  const { rows } = await pool.query(
    `SELECT DISTINCT tier FROM tb_companies
      WHERE btrim(coalesce(tier, '')) <> ''
      ORDER BY tier`,
  );
  return rows.map((r) => r.tier);
}

/** His own earlier group names, as they actually appear. For the filter. */
async function oldGroups() {
  const { rows } = await pool.query(
    `SELECT DISTINCT old_group FROM tb_companies
      WHERE btrim(coalesce(old_group, '')) <> ''
      ORDER BY old_group`,
  );
  return rows.map((r) => r.old_group);
}

/** Every company name, for the assign-a-handler picker's search. */
async function names() {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (${CKEY}) ${CKEY} AS ckey, btrim(company) AS name
     FROM tb_mastersheet
     WHERE company IS NOT NULL AND btrim(company) <> ''
     ORDER BY ${CKEY}, id`,
  );
  return rows;
}

module.exports = {
  findAll, findByKey, findAllPlain, rename, update, revertCompanyField, names, tierMap, setTiers,
  oldGroups, tiersInUse, CKEY,
  COMPANY_STATUS, TERMINAL, isTerminal, REVIEWED_MONTHLY, isReviewedMonthly,
};
