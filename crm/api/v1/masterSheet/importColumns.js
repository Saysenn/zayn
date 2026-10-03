/**
 * WHICH COLUMNS AN UPLOAD IS ALLOWED TO WRITE.
 *
 * A column the file does not have and a column whose cells are empty are
 * two different facts, and the parser could not tell them apart. It filled
 * all 31 fields for every row regardless, and the upsert wrote all 31 — so
 * uploading a sheet without a "Provisional payment end date" column, or
 * with that header renamed, set `end_on` to nothing on every row a human
 * had not claimed. Nothing errored. The dates simply went.
 *
 * So an upload now writes only the columns its file actually carried. What
 * the sheet does not mention, it does not get an opinion on.
 *
 * This is NOT the empty-cell case. A column that IS present with an empty
 * cell is a real statement ("no end date"), and stays a change the admin
 * can accept or reject.
 */

/**
 * db column -> the parsed fields that feed it.
 *
 * Several columns are computed rather than read (`payable_days` falls out
 * of the preset and payment start dates when the sheet has no column of
 * its own), so a computed column counts as present when ANY of its inputs
 * is. Getting this wrong in the other direction is the dangerous one: a
 * column wrongly called absent is merely not updated, where a column
 * wrongly called present overwrites good data with nothing.
 */
const COLUMN_SOURCES = {
  person_id: ['personName'],
  person_name: ['personName'],
  phone: ['phone'],
  role: ['role'],
  seat: ['role'],
  role_label: ['role'],
  group_name: ['group'],
  company: ['company'],
  assigned_on: ['appointmentOn'],
  payment_start_on: ['paymentStartOn'],
  preset_on: ['presetOn'],
  end_on: ['endOn'],
  payable_days: ['payableDays', 'presetOn', 'paymentStartOn'],
  monthly_amount: ['monthlyAmount'],
  payable_amount: ['payableAmount', 'monthlyAmount', 'payableDays', 'presetOn', 'paymentStartOn'],
  currency: ['currency'],
  payment_method: ['paymentMethodRaw'],
  location: ['location'],
  door_number: ['doorNumber'],
  postcode: ['postcode'],
  accepting_postals: ['acceptingPostals'],
  label: ['label'],
  should_be_paid: ['shouldBePaid'],
  paid: ['paid'],
  /**
   * ONLY A NOTES COLUMN MAKES NOTES WRITABLE.
   *
   * The payment start cell feeds this too when it holds prose rather than
   * a date ("AUGUST END FULL"), and listing it here as a source looked
   * right: it IS where some notes come from. But writability is decided
   * per FILE, not per row, so any sheet carrying a payment start date
   * counted as having an opinion on notes. The export does not write a
   * Notes column at all, so re-uploading a generated sheet cleared the
   * note on every row that had one: 18 of 96 on the live data.
   *
   * A note found in a payment start cell still reaches a NEW row, because
   * an insert writes every column. It just cannot overwrite an existing
   * one from a file that never mentioned notes.
   */
  notes: ['notes'],
  /**
   * DELIBERATELY ABSENT FROM THIS MAP, and for the same reason as `notes`
   * directly above: it is read out of the payment start cell, and only the
   * HUMAN sheet can express it.
   *
   * "AUGUST END FULL" is the only thing that sets it. Our own export writes
   * that cell as a real date (2026-08-31), because that is what the column
   * is for. So the round trip generate a month -> boss edits -> re-upload
   * would carry a Payment start column with no FULL in it, and listing the
   * column here would read that as "this row is ordinary" and clear the
   * flag. The next month sheet would then pro-rate Drew and James King back
   * to one day, which is the bug this column was added to fix, returning by
   * the back door.
   *
   * Not in the map means: never overwritten on an existing row, still
   * written on a NEW one, because an insert writes every column. An admin
   * turns it off by hand, which claims it like any other edit.
   */
  bank_details: ['bankDetails'],
  account_number: ['accountNumber'],
  sort_code: ['sortCode'],
  // Seeded from the end date, so it has no business being written by a
  // file that never mentioned one.
  status: ['endOn'],
  /**
   * HIS WORDS IN THE END DATE CELL, and the flag they set.
   *
   * Both are read out of that one cell, so they are present exactly when
   * the end date column is. Leaving them out of this map is what made the
   * feature dead on its own path: the parser read all 31 prose rows, the
   * upsert carried the values, and the SET list dropped them on every
   * EXISTING row, which is all 92 of them. See shared/endNote.helper.js.
   */
  end_note: ['endOn'],
  review_monthly: ['endOn'],
};

/**
 * Always written, whatever the file looked like.
 *
 * These are the parser's own verdict on the rows it just read, not values
 * copied out of the sheet. Leaving them stale would mean a row still
 * flagged for a problem the new file fixed.
 */
const ALWAYS_WRITTEN = ['needs_review', 'review_reason'];

/**
 * ===============================
 * * SEEDED, NEVER ASKED ABOUT
 * ===============================
 * Written like any other column, kept OUT of the diff.
 *
 * `status` is derived from the end date by identity.js `statusFor`, so a
 * file carrying an end date proposed a new value for it on every row. The
 * diff then showed a two way choice between `ended` and `active` that
 * changes NOTHING a person can see: the badge and the status filter both go
 * through `shared/paymentPeriod.helper.js` (see masterSheetRows.repo's
 * findAll, which filters on the derived expression, not this column).
 *
 * It used to be meaningful, because a human could claim it. Migration 052
 * removed that, so the question has had no answer worth giving since.
 *
 * Read by `diffImport.js`, which skips these when building cells, and by
 * the commit route, which adds them back to every per row mask so storage
 * is exactly what it was.
 */
const SEEDED_NOT_ASKED = new Set(['status']);

/**
 * ===============================
 * * COLUMNS THAT TRAVEL WITH ANOTHER
 * ===============================
 * A companion is not a separate question: it IS part of the cell it
 * belongs to, so it is never offered on its own and never written without
 * its owner. `end_note` ticked while `end_on` was rejected would print
 * "Going concern" over the date the admin chose to keep.
 *
 * `note` is the one the diff DISPLAYS in place of its owner's value, so
 * the cell reads his words rather than "empty". `also` travels with it and
 * shows nothing: a boolean the review queue reads is not a thing to print.
 */
const COMPANIONS = Object.freeze({
  end_on: { note: 'end_note', also: ['review_monthly'] },
});

const COMPANION_COLUMNS = new Set(
  Object.values(COMPANIONS).flatMap((c) => [c.note, ...c.also]),
);

/**
 * @param {string[]} columns db columns a row's mask allows
 * @returns {string[]} the same, plus every companion whose owner is in it
 *
 * Used where a PER ROW mask is built from what a human ticked. Half a cell
 * written is worse than none: the date kept and the note written would put
 * a pill over a date on the master sheet.
 */
function withCompanions(columns) {
  const out = new Set(columns);
  for (const [owner, companion] of Object.entries(COMPANIONS)) {
    if (!out.has(owner)) continue;
    out.add(companion.note);
    for (const extra of companion.also) out.add(extra);
  }
  return [...out];
}

/**
 * @param {Set<string>} fields canonical field names the file's headers mapped to
 * @param {object} [defaults] db column -> value the admin typed for this upload
 * @returns {string[]} db columns this upload may write
 *
 * A COLUMN THE ADMIN GAVE A VALUE FOR IS WRITABLE, even though the file
 * never carried it. The rule is "the upload only writes what it was told",
 * and being told by a person in the diff is being told. It still lands as
 * a change they accept or reject per row like any other, so nothing
 * arrives unapproved.
 */
function writableColumns(fields, defaults = {}, overrides = {}) {
  const given = new Set();
  const take = (values) => {
    for (const [column, value] of Object.entries(values ?? {})) {
      if (value !== '' && value != null) given.add(column);
    }
  };
  take(defaults);
  // A value typed on ONE card counts too. Without this a per-row fill was
  // computed into the row and then dropped from the SET list, so setting
  // it changed nothing on an existing deal and the diff showed no reason
  // why.
  for (const fields_ of Object.values(overrides)) take(fields_);
  const out = Object.entries(COLUMN_SOURCES)
    .filter(([column, sources]) => given.has(column) || sources.some((f) => fields.has(f)))
    .map(([column]) => column);
  // A default on the end date makes status meaningful again, the same way
  // the file carrying the column does.
  if (given.has('end_on') && !out.includes('status')) out.push('status');
  return [...out, ...ALWAYS_WRITTEN];
}

module.exports = {
  COLUMN_SOURCES,
  ALWAYS_WRITTEN,
  SEEDED_NOT_ASKED,
  COMPANIONS,
  COMPANION_COLUMNS,
  withCompanions,
  writableColumns,
};
