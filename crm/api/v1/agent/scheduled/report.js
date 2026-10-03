const pool = require('../../../configs/db');

/**
 * ***************************************************
 * * WHAT SHE ACTUALLY DID, read back off the change log
 * ***************************************************
 *
 * Built from `tb_mastersheet_changes` filtered by the run's `batch_id`, NOT
 * from the jobs that were supposed to run. The difference matters: a job
 * marked done whose write changed nothing produces no log row, so this
 * reports nothing for it rather than claiming a change that never landed.
 *
 * She physically cannot overstate what happened, because the sentence is
 * made from the record rather than from the intention.
 *
 * ONE LINE PER FIELD, with the FIGURES EITHER SIDE. "3 deals updated" is
 * the shape his briefing already rejected once: "and 9 other deals" hid the
 * rows he needed. Every row shows, from and to.
 */

const plural = (n, one, many) => (n === 1 ? one : many);

/** Every field this run wrote, with its before and after. */
function changesIn(batchId) {
  if (!batchId) return Promise.resolve([]);
  return pool
    .query(
      `SELECT c.row_id, c.person_name, c.field, c.old_value, c.new_value, c.changed_at,
              m.company, m.group_name
         FROM tb_mastersheet_changes c
         LEFT JOIN tb_mastersheet m ON m.id = c.row_id
        WHERE c.batch_id = $1
        ORDER BY c.changed_at ASC, c.id ASC`,
      [batchId],
    )
    .then((r) => r.rows);
}

const where = (row) => [row.company, row.group_name].filter(Boolean).join(' · ');
const shown = (v) => (v === null || v === undefined || v === '' ? 'empty' : String(v));

/**
 * The welcome page item, in the shape briefing.helper already returns:
 * a finished sentence plus every row behind it.
 */
async function buildReport(run) {
  const changed = await changesIn(run.batchId);

  const applied = changed.map((c) => ({
    id: `${c.row_id}|${c.field}`,
    kind: 'applied',
    person: c.person_name || '(no handler)',
    where: where(c),
    // The RAW field travels, and the welcome page names it with the
    // FIELD_LABELS it already owns (components/history/HistoryList.jsx).
    // A second copy of that map here is a second copy to drift.
    field: c.field,
    what: c.field.replace(/([A-Z])/g, ' $1').toLowerCase(),
    from: shown(c.old_value),
    to: shown(c.new_value),
  }));

  // Not a field change, so it carries the reason instead of a before and
  // after. `said` is his own sentence, which is what makes a skipped line
  // readable months after he typed it.
  const asRow = (entry, kind) => ({
    id: `q${entry.id}`,
    kind,
    person: entry.said,
    where: '',
    field: null,
    what: entry.outcome ?? '',
    from: null,
    to: null,
  });

  const skipped = (run.skipped ?? []).map((e) => asRow(e, 'skipped'));
  const failed = (run.failed ?? []).map((e) => asRow(e, 'failed'));
  const expired = (run.expired ?? []).map((e) => asRow(e, 'expired'));

  const rows = [...applied, ...skipped, ...failed, ...expired];
  if (rows.length === 0) return null;

  // Counted on what the LOG says, not on how many jobs claimed success.
  const parts = [];
  if (applied.length) {
    parts.push(`${applied.length} ${plural(applied.length, 'change', 'changes')} you parked earlier`);
  }
  if (skipped.length) parts.push(`${skipped.length} left alone`);
  if (failed.length) parts.push(`${failed.length} that did not work`);
  if (expired.length) parts.push(`${expired.length} that ran out of time`);

  const sentence = applied.length
    ? `I applied ${parts.join(', ')}.`
    : `Nothing was applied: ${parts.join(', ')}.`;

  return {
    key: 'scheduled', count: rows.length, sentence, rows,
  };
}

module.exports = { buildReport, changesIn };
