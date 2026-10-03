const rowsRepo = require('../repos/masterSheetRows.repo');
const settingsRepo = require('../repos/settings.repo');
const { rollToMonth, currentMonth } = require('./rollToMonth');
const { currenciesByGroup } = require('./groupTables');
const { exportWarnings } = require('./exportWarnings');
// The review's second door: a payout file must not be built over deals
// nobody has answered for. See exportWarnings' `unanswered-review`.
const { dueThisMonth } = require('../shared/reviewQueue.helper');

// ***************************************************
// * What an export CONTAINS, decided once
// ***************************************************
//
// Lifted out of export.js when Diane learned to export. The route was the
// only reader, so the filters, the presets and the counting lived inside
// it; a second caller would have meant a second copy, and two answers to
// "how many rows are in this file" is exactly the failure a payout export
// cannot have.
//
// SHE HAS NO UI OF THE MODAL'S, AND SHARES THIS INSTEAD. The rule in
// docs/plans/diane-export.md: her surface may draw anything, it may not
// know anything. Every option, count and warning comes from here, so the
// two renderers cannot disagree about what the file holds.

// Only Director and Mid are tied to a client company. Everything else is
// the recurring internal roster, which is what the admin sheet means.
const CLIENT_FACING = /^(director|mid)(\s+\d+)?$/i;

/**
 * A preset is a FILTER PLUS A GROUPING, nothing more. These are what the
 * Calculator page's four files became.
 */
const PRESETS = {
  expensing: { label: 'Expensing', filter: () => true },
  cash: { label: 'Cash', filter: (r) => r.payment_method === 'cash' },
  bank: { label: 'Bank', filter: (r) => r.payment_method === 'bank' },
  // THE BANK SHEET OVER EVERYONE, not just the transfers. Its own preset
  // rather than reusing `expensing`, because the pair a mode sends is what
  // names the file: a bank run and a bank-details listing are two different
  // documents and must not download as the same filename.
  //
  // Why it exists: the sheet contradicts itself in both directions. Seven
  // rows are `payment_method = bank` with no details to pay into, four of
  // them reading the "Will never be bank" sentinel, and 54 cash rows carry
  // that sentinel legitimately. Bank-only hides the second set entirely, so
  // there was no document that showed who is and is not payable by
  // transfer. This is that document, and the toggle on the Bank tab is how
  // you ask for it.
  'bank-details': { label: 'Bank details', filter: () => true },
  admin: { label: 'Admin', filter: (r) => !CLIENT_FACING.test(String(r.role_label ?? '').trim()) },
  // Same rows as expensing; the difference is entirely in the layout.
  breakdown: { label: 'Earnings breakdown', filter: () => true, layout: 'breakdown' },
};

const PRESET_IDS = Object.keys(PRESETS);

function presetFor(id) {
  return PRESETS[id] ?? PRESETS.expensing;
}

// ===============================
// * The month
// ===============================
//
// `?month=YYYY-MM` rolls the selection forward before it is rendered.
// Applied AFTER the filters, so "August, NEXUS only" narrows first and
// recomputes second; the other way round rolls 96 rows to throw most away.
//
// `month=current` is accepted so a saved link means "this month" rather
// than whichever month it was saved in.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// ASYNC, so the Settings toggle reaches rollToMonth. It decided ended off
// the end date directly and so ignored the setting every other reader
// obeys, which took A J Rayson off NEXUS's Active company list.
async function applyMonth(rows, month) {
  if (!month) return { rows, stats: null };
  const target = month === 'current' ? currentMonth() : month;
  if (!MONTH.test(target)) return { rows, stats: null };
  const useEndDate = Boolean((await settingsRepo.get()).color_uses_end_date);
  return rollToMonth(rows, target, { useEndDate });
}

/** `month=current` resolved, for anything that has to name the month. */
function monthValue(month) {
  if (!month) return null;
  const target = month === 'current' ? currentMonth() : month;
  return MONTH.test(target) ? target : null;
}

// ===============================
// * The filters
// ===============================

function listParam(value, fold = (v) => v) {
  if (!value) return null;
  const wanted = new Set(String(value).split(',').map((v) => fold(v.trim())).filter(Boolean));
  return wanted.size > 0 ? wanted : null;
}

const upper = (v) => v.toUpperCase();

/**
 * The same filters the People page uses, applied server side to the full
 * set rather than to a page of it. An export covering only what happened
 * to be on screen would be wrong in a way nobody notices until the money
 * has gone.
 */
function applyFilters(rows, q) {
  let out = rows;
  // SEVERAL PEOPLE, by id. A name is matched as text and a short one catches
  // more people than anybody means; an id cannot be ambiguous.
  const people = listParam(q.personId);
  if (people) out = out.filter((r) => people.has(r.person_id));
  if (q.role) out = out.filter((r) => r.role_label === q.role);
  const groups = listParam(q.group, upper);
  if (groups) out = out.filter((r) => groups.has(String(r.group_name).toUpperCase()));
  if (q.company) {
    const key = String(q.company).trim().toLowerCase();
    out = out.filter((r) => String(r.company ?? '').trim().toLowerCase() === key);
  }
  if (q.method) out = out.filter((r) => r.payment_method === q.method);
  if (q.currency) out = out.filter((r) => String(r.currency).toUpperCase() === String(q.currency).toUpperCase());
  // The LIVE payment period, not the stored column. Filtering an export on
  // `status` meant a "still paying" file could include somebody whose
  // period ended weeks ago. This is the one filter where stale sends money.
  if (q.status) out = out.filter((r) => (r.payment_period ?? r.status) === q.status);
  if (q.needsReview === 'true') out = out.filter((r) => r.needs_review);
  if (q.needsReview === 'false') out = out.filter((r) => !r.needs_review);
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    out = out.filter(
      (r) => String(r.person_name ?? '').toLowerCase().includes(needle)
        || String(r.phone ?? '').toLowerCase().includes(needle),
    );
  }
  return out;
}

/**
 * The SHAPE options, as opposed to the filters: what the chosen template
 * draws, never which rows reach it.
 *
 * One reader for /export/xlsx, /export/rows and Diane, so the spreadsheet,
 * the printed page and her panel cannot be handed different instructions
 * for the same link.
 */
function layoutOptions(q) {
  return {
    // `personTotals` is the old name, kept so a saved link still carries
    // the setting. The block moved from under each person to under each
    // company when the rows were regrouped by company.
    companyTotals: q.companyTotals === 'true' || q.personTotals === 'true',
    groupTotals: q.groupTotals === 'true',
    // ON unless explicitly turned off. The other two add to the sheet's own
    // shape; this one IS the boss's own pivot.
    breakdown: q.breakdown !== 'false',
    // WHICH SHAPE the breakdown block takes. `breakdown=false` above still
    // wins and still means none, so a saved link keeps its meaning; an
    // unknown id falls back rather than erroring.
    breakdownDesign: q.breakdownDesign ? String(q.breakdownDesign) : undefined,
    // NAMES EVERY ADD ON AND FEE in a block of its own, on the advance
    // design. OFF unless asked: it was a fourth design, and a saved link
    // carrying that retired id still turns it on (breakdowns/index ALIASES).
    percentagesTable: q.percentagesTable === 'true',
    // A PROOFREADING PASS, off unless asked. Tints every empty cell so the
    // gaps in the working copy are findable. Off by default because a sheet
    // of red is unreadable and most blanks are legitimately blank.
    tintEmpty: q.tintEmpty === 'true',
    // HIS WORDS IN THE END DATE CELL, on yellow, off unless asked. Off the
    // cell is blank as it always was; on it says why it is blank. See
    // buildWorkbook TAG_FILL.
    includeTags: q.includeTags === 'true',
    // A TAB PER GROUP, in ONE workbook. Distinct from `multiFile`, which
    // hands back a zip of separate files. His call 2026-09-22.
    perGroupTabs: q.perGroupTabs === 'true',
    // Absent means off, so a saved link made before this existed keeps the
    // shape it had. Same rule as the two switches above it.
    showRates: q.showRates === 'true',
    primaryColor: q.primaryColor ? String(q.primaryColor) : undefined,
    secondaryColor: q.secondaryColor ? String(q.secondaryColor) : undefined,
    // The rate the admin was actually quoted, never the mid-market one.
    usdRate: Number(q.usdRate) > 0 ? Number(q.usdRate) : undefined,
    // Comma separated keys. Absent means every column, which is what every
    // template without a selector wants and what every saved link means.
    columns: q.columns ? String(q.columns).split(',').map((c) => c.trim()).filter(Boolean) : undefined,
  };
}

/**
 * The rows an export would contain, off one query.
 *
 * ONE CHAIN, EVERY READER. `/export/xlsx` builds from it, `/export/count`
 * counts it, `/export/rows` prints it and Diane describes it. A count that
 * ran a different chain from the build is a file whose own description is
 * wrong, which is worse than no description.
 */
async function rowsFor(query) {
  const all = await rowsRepo.findAllRows();
  const filtered = applyFilters(all, query).filter(presetFor(query.preset).filter);
  return applyMonth(filtered, query.month);
}

/**
 * WHAT IS IN THE FILE, before anyone commits to generating it.
 *
 * Counts, currencies and warnings, all off the rows the export would
 * actually contain, so a warning can never describe a row the file does
 * not have.
 */
/**
 * ===============================
 * * A WARNING MUST NEVER BE WHY A FILE CANNOT BE BUILT
 * ===============================
 * The review is an EXTRA on this panel. Reaching the database for it made
 * the export depend on a table migration 057 creates, so on any database
 * that had not been migrated every export preview 500'd: a payout file
 * blocked by the thing that was only meant to warn about it. It is
 * swallowed, and the warning is simply absent.
 *
 * AND IT ASKS ONLY WHEN THE ANSWER COULD MATTER. A deal can only be under
 * review if its end date has passed and nothing has stopped it, which is
 * readable from the rows already in hand. Most files contain none, and a
 * question whose answer cannot change anything is not worth a round trip.
 *
 * ALWAYS THE CURRENT MONTH, never the month being generated: the question
 * is whether somebody has answered yet, not which file is being built. The
 * two never have to agree on a month, because the review writes a DATE.
 * See docs/closure.md section 9.
 */
async function unansweredIn(rows) {
  const month = `${currentMonth()}-01`;
  const couldBe = rows.some((row) => (
    !row.stopped_on && row.end_on && String(row.end_on).slice(0, 10) < month
  ));
  if (!couldBe) return new Set();
  try {
    const due = await dueThisMonth(currentMonth(), { answered: false });
    return new Set(due.map((row) => row.id));
  } catch {
    return new Set();
  }
}

async function previewExport(query) {
  const { rows, stats } = await rowsFor(query);
  return {
    rows: rows.length,
    month: stats,
    people: new Set(rows.map((r) => r.person_id)).size,
    groups: new Set(rows.map((r) => r.group_name)).size,
    // Every live group is paid in more than one currency, so this is a fact
    // about the file rather than a warning about an edge case.
    currencies: currenciesByGroup(rows),
    // WITH THE ROW IDS, so a reader can fix them in place rather than going
    // to look for them.
    warnings: exportWarnings(rows, {
      month: monthValue(query.month),
      template: query.template,
      // THE REVIEW'S SECOND DOOR. Queried here rather than inside
      // exportWarnings so that file stays pure over the rows it is given.
      unanswered: await unansweredIn(rows),
    }),
  };
}

module.exports = {
  PRESETS, PRESET_IDS, presetFor,
  applyFilters, applyMonth, monthValue, layoutOptions, listParam,
  rowsFor, previewExport,
  MONTH, CLIENT_FACING,
};
