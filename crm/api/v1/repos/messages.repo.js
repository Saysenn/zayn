const pool = require('../../configs/db');

function findThread(groupName, personId, limit = 200) {
  return pool
    .query(
      `SELECT id, direction, body, status, created_at
       FROM tb_messages
       WHERE group_name = $1 AND person_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [groupName, personId, limit],
    )
    .then((result) => result.rows);
}

function create({ groupName, personId, direction, body, status }) {
  const defaultStatus = direction === 'inbound' ? 'received' : 'sending';
  return pool
    .query(
      `INSERT INTO tb_messages (group_name, person_id, direction, body, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, group_name, person_id, direction, body, status, created_at`,
      [groupName, personId, direction, body, status ?? defaultStatus],
    )
    .then((result) => result.rows[0]);
}

function updateStatus(id, status) {
  return pool
    .query(
      `UPDATE tb_messages SET status = $2 WHERE id = $1
       RETURNING id, group_name, person_id, direction, body, status, created_at`,
      [id, status],
    )
    .then((result) => result.rows[0] ?? null);
}

// The chatbox's thread list: latest message per (group, person), newest
// activity first. person_name comes from tb_mastersheet via a lateral join —
// messages itself only ever stores the identity, never a name that could
// drift from the sheet.
function listThreads(limit = 100) {
  return pool
    .query(
      `SELECT t.group_name, t.person_id, a.person_name, t.body, t.direction,
              t.status, t.created_at
       FROM (
         SELECT DISTINCT ON (group_name, person_id)
           group_name, person_id, body, direction, status, created_at
         FROM tb_messages
         ORDER BY group_name, person_id, created_at DESC
       ) t
       LEFT JOIN LATERAL (
         SELECT person_name FROM tb_mastersheet
         WHERE tb_mastersheet.group_name = t.group_name
           AND tb_mastersheet.person_id = t.person_id
         LIMIT 1
       ) a ON true
       ORDER BY t.created_at DESC
       LIMIT $1`,
      [limit],
    )
    .then((result) => result.rows);
}

module.exports = { findThread, create, updateStatus, listThreads };
