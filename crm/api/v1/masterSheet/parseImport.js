const { scanBuffer } = require('../calculator/readSheets');
const {
  mapSheetRow, carryForwardGroups, unknownHeaders, normalizeHeader, mappedFields,
} = require('../calculator/mapSheetRow');
const { personIdOf, parseRole, statusFor } = require('./identity');
const { canonicalize, SENTINELS } = require('./canonical');
const { dealKey } = require('./dealKey');
const { parseCompanyTable } = require('./parseCompanyTable');
const { writableColumns, COLUMN_SOURCES } = require('./importColumns');
const { fieldsFor } = require('./importDefaults');
const { groupFromFilename } = require('./groupFromFilename');
const { PAYMENT_START_OFFSET_DAYS } = require('../shared/fromAppointment.helper');

/**
 * A messy human-made xlsx, uploaded straight into the CRM, turned into
 * tb_mastersheet-shaped rows.
 *
 * This replaces whatbot's own upload-folder path (sheet/syncMasterSheet.js)
 * as the way a new sheet enters the system — user's own call: uploading
 * here gives immediate, visible feedback (rows parse in front of you, what's
 * messy is flagged on the spot), where the folder+cron route failed silently
 * and only on a date that had nothing to do with when the sheet was ready.
 *
 * LENIENT on purpose, same principle whatbot's own lenient parse follows:
 * the messy sheet goes in as-is, half-filled rows included, each flagged
 * with WHY it looked wrong (`needsReview`/`reviewReason`) so a human can
 * fix it on the Master Sheet page. A row is only dropped when there's no
 * person to attach it to at all. That's the whole point of this table —
 * it's the cleanup surface, so refusing messy input would defeat it.
 */

// Identity comes from dealKey.js, shared with the hand-add path — that
// sharing is the whole point. See that file for why the comparison
// strips punctuation and spacing, and why money and dates are not in it.
const buildSyncKey = dealKey;

/**
 * A sheet cell -> 'YYYY-MM-DD', or null.
 *
 * TWO SEPARATE PROBLEMS, both solved here.
 *
 * 1. Excel hands some cells over as a Date object holding no valid time —
 *    real rows in the boss's own sheet do this (the "TBC" entries).
 *    Postgres rejects those outright ("invalid input syntax for type
 *    date"), taking the whole upload down with them. Unparseable means
 *    "not known", which is null.
 *
 * 2. IT RETURNS A STRING, NOT THE DATE. A JS Date is a moment in time; a
 *    Postgres `date` is a calendar day with no timezone. Handed a Date,
 *    node-postgres has to pick which day that instant falls on and uses
 *    the server's local zone — so on any host behind UTC, "1 July" was
 *    stored as 30 June. That shifted EVERY date in the live database back
 *    a day: preset, appointment, payment start and end alike, which moved
 *    81 rows out of July into June and put the pro-rata on the wrong
 *    month's denominator.
 *
 *    A date string has no instant to convert, so no zone can be applied.
 *    UTC is the right reading because that is how Excel encodes the cell
 *    and what exceljs hands back.
 *
 *    Nothing else in this codebase writes a Date to a date column: the
 *    agent's tools and the hand-add path both take 'YYYY-MM-DD' already.
 */
function safeDate(v) {
  if (!(v instanceof Date)) return null;
  if (Number.isNaN(v.getTime())) return null;
  return v.toISOString().slice(0, 10);
}

/**
 * The Group column, when its HEADER has been typed over.
 *
 * Cell A1 of the live file read "Group" until somebody replaced it with
 * "pre". Nothing then mapped to a group, and all 96 rows imported as
 * UNKNOWN — the roster intact but ungrouped, which breaks the group filter,
 * whatbot's scoping and every per-group export.
 *
 * The VALUES were never lost, only the label above them. So when no header
 * maps to a group, the first column is treated as one — but only if it
 * looks like a group column: mostly-filled, short text, and repeating.
 * A column of names or dates fails all three and is left alone.
 *
 * A correct header always wins; this never runs when one exists.
 */
const MAX_GROUP_NAME = 40;

// A header the parser already understands is never a candidate for
// recovery. Derived from the alias table itself via unknownHeaders, so a
// column added there is automatically protected here too.
const isKnownHeader = (h) => unknownHeaders([h]).length === 0 && String(h ?? '').trim() !== '';

function looksLikeGroupColumn(rows, key) {
  const values = rows.map((r) => String(r[key] ?? '').trim()).filter(Boolean);
  if (values.length < rows.length * 0.5) return false;           // mostly filled
  if (values.some((v) => v.length > MAX_GROUP_NAME)) return false; // short
  if (values.some((v) => /^\d/.test(v))) return false;            // not numbers or dates
  // Repeating: a handful of groups across many rows, never one per row.
  return new Set(values.map((v) => v.toLowerCase())).size <= Math.max(2, values.length / 3);
}

/**
 * Rewrites the first column's header to "Group" when nothing else maps to
 * one, so carryForwardGroups and mapSheetRow find it the usual way. Returns
 * the rows unchanged when a real Group header exists.
 */
function recoverGroupHeader(table) {
  const headers = table.headers ?? [];
  if (headers.some((h) => normalizeHeader(h) === 'group')) return table.rows;

  const first = headers[0];
  if (!first) return table.rows;

  // THE FIRST COLUMN MUST BE ONE WE DO NOT RECOGNISE.
  //
  // "pre" maps to nothing, so it is a candidate. "Role:" maps to role and
  // must never be stolen — and it would have been: blank out A1 and the
  // extractor's first column becomes Role, whose values are short,
  // repeating and mostly filled, so every other test here passes. That
  // produced groups called DIRECTOR, MID 1 and TECH.
  if (isKnownHeader(first)) return table.rows;

  if (!looksLikeGroupColumn(table.rows, first)) return table.rows;

  return table.rows.map((r) => {
    const { [first]: value, ...rest } = r;
    return { Group: value, ...rest };
  });
}

/**
 * Our own total blocks, so a generated sheet can be uploaded back.
 *
 * The export writes a heading (`Total`, `Total for INDIGO`) and then one row
 * per currency (`GBP | | 4,750`) across the first three columns, which on
 * that sheet are Role, Name of individual and Company.
 *
 * WHY THIS EXISTS AT ALL. An earlier layout put the currency in the NAME
 * column, so the parser's one rule for discarding a line ("no person on it")
 * stopped firing: every total came back as a person called GBP, and 96 deals
 * re-imported as 191.
 *
 * Two shapes, matched separately:
 *   heading  the label in the first column, which is ours and fixed
 *   currency a first column and a figure with the NAME COLUMN EMPTY
 *
 * Both also require the sparseness a real deal never has, so a person
 * genuinely called "Total" with a company and a date still imports. The
 * currency rows would be dropped by mapSheetRow anyway for having no name on
 * them; naming them here means the file's own furniture is discarded on
 * purpose rather than by luck, and it survives a column being reordered.
 */
// Our own furniture: the total blocks, and the breakdown table's own
// headings and total lines ("Bank Transfer Total GBP", "Grand Total AED",
// "Row Labels"). All are named here rather than left to be discarded for
// having no person on them, so the file's own scaffolding is dropped on
// purpose and survives a column being reordered.
const TOTAL_LABEL = /^(total|row labels|grand total|ended, not counted|total for |.+\stotal(\s|$))/i;
// Written as the sheet writes it, so not ISO: GBP, AED, EURO. Letters only
// and short is the whole test — an allow-list would reject the first new
// currency the boss takes on.
const CURRENCY_LABEL = /^[a-z]{2,5}$/i;

function isOwnTotalRow(rawRow) {
  const values = Object.values(rawRow ?? {}).map((v) => String(v ?? '').trim());
  const filled = values.filter(Boolean).length;
  const first = values[0] ?? '';
  // A total line carries a label and a figure and nothing else. Four or more
  // filled cells means it is a deal, not a total.
  if (filled > 3) return false;
  if (TOTAL_LABEL.test(first)) return true;

  const isNumber = (v) => v !== '' && Number.isFinite(Number(v));

  // A LABEL AND A FIGURE BESIDE IT, which is where the breakdown's figures
  // now sit: column B, the Name of individual column. mapSheetRow would
  // otherwise read "750" as a person's name and import every line of the
  // pivot as a deal. No real row has a number for a name and nothing else
  // on it, so the shape is the test.
  if (filled <= 2 && first && isNumber(values[1] ?? '')) return true;

  // The older shape, from before the gutter column was closed up: a label,
  // an empty name column, and the figure in C. Files exported then are
  // still uploaded now.
  return CURRENCY_LABEL.test(first) && !values[1] && isNumber(values[2] ?? '');
}

/**
 * Is this worksheet named after a GROUP, or after the document?
 *
 * A tab called NEXUS or MILKMAN says which group its rows belong to. A tab
 * called "Master sheets" says only that the file is a master sheet, and
 * treating it as a group name files the whole roster under a group nobody
 * has ever heard of.
 *
 * Deny-list rather than an allow-list of the five known groups: the boss
 * invents a group whenever he takes on a new client, and a new group must
 * import on the day it appears rather than after somebody edits this file.
 */
const DOCUMENT_TAB_NAMES = /^(master\s*sheets?|sheet\d*|data|export|all)$/i;

function isGroupTabName(name) {
  const s = String(name ?? '').trim();
  return s.length > 0 && !DOCUMENT_TAB_NAMES.test(s);
}

// What made a row look wrong, in plain words — shown on the page and to
// Diane. Blank when the row is fine.
//
// Note a payable amount of 0 is NOT a problem: the sheet writes a real 0
// for deals that are agreed but not yet paying (Sertan Huseyin, Stuart S,
// Peter Gibson on Social work partners PR all sit at £0 legitimately).
// Only an amount we could not work out at all is worth a human's time.
//
// Only complains about columns THE FILE ACTUALLY HAD. A sheet with no
// Company column is not 96 rows each missing a company, it is a sheet that
// does not talk about companies, and flagging every row for it buries the
// rows with a genuine problem.
function reviewReasonFor(mapped, present) {
  const reasons = [];
  const has = (field) => present.has(field);
  // GROUP IS THE EXCEPTION, flagged whether the column was there or not.
  // Every other absent column merely leaves a value unknown; an absent
  // group changes the row's IDENTITY, so it cannot match the same deal
  // stored under its real group and the upload inserts a duplicate of it.
  // That is worth a human's attention on every single row it happens to.
  if (!mapped.group) reasons.push('no group');
  if (has('company') && !mapped.company) reasons.push('no company');
  if (has('paymentMethodRaw') && mapped.paymentMethod === null) {
    reasons.push('payment method not recognised');
  }
  // A missing preset date is NOT a problem — it means no pro-rata applies
  // and the full monthly amount is owed, which is what the sheet itself
  // does on those rows. Only an amount we genuinely could not work out is
  // worth a human's attention.
  if (has('monthlyAmount') && mapped.payableAmount === null) {
    reasons.push(
      mapped.paymentStartNote
        ? `payment start reads "${mapped.paymentStartNote}", not a date`
        : 'cannot work out the payable amount',
    );
  } else if (mapped.paymentStartNote) {
    // PROSE THAT THE APPOINTMENT RESCUED IS STILL A READING, NOT A FACT.
    // This only fired when nothing could be computed, so the six `END FULL`
    // rows went through silently on appointment + 90. His own August sends
    // resolved that phrase two different ways, 1,613 apart on two rows.
    reasons.push(
      `payment start reads "${mapped.paymentStartNote}", `
      + `read as appointment + ${PAYMENT_START_OFFSET_DAYS} days`,
    );
  }
  if (has('currency') && !mapped.currency) reasons.push('no currency');
  // A phrase in the end date column that nobody has taught it. The words
  // are kept, the date is left empty, and this says so rather than the row
  // losing its end date in silence.
  if (mapped.endNoteKnown === false) {
    reasons.push(`end date reads "${mapped.endNote}", which is not a date or a phrase the CRM knows`);
  }
  return reasons.join(', ');
}

const SENTINEL_FIELDS = [
  'acceptingPostals', 'phone', 'bankDetails', 'accountNumber', 'sortCode',
  // THE END DATE COLUMN, which holds words on 31 of his 92 September rows.
  // `Going concern` and `Reviewed monthly` are in SENTINELS so they pass
  // without a warning; a THIRD phrase he invents does not, which is the
  // whole point. Until this, every one of them was dropped in silence.
  'endNote',
];
const KNOWN_SENTINELS = new Set(SENTINELS.map((value) => value.toLowerCase()));

function sentinelWarningsFor(rows) {
  const warnings = [];

  for (const field of SENTINEL_FIELDS) {
    const counts = new Map();
    for (const row of rows) {
      const value = String(row[field] ?? '').replace(/\s+/g, ' ').trim();
      if (!value || KNOWN_SENTINELS.has(value.toLowerCase())) continue;
      // Account numbers, phone numbers and sort codes can contain spaces,
      // punctuation and a leading plus. Letters make this prose shaped.
      if (!/[a-z]/i.test(value)) continue;
      const key = value.toLowerCase();
      const found = counts.get(key) ?? { value, rows: 0 };
      found.rows += 1;
      counts.set(key, found);
    }
    for (const found of counts.values()) {
      if (found.rows >= 2) warnings.push({ field, ...found });
    }
  }

  return warnings.sort((a, b) => a.field.localeCompare(b.field) || a.value.localeCompare(b.value));
}

/**
 * @param {Buffer} buffer the uploaded xlsx
 * @param {object} [options]
 * @param {string} [options.filename] as uploaded. The LAST place a group is
 *   looked for, after the column, the recovered header and the tab name.
 *   See groupFromFilename.js for why, and for the three rules that keep it
 *   from guessing.
 * @param {string[]} [options.knownGroups] groups already in the CRM. The
 *   filename can only ever match one of these; it never invents a group.
 * @returns {{ rows, columns, stats }}
 */
async function parseMasterSheetImport(
  buffer,
  { filename = '', knownGroups = [], defaults = {}, overrides = {} } = {},
) {
  // Applied to the NORMALIZED row before anything is computed, so a filled
  // in preset date or monthly amount recomputes the pro-rata rather than
  // sitting beside a figure worked out without it. `group` is excluded and
  // filled later: it has its own chain of fallbacks to try first.
  const defaultFills = fieldsFor(defaults, COLUMN_SOURCES);
  const overrideFills = Object.fromEntries(
    Object.entries(overrides).map(([i, v]) => [i, fieldsFor(v, COLUMN_SOURCES)]),
  );
  // Counted across the whole file, not per table: an override names a row
  // by its position in the upload, which is what the modal can see.
  let rowIndex = -1;
  const sheets = await scanBuffer(buffer);
  let tables = 0;
  let skipped = 0;

  // TWO PASSES, deliberately.
  //
  // Canonical spelling can only be decided once every row has been seen —
  // it picks whichever way the team writes a value most often (see
  // canonical.js). So mapping happens first, the whole set is folded to
  // one spelling per value, and only THEN are identities built. Building
  // sync keys before the fold would let "Relia PA" and "Relia Pa" become
  // two different deals for what is one company.
  const mappedRows = [];
  // Columns the sheet has that this parser does not read. Collected across
  // every table and deduped, because one sheet can hold several tables and
  // a new column usually appears on all of them.
  const unmapped = new Map();
  // Which fields this FILE carries, pooled across every table in it. A
  // column absent here is one the upload has no opinion on and must not
  // write. See importColumns.js.
  const present = new Set();
  for (const sheet of sheets) {
    for (const table of sheet.tables) {
      tables += 1;
      for (const label of unknownHeaders(table.headers)) {
        if (!unmapped.has(label.toLowerCase())) unmapped.set(label.toLowerCase(), label);
      }
      for (const field of mappedFields(table.headers)) present.add(field);
      // The boss's own sheets write a group once and leave it blank down
      // the rest of the block — without this those rows have no group at
      // all. Already solved for the calculator; same fix applies here.
      const raw = carryForwardGroups(recoverGroupHeader(table));
      for (const rawRow of raw) {
        // Our own totals block, if this file came from the export.
        if (isOwnTotalRow(rawRow)) { skipped += 1; continue; }
        rowIndex += 1;
        // A row's own override beats the column default, which beats what
        // the file left blank. Same order the UI reads: a value typed on
        // one card is about that card.
        const mapped = mapSheetRow(rawRow, {
          ...defaultFills,
          ...(overrideFills[rowIndex] ?? {}),
        });
        // null means there's no person on the row at all (a spacer, a
        // subtotal line) — nothing to clean up later, so it isn't kept.
        if (!mapped) {
          skipped += 1;
          continue;
        }
        // Its position in the file, carried through so the modal can name
        // one row when filling a value in for it alone. Not the sync_key:
        // that key is built FROM these values, so it changes the moment a
        // group is filled in and could not identify the row being edited.
        mapped.uploadIndex = rowIndex;
        // THE TAB NAME IS THE GROUP, but only for a tab actually named
        // after one.
        //
        // Our own per-month export writes one tab per group with the name
        // at the top and NOT repeated down every row, so without this that
        // file re-uploads with everything in "UNKNOWN".
        //
        // The guard matters more than the fallback. Written without it,
        // this fired on the boss's own file the day cell A1 got typed over
        // ("Group" became "pre"), and quietly filed all 96 rows under
        // "MASTER SHEETS" — a plausible-looking group that exists nowhere.
        // A broken header should stay loudly broken: UNKNOWN is visible,
        // and the upload result already names "pre" as an unrecognised
        // column. Never invent a group from a whole-document tab name.
        if (!mapped.group && isGroupTabName(sheet.sheet)) {
          mapped.group = String(sheet.sheet).trim().toUpperCase();
        }
        mappedRows.push(mapped);
      }
    }
  }

  // mapSheetRow names the person's role `role` and the group `group`;
  // canonical.js works on the field names the rest of the pipeline uses,
  // so the two are bridged here rather than renaming either side.
  // THE LAST PLACE A GROUP IS LOOKED FOR: the file's own name.
  //
  // Only for rows nothing else could group, and only ever a group the CRM
  // already has. A deal's identity contains its group, so a row landing on
  // UNKNOWN does not match the same deal already stored under its real
  // group, and the upload inserts a duplicate of it. That is what "August
  // send for nexus Unpaid.xlsx" did: six rows, six duplicates, and the
  // word nexus sitting in the filename the whole time.
  const ungrouped = mappedRows.filter((m) => !m.group);
  const fromName = ungrouped.length > 0
    ? groupFromFilename(filename, knownGroups)
    : { group: null, reason: '' };
  if (fromName.group) for (const m of ungrouped) m.group = fromName.group;

  // AND LAST, WHAT THE ADMIN TYPED. It beats the tab name and the file
  // name because those are guesses and this is not: they are looking at
  // the diff those guesses produced and overruling it. It never beats a
  // Group cell on the row itself, which is the file's own record.
  for (const m of mappedRows) {
    if (m.group) continue;
    m.group = overrides[m.uploadIndex]?.group_name || defaults.group_name || m.group;
  }

  for (const m of mappedRows) {
    m.roleLabel = String(m.role ?? '').trim() || 'Other';
    m.groupName = m.group || 'UNKNOWN';
  }
  const { folded } = canonicalize(mappedRows);

  // A group can reach a row without a Group header: recoverGroupHeader
  // rebuilds one from the first column, and a tab named after a group
  // supplies it. Either way the file DID say which group these rows belong
  // to, so the column is present even though no header mapped to it.
  if (mappedRows.some((m) => m.groupName && m.groupName !== 'UNKNOWN')) present.add('group');

  const rows = [];
  // Counts how many times one natural key has already been seen across
  // the WHOLE upload (not per table), so the dedupe suffix stays stable
  // when a person legitimately appears twice on the same company in the
  // same role. Keyed on the base identity, never on row position.
  const keyCounts = new Map();

  {
    {
      mappedRows.forEach((mapped) => {
        // A default fills what the row does not say, never what it does.
        // `fill` is used for every defaultable column below so one rule
        // decides it, rather than fourteen `??` chains that would each
        // have to be got right.
        // A second pass for the columns mapSheetRow blanks rather than
        // leaves undefined, where the fill above could not catch them.
        // Row override first, then the column default.
        const own = overrides[mapped.uploadIndex] ?? {};
        const fill = (value, column) => {
          const has = value !== undefined && value !== null && String(value).trim() !== '';
          return has ? value : (own[column] ?? defaults[column] ?? value);
        };

        const roleLabel = fill(mapped.roleLabel === 'Other' ? '' : mapped.roleLabel, 'role_label')
          || 'Other';
        const { role, seat } = parseRole(roleLabel);
        const personId = personIdOf(mapped.personName);
        const groupName = mapped.groupName;
        const reviewReason = reviewReasonFor(mapped, present);

        const company = fill(mapped.company, 'company') ?? null;
        const identity = { groupName, company, role, seat, personId };
        const baseKey = buildSyncKey(identity);
        const dedupeIndex = keyCounts.get(baseKey) ?? 0;
        keyCounts.set(baseKey, dedupeIndex + 1);

        rows.push({
          uploadIndex: mapped.uploadIndex,
          syncKey: buildSyncKey(identity, dedupeIndex),
          personId,
          personName: mapped.personName,
          phone: fill(mapped.phone, 'phone') ?? '',
          role,
          seat,
          roleLabel,
          groupName,
          company,
          assignedOn: safeDate(mapped.appointmentOn),
          paymentStartOn: safeDate(mapped.paymentStartOn),
          presetOn: safeDate(mapped.presetOn),
          // The sheet's own end-date column is frequently the text
          // "Ongoing" rather than a date. tb_mastersheet.end_on is a
          // real `date` column, so text can't be stored there — it
          // becomes null (no known end date, which is what "Ongoing"
          // means) rather than failing the whole row over it.
          // A default here is a date string the admin typed, which needs
          // no safeDate: that guards Excel's own broken Date objects.
          endOn: safeDate(mapped.endOn) ?? own.end_on ?? defaults.end_on ?? null,
          // Both computed (computePayable.js), never read off the sheet.
          // null means "we could not work it out", which is a different
          // fact from 0 ("owed nothing") — but the columns are NOT NULL,
          // so an unknown lands as 0 with the row flagged and the reason
          // spelled out, rather than as a confident-looking wrong figure.
          payableDays: mapped.payableDays ?? 0,
          monthlyAmount: mapped.monthlyAmount ?? 0,
          payableAmount: mapped.payableAmount ?? 0,
          currency: fill(mapped.currency, 'currency') ?? 'GBP',
          paymentMethod: fill(mapped.paymentMethod, 'payment_method') ?? 'cash',
          location: fill(mapped.location, 'location') ?? '',
          postcode: fill(mapped.postcode, 'postcode') ?? '',
          label: mapped.label ?? '',
          shouldBePaid: mapped.shouldBePaid ?? '',
          paid: mapped.paid ?? '',
          // HIS WORD FROM THE END DATE COLUMN, kept as its own field
          // rather than folded into notes: the cell's tag reads it, and
          // "Reviewed monthly" also has to reach the review queue.
          endNote: mapped.endNote ?? null,
          endNoteKnown: mapped.endNoteKnown ?? null,
          reviewMonthly: mapped.reviewMonthly ?? false,
          // Prose found in the Payment start date column ("AUGUST END
          // FULL") is kept rather than dropped — it is real information
          // about a real payment, it just isn't a date. Appended to the
          // sheet's own notes instead of overwriting them.
          notes: [mapped.notes, mapped.paymentStartNote && `Payment start: ${mapped.paymentStartNote}`]
            .filter(Boolean)
            .join(' · '),
          bankDetails: fill(mapped.bankDetails, 'bank_details') ?? '',
          doorNumber: fill(mapped.doorNumber, 'door_number') ?? '',
          acceptingPostals: fill(mapped.acceptingPostals, 'accepting_postals') ?? '',
          accountNumber: fill(mapped.accountNumber, 'account_number') ?? '',
          sortCode: fill(mapped.sortCode, 'sort_code') ?? '',
          status: statusFor(mapped.endOn ?? own.end_on ?? defaults.end_on),
          needsReview: Boolean(reviewReason),
          reviewReason,
        });
      });
    }
  }

  const { companies, found: hasCompanyTable } = parseCompanyTable(sheets);

  return {
    rows,
    // The "Active company list" block, when the file carries one. Only
    // his per-group sheets do; the multi-group master has none.
    companies,
    hasCompanyTable,
    // The columns this file is entitled to write. Handed to syncUpsert,
    // which builds its SET list from them, so an absent column keeps
    // whatever the CRM already holds.
    columns: writableColumns(present, defaults, overrides),
    stats: {
      tables,
      parsed: rows.length,
      skipped,
      flagged: rows.filter((r) => r.needsReview).length,
      // What the fold changed, so the upload summary can say it out loud
      // rather than silently rewriting the team's own spelling.
      folded,
      // A repeated prose value in a column that normally carries a real
      // contact or banking value may be a renamed sentinel. Preview only:
      // it asks a person and never guesses or rewrites the value.
      sentinelWarnings: sentinelWarningsFor(mappedRows),
      // Named, not stored. Adding a column to tb_mastersheet is a schema
      // decision a parser should never make on its own, so the upload
      // reports what it could not read and a human decides whether it
      // matters. Silence was the old behaviour and it lost four columns.
      unknownColumns: [...unmapped.values()],
      // The other half of that sentence: columns the CRM holds that this
      // file never mentioned, and which are therefore left alone. Said out
      // loud because it used to be the opposite and unannounced.
      untouchedColumns: Object.keys(COLUMN_SOURCES).filter(
        (c) => !writableColumns(present, defaults, overrides).includes(c),
      ),
      // What the admin filled in, echoed back so the modal renders from
      // the server's answer rather than from what it thinks it sent.
      defaults,
      // Where the group came from when the sheet did not carry one, and
      // how many rows still have none. Both said out loud: a row landing
      // on UNKNOWN duplicates the real one, so it is not a detail.
      groupFromName: ungrouped.length > 0
        ? { group: fromName.group, reason: fromName.reason, rows: ungrouped.length }
        : null,
      ungrouped: rows.filter((r) => r.groupName === 'UNKNOWN').length,
    },
  };
}

module.exports = { parseMasterSheetImport };
