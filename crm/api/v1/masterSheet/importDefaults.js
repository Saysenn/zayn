/**
 * WHAT THE FILE DID NOT SAY, filled in by the person uploading it.
 *
 * A sheet the boss sends is often a slice: one group, a few columns, the
 * rest left off because he knows what they are. The CRM then invented its
 * own answers, and one of them cost real rows. "August send for nexus
 * Unpaid.xlsx" has no Group column, and with no NEXUS deals left in the
 * CRM the filename could not be matched against anything, so six deals
 * imported as UNKNOWN. The group is part of a deal's identity, so they
 * duplicated the moment NEXUS came back.
 *
 * The fix is not a cleverer guess. It is asking: the diff shows what the
 * file leaves blank, and a value typed there applies to the whole upload.
 *
 * THE ORDER, since 2026-08-25:
 *
 *   a value typed on ONE row   beats everything
 *   a value applied to ALL     beats the file's own cell, the recovered
 *                              header, the tab name and the file name
 *   the file's own cell        beats nothing typed here
 *
 * THE PERSON WINS NOW, INCLUDING OVER THE FILE. It used to be the other way
 * round — the row's own cell beat everything and a typed value only filled
 * a blank — on the reasoning that the file is the record. That left the
 * diff unable to correct the commonest fault there is: a sheet whose preset
 * still says last month on every row, where the fix is one value applied to
 * all of them and the file is precisely what is wrong.
 *
 * Nothing is written unaccepted. A typed value lands in the diff as an
 * ordinary per-row change, so overruling the file is still a decision
 * somebody makes in front of the list.
 */

/**
 * EVERY COLUMN THE SHEET ITSELF CARRIES can be filled in.
 *
 * What is missing from a partial sheet is not predictable, so the list is
 * not a curated few: it is every column that comes off the file. The only
 * exclusions are the ones a value could not mean anything for:
 *
 *   person_id, person_name   a row with no name is not a row. It is
 *                            dropped before any of this runs, so there is
 *                            nothing to fill in.
 *   role, seat               parsed out of role_label, which IS fillable.
 *   payable_days,            computed from the preset date, payment start
 *   payable_amount           and monthly amount, all three fillable. A
 *                            default on the result would sit beside inputs
 *                            that disagree with it.
 *   status                   derived from end_on, which is fillable.
 *   needs_review,            the parser's own verdict on what it just
 *   review_reason            read, not a value off the sheet.
 */
const DEFAULTABLE = [
  'group_name',
  'company',
  'role_label',
  'assigned_on',
  'payment_start_on',
  'preset_on',
  'end_on',
  'monthly_amount',
  'currency',
  'payment_method',
  'location',
  'door_number',
  'postcode',
  'phone',
  'accepting_postals',
  'label',
  'should_be_paid',
  'paid',
  'notes',
  'bank_details',
  'account_number',
  'sort_code',
];

/** Anything else in the payload is ignored rather than trusted. */
function cleanDefaults(input) {
  const out = {};
  for (const column of DEFAULTABLE) {
    const value = input?.[column];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text !== '') out[column] = text;
  }
  return out;
}

/**
 * A JSON blob off a multipart field, which is a string or nothing.
 * A malformed one is treated as none: an upload must not fail because a
 * default could not be parsed.
 */
function parseDefaults(raw) {
  if (!raw) return {};
  try {
    return cleanDefaults(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    return {};
  }
}

/**
 * The same thing for ONE row: `{ "3": { location: "Abu Dhabi" } }`.
 *
 * KEYED BY THE ROW'S POSITION IN THE FILE, not by its sync_key. The key is
 * built FROM these values: filling in a group changes it, so a key could
 * not identify the row whose group is being set. Position is stable across
 * re-parses of the same file, which is the only thing that has to be true.
 */
function parseOverrides(raw) {
  if (!raw) return {};
  try {
    const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const out = {};
    for (const [index, fields] of Object.entries(input ?? {})) {
      const n = Number(index);
      if (!Number.isInteger(n) || n < 0) continue;
      const cleaned = cleanDefaults(fields);
      if (Object.keys(cleaned).length > 0) out[n] = cleaned;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * db column -> the canonical field mapSheetRow knows it by, so a fill can
 * be applied before anything is computed. Derived from COLUMN_SOURCES so
 * the two cannot drift: its first source is the column's own field.
 */
/**
 * The date columns, which need a Date object rather than the text typed.
 *
 * `toDate` in mapSheetRow refuses strings ON PURPOSE: a sheet cell reading
 * "tbc" or "Ongoing" must never become a date. A default is not a sheet
 * cell, though, it is a date somebody typed, so it is turned into a real
 * Date here and arrives looking like any other date on the row. Without
 * this the value reached the column and was then dropped by safeDate, so a
 * filled-in preset date silently did nothing and the pro-rata was still
 * computed without it.
 */
const DATE_COLUMNS = new Set(['assigned_on', 'payment_start_on', 'preset_on', 'end_on']);

function asDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fieldsFor(values, columnSources) {
  const out = {};
  for (const [column, value] of Object.entries(values)) {
    const field = columnSources[column]?.[0];
    // `group` has its own chain of fallbacks (recovered header, tab name,
    // file name) that must be tried first, so it is filled later.
    if (!field || field === 'group') continue;
    if (DATE_COLUMNS.has(column)) {
      const d = asDate(String(value).trim());
      // A default nobody can parse is no default. Better a blank column
      // than an Invalid Date reaching Postgres.
      if (d) out[field] = d;
      continue;
    }
    out[field] = value;
  }
  return out;
}

module.exports = { DEFAULTABLE, cleanDefaults, parseDefaults, parseOverrides, fieldsFor };
