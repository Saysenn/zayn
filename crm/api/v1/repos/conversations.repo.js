const pool = require('../../configs/db');

/**
 * Diane's stored conversations. The only place these two tables are read
 * or written.
 *
 * A conversation is saved ONCE, when it ends, not turn by turn. That is a
 * deliberate UX call: nothing writes to the database while somebody is
 * talking to her. The cost is that the end has to be detected reliably in
 * the browser, and that a checkpoint exists for long conversations, both
 * of which live in useConversationLog.js.
 *
 * SAVE IS IDEMPOTENT ON THE ID. The end can fire twice (the orb closing
 * and the tab unloading are two separate signals, and a checkpoint may
 * have already written once), so a second save REPLACES rather than
 * appends. That is why the browser owns the id.
 */

/** How much of one message is kept. A pasted wall of text is not a turn. */
const MAX_CONTENT = 20000;

// How far back recall looks. See the note in search(): the row is kept
// forever, this only bounds what she reads back unprompted.
const RECALL_MONTHS = 12;

function clip(text) {
  const s = String(text ?? '');
  return s.length > MAX_CONTENT ? `${s.slice(0, MAX_CONTENT)}\n… (trimmed)` : s;
}

/**
 * Write a whole conversation, replacing any earlier save of the same id.
 *
 * ONE TRANSACTION. A conversation whose row exists with its messages half
 * deleted is worse than one that was never saved: recall would return a
 * summary describing turns that are no longer there.
 */
async function save({
  id, startedAt, messages, summary = null, memory = null,
  touchedRows = [], touchedPeople = [], touchedGroups = [], touchedCompanies = [],
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO tb_conversations
         (id, started_at, ended_at, message_count, summary,
          touched_rows, touched_people, touched_groups, touched_companies,
          summary_data, summary_version, summarized_at)
       VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
               CASE WHEN $4::text IS NULL THEN NULL ELSE now() END)
       ON CONFLICT (id) DO UPDATE SET
         ended_at       = now(),
         message_count  = EXCLUDED.message_count,
         -- A later save with no summary must not wipe one already written.
         -- The checkpoint now writes a provisional summary and the end save
         -- replaces it with one made from the whole transcript; if THAT
         -- model call fails it returns null, and null must leave the
         -- provisional one standing rather than blank it.
         summary        = COALESCE(EXCLUDED.summary, tb_conversations.summary),
         touched_rows   = EXCLUDED.touched_rows,
         touched_people = EXCLUDED.touched_people,
         touched_groups = EXCLUDED.touched_groups,
         touched_companies = EXCLUDED.touched_companies,
         summary_data = CASE WHEN EXCLUDED.summary IS NULL
           THEN tb_conversations.summary_data ELSE EXCLUDED.summary_data END,
         summary_version = CASE WHEN EXCLUDED.summary IS NULL
           THEN tb_conversations.summary_version ELSE EXCLUDED.summary_version END,
         summarized_at = COALESCE(EXCLUDED.summarized_at, tb_conversations.summarized_at)`,
      [
        id, startedAt, messages.length, summary,
        touchedRows, touchedPeople, touchedGroups, touchedCompanies,
        JSON.stringify(memory ?? {}), Number(memory?.version ?? 1),
      ],
    );

    // Replaced wholesale rather than appended. The browser always sends the
    // full transcript, so diffing what is already stored would be work in
    // exchange for a way to get it wrong.
    await client.query('DELETE FROM tb_conversation_messages WHERE conversation_id = $1', [id]);

    if (messages.length > 0) {
      const values = [];
      const params = [id];
      messages.forEach((m, i) => {
        params.push(m.role, clip(m.content), i);
        values.push(`($1, $${params.length - 2}, $${params.length - 1}, $${params.length})`);
      });
      await client.query(
        `INSERT INTO tb_conversation_messages (conversation_id, role, content, position)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Conversations still missing a summary, oldest first. */
function needingSummary(limit = 5, version = 1) {
  return pool
    .query(
      `SELECT id FROM tb_conversations
       WHERE message_count > 0
         AND (summary IS NULL OR summary_version < $2 OR summary_data = '{}'::jsonb)
       ORDER BY ended_at ASC LIMIT $1`,
      [limit, version],
    )
    .then((r) => r.rows.map((x) => x.id));
}

function setSummary(id, summary, memory = null) {
  return pool.query(
    `UPDATE tb_conversations SET summary = $2, summary_data = $3::jsonb,
       summary_version = $4, summarized_at = now() WHERE id = $1`,
    [id, summary, JSON.stringify(memory ?? {}), Number(memory?.version ?? 1)],
  );
}

/** The full transcript of one conversation, in order. */
function messagesFor(id) {
  return pool
    .query(
      `SELECT role, content FROM tb_conversation_messages
       WHERE conversation_id = $1 ORDER BY position ASC`,
      [id],
    )
    .then((r) => r.rows);
}

/**
 * Find past conversations, NEWEST FIRST.
 *
 * Ordering is not a nicety here: a decision made in July and changed in
 * August are both true statements about their own moment, and the reader
 * needs to see which came last. Recency is how supersession is handled
 * without any logic that guesses at it.
 *
 * `person` matches the recorded touched_people rather than the text,
 * because "what did we say about Gloria" should find the conversations
 * that ACTED on her rows, not the ones that mentioned the word.
 */
function search({ q, person, group, company, month, months, limit = 5 }) {
  const where = ['summary IS NOT NULL'];
  // THE WINDOW, not a delete. Nothing prunes this table and nothing should:
  // a conversation is a record. But a summary from two years ago describes a
  // sheet that no longer exists, and recall only ever reads five. So the
  // record stays whole and the LOOKING is bounded. One constant, reversible,
  // and an explicit month is exempt below because asking for a month is
  // asking to look past the window on purpose.
  if (!month && !(Array.isArray(months) && months.length > 0)) {
    where.push(`ended_at > now() - interval '${RECALL_MONTHS} months'`);
  }
  const params = [];

  if (q) {
    params.push(q);
    where.push(`search @@ plainto_tsquery('english', $${params.length})`);
  }
  if (person) {
    params.push(person.toLowerCase());
    where.push(`EXISTS (
      SELECT 1 FROM unnest(touched_people) p WHERE lower(p) = $${params.length}
    )`);
  }
  if (group) {
    params.push(group.toLowerCase());
    where.push(`EXISTS (
      SELECT 1 FROM unnest(touched_groups) g WHERE lower(g) = $${params.length}
    )`);
  }
  if (company) {
    params.push(company.toLowerCase());
    where.push(`EXISTS (
      SELECT 1 FROM unnest(touched_companies) c WHERE lower(c) = $${params.length}
    )`);
  }
  const wantedMonths = [...new Set([
    month,
    ...(Array.isArray(months) ? months : []),
  ].filter((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))))];
  if (wantedMonths.length > 0) {
    params.push(wantedMonths);
    where.push(`to_char(ended_at AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($${params.length}::text[])`);
  }

  /**
   * WHICH FIVE, then WHAT ORDER — two different questions, and they used to
   * share one answer. `ORDER BY ended_at DESC LIMIT 5` picked the five
   * NEWEST matches, so the conversation that actually settled a thing fell
   * off the list as soon as five chattier ones happened after it. The
   * filter said relevant; only the date chose.
   *
   * So the inner query picks by RANK and the outer one puts them back in
   * date order. Newest-first is preserved exactly — recall.js reads the
   * first as what stands, and that contract is untouched — but the five it
   * reads are now the five worth reading.
   *
   * Rank only applies to `q`. A search by person, group or company is an
   * exact array match with nothing to rank, so those stay pure recency.
   */
  const ranked = q ? 'ts_rank(search, plainto_tsquery(\'english\', $1)) DESC, ended_at DESC' : 'ended_at DESC';
  params.push(limit);
  return pool
    .query(
      `SELECT * FROM (
         SELECT id, started_at, ended_at, summary, summary_data,
                touched_people, touched_groups, touched_companies
         FROM tb_conversations
         WHERE ${where.join(' AND ')}
         ORDER BY ${ranked}
         LIMIT $${params.length}
       ) hits
       ORDER BY ended_at DESC`,
      params,
    )
    .then((r) => r.rows);
}

module.exports = {
  save, needingSummary, setSummary, messagesFor, search, MAX_CONTENT, RECALL_MONTHS,
};
