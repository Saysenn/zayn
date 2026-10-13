const pool = require('../../configs/db');
// The company key in SQL, as companies.repo.js has it (its own copy: requiring
// that file here would be a cycle, since its rename carries this table along).
const CKEY = `lower(regexp_replace(btrim(company), '\\s+', ' ', 'g'))`;

// ***************************************************
// * THE LIQUIDATION TRACKER (migration 084)
// ***************************************************
//
// One row per company being wound down. Only this file touches its four
// tables.
//
// THE PAGE FOLLOWS THE COMPANY STATUS (his call 2026-10-13, migration 086):
// a company is on it because tb_companies.status is liquidation, and
// leaves when it is not. Its row here (stage, notes, documents, log) is
// kept when it leaves, so it is all there again if it comes back. The company itself (name, groups, people, pay status, settlement)
// is READ from the deals and tb_companies, never copied in: a copy would be
// a second answer to "who is the director" that drifts.

/** The stages, in the order the page offers them. */
const STAGE = Object.freeze({
  OWN_LIQ: 'own_liq',
  HMRC_LIQ: 'hmrc_liq',
  STRIKE_OFF: 'strike_off',
  STRIKE_OFF_REJECTED: 'strike_off_rejected',
  DISSOLVED: 'dissolved',
  ACTIVE: 'active',
});
const STAGES = Object.freeze(Object.values(STAGE));

const companyKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Every tracked company, with what the deals and the company say about it.
 *
 * DIRECTOR AND MID come from the company's LIVE deals (not stopped), every
 * name in that role, comma separated; none found is null, shown blank.
 * ALLOCATED is what the live deals pay a month, beside the settlement the
 * liquidation panel holds, so "how much of it is placed" is on the row.
 */
const LIST_SQL = `
  WITH deals AS (
    SELECT ${CKEY} AS ckey, * FROM tb_mastersheet WHERE company IS NOT NULL
  )
  SELECT
    l.*,
    COALESCE(c.name, (SELECT MAX(btrim(d.company)) FROM deals d WHERE d.ckey = l.company_key), l.company_key) AS company_name,
    COALESCE(c.status, 'active')  AS pay_status,
    c.liquidation_total::float     AS settlement,
    (SELECT ARRAY_AGG(DISTINCT d.group_name ORDER BY d.group_name) FROM deals d WHERE d.ckey = l.company_key AND d.group_name IS NOT NULL) AS groups,
    (SELECT string_agg(DISTINCT d.person_name, ', ') FROM deals d WHERE d.ckey = l.company_key AND d.stopped_on IS NULL AND lower(d.role) = 'director') AS director,
    (SELECT string_agg(DISTINCT d.person_name, ', ') FROM deals d WHERE d.ckey = l.company_key AND d.stopped_on IS NULL AND lower(d.role) = 'mid') AS mid,
    (SELECT SUM(d.monthly_amount)::float FROM deals d WHERE d.ckey = l.company_key AND d.stopped_on IS NULL) AS allocated,
    (SELECT MAX(d.currency) FROM deals d WHERE d.ckey = l.company_key) AS currency,
    (SELECT row_to_json(m) FROM (
       SELECT said_on, body FROM tb_liquidation_comms WHERE liquidation_id = l.id ORDER BY said_on DESC, id DESC LIMIT 1
     ) m) AS last_comm,
    (SELECT COUNT(*)::int FROM tb_liquidation_docs WHERE liquidation_id = l.id AND removed_at IS NULL) AS doc_count
  FROM tb_liquidations l
  LEFT JOIN tb_companies c ON lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')) = l.company_key`;

// Only the companies whose status is liquidation now.
const IN_LIQUIDATION = "c.status = 'liquidation'";

/** A row for every company in liquidation that has none yet. Stage unset. */
async function syncFromCompanies() {
  await pool.query(
    `INSERT INTO tb_liquidations (company_key)
     SELECT lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) FROM tb_companies
      WHERE status = 'liquidation' AND btrim(name) <> ''
     ON CONFLICT (company_key) DO NOTHING`,
  );
}

// Most urgent first: a passed deadline, then the nearest, then none.
const ORDER = 'ORDER BY l.deadline ASC NULLS LAST, company_name';

async function list() {
  await syncFromCompanies();
  const { rows } = await pool.query(`${LIST_SQL} WHERE ${IN_LIQUIDATION} ${ORDER}`);
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query(`${LIST_SQL} WHERE l.id = $1`, [id]);
  return rows[0] ?? null;
}

/** The row's log, history and documents, for its panel. */
async function details(id) {
  const [comms, history, docs] = await Promise.all([
    pool.query('SELECT id, said_on, body, by_user, created_at FROM tb_liquidation_comms WHERE liquidation_id = $1 ORDER BY said_on DESC, id DESC', [id]),
    pool.query('SELECT id, from_stage, to_stage, by_user, changed_at FROM tb_liquidation_history WHERE liquidation_id = $1 ORDER BY changed_at DESC, id DESC', [id]),
    pool.query('SELECT id, file_name, mime, size_bytes, by_user, uploaded_at FROM tb_liquidation_docs WHERE liquidation_id = $1 AND removed_at IS NULL ORDER BY uploaded_at DESC, id DESC', [id]),
  ]);
  return { comms: comms.rows, history: history.rows, docs: docs.rows };
}

// The fields the page edits, and their columns.
const COLUMNS = Object.freeze({
  stage: 'stage',
  instructions: 'instructions',
  deadline: 'deadline',
  nextAction: 'next_action',
  owner: 'owner',
  blamed: 'blamed',
  liquidator: 'liquidator',
  note: 'note',
});

/**
 * Writes the fields given. A stage change is logged in the same
 * transaction, so the history can never disagree with the row.
 * Returns { before, after } stages, or null when the row is gone.
 */
async function update(id, fields, byUser) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [was] } = await client.query('SELECT stage FROM tb_liquidations WHERE id = $1 FOR UPDATE', [id]);
    if (!was) { await client.query('ROLLBACK'); return null; }
    const sets = [];
    const params = [id];
    for (const [field, column] of Object.entries(COLUMNS)) {
      if (fields[field] === undefined) continue;
      params.push(fields[field]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length) {
      await client.query(`UPDATE tb_liquidations SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    }
    const stageChanged = fields.stage !== undefined && (fields.stage ?? null) !== (was.stage ?? null);
    if (stageChanged) {
      await client.query(
        'INSERT INTO tb_liquidation_history (liquidation_id, from_stage, to_stage, by_user) VALUES ($1, $2, $3, $4)',
        [id, was.stage, fields.stage, byUser],
      );
    }
    await client.query('COMMIT');
    return { before: was.stage, after: stageChanged ? fields.stage : was.stage };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addComm(id, { saidOn, body }, byUser) {
  const { rows } = await pool.query(
    `INSERT INTO tb_liquidation_comms (liquidation_id, said_on, body, by_user)
     VALUES ($1, COALESCE($2::date, current_date), $3, $4) RETURNING *`,
    [id, saidOn || null, body, byUser],
  );
  await pool.query('UPDATE tb_liquidations SET updated_at = now() WHERE id = $1', [id]);
  return rows[0];
}

async function addDoc(id, { fileName, storedPath, mime, size }, byUser) {
  const { rows } = await pool.query(
    `INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes, by_user)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, file_name, mime, size_bytes, by_user, uploaded_at`,
    [id, fileName, storedPath, mime, size, byUser],
  );
  return rows[0];
}

async function findDoc(id, docId) {
  const { rows } = await pool.query(
    'SELECT * FROM tb_liquidation_docs WHERE id = $1 AND liquidation_id = $2 AND removed_at IS NULL',
    [docId, id],
  );
  return rows[0] ?? null;
}

/** Marks a doc removed and records where its file was moved to. */
async function removeDoc(docId, movedTo) {
  await pool.query('UPDATE tb_liquidation_docs SET removed_at = now(), stored_path = $2 WHERE id = $1', [docId, movedTo]);
}

/** Usernames an owner can be. */
async function owners() {
  const { rows } = await pool.query('SELECT username FROM tb_accounts ORDER BY username');
  return rows.map((r) => r.username);
}

/**
 * DEADLINES DUE THIS WEEK, for Diane's briefing: passed or within `days`,
 * on any company not yet dissolved. Most urgent first.
 */
async function dueSoon(days = 7) {
  const { rows } = await pool.query(
    `${LIST_SQL}
     WHERE ${IN_LIQUIDATION} AND l.deadline IS NOT NULL AND l.stage IS DISTINCT FROM 'dissolved' AND l.deadline <= current_date + $1::int
     ${ORDER}`,
    [days],
  );
  return rows;
}

module.exports = {
  STAGE, STAGES, companyKey, list, findById, details, syncFromCompanies, update, addComm, addDoc, findDoc, removeDoc, owners, dueSoon,
};
