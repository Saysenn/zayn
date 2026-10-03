const pool = require('../../configs/db');

function markRead(groupName, personId) {
  return pool.query(
    `INSERT INTO tb_thread_reads (group_name, person_id, last_read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (group_name, person_id) DO UPDATE SET last_read_at = now()`,
    [groupName, personId],
  );
}

// One row per thread that has at least one inbound message, with however
// many of those arrived after the thread was last marked read (0 if never
// unread, or if read since). '-infinity' means "never read" — everything
// inbound counts.
function unreadCounts() {
  return pool
    .query(
      `SELECT m.group_name, m.person_id, COUNT(*)::int AS unread
       FROM tb_messages m
       LEFT JOIN tb_thread_reads r
         ON r.group_name = m.group_name AND r.person_id = m.person_id
       WHERE m.direction = 'inbound'
         AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamp)
       GROUP BY m.group_name, m.person_id`,
    )
    .then((result) => result.rows);
}

module.exports = { markRead, unreadCounts };
