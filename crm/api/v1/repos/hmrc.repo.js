const pool = require('../../configs/db');

// ***************************************************
// * DIANE'S HMRC & CIS KNOWLEDGE: sources and their searchable chunks
// ***************************************************
// See migration 079. A refresh replaces GOV.UK sources by url; a note is
// the admin's and only they change it.

async function upsertSource({ kind, url = null, title, body, topic = null, updatedOn = null, addedBy = null }) {
  const { rows } = url
    ? await pool.query(
      `INSERT INTO tb_hmrc_sources (kind, url, title, body, topic, updated_on, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, topic = EXCLUDED.topic,
         updated_on = EXCLUDED.updated_on, fetched_at = now(), active = true
       RETURNING *, (xmax = 0) AS inserted`,
      [kind, url, title, body, topic, updatedOn, addedBy],
    )
    : await pool.query(
      `INSERT INTO tb_hmrc_sources (kind, title, body, topic, added_by) VALUES ($1, $2, $3, $4, $5) RETURNING *, true AS inserted`,
      [kind, title, body, topic, addedBy],
    );
  return rows[0];
}

async function replaceChunks(sourceId, chunks) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tb_hmrc_chunks WHERE source_id = $1', [sourceId]);
    for (const [n, c] of chunks.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await client.query('INSERT INTO tb_hmrc_chunks (source_id, n, text, embedding) VALUES ($1, $2, $3, $4)', [sourceId, n, c.text, c.embedding]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Every active chunk with its source, for the in-memory search. */
async function allChunks() {
  const { rows } = await pool.query(
    `SELECT c.id, c.text, c.embedding, s.id AS source_id, s.kind, s.url, s.title, s.updated_on
       FROM tb_hmrc_chunks c JOIN tb_hmrc_sources s ON s.id = c.source_id
      WHERE s.active`,
  );
  return rows;
}

async function sourceByUrl(url) {
  return (await pool.query('SELECT * FROM tb_hmrc_sources WHERE url = $1', [url])).rows[0] ?? null;
}

async function notes() {
  return (await pool.query("SELECT id, title, body, topic, added_by, created_at, fetched_at AS updated_at FROM tb_hmrc_sources WHERE kind = 'note' AND active ORDER BY created_at DESC")).rows;
}

async function updateNote(id, { title, body }) {
  const { rows } = await pool.query(
    "UPDATE tb_hmrc_sources SET title = COALESCE($2, title), body = COALESCE($3, body), fetched_at = now() WHERE id = $1 AND kind = 'note' RETURNING *",
    [id, title ?? null, body ?? null],
  );
  return rows[0] ?? null;
}

async function removeNote(id) {
  return (await pool.query("DELETE FROM tb_hmrc_sources WHERE id = $1 AND kind = 'note'", [id])).rowCount > 0;
}

async function status() {
  const { rows } = await pool.query(
    `SELECT kind, count(*)::int AS sources, max(fetched_at) AS last,
            (SELECT count(*)::int FROM tb_hmrc_chunks c JOIN tb_hmrc_sources s2 ON s2.id = c.source_id WHERE s2.kind = s.kind) AS chunks
       FROM tb_hmrc_sources s WHERE active GROUP BY kind`,
  );
  return rows;
}

// ---- what changed on GOV.UK ----
async function recordChange({ sourceId, url, title, oldUpdatedOn, newUpdatedOn, summary }) {
  const { rows } = await pool.query(
    `INSERT INTO tb_hmrc_changes (source_id, url, title, old_updated_on, new_updated_on, summary)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sourceId, url, title, oldUpdatedOn, newUpdatedOn, summary],
  );
  return rows[0];
}

/** Changes not yet said in an answer, newest first. */
async function untoldChanges(limit = 3) {
  return (await pool.query('SELECT * FROM tb_hmrc_changes WHERE told_at IS NULL ORDER BY created_at DESC LIMIT $1', [limit])).rows;
}

async function markTold(ids) {
  if (!ids.length) return;
  await pool.query('UPDATE tb_hmrc_changes SET told_at = now() WHERE id = ANY($1)', [ids]);
}

async function recentChanges(limit = 20) {
  return (await pool.query('SELECT id, url, title, old_updated_on, new_updated_on, summary, told_at, created_at FROM tb_hmrc_changes ORDER BY created_at DESC LIMIT $1', [limit])).rows;
}

module.exports = {
  upsertSource, replaceChunks, allChunks, sourceByUrl, notes, updateNote, removeNote, status,
  recordChange, untoldChanges, markTold, recentChanges,
};
