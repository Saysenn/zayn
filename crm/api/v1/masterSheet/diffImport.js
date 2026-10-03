const { asText, sameStoredValue } = require('./compareValues');
const { SEEDED_NOT_ASKED, COMPANIONS, COMPANION_COLUMNS } = require('./importColumns');

/**
 * WHAT AN UPLOAD WOULD DO, worked out before it does any of it.
 *
 * The upload used to be one act: parse, write, report. Everything it got
 * wrong was therefore discovered afterwards, on a table that had already
 * changed — a renamed column that wiped every end date, a one-group
 * extract that deleted ninety rows, a file with no Group column that
 * duplicated every deal it named. All three were visible in the data
 * before a single write.
 *
 * So the parse and the write are two requests now, and this is what sits
 * between them: the same comparison the upsert is about to make, returned
 * for a human to look at.
 *
 * THREE SECTIONS, and they are not the same question:
 *
 *   changed    a row that exists, and what this file would do to it
 *   new        a row the CRM has never seen
 *   notInFile  a row the CRM has that this file does not mention. NOT a
 *              deletion. An upload deletes nothing; this is here so a
 *              partial sheet is obvious rather than silent.
 *
 * AND TWO KINDS OF CHANGE, kept apart deliberately:
 *
 *   set        the sheet has a different value
 *   cleared    the sheet's cell is EMPTY where the CRM holds something
 *
 * Collapsing those would make "accept all" on a sheet whose column exists
 * but is mostly blank into a mass wipe that reads like an ordinary batch
 * of edits. A missing COLUMN never appears here at all: the upload has no
 * opinion on it, which is decided in importColumns.js long before this.
 */

/**
 * @param {object[]} rows parsed rows, each with a syncKey
 * @param {string[]} columns db columns this file may write (importColumns)
 * @param {Map<string, object>} existing sync_key -> the stored row
 * @param {(row: object) => Record<string, any>} valuesOf what the upsert
 *   would write for one parsed row, keyed by column. Passed in rather than
 *   rebuilt here, so the diff and the write cannot disagree about what "the
 *   new value" is.
 * @param {Record<string, string>} fieldFor db column -> camelCase name, for
 *   labelling. The change log and the UI both speak camelCase.
 * @param {Map<string, object>} claims `${rowId}:${field}` -> the last edit a
 *   HUMAN made to that field, from the change log. Optional: without it a
 *   claimed cell is still marked, it just cannot say when or from what.
 */
function buildImportDiff({
  rows, columns, existing, valuesOf, fieldFor = {}, claims = new Map(),
}) {
  const changed = [];
  const created = [];
  /**
   * EVERY EXISTING DEAL THIS FILE MENTIONS, changed or not.
   *
   * The other lists answer "what does this file change". This answers "which
   * of my rows is this file about", which is the question a sheet of ENDED
   * deals asks: upload the list of what has finished and delete exactly
   * those, rather than hunting for them one at a time on the table.
   *
   * Identity only, and the row's own id. It is a list to tick, not a diff to
   * read, so the values it would have written are not its business.
   */
  const inFile = [];

  for (const row of rows) {
    const old = existing.get(row.syncKey);
    if (old) {
      // snake_case, matching `notInFile`, because both feed the same list.
      // Two shapes for one list is how a component ends up with a branch
      // per source.
      inFile.push({
        id: old.id,
        sync_key: row.syncKey,
        person_name: old.person_name ?? row.personName,
        company: old.company ?? row.company,
        group_name: old.group_name ?? row.groupName,
        role_label: old.role_label ?? row.roleLabel,
      });
    }

    if (!old) {
      created.push({
        // ITS POSITION IN THE FILE, carried through. Without it the modal
        // had nothing to name a row by when filling a value in for it
        // alone: every per-row value was keyed `undefined`, the server
        // read that as not-a-row and dropped it, and the value appeared
        // optimistically and then vanished when the re-read landed.
        uploadIndex: row.uploadIndex,
        syncKey: row.syncKey,
        personName: row.personName,
        company: row.company,
        groupName: row.groupName,
        roleLabel: row.roleLabel,
        needsReview: row.needsReview,
        reviewReason: row.reviewReason,
      });
      continue;
    }

    /**
     * ===============================
     * * A CLAIMED COLUMN IS SHOWN, NOT HIDDEN
     * ===============================
     * It used to `continue` here, so a column anybody had ever edited by
     * hand vanished from the diff for good: never listed, never offered,
     * never written. The invisible guard was removing the visible modal's
     * one job, which is to ask.
     *
     * It is marked instead, with WHEN it was set and WHAT it was before, so
     * the choice is made knowing why the CRM disagrees with the sheet. The
     * default side is the only thing the claim decides now.
     */
    const claimed = new Set(old.manually_overridden_fields ?? []);
    const values = valuesOf(row);
    const cells = [];

    for (const column of columns) {
      // Seeded on write, never a question. See importColumns.
      if (SEEDED_NOT_ASKED.has(column)) continue;
      // Part of another cell, asked about there. See importColumns.
      if (COMPANION_COLUMNS.has(column)) continue;
      const to = values[column];
      /**
       * ===============================
       * * HIS WORDS WHERE THE VALUE WOULD BE
       * ===============================
       * The end date cell moves when his NOTE moves, even though both
       * dates are null either side. Comparing the date alone made 12 rows
       * identical, so they never reached the diff and the commit never
       * wrote them: the silence this column exists to end.
       *
       * The note is also what the cell SAYS. "Going concern" read as
       * "empty" told the admin the sheet had nothing there, and counted
       * the row among the ones the file would CLEAR.
       */
      const companion = COMPANIONS[column];
      const noteFrom = companion ? asText(old[companion.note]) : '';
      const noteTo = companion ? asText(values[companion.note]) : '';
      if (sameStoredValue(old[column], to) && noteFrom === noteTo) continue;
      const from = noteFrom || asText(old[column]);
      const next = noteTo || asText(to);
      const byHand = claimed.has(column);
      const claim = byHand ? claims.get(`${old.id}:${fieldFor[column] ?? column}`) : null;
      cells.push({
        column,
        field: fieldFor[column] ?? column,
        from,
        to: next,
        // Empty on the sheet where the CRM has something. The one the
        // reader has to be able to pick out of the list.
        kind: next === '' && from !== '' ? 'cleared' : 'set',
        // WHICH SIDE WINS unless somebody says otherwise. Incoming, except
        // where a human typed this value in: their correction is not
        // overwritten by a file they have not looked at yet.
        keep: byHand,
        byHand,
        // Null when the edit predates the change log or was never logged.
        // The mark still shows; only the detail is missing.
        claimedAt: claim?.changed_at ?? null,
        claimedFrom: claim?.old_value ?? null,
      });
    }

    if (cells.length === 0) continue; // identical, and identical is a count

    changed.push({
      uploadIndex: row.uploadIndex,
      id: old.id,
      syncKey: row.syncKey,
      personName: row.personName ?? old.person_name,
      company: row.company ?? old.company,
      groupName: row.groupName ?? old.group_name,
      roleLabel: row.roleLabel ?? old.role_label,
      cells,
      // So the modal can say "3 of these only clear a value" without
      // walking the cells again on every render.
      clearedCount: cells.filter((c) => c.kind === 'cleared').length,
    });
  }

  return {
    changed,
    new: created,
    inFile,
    // Rows that would be left exactly as they are. Worth a number: on a
    // normal month it is most of the sheet, and seeing it is how you know
    // the diff is short because nothing moved rather than because the
    // parse went wrong.
    unchanged: rows.length - changed.length - created.length,
  };
}

module.exports = { buildImportDiff };
