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
    pool.query(`SELECT id, file_name, mime, size_bytes, by_user, uploaded_at, read_status, read_how, read_error,
                       COALESCE(length(text), 0) AS text_chars
                  FROM tb_liquidation_docs WHERE liquidation_id = $1 AND removed_at IS NULL ORDER BY uploaded_at DESC, id DESC`, [id]),
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

/** Takes contact lines back out (Diane's undo of lines she added). */
async function removeComms(ids) {
  if (!ids?.length) return 0;
  const { rowCount } = await pool.query('DELETE FROM tb_liquidation_comms WHERE id = ANY($1::int[])', [ids]);
  return rowCount;
}

async function addDoc(id, { fileName, storedPath, mime, size }, byUser) {
  const { rows } = await pool.query(
    `INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes, by_user)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, file_name, mime, size_bytes, by_user, uploaded_at, read_status`,
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

// ===============================
// * READING THE DOCUMENTS (migration 088)
// ===============================

/** Where a document's reading stands, and its text once read. */
async function setRead(docId, { status, how = null, error = null, text = null }) {
  await pool.query(
    `UPDATE tb_liquidation_docs SET read_status = $2, read_how = $3, read_error = $4,
            text = COALESCE($5, text), read_at = CASE WHEN $2 IN ('read', 'unreadable') THEN now() ELSE read_at END
      WHERE id = $1`,
    [docId, status, how, error, text],
  );
}

/** A document's passages and their embeddings, replaced whole. */
async function saveChunks(docId, chunks) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tb_liquidation_doc_chunks WHERE doc_id = $1', [docId]);
    for (const [n, c] of chunks.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await client.query('INSERT INTO tb_liquidation_doc_chunks (doc_id, n, text, embedding) VALUES ($1, $2, $3, $4)', [docId, n, c.text, c.embedding]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Every passage of every document still on a row, with whose it is. */
async function allChunks() {
  const { rows } = await pool.query(
    `SELECT k.id, k.doc_id, k.n, k.text, k.embedding, d.file_name, d.liquidation_id, l.company_key,
            COALESCE(c.name, l.company_key) AS company_name
       FROM tb_liquidation_doc_chunks k
       JOIN tb_liquidation_docs d ON d.id = k.doc_id AND d.removed_at IS NULL
       JOIN tb_liquidations l ON l.id = d.liquidation_id
       LEFT JOIN tb_companies c ON lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')) = l.company_key`,
  );
  return rows;
}

/** Changes whenever a document is added, read, renamed or removed: the search cache's key. */
async function docsVersion() {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE removed_at IS NULL) AS n, max(id) AS top, max(removed_at) AS gone, max(read_at) AS read,
            md5(string_agg(file_name, '|' ORDER BY id) FILTER (WHERE removed_at IS NULL)) AS names
       FROM tb_liquidation_docs`,
  );
  return JSON.stringify(rows[0]);
}

/** One document whole: its row, its text, and whose it is. */
async function docWithText(docId) {
  const { rows } = await pool.query(
    `SELECT d.*, l.company_key FROM tb_liquidation_docs d JOIN tb_liquidations l ON l.id = d.liquidation_id
      WHERE d.id = $1 AND d.removed_at IS NULL`,
    [docId],
  );
  return rows[0] ?? null;
}

/** Documents left waiting or half read (a restart mid read). */
async function unread() {
  const { rows } = await pool.query("SELECT id FROM tb_liquidation_docs WHERE removed_at IS NULL AND read_status IN ('waiting', 'reading') ORDER BY id");
  return rows.map((r) => r.id);
}

async function renameDoc(id, docId, fileName) {
  const { rows } = await pool.query(
    'UPDATE tb_liquidation_docs SET file_name = $3 WHERE id = $2 AND liquidation_id = $1 AND removed_at IS NULL RETURNING id, file_name',
    [id, docId, fileName],
  );
  return rows[0] ?? null;
}

/** A removed document put back (Diane's undo): its file is moved back by the caller. */
async function restoreDoc(docId, storedPath) {
  await pool.query('UPDATE tb_liquidation_docs SET removed_at = NULL, stored_path = $2 WHERE id = $1', [docId, storedPath]);
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
  STAGE, STAGES, companyKey, list, findById, details, syncFromCompanies, update, addComm, removeComms, addDoc, findDoc, removeDoc, owners, dueSoon,
  setRead, saveChunks, allChunks, docWithText, unread, renameDoc, restoreDoc, docsVersion,
};
