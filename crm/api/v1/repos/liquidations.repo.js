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

/**
 * The stages, in the order the page offers them: the process as it really
 * runs (his corrected flowchart, 2026-10-14, migration 090). The strike off
 * road, then liquidation's, then the end. See the migration.
 */
const STAGE = Object.freeze({
  ACTIVE: 'active',
  ACTIVE_PROPOSAL: 'active_proposal',
  STRIKE_OFF_SUSPENDED: 'strike_off_suspended',
  STRIKE_OFF_REJECTED: 'strike_off_rejected',
  LIQUIDATION: 'liquidation',
  OWN_LIQ: 'own_liq',
  HMRC_LIQ: 'hmrc_liq',
  DISSOLVED: 'dissolved',
});
const STAGES = Object.freeze(Object.values(STAGE));
// Which kinds each stage may carry (Active proposal, Own liq, HMRC liq, Dissolved).
const { STAGE_KINDS, kindFits } = require('../shared/liquidationStages');

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
    -- THE DEALS FIRST; the closure sheet's names only when the deals give none
    -- (a company with no deals with us, migration 093). \`who_from_sheet\` says so.
    COALESCE((SELECT ARRAY_AGG(DISTINCT d.group_name ORDER BY d.group_name) FROM deals d WHERE d.ckey = l.company_key AND d.group_name IS NOT NULL),
             CASE WHEN l.sheet_group <> '' THEN ARRAY[l.sheet_group] END) AS groups,
    COALESCE((SELECT string_agg(DISTINCT d.person_name, ', ') FROM deals d WHERE d.ckey = l.company_key AND d.stopped_on IS NULL AND lower(d.role) = 'director'), NULLIF(l.sheet_director, '')) AS director,
    COALESCE((SELECT string_agg(DISTINCT d.person_name, ', ') FROM deals d WHERE d.ckey = l.company_key AND d.stopped_on IS NULL AND lower(d.role) = 'mid'), NULLIF(l.sheet_mid, '')) AS mid,
    NOT EXISTS (SELECT 1 FROM deals d WHERE d.ckey = l.company_key) AND (l.sheet_director <> '' OR l.sheet_mid <> '' OR l.sheet_group <> '') AS who_from_sheet,
    (SELECT SUM(d.monthly_amount)::float FROM deals d WHERE d.ckey = l.company_key AND d.stopped_on IS NULL) AS allocated,
    -- How many deals closing it would stop: said before stage Dissolved closes it.
    (SELECT COUNT(*)::int FROM deals d WHERE d.ckey = l.company_key AND d.stopped_on IS NULL) AS live_deals,
    -- NO DEALS WITH US AT ALL, stopped ones included (his call 2026-11-04): the
    -- "No deals" tag. Worked out here, never stored, so a deal added later drops it.
    NOT EXISTS (SELECT 1 FROM deals d WHERE d.ckey = l.company_key) AS no_deals,
    COALESCE((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'position', p.position) ORDER BY p.id)
                FROM tb_liquidation_parties p WHERE p.liquidation_id = l.id), '[]'::json) AS parties,
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

/**
 * THE ROW FOR ONE COMPANY, made if it has none, whatever its status: Diane
 * putting a company INTO winding down, or recording that one off the page
 * was struck off, sets its stage in the same act (suite 2026-10-14).
 */
async function ensureRow(key) {
  const k = companyKey(key);
  await pool.query('INSERT INTO tb_liquidations (company_key) VALUES ($1) ON CONFLICT (company_key) DO NOTHING', [k]);
  const { rows } = await pool.query(`${LIST_SQL} WHERE l.company_key = $1`, [k]);
  return rows[0] ?? null;
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

/** The row's log, history, documents and audit trail, for its panel. */
async function details(id) {
  const [comms, history, docs, audit] = await Promise.all([
    pool.query('SELECT id, said_on, body, by_user, created_at FROM tb_liquidation_comms WHERE liquidation_id = $1 ORDER BY said_on DESC, id DESC', [id]),
    pool.query('SELECT id, from_stage, to_stage, by_user, changed_at FROM tb_liquidation_history WHERE liquidation_id = $1 ORDER BY changed_at DESC, id DESC', [id]),
    pool.query(`SELECT id, file_name, mime, size_bytes, by_user, uploaded_at, read_status, read_how, read_error,
                       COALESCE(length(text), 0) AS text_chars
                  FROM tb_liquidation_docs WHERE liquidation_id = $1 AND removed_at IS NULL ORDER BY uploaded_at DESC, id DESC`, [id]),
    auditTrail(id),
  ]);
  return { comms: comms.rows, history: history.rows, docs: docs.rows, audit };
}

// ===============================
// * THE AUDIT TRAIL (migration 092, his call 2026-11-04)
// ===============================
// Every change, kept forever: field, old, new, who, how, when, and the
// file an import came from. Written in the same transaction as the change
// wherever there is one, so the trail can never disagree with the row.

const VIAS = ['admin', 'diane', 'import', 'undo', 'system'];
/** How a change was made, from who made it when the caller did not say. */
function viaOf(byUser, via) {
  if (VIAS.includes(via)) return via;
  const who = String(byUser ?? '');
  if (/\(undo\)/i.test(who)) return 'undo';
  if (/^diane\b/i.test(who)) return 'diane';
  if (/^import\b/i.test(who)) return 'import';
  return 'admin';
}
const auditText = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
};

/**
 * One line of the trail. `q` is a client inside a transaction, or the pool.
 * The company key is read off the row when only its id is given.
 */
async function audit(q, {
  liquidationId = null, companyKey: key = null, field, from = null, to = null, byUser = null, via, source = null, batchId = null,
}) {
  await q.query(
    `INSERT INTO tb_liquidation_audit (liquidation_id, company_key, field, old_value, new_value, by_user, via, source, batch_id)
     VALUES ($1, COALESCE($2, (SELECT company_key FROM tb_liquidations WHERE id = $1)), $3, $4, $5, $6, $7, $8, $9)`,
    [liquidationId, key ? companyKey(key) : null, field, auditText(from), auditText(to), byUser, viaOf(byUser, via), source, batchId],
  );
}

/**
 * A COMPANY'S STATUS MOVING IN OR OUT OF WINDING DOWN (or closed), from the
 * company page, Diane or the import: on its trail too. Its row is found by
 * name; one with no row yet is still kept, by its key.
 */
async function auditStatus(name, from, to, byUser, { via, source = null, batchId = null } = {}) {
  if ((from ?? 'active') === (to ?? 'active')) return;
  const key = companyKey(name);
  const { rows } = await pool.query('SELECT id FROM tb_liquidations WHERE company_key = $1', [key]);
  await audit(pool, {
    liquidationId: rows[0]?.id ?? null, companyKey: key, field: 'status', from: from ?? 'active', to, byUser, via, source, batchId,
  });
}

/** One company's whole trail, newest first. */
async function auditTrail(id) {
  const { rows } = await pool.query(
    `SELECT a.id, a.field, a.old_value, a.new_value, a.by_user, a.via, a.source, a.changed_at
       FROM tb_liquidation_audit a
      WHERE a.liquidation_id = $1 OR a.company_key = (SELECT company_key FROM tb_liquidations WHERE id = $1)
      ORDER BY a.changed_at DESC, a.id DESC`,
    [id],
  );
  return rows;
}

// The fields the page edits, and their columns.
const COLUMNS = Object.freeze({
  stage: 'stage',
  stageKind: 'stage_kind',
  instructions: 'instructions',
  deadline: 'deadline',
  nextAction: 'next_action',
  owner: 'owner',
  blamed: 'blamed',
  liquidator: 'liquidator',
  note: 'note',
  // The boss's closure sheet's columns (migration 092).
  officialReceiver: 'official_receiver',
  lastAction: 'last_action',
  unresolved: 'unresolved',
  play: 'play',
  prompts: 'prompts',
  stageDate: 'stage_date',
  // Who runs a no-deals company, as the closure sheet says (migration 093).
  sheetDirector: 'sheet_director',
  sheetMid: 'sheet_mid',
  sheetGroup: 'sheet_group',
});

/** Current play (migration 092), in the order offered. */
const PLAYS = Object.freeze(['wait', 'chase', 'leave', 'do_not_contact']);

/**
 * Writes the fields given. A stage change is logged in the same
 * transaction, so the history can never disagree with the row.
 * Returns { before, after } stages, or null when the row is gone.
 */
async function update(id, fieldsIn, byUser, { via, source = null, batchId = null } = {}) {
  // A NEW STAGE STARTS WITH NO KIND unless one comes with it: a kind belongs
  // to its stage (an MVL is no kind of strike off).
  const fields = fieldsIn.stage !== undefined && fieldsIn.stageKind === undefined
    ? { ...fieldsIn, stageKind: null } : fieldsIn;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [was] } = await client.query('SELECT * FROM tb_liquidations WHERE id = $1 FOR UPDATE', [id]);
    if (!was) { await client.query('ROLLBACK'); return null; }
    const sets = [];
    const params = [id];
    const trail = [];
    for (const [field, column] of Object.entries(COLUMNS)) {
      if (fields[field] === undefined) continue;
      params.push(fields[field]);
      sets.push(`${column} = $${params.length}`);
      // ONLY WHAT MOVED goes on the trail: a save of the same value is no change.
      const from = auditText(was[column]);
      const to = auditText(fields[field]);
      if ((from ?? '') !== (to ?? '')) trail.push({ field: column, from, to });
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
    for (const t of trail) {
      // eslint-disable-next-line no-await-in-loop
      await audit(client, { liquidationId: id, companyKey: was.company_key, ...t, byUser, via, source, batchId });
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

const commText = (c) => `${auditText(c.said_on)}: ${c.body}`;

async function addComm(id, { saidOn, body }, byUser, { via, source = null, batchId = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO tb_liquidation_comms (liquidation_id, said_on, body, by_user)
     VALUES ($1, COALESCE($2::date, current_date), $3, $4) RETURNING *`,
    [id, saidOn || null, body, byUser],
  );
  await pool.query('UPDATE tb_liquidations SET updated_at = now() WHERE id = $1', [id]);
  await audit(pool, { liquidationId: id, field: 'contact log', to: commText(rows[0]), byUser, via, source, batchId });
  return rows[0];
}

/** Takes contact lines back out (Diane's undo of lines she added). Each on the trail. */
async function removeComms(ids, byUser = null, { via } = {}) {
  if (!ids?.length) return 0;
  const { rows } = await pool.query('DELETE FROM tb_liquidation_comms WHERE id = ANY($1::int[]) RETURNING *', [ids]);
  for (const c of rows) {
    // eslint-disable-next-line no-await-in-loop
    await audit(pool, { liquidationId: c.liquidation_id, field: 'contact log', from: commText(c), byUser, via });
  }
  return rows.length;
}

// ===============================
// * OTHER INVOLVED PARTIES (migration 092)
// ===============================

async function addParty(id, { name, position = '' }, byUser, { via, source = null, batchId = null } = {}) {
  const { rows } = await pool.query(
    'INSERT INTO tb_liquidation_parties (liquidation_id, name, position, by_user) VALUES ($1, $2, $3, $4) RETURNING *',
    [id, name, position ?? '', byUser],
  );
  await pool.query('UPDATE tb_liquidations SET updated_at = now() WHERE id = $1', [id]);
  await audit(pool, {
    liquidationId: id, field: 'party', to: [name, position].filter(Boolean).join(', '), byUser, via, source, batchId,
  });
  return rows[0];
}

/** Taken off; the trail keeps who they were. Returns what was removed (for undo). */
async function removeParties(id, partyIds, byUser, { via } = {}) {
  if (!partyIds?.length) return [];
  const { rows } = await pool.query(
    'DELETE FROM tb_liquidation_parties WHERE liquidation_id = $1 AND id = ANY($2::int[]) RETURNING *',
    [id, partyIds],
  );
  for (const p of rows) {
    // eslint-disable-next-line no-await-in-loop
    await audit(pool, { liquidationId: id, field: 'party', from: [p.name, p.position].filter(Boolean).join(', '), byUser, via });
  }
  if (rows.length) await pool.query('UPDATE tb_liquidations SET updated_at = now() WHERE id = $1', [id]);
  return rows;
}

async function addDoc(id, { fileName, storedPath, mime, size }, byUser) {
  const { rows } = await pool.query(
    `INSERT INTO tb_liquidation_docs (liquidation_id, file_name, stored_path, mime, size_bytes, by_user)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, file_name, mime, size_bytes, by_user, uploaded_at, read_status`,
    [id, fileName, storedPath, mime, size, byUser],
  );
  await audit(pool, { liquidationId: id, field: 'document', to: fileName, byUser });
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
async function removeDoc(docId, movedTo, byUser = null) {
  const { rows } = await pool.query(
    'UPDATE tb_liquidation_docs SET removed_at = now(), stored_path = $2 WHERE id = $1 RETURNING liquidation_id, file_name',
    [docId, movedTo],
  );
  if (rows[0]) await audit(pool, { liquidationId: rows[0].liquidation_id, field: 'document', from: rows[0].file_name, byUser });
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

/** Every live document's name and whose it is: her answer's names made links. */
async function docNames() {
  const { rows } = await pool.query(
    `SELECT d.id, d.liquidation_id, d.file_name, d.mime, COALESCE(c.name, l.company_key) AS company_name
       FROM tb_liquidation_docs d
       JOIN tb_liquidations l ON l.id = d.liquidation_id
       LEFT JOIN tb_companies c ON lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g')) = l.company_key
      WHERE d.removed_at IS NULL`,
  );
  return rows;
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

async function renameDoc(id, docId, fileName, byUser = null) {
  const { rows: [was] } = await pool.query('SELECT file_name FROM tb_liquidation_docs WHERE id = $2 AND liquidation_id = $1', [id, docId]);
  const { rows } = await pool.query(
    'UPDATE tb_liquidation_docs SET file_name = $3 WHERE id = $2 AND liquidation_id = $1 AND removed_at IS NULL RETURNING id, file_name',
    [id, docId, fileName],
  );
  if (rows[0] && was && was.file_name !== fileName) {
    await audit(pool, { liquidationId: id, field: 'document name', from: was.file_name, to: fileName, byUser });
  }
  return rows[0] ?? null;
}

/** A removed document put back (Diane's undo): its file is moved back by the caller. */
async function restoreDoc(docId, storedPath, byUser = null) {
  const { rows } = await pool.query(
    'UPDATE tb_liquidation_docs SET removed_at = NULL, stored_path = $2 WHERE id = $1 RETURNING liquidation_id, file_name',
    [docId, storedPath],
  );
  if (rows[0]) await audit(pool, { liquidationId: rows[0].liquidation_id, field: 'document', to: rows[0].file_name, byUser });
}

/**
 * Who an owner can be: the CRM's admins, and every owner already on a row.
 * The boss's sheet names Gloria and Pat, who have no account (his call
 * 2026-11-04: kept as written), so a name the import brought stays pickable.
 */
async function owners() {
  const { rows } = await pool.query(
    `SELECT username AS name FROM tb_accounts
     UNION SELECT owner FROM tb_liquidations WHERE owner IS NOT NULL AND btrim(owner) <> ''
     ORDER BY 1`,
  );
  return rows.map((r) => r.name);
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
  STAGE, STAGES, STAGE_KINDS, kindFits, companyKey, list, findById, details, syncFromCompanies, ensureRow, update, addComm, removeComms, addDoc, findDoc, removeDoc, owners, dueSoon,
  PLAYS, COLUMNS, addParty, removeParties, audit, auditStatus, auditTrail, viaOf,
  setRead, saveChunks, allChunks, docNames, docWithText, unread, renameDoc, restoreDoc, docsVersion,
};
