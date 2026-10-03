const ExcelJS = require('exceljs');
const { DATE_FMT, MONEY_FMT } = require('../shared/sheetFormats');
const { scrubWorkbook } = require('../shared/scrubWorkbook.helper');
const { activeCompanies, paymentBreakdown } = require('./groupTables');
const { breakdownDesignFor, forcesPercentagesTable, NONE_ID } = require('./breakdowns');
const { fillsFor } = require('./breakdowns/palette');
// His two phrases, from the one file that defines them. The tag writes
// REVIEWED_MONTHLY itself, so it must be the same string the importer reads
// back or a re-imported file loses the flag.
const { REVIEWED_MONTHLY } = require('../shared/endNote.helper');
// Excel refuses seven characters in a tab name and exceljs throws on them.
const { sheetNameFor } = require('./sheetName');
const {
  applyFormulas, resultsFor, FORMULA_COLUMNS,
} = require('./sheetFormulas');
// THE RULE, not a copy of it. What a month owes is a business question and
// lives in shared/; this file only paints the answer.
const {
  START_STATE, paymentStartState, countsTowardTotal,
} = require('../shared/owedThisMonth.helper');
// APPLIED ONCE, at the top of the build. Every reader below sees rows whose
// Monthly and Payable already carry their rates.
const { withRates } = require('../shared/rates.helper');
const { rateTextFor } = require('../shared/rateText.helper');

/**
 * The CRM's final master sheet, as a downloadable .xlsx.
 *
 * Columns are the boss's own master-sheet headers, in his order and with
 * his spelling, so both whatbot's parseSheet.js and the calculator's
 * mapSheetRow.js match them as typed. "Fixing" a header here would produce
 * a file our own parsers read one column worse than the messy original.
 *
 * TWENTY-ONE OF HIS TWENTY-FIVE. His four working columns — label, should
 * be paid or not, Paid, Notes — are left out; see the gap in the list
 * below for why. This is an EXPORT shape only. Nothing about what the CRM
 * stores, shows or accepts on upload changes.
 *
 * One tab per group, same grouping and same tab order the calculator's
 * output uses — see calculator/buildBreakdowns.js, which this mirrors on
 * purpose so the two families of file look like they came from one system.
 */

/** One shape for every solid fill in this file. */
function solidFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/**
 * The deal table's header band.
 *
 * WAS A HARDCODED PALE GREEN, which is why the sheet stayed green however
 * the breakdown was coloured: one document in two palettes. It now comes
 * from the same picked pair, one weight below the breakdown's heading
 * because it runs across twenty-one columns.
 *
 * A module-level LET set per build, not a constant: styleHeader and the
 * side table both reach for it from several call sites, and threading a
 * fill through five signatures to colour a header would be a large edit
 * for one value. Set once at the top of a build, which is synchronous.
 */
// Initialised from the palette's own defaults, never a typed hex: a
// fallback that drifts from the picked colours is a second palette.
let HEADER_FILL = fillsFor().head;
// The type on it. `strong` is dark now, so a header that kept black type
// was a black word on a dark green ground.
let HEADER_TEXT = fillsFor().headText;
// THE RULE BETWEEN HEADER CELLS. His own table draws one, and without it a
// pale band reads as one long smear rather than a row of columns. Set with
// the fill, never separately, or the two disagree about which colour won.
let HEADER_BORDER = fillsFor().headBorder;

// ===============================
// * NO ROW EVER CARRIES A FILL. His call 2026-09-23.
// ===============================
// A hand added deal used to wash all twenty-one columns in cream, which
// read as "this row is broken" when the fact was only where the row came
// from. It is also the rule the rest of the CRM follows: a tint means
// state in ONE CELL, never a row. Nothing replaced it, because "added by
// hand" is not a fact about any single column.

// Where the deal headers sit on a per-group tab. Three things read it and
// they must agree: the header styling, the number styling and the side
// table beside them.
const HEADER_ROW = 1;

// 'ALL BOOKS' sat here while the real group is 'ALL GROUPS', so the entry
// matched nothing and the group fell through to the unlisted branch. Right
// by luck, and two names in circulation for one thing.
const GROUP_ORDER = ['NEXUS', 'INDIGO', 'MILKMAN', 'MANBAT', 'ALL GROUPS'];

function sortGroupNames(names) {
  return [...names].sort((a, b) => {
    if (a === 'TAKEOFF') return 1;
    if (b === 'TAKEOFF') return -1;
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

const GROUP_COLUMN = { header: 'Group', key: 'group_name', width: 14 };

/**
 * The columns WITHOUT Group, for the per-group tabs.
 *
 * THE TAB IS THE GROUP. Repeating "MILKMAN" down thirty-two rows is noise
 * on a document somebody reads, and it is the same word every time by
 * construction. The tab name is also the only thing carrying the group on
 * a re-upload, so it is load bearing rather than a label.
 *
 * Round-trips safely: parseImport falls back to the WORKSHEET NAME when a
 * sheet has no Group column, so re-uploading puts every row back in the
 * right group. A Group column, where one exists, still wins.
 *
 * The single-tab export puts Group back (see COLUMNS_WITH_GROUP) — with
 * every group in one sheet, the column is the only thing saying which is
 * which.
 */
// The one opt in column's key, named once so the switch that adds it and
// the list that holds it cannot drift apart.
const RATES_COLUMN = 'rates_text';

const COLUMNS = [
  { header: 'Role', key: 'role_label', width: 14 },
  { header: 'Name of individual', key: 'person_name', width: 24 },
  { header: 'Company in question', key: 'company', width: 30 },
  { header: 'Appointment date', key: 'assigned_on', width: 16, style: { numFmt: DATE_FMT } },
  { header: 'Payment start date', key: 'payment_start_on', width: 16, style: { numFmt: DATE_FMT } },
  { header: 'Preset date', key: 'preset_on', width: 14, style: { numFmt: DATE_FMT } },
  { header: 'Provisional payment end date', key: 'end_on', width: 24, style: { numFmt: DATE_FMT } },
  { header: 'Payable days this month', key: 'payable_days', width: 20 },
  { header: 'Method of payment', key: 'payment_method', width: 18 },
  { header: 'Monthly amount', key: 'monthly_amount', width: 16 },
  { header: 'Payable amount', key: 'payable_amount', width: 16 },
  { header: 'Currency', key: 'currency', width: 10 },
  { header: 'Location', key: 'location', width: 18 },
  { header: 'Door number', key: 'door_number', width: 16 },
  { header: 'Postcode', key: 'postcode', width: 12 },
  { header: 'Phone number', key: 'phone', width: 18 },
  // label / should be paid or not / Paid / Notes are DELIBERATELY ABSENT.
  //
  // They exist in the boss's file but they are his working columns, filled
  // in during a month as the money goes out — 87 of the 96 live rows have
  // all four empty. An exported sheet is the arrangement, not the running
  // commentary on it, and carrying last month's answers onto a new sheet
  // would read as this month's.
  //
  // EXPORT ONLY. The CRM still stores all four, still shows them on the
  // Master Sheet page, and still takes them from an upload; nothing about
  // tb_mastersheet changes. This list is the shape of a file leaving the
  // building, nothing more.
  { header: 'Accepting postals', key: 'accepting_postals', width: 18 },
  { header: 'Bank details of individual', key: 'bank_details', width: 30 },
  { header: 'Account number', key: 'account_number', width: 18 },
  { header: 'Sort code', key: 'sort_code', width: 14 },
  /**
   * ===============================
   * * WHAT WENT ON TOP, IN WORDS. His call 2026-09-23.
   * ===============================
   * OPT IN, and it is the only column that is. It is not in the picker and
   * not in any preset: it is a SWITCH, because it answers a question about
   * the file rather than being one of his own columns, and offering it in
   * a list of his headers would read as one.
   *
   * Last on purpose. Every other column is his, in his order, and a
   * generated file has to look like the document it replaces.
   */
  { header: 'Rates applied', key: RATES_COLUMN, width: 26, optIn: true },
];

/**
 * The same columns with Group in front — the single-tab export.
 *
 * "Export master sheet" hands over ONE sheet holding every group, shaped
 * like the boss's own file, because that is what it replaces. There are no
 * tabs to carry the group, so the column does.
 *
 * The per-month generation is the opposite and deliberately so: one tab per
 * group, each headed by its name, and totals if the admin asked for them.
 * That file is a payment run signed off a group at a time; this one is the
 * working sheet.
 */
const COLUMNS_WITH_GROUP = [GROUP_COLUMN, ...COLUMNS];

/**
 * WHICH COLUMNS A FILE CAN LEAVE OUT, and which it never can.
 *
 * The boss's own sends are not the whole sheet: "August send for nexus
 * Unpaid.xlsx" carries twelve columns, because he already knows everyone's
 * bank details and a payment request does not need them. Which columns a
 * run needs is his decision and it changes with the run.
 *
 * FOUR CAN NEVER GO. `mapSheetRow` discards a row with no name, so a file
 * without "Name of individual" re-uploads as nothing at all; and group,
 * company and role are what `dealKey` builds a deal's identity from, so a
 * file missing any of them comes back as a different deal or as none. The
 * selector refuses those rather than letting somebody generate a file that
 * cannot come home.
 */
const REQUIRED_COLUMNS = new Set(['group_name', 'person_name', 'company', 'role_label']);

// The shape of the boss's own send. Not a subset anyone has to remember:
// it is what his file carries, so a generated one looks like his.
const SEND_COLUMNS = [
  'group_name', 'role_label', 'person_name', 'company',
  'assigned_on', 'payment_start_on', 'preset_on', 'payable_days',
  'payment_method', 'monthly_amount', 'payable_amount', 'currency', 'location',
];

/**
 * THE END DATE JOINS THE SEND WHEN IT DECIDES SOMETHING.
 *
 * His own send does not carry it, which is why it is not in SEND_COLUMNS.
 * But with the colour setting on, `isOwedThisMonth` drops a row whose end
 * date is behind the month, so the payment start cell turns red BECAUSE OF
 * A DATE THE FILE DOES NOT SHOW. The reader gets a tinted row and no reason
 * beside it.
 *
 * With the setting off the end date decides nothing, so the column is
 * noise and stays out. Either way it can still be ticked by hand.
 */
const SETTING_LED_COLUMNS = { end_on: 'useEndDate' };

/**
 * Metadata only, for the Export modal. Never the column objects.
 *
 * `useEndDate` is an ARGUMENT, defaulting to false, the same arrangement
 * owedThisMonth.helper uses and for the same reason: as module state it
 * would be set by whichever caller ran last.
 */
/**
 * ===============================
 * * WHAT HE ACTUALLY ASKS FOR, as four named documents
 * ===============================
 * His call 2026-09-22. Picking eleven columns out of twenty one by hand,
 * every time, to produce the same four documents he always produces.
 *
 * DEFINED HERE, BESIDE THE COLUMNS, and served with them. A list of keys
 * living in the browser would be a second place for a column name, and a
 * key that stopped matching would select nothing and say nothing:
 * `exportPresets.test.js` refuses a preset naming a column that does not
 * exist.
 *
 * THE FOUR REQUIRED COLUMNS ARE NOT LISTED. Group, role, name and company
 * are written into every file whatever is picked, so naming them here
 * would suggest they could be left out. Each set below is what is chosen
 * ON TOP of those.
 *
 * A PAYMENT RUN IS ALSO A ROW FILTER, his call 2026-09-22. The Bank
 * document is the bank rows in bank columns: offering its columns over
 * every row hands him sort codes beside the 54 people paid in cash, and
 * three sheets that each claim to be the run. So a preset that names a
 * `method` narrows the rows to it, through the `method` filter
 * `exportQuery.applyFilters` already has.
 *
 * NO METHOD MEANS EVERY ROW, which is what keeps All and Standard over the
 * whole sheet. The field is absent rather than set to something meaning
 * "any": a filter that has to be spelled out to be switched off is one
 * that gets left on.
 */
const SHEET_PRESETS = Object.freeze([
  { id: 'all', label: 'All' },
  {
    id: 'standard',
    label: 'Standard',
    columns: ['payable_days', 'payment_method', 'payable_amount', 'currency', 'location'],
  },
  {
    id: 'bank',
    label: 'Bank',
    method: 'bank',
    columns: ['payable_days', 'payment_method', 'payable_amount', 'currency',
      'bank_details', 'account_number', 'sort_code'],
  },
  {
    id: 'cash',
    label: 'Cash',
    method: 'cash',
    columns: ['payable_days', 'payment_method', 'payable_amount', 'currency',
      'location', 'door_number', 'postcode', 'phone', 'accepting_postals'],
  },
  {
    id: 'crypto',
    label: 'Crypto',
    method: 'crypto',
    columns: ['payable_days', 'payment_method', 'payable_amount', 'currency'],
  },
]);

/**
 * The presets, with 'all' resolved against the columns that actually exist.
 *
 * RESOLVED HERE rather than left as a word for the browser to interpret:
 * "all" means every optional column, and which those are is this file's
 * business, not the picker's.
 *
 * `method` is always present, null where there is none, so the browser
 * reads one shape and never has to know which ids carry a filter.
 */
/**
 * WHICH WORD A CHOSEN PRESET ADDS TO THE FILENAME, or null for none.
 *
 * His call 2026-09-23. It was the METHOD, so Bank, Cash and Crypto named
 * themselves and STANDARD did not: three of the four documents could not
 * overwrite each other and the fourth could. The preset IS the document,
 * so the preset is what names it.
 *
 * ALLOW LISTED, never the raw query value. This reaches a filename and a
 * Content-Disposition header, and `fileLabelOf` uppercases whatever it is
 * handed. An id nobody defined gets no word rather than an error, the same
 * way an unknown template falls back rather than 400ing on a stale link.
 *
 * `all` is the whole sheet, so it adds nothing: "MASTER SHEET - ALL" is
 * the same document as "MASTER SHEET" with a longer name.
 */
function presetFileWord(id) {
  const preset = SHEET_PRESETS.find((p) => p.id === id);
  if (!preset || preset.id === 'all') return null;
  return preset.label;
}

function listSheetPresets({ useEndDate = false } = {}) {
  const optional = listExportColumns({ useEndDate })
    .filter((c) => !c.required)
    .map((c) => c.key);
  return SHEET_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    method: p.method ?? null,
    columns: p.columns ?? optional,
  }));
}

function listExportColumns({ useEndDate = false } = {}) {
  const led = { useEndDate };
  // OPT IN COLUMNS ARE NOT OFFERED. A switch owns this one, and a column
  // in the picker that a switch also controls is two controls for one cell.
  return COLUMNS_WITH_GROUP.filter((c) => !c.optIn).map((c) => ({
    key: c.key,
    header: c.header,
    required: REQUIRED_COLUMNS.has(c.key),
    inSend: SEND_COLUMNS.includes(c.key)
      || Boolean(SETTING_LED_COLUMNS[c.key] && led[SETTING_LED_COLUMNS[c.key]]),
  }));
}

/**
 * Narrow a column list to a chosen set.
 *
 * ORDER IS NEVER THE CALLER'S. It is always the canonical order above,
 * because that order is what makes a generated file look like the boss's
 * own; a re-upload matches headers by name and would survive a shuffle,
 * but a shuffled sheet is a different document to read.
 *
 * An empty or absent choice means every column, which is what every caller
 * that has no selector wants.
 */
function pickColumns(all, chosen, required = REQUIRED_COLUMNS) {
  // AN OPT IN COLUMN IS NEVER IMPLIED. "No choice means every column" is
  // right for his own columns and wrong for this one: it would appear on
  // every export that did not narrow the picker, which is most of them.
  const offered = all.filter((c) => !c.optIn || (Array.isArray(chosen) && chosen.includes(c.key)));
  if (!Array.isArray(chosen) || chosen.length === 0) return offered;
  const wanted = new Set(chosen);
  return offered.filter((c) => wanted.has(c.key) || required.has(c.key));
}

// Postgres hands `numeric` back as a string (pg never lossily casts it to a
// JS float) — written as-is that puts text in a money column, so Excel
// can't sum it. null stays null rather than becoming 0: a blank monthly
// amount and a genuine zero are different facts on this sheet.
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "Bank Transfer"/"Cash"/"Crypto" as the sheet writes them, back from the
// lowercase form stored in Postgres — this file is meant to read like the
// team's own sheet, not like a database dump.
const METHOD_LABELS = { bank: 'Bank Transfer', cash: 'Cash', crypto: 'Crypto' };

/**
 * SHORT NAMES FOR THE BREAKDOWN. "Bank", not "Bank Transfer".
 *
 * The Method column above keeps the sheet's own spelling, because that
 * column has to round-trip and the boss's file writes "Bank Transfer". The
 * breakdown is ours, its rows read "Bank Total" and the extra word only
 * made the label longer than the thing it labels.
 */
const METHOD_SHORT = { bank: 'Bank', cash: 'Cash', crypto: 'Crypto' };

function toRow(r) {
  return {
    role_label: r.role_label,
    person_name: r.person_name,
    company: r.company ?? '',
    assigned_on: r.assigned_on,
    payment_start_on: r.payment_start_on,
    preset_on: r.preset_on,
    end_on: r.end_on,
    payable_days: r.payable_days,
    payment_method: METHOD_LABELS[r.payment_method] ?? r.payment_method,
    monthly_amount: toNumber(r.monthly_amount),
    payable_amount: toNumber(r.payable_amount),
    currency: r.currency,
    location: r.location,
    door_number: r.door_number,
    postcode: r.postcode,
    phone: r.phone,
    accepting_postals: r.accepting_postals,
    bank_details: r.bank_details,
    account_number: r.account_number,
    sort_code: r.sort_code,
    // '' on the 90 rows that carry nothing, which is the right answer: a
    // column of "0%" hides the eight that matter. Always computed, never
    // written unless the column was asked for.
    rates_text: rateTextFor(r),
  };
}

/**
 * Rows straight from masterSheetRows.repo.js's findAllRows() (snake_case,
 * as Postgres returns them) -> one workbook.
 *
 * NOTHING MARKS AN ADMIN ADDED ROW any more. It carried a cream fill
 * across every column until 2026-09-23; see the banner where that fill
 * used to be declared.
 */
// A total row reads as a band across A to C: the picked colour's dark step,
// white type. Grey-on-grey did not separate the totals from the deals above
// them, and on a tab where every person gets a total line the page needs the
// two kinds of row to be unmistakable at a glance.
//
// WAS A HARDCODED BLACK, which is why a sheet picked in green printed a
// black bar over green headers. Same module-level `let` as HEADER_FILL, set
// once per build; see the note on it.
let TOTAL_FILL = fillsFor().head;
let TOTAL_TEXT = fillsFor().headText;
/**
 * THE LABEL IN A, THE FIGURE IN B, and the band stops there.
 *
 * The figure used to sit in C with B left as a gutter, which put an empty
 * column between a label and its own number and made every block read as
 * two things rather than one.
 *
 * B is "Name of individual" on this sheet, which is exactly why it was
 * avoided: mapSheetRow drops any row with no name, so a total landing
 * there could import as a person. `isOwnTotalRow` names the shape instead
 * — a label in A, a NUMBER in B, and nothing else on the row — which no
 * real deal has, since a deal's name column holds a name and its company
 * column is filled.
 */
const VALUE_COL = 2;
const BAND_SPAN = [1, 2];
// Out of the month's total: on the sheet, but not in the figure. FROM THE
// PICKED SECONDARY, same `let` per build as HEADER_FILL; see setPalette.
// It was a typed beige here and again in buildPayoutSheet, so two files
// marked the same fact in a colour the picker never offered.
let ENDED_FILL = fillsFor().tint;

/**
 * ===============================
 * * AN EMPTY CELL IS A GAP TO FILL, NOT A VALUE
 * ===============================
 * Off by default, because a sheet of red is unreadable and most blanks are
 * legitimately blank. On, it is a proofreading pass: which cells is the
 * working copy missing.
 *
 * PALE. It has to lose to the three fills that mean something about the
 * ROW (manual, uncounted, the payment start tint), so it is painted FIRST
 * and those overwrite it. A blank cell on an uncounted row is not news.
 */
const EMPTY_FILL = solidFill('FFFDECEC');

/**
 * ===============================
 * * HIS WORDS IN THE END DATE CELL, ON BRIGHT YELLOW
 * ===============================
 * His call 2026-09-22, behind the "Include tags" switch. Off, the cell is
 * blank as it always was; on, it says WHY it is blank.
 *
 * BRIGHT, unlike EMPTY_FILL. That one is a proofreading hint that has to
 * lose to every fill meaning something about the row; this one is the
 * value itself and has to be seen.
 *
 * AND IT BEATS THE GAP TINT. A tagged cell is not a gap, it is explained,
 * so it is painted AFTER tintBlanks rather than before.
 */
const TAG_FILL = solidFill('FFFFEB3B');

/**
 * What the end date cell says when there is no date.
 *
 * DERIVED, not just read off `end_note`. His own word wins when the sheet
 * wrote one, because he wrote it about that row. Otherwise a ticked deal
 * is "Reviewed monthly" whatever put the tick there, which is how a
 * liquidation company's deals get the tag they never had: the checklist
 * writes the FLAG and only the import writes the note.
 *
 * A DEAL WITH A REAL DATE GETS NOTHING. It is not ticked and its cell
 * holds a date, and printing words over it is what the clear-on-type rule
 * exists to stop.
 *
 * Mirrors web/src/configs/sheetValues.js `endCellTag`. Two codebases,
 * never a shared import.
 */
function endCellTag(row) {
  if (row?.end_note) return String(row.end_note);
  if (row?.review_monthly) return REVIEWED_MONTHLY;
  return null;
}

/**
 * What counts as empty. `0` and `false` DO NOT: a payable amount of 0 and
 * a day count of 0 are real answers the sheet gives, and tinting them
 * would send somebody looking for a value that is already there.
 */
function isBlank(value) {
  if (value === null || value === undefined) return true;
  // ===============================
  // * A FORMULA CELL IS BLANK WHEN ITS RESULT IS
  // ===============================
  // The four derived columns hold `{ formula, result }`, an OBJECT, so a
  // plain check called every one of them filled. On screen the payment
  // start and the end date were empty and untinted on every row with no
  // appointment date: the formula is `IF(NOT(ISNUMBER(E2)),"",...)` and it
  // renders as nothing. Found 2026-09-17, on the first real export.
  //
  // `result` is sheetFormulas' OWN answer (it writes '' where the formula
  // yields ""), so this reads the rule rather than restating it.
  if (typeof value === 'object') {
    if ('result' in value) return isBlank(value.result);
    if ('richText' in value) return isBlank(value.richText?.map((t) => t.text).join(''));
    // A formula with no cached result: nothing here can know what Excel
    // will make of it, and guessing would tint a cell that fills in.
    if ('formula' in value || 'sharedFormula' in value) return false;
    return false;
  }
  return typeof value === 'string' && value.trim() === '';
}

/**
 * Paint the gaps.
 *
 * IT USED TO STAND DOWN FOR A ROW LEVEL FILL, because those used
 * `eachCell` WITHOUT `includeEmpty` and a row came back half cream and
 * half red. No fill covers a row any more, so there is nothing to yield
 * to and every blank is painted.
 */
function tintBlanks(sheetRow, { derived = null } = {}) {
  sheetRow.eachCell({ includeEmpty: true }, (cell, n) => {
    // A DERIVED CELL CANNOT BE ASKED. It holds `{ formula, result }`, and
    // exceljs drops an empty cached result on the way in, so the cell says
    // "formula" and nothing about what Excel will render. `derived` is
    // sheetFormulas' own answer for that column, which is the same one.
    const value = derived?.has(n) ? derived.get(n) : cell.value;
    if (isBlank(value)) cell.fill = EMPTY_FILL;
  });
}

/**
 * Put his word in the end date cell, on yellow.
 *
 * ONLY WHERE THE CELL IS EMPTY. A deal with a real date keeps it: the tag
 * explains a blank, it does not replace a value.
 */
function writeTag(sheetRow, r, derived = null) {
  const tag = endCellTag(r);
  if (!tag) return;
  /**
   * THROUGH cellByKey, because the end date column can be dropped. Every
   * preset but All drops it, so exporting Bank with tags on threw
   * "Out of bounds. Excel supports columns from 1 to 16384" and lost the
   * whole file: exceljs's getColumn(key) throws on an unknown key, so the
   * guard underneath it never ran.
   */
  const cell = cellByKey(sheetRow, 'end_on');
  if (!cell) return;
  /**
   * ===============================
   * * A FORMULA IS NOT AN EMPTY CELL, AND IT IS NOT A FULL ONE EITHER
   * ===============================
   * The single tab writes end_on as a FORMULA off the appointment date, so
   * it is the tab he can work in. Asking the cell what it holds returns
   * { formula, result } either way, which is never blank, so the tag would
   * never appear there; overwriting it regardless would replace a live
   * formula with a word and break the one thing that tab is for.
   *
   * `derived` is sheetFormulas' own answer for what the formula will
   * render, the same one tintBlanks uses. Blank means the deal has no
   * appointment date to derive an end date from, so the words belong.
   */
  const shown = derived?.has(cell.col) ? derived.get(cell.col) : cell.value;
  if (!isBlank(shown)) return;
  cell.value = tag;
  // The column carries a date format, which a string ignores, but the
  // alignment does not: left, like the words it now holds.
  cell.alignment = { horizontal: 'left' };
  cell.fill = TAG_FILL;
}

/** column number -> what the formula in it will render, for tintBlanks. */
/**
 * @param {string[]} [written] the columns applyFormulas ACTUALLY converted.
 *   Without it this reports what a formula WOULD render for every formula
 *   column, including ones that were skipped, and a caller asking "will
 *   this cell look empty" gets the wrong answer. That is how the end date
 *   tag stayed invisible on the single tab: the formula was skipped for
 *   his words, and this still claimed a date.
 */
function derivedValues(sheetRow, r, cellFor, written = null) {
  const results = resultsFor(r);
  const out = new Map();
  for (const key of FORMULA_COLUMNS) {
    if (written && !written.includes(key)) continue;
    const cell = cellFor(sheetRow, key);
    if (cell) out.set(cell.col, results[key]);
  }
  return out;
}

/**
 * Sum payable per currency. Never blended: the roster runs GBP, AED and
 * EURO, and one figure across the three means nothing.
 *
 * ENDED DEALS ARE EXCLUDED BY DEFAULT. The sheet is generated at the end
 * of a month to pay from, and a payment period that has already finished
 * is not money owed — including it would overstate the run by the amount
 * of everyone nobody is paying. They stay visible on the rows above,
 * tinted, so the decision is a human's and not a disappearance.
 *
 * `includeEnded` is what names the currencies of a block with nothing live
 * in it, so it can print them at zero rather than printing nothing.
 */

/**
 * ===============================
 * * The colour, and only the colour
 * ===============================
 * The RULE is shared/owedThisMonth.helper.js. This file owns the paint and
 * nothing else, so a fill can be retuned without a figure moving.
 *
 * Tints, not signal colours: a payout tab is mostly figures and three
 * saturated fills would fight the numbers. Amber is deliberately not the
 * breakdown's orange, which means "a figure you sign".
 */
// Named, because the conditional formatting below paints the same three
// and two lists of hex would drift the first time one was retuned.
const RUNNING_ARGB = 'FFCDEBD5';
const STARTED_ARGB = 'FFFFE3A3';
const NOT_STARTED_ARGB = 'FFF8C9C4';

const START_FILL = {
  [START_STATE.RUNNING]: solidFill(RUNNING_ARGB),
  [START_STATE.STARTED_THIS_MONTH]: solidFill(STARTED_ARGB),
  [START_STATE.NOT_STARTED]: solidFill(NOT_STARTED_ARGB),
};

function paymentStartFill(r, opts) {
  return START_FILL[paymentStartState(r, opts)];
}

/**
 * ***************************************************
 * * The payment start colour, LIVE
 * ***************************************************
 *
 * A static fill is dead paint: it says what the CRM computed the day the
 * file was written, and lies the moment he edits a preset. So the
 * single-tab export gets CONDITIONAL FORMATTING instead, which recalculates
 * exactly like the four formula columns beside it.
 *
 * HIS OWN SHEET ALREADY DOES THIS. Five expression rule blocks on column F,
 * and these are his three conditions unchanged:
 *
 *     F > EOMONTH(G,0)                  red     starts after the month ends
 *     AND(F >= G, F <= EOMONTH(G,0))    amber   starts inside the month
 *     F < G                             green   already running
 *
 * ===============================
 * * ONE BLOCK, NOT FIVE
 * ===============================
 * His are F2:F37, F2:F79, F38:F73, F74:F79 and F80:F85, grown by hand as
 * the sheet did, with priorities interleaved across them. Three things
 * follow, all of them in his live file:
 *
 *   rows 80-85 carry ONLY the green rule, so a start after the preset month
 *     is not coloured at all there
 *   rows past 85 have no rules whatsoever, and his sheet is 105 rows
 *   amber is theme 5 on two blocks and literal FFC000 on another
 *
 * So this writes one block over every written row. Same correction as the
 * payable amount: his rule, applied consistently.
 *
 * THE PRESET GUARD IS OURS. `EOMONTH` on the text "NA" is #VALUE!, and a
 * cell erroring inside a conditional format simply does not paint, so his
 * twelve NA rows were silently uncoloured either way. ISNUMBER says so on
 * purpose rather than by accident, and keeps a blank start uncoloured too:
 * `Ongoing` is not a date and must not read as "starts before the month".
 */
function paymentStartRules(sheet, { firstRow, lastRow }) {
  const start = cellByKey(sheet.getRow(firstRow), 'payment_start_on');
  const preset = cellByKey(sheet.getRow(firstRow), 'preset_on');
  // Both columns have to be in the file. The selector can drop either, and
  // a rule pointing at a column that is not there paints on the wrong one.
  if (!start || !preset || lastRow < firstRow) return;

  const col = start.address.replace(/\d+$/, '');
  const F = `${col}${firstRow}`;
  const G = `${preset.address.replace(/\d+$/, '')}${firstRow}`;
  const both = `AND(ISNUMBER(${F}),ISNUMBER(${G}))`;

  sheet.addConditionalFormatting({
    ref: `${col}${firstRow}:${col}${lastRow}`,
    rules: [
      // Order IS the meaning, same as the predicate: a row that has not
      // begun cannot also be running. Lower priority number wins in Excel.
      {
        type: 'expression',
        priority: 1,
        formulae: [`AND(${both},${F}>EOMONTH(${G},0))`],
        style: { fill: solidFill(NOT_STARTED_ARGB) },
      },
      {
        type: 'expression',
        priority: 2,
        formulae: [`AND(${both},${F}>=${G},${F}<=EOMONTH(${G},0))`],
        style: { fill: solidFill(STARTED_ARGB) },
      },
      {
        type: 'expression',
        priority: 3,
        formulae: [`AND(${both},${F}<${G})`],
        style: { fill: solidFill(RUNNING_ARGB) },
      },
    ],
  });
}

function totalsByCurrency(rows, { includeEnded = false, useEndDate = false } = {}) {
  const out = new Map();
  for (const r of rows) {
    if (!includeEnded && !countsTowardTotal(r, { useEndDate })) continue;
    const amount = Number(r.payable_amount);
    if (!Number.isFinite(amount)) continue;
    const currency = r.currency || 'GBP';
    out.set(currency, Math.round(((out.get(currency) ?? 0) + amount) * 100) / 100);
  }
  return out;
}

/**
 * THE ORDER WITHIN A COMPANY, taken off the boss's own sheet rather than
 * invented: Director, then Mid by seat, then KP. Workforce, which has no
 * client hierarchy, reads Admin, Tech, Closer there, so those follow. The
 * two sets never meet on one company, so this is a concatenation and not a
 * ranking anybody has to defend.
 *
 * A role not on the list sorts last, alphabetically by its label, so a new
 * one the sheet introduces lands somewhere stable instead of shuffling.
 */
const ROLE_ORDER = [
  'director', 'mid', 'kp',
  'admin', 'tech', 'closer',
  'sales', 'holding', 'accounts', 'maid', 'visa', 'support', 'graphics', 'loss_lead',
];

function roleRank(r) {
  const at = ROLE_ORDER.indexOf(String(r.role ?? '').toLowerCase());
  return at === -1 ? ROLE_ORDER.length : at;
}

/** Folded, so one company written two ways is one block. */
const companyKeyOf = (r) => String(r.company ?? '').trim().toLowerCase();

/**
 * Rows regrouped into one array per company, companies alphabetical, and
 * each company's rows in the sheet's own role order.
 *
 * A row with no company (an orphan) keys on '' and therefore sorts first,
 * matching the repo's own `company NULLS FIRST` and keeping the rows that
 * need fixing at the top rather than buried.
 */
function byCompany(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = companyKeyOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, deals]) => deals.sort(
      (x, y) => roleRank(x) - roleRank(y)
        || (x.seat ?? 0) - (y.seat ?? 0)
        || String(x.role_label ?? '').localeCompare(String(y.role_label ?? ''))
        || String(x.person_name ?? '').localeCompare(String(y.person_name ?? '')),
    ));
}

/**
 * A cell by its column KEY, or null when this sheet has no such column.
 *
 * exceljs's own getCell(key) throws when the key is unknown, and the
 * column selector can legitimately drop any non-required column, so every
 * per-column tint has to ask rather than assume.
 */
function cellByKey(row, key) {
  const col = row.worksheet.columns?.findIndex((c) => c?.key === key);
  return col === undefined || col === -1 ? null : row.getCell(col + 1);
}

/** One deal on a per-group tab, with the two tints that say where it came
 *  from and whether it counts. One writer whatever the totals are set to,
 *  so a row cannot be marked on one setting and unmarked on another: the
 *  export modal promises a finished period is "marked in the file", and it
 *  has to stay true with every total switched off. */
function addDealRow(sheet, r, {
  useEndDate = false, tintEmpty = false, includeTags = false,
} = {}) {
  // group_name is written only when the tab actually has that column,
  // which is when sheetNameFor had to rename the tab. exceljs matches on
  // the column key, so it costs nothing on every other tab.
  const added = sheet.addRow({ group_name: r.group_name, ...toRow(r) });
  if (tintEmpty) tintBlanks(added);
  // AFTER the gap tint: the cell is explained, not missing, so yellow
  // beats red.
  if (includeTags) writeTag(added, r);
  /**
   * ===============================
   * * WHERE AN UNCOUNTED ROW SAYS SO: ON THE AMOUNT, NEVER THE ROW
   * ===============================
   * Tinted so a figure out of the total is obvious next to one in it. The
   * column beside it already says WHY, the end date for a finished period
   * or the preset for another month's row, so this adds no text.
   *
   * BOTH REASONS GET THE SAME TINT. They are one fact to the reader: on
   * the sheet, out of the total. Two tints would ask them to learn a key.
   *
   * NO AMOUNT COLUMN, NO TINT, his call 2026-09-23. It used to fall back
   * to washing the whole row, which is the thing this rule exists to stop.
   * A document that does not show the figure has nothing to say about it,
   * the same answer the payment start tint gives when its column is gone.
   */
  if (!countsTowardTotal(r, { useEndDate })) {
    const amount = cellByKey(added, 'payable_amount');
    if (amount) amount.fill = ENDED_FILL;
  }
  // LAST, so it survives the row tints above rather than being painted
  // over by them. Guarded because the column selector can drop this
  // column, and getCell on a key the sheet does not have would write into
  // a column nobody asked for.
  const startCell = cellByKey(added, 'payment_start_on');
  if (startCell) startCell.fill = paymentStartFill(r, { useEndDate });
  return added;
}

/**
 * A COMPANY'S ROWS SIT TOGETHER, which is how the boss writes the sheet.
 *
 * Read his own file and the rule is plain: one company at a time, its
 * Director first, then Mid 1, Mid 2, Mid 3, then KP. Workforce is Admin,
 * Tech, Closer. `tb_mastersheet` is read back
 * `ORDER BY group_name, person_name`, so by the time rows reach here they
 * are alphabetical by handler and a company with two handlers is split
 * across the tab — Monument Marketing's Director on row 16 and its Mid on
 * row 10. This puts them back.
 *
 * ALPHABETICAL BY COMPANY, not the order they arrive in. The database sort
 * means "order of first appearance" would really mean "ordered by whichever
 * of its handlers is alphabetically first", which is arbitrary and looks
 * random. Alphabetical is the one a reader can predict. Note this moves
 * Workforce from the top of each group, where his file has it, to the
 * bottom.
 *
 * FOLDED, so "Relia PA" and "Relia Pa" are one company and not two blocks:
 * both spellings are in the live sheet.
 *
 * Rows are reordered WHETHER OR NOT totals are on. A toggle adds lines; it
 * never reshuffles the sheet underneath them, so turning one on to check a
 * figure hands back the same file plus the figure.
 *
 * THE NAME COLUMN IS LEFT EMPTY ON EVERY TOTAL LINE. This file gets edited
 * and uploaded back, and the parser's one rule for discarding a line is an
 * empty "Name of individual" (mapSheetRow returns null). A person's name on
 * a subtotal would re-import every total as a deal and double the sheet.
 *
 * NO BLANK ROW BETWEEN PEOPLE either, for a related reason: readSheets.js
 * treats a blank row as the start of a NEW table and takes the next line
 * as its header. Blank-separated person blocks came back from a re-upload
 * with a row eaten per person — 96 deals out, 6 back. The one blank before
 * the group block is safe, because nothing after it is a deal.
 */
function writeGroup(sheet, groupName, rows, {
  companyTotals, groupTotals, useEndDate = false, tintEmpty = false, includeTags = false,
}) {
  for (const deals of byCompany(rows)) {
    for (const r of deals) addDealRow(sheet, r, { useEndDate, tintEmpty, includeTags });
    // The company's name is not repeated on its block. It sits directly
    // under its rows, so the name is already three inches above it.
    if (companyTotals) writeTotalBlock(sheet, 'Total', deals, { italic: true, useEndDate });
  }

  // An empty group gets no block. A heading with no figure under it says
  // less than nothing.
  if (!groupTotals || rows.length === 0) return;
  // One blank before the group block is safe: everything after it is a
  // total, so the table it starts contains no deals to lose.
  sheet.addRow({});
  writeTotalBlock(sheet, `Total for ${groupName}`, rows, { bold: true, useEndDate });
}

/**
 * A total block: a heading, then one row per currency.
 *
 *   Total for INDIGO
 *   GBP          30,000.00
 *   EURO          1,000.00
 *   AED           3,675.00
 *
 * The heading printed once per currency was the first thing anyone noticed
 * about the file: three identical bold lines read as a bug in the export
 * rather than as three currencies. The heading is a heading, said once, and
 * the currencies are its rows.
 *
 * NO MONTH ON THE HEADING. The file is named for its month and the sheet is
 * generated for one, so dating every total block repeated it a dozen times
 * per tab.
 *
 * COLUMNS A AND C, with B left as the gutter. Neither lands in the "Name of
 * individual" column, which is what keeps the whole block out of a
 * re-upload: no name on the row means mapSheetRow discards it, and
 * isOwnTotalRow catches the heading by its label as well.
 *
 * ENDED DEALS ARE NOT COUNTED. A payment period that has finished is not
 * money owed this month, so including it would overstate the run by exactly
 * the amount nobody is being paid. The rows stay above, tinted, with their
 * end date in its own column.
 */
function writeTotalBlock(sheet, heading, rows, { bold = false, italic = false, useEndDate = false } = {}) {
  const live = totalsByCurrency(rows, { useEndDate });
  // Nothing live still prints its currencies, at zero. Real figures with no
  // total under them reads as a failed export, where a zero is an answer.
  const lines = live.size > 0
    ? [...live]
    : [...totalsByCurrency(rows, { includeEnded: true })].map(([currency]) => [currency, 0]);

  styleBandRow(addBandRow(sheet, heading), { bold, italic, heading: true });
  for (const [currency, total] of lines) {
    styleBandRow(addBandRow(sheet, currency, total), { bold, italic });
  }
}

/**
 * A band row: label in A, figure in B (VALUE_COL), and nothing else.
 *
 * BY POSITION, never by column key. These rows were written as
 * `{ group_name: label, person_name: total }`, which broke silently the
 * moment the Group column was dropped from the export — the label had
 * nowhere to go and every total printed as a bare number. A total is not a
 * deal and does not belong to the column schema, so it does not use it.
 *
 * The figure goes in column C, beside its label, rather than out in the
 * Payable amount column twenty columns right — which also keeps that column
 * free of subtotals, so summing it gives the real total instead of double
 * counting every person.
 */
function addBandRow(sheet, label, value) {
  const row = sheet.addRow([]);
  row.getCell(1).value = label;
  if (value !== undefined) row.getCell(VALUE_COL).value = value;
  return row;
}

/** One place deciding how a band row looks, so a group block cannot drift
 *  out of step with the person blocks above it. */
function styleBandRow(row, { bold = false, italic = false, heading = false } = {}) {
  // White on EVERY cell of the band, not just the one holding the text.
  // Left unset, B and C default to black type on the black fill: invisible,
  // and only noticeable the day something gets written there.
  const font = { bold, italic, color: TOTAL_TEXT };
  if (heading) font.size = 11;
  for (const n of BAND_SPAN) {
    const cell = row.getCell(n);
    cell.font = font;
    cell.fill = TOTAL_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    // A hairline under the heading, closing the top of the block. It
    // separates the heading from the figures under it without a second
    // colour.
    if (heading) cell.border = { bottom: { style: 'thin', color: { argb: 'FF555555' } } };
  }
  const value = row.getCell(VALUE_COL);
  if (typeof value.value === 'number') value.numFmt = MONEY_FMT;
  row.height = heading ? 20 : 17;
  return row;
}

/**
 * THE SIDE TABLE: one row per live company, who runs it, what kind it is.
 *
 * TO THE RIGHT OF THE DEALS, past a blank gutter column, which is where
 * the boss's own file puts it. Not above them: readSheets finds a table by
 * its header row, so a block above the deals gets read as the header on
 * re-upload and eats the first row of real data. To the right it simply
 * becomes four columns nothing maps to, which the upload already reports
 * as "columns not read" and otherwise ignores.
 *
 * Its header sits on the SAME row as the deal header, so the two tables
 * read as one sheet rather than two documents that happen to share a tab.
 */
const SIDE_GAP = 1;
const SIDE_HEADERS = ['Active company list:', 'Director:', 'Mid:', 'Status:'];
const SIDE_WIDTH = 22;

function writeSideTable(sheet, companies, headerRow, columnCount) {
  if (companies.length === 0) return;
  // Past the LAST column, whichever that is. A shorter column set slides
  // the whole table left rather than leaving a gulf of empty columns
  // between the deals and their summary.
  const first = columnCount + SIDE_GAP + 1;

  SIDE_HEADERS.forEach((label, i) => {
    const cell = sheet.getRow(headerRow).getCell(first + i);
    cell.value = label;
    cell.font = { bold: true, color: HEADER_TEXT };
    cell.fill = HEADER_FILL;
    cell.border = {
      top: HEADER_BORDER, bottom: HEADER_BORDER, left: HEADER_BORDER, right: HEADER_BORDER,
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getColumn(first + i).width = SIDE_WIDTH;
  });

  companies.forEach((c, n) => {
    const row = sheet.getRow(headerRow + 1 + n);
    [c.company, c.director, c.mid, c.tier].forEach((value, i) => {
      const cell = row.getCell(first + i);
      // NO BORDER OF ITS OWN. It had a hairline box, which read as a
      // different kind of table sitting beside the deals rather than part
      // of the same sheet: lighter, dotted, and out of step with the grid
      // Excel already draws. The deal rows carry none either.
      cell.value = value || '';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });
}

/**
 * THE BREAKDOWN: what this group costs, by method, then location, then
 * currency.
 *
 * Written in columns A and C like every other total block, and for the
 * same reason: neither lands in the Name of individual column, so
 * mapSheetRow discards the whole block on re-upload instead of importing
 * "Bank Transfer" as a person. `isOwnTotalRow` names them as well, so they
 * are dropped on purpose rather than by luck.
 *
 * A currency line always, even for a single-currency group. It is the same
 * shape either way, and one layout cannot drift out of step with itself.
 */
const BREAKDOWN_HEADERS = ['Row Labels', 'Sum of Payable amount:'];
// BOTH WERE HARDCODED GREEN, so a sheet picked in orange still printed a
// green Grand Total. From the picked pair now, same `let` per build.
let GRAND_FILL = fillsFor().grandFill;
let GRAND_BORDER = fillsFor().grandBorder;

/**
 * ===============================
 * * EVERY PAINTED VALUE IN THIS FILE, SET ONCE PER BUILD
 * ===============================
 *
 * The lets above are module state on purpose: styleHeader, the side table
 * and three total writers reach for them from a dozen call sites, and
 * threading two fills through those signatures would be a large edit for
 * values that never change inside one build.
 *
 * IT IS EXPORTED because buildPayoutSheet.js calls `styleHeader` too. Its
 * own entry point never set these, so a payout-only export painted its
 * headers in whatever the last month sheet left behind, or in the pale
 * green initialiser if nothing had run yet.
 *
 * @returns {object} the resolved fills, for a caller with its own to paint
 */
function setPalette(primaryColor, secondaryColor) {
  const fills = fillsFor(primaryColor, secondaryColor);
  HEADER_FILL = fills.head;
  HEADER_TEXT = fills.headText;
  HEADER_BORDER = fills.headBorder;
  TOTAL_FILL = fills.head;
  TOTAL_TEXT = fills.headText;
  GRAND_FILL = fills.grandFill;
  GRAND_BORDER = fills.grandBorder;
  ENDED_FILL = fills.tint;
  return fills;
}

/**
 * WHAT THIS GROUP COSTS, the way the boss pivots it by hand.
 *
 *   Row Labels            Sum of Payable amount:
 *   Bank                                              <- method, bold
 *     Main city                                       <- where
 *       GBP                        750.00             <- and in what
 *     South east
 *       GBP                        500.00
 *   Bank Total                                        <- bold heading
 *       GBP                      1,250.00             <- one line per currency
 *
 *   Cash
 *     ...
 *   Cash Total
 *       AED                      1,000.00
 *
 *   Grand Total                                       <- its own tinted box
 *     Bank
 *       GBP                      1,250.00
 *     Cash
 *       AED                      1,000.00
 *
 * A METHOD TOTAL IS A HEADING WITH ROWS, never "Bank Total GBP" on one
 * line. Three currencies made three near-identical bold lines that read as
 * a repeat rather than as three currencies, which is the same mistake the
 * person and group blocks made before they were split into a heading and
 * its rows.
 *
 * The grand total repeats the split by method on purpose. It is the block
 * somebody signs, and "what goes out in cash" and "what goes out by bank"
 * are two different payment runs.
 *
 * LABEL IN A, FIGURE IN B. Column C is Company in question and B is Name
 * of individual, so neither is a column a deal's identity comes from: a
 * figure in B with nothing else on the row is not a person, and
 * isOwnTotalRow names that shape so the whole block is discarded on
 * re-upload.
 */
/**
 * THE PAYMENT BREAKDOWN AT THE FOOT OF A GROUP TAB.
 *
 * The LAYOUT now lives in breakdowns/, one file per design, because there
 * is more than one shape of this block and the admin picks between them in
 * the export modal. This is the seam: it hands a design the sheet and the
 * band-row primitives and gets out of the way.
 *
 * The primitives are PASSED, not exported. They are used throughout this
 * 950 line file, so hoisting them into a shared module to suit three small
 * files would be a large edit to a load-bearing document for nothing the
 * call site gains.
 */
function writeBreakdown(sheet, groupRows, {
  design, usdRate, usdRateSource, localLocations, perUsd,
  primaryColor, secondaryColor, rates, cryptoPercent = 0, useEndDate = false, month,
  percentagesTable = false,
} = {}) {
  const chosen = breakdownDesignFor(design);
  // THE DESIGN PICKS ITS OWN WORDS. The boss's converted layout says
  // "Bank Transfer" in its pivots where the standard block says "Bank";
  // both are his, on different documents. Declared by the design rather
  // than fixed here, so the label cannot be right for one and wrong for
  // the other.
  const methodLabels = chosen.methodStyle === 'long' ? METHOD_LABELS : METHOD_SHORT;
  chosen.write(
    {
      sheet,
      addBandRow,
      styleBandRow,
      stylePlainRow,
      VALUE_COL,
      BAND_SPAN,
      GRAND_FILL,
      GRAND_BORDER,
      // The band a design paints itself, for the one row that is a heading
      // rather than a figure. Same pair as styleBandRow uses.
      BAND_FILL: TOTAL_FILL,
      BAND_TEXT: TOTAL_TEXT,
      BREAKDOWN_HEADERS,
    },
    // `counts` is this file's own rule, passed in rather than groupTables
    // keeping a second copy of it. See countsTowardTotal.
    // NO  OR . The rows arrived through withRates at
    // the top of the build, so their amounts already carry them and
    // paymentBreakdown reads the parts off the row rather than recomputing.
    paymentBreakdown(groupRows, {
      methodLabels, counts: (row) => countsTowardTotal(row, { useEndDate, month }),
    }),
    {
      usdRate,
      usdRateSource,
      localLocations,
      perUsd,
      primaryColor,
      secondaryColor,
      // THE RETIRED ID STILL FORCES IT ON. `with-usd-table` was this option
      // as a design of its own, so a link saved before the toggle existed
      // keeps producing the file it always did.
      adjustmentsInTable: percentagesTable || forcesPercentagesTable(design),
      // Same switch, read by simple and standard as well: they write the
      // named rows BELOW their grand total instead of inside the pivot.
      percentagesTable: percentagesTable || forcesPercentagesTable(design),
    },
  );
}

/** A breakdown line: no fill, so the total blocks stay the ones that carry
 *  a band. Indent is what shows the nesting. */
function stylePlainRow(row, { bold = false, indent = 0 } = {}) {
  const label = row.getCell(1);
  label.font = { bold };
  label.alignment = { horizontal: 'left', vertical: 'middle', indent };
  const value = row.getCell(VALUE_COL);
  value.font = { bold };
  value.alignment = { horizontal: 'center', vertical: 'middle' };
  if (typeof value.value === 'number') value.numFmt = MONEY_FMT;
  return row;
}

// The header row, styled the same wherever it lands.
//
// NO FROZEN PANES anywhere in here. Freezing is a CRM-table convenience,
// not something that belongs in a file handed to somebody else: it opens
// already split, which is a state the recipient did not ask for and has to
// undo. An exported file stays a plain sheet.
function styleHeader(sheet, rowNumber) {
  const head = sheet.getRow(rowNumber);
  head.font = { bold: true, color: HEADER_TEXT };
  head.height = 28;
  head.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  head.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = {
      top: HEADER_BORDER, bottom: HEADER_BORDER, left: HEADER_BORDER, right: HEADER_BORDER,
    };
  });
}

/**
 * Applied by column, after the rows: a row written through addRow takes the
 * column's style, but a cell set individually does not.
 *
 * EVERY COLUMN IS CENTRED, money included. Mixed alignment (text left,
 * figures right) is the spreadsheet default and it left the sheet looking
 * ragged down the middle with columns of wildly different widths. One
 * alignment reads as one document.
 */
function styleNumberColumns(sheet, columns, headerRow) {
  const at = (key) => columns.findIndex((c) => c.key === key) + 1;
  for (const key of ['monthly_amount', 'payable_amount']) {
    const n = at(key);
    if (n) sheet.getColumn(n).numFmt = MONEY_FMT;
  }

  // PER CELL, not per column. Setting it on the column looks like it works
  // and does not: exceljs only applies a column style to cells created
  // afterwards, and every row here is already written by this point. The
  // header row and the total rows also set their own alignment, which a
  // column style would not override anyway.
  //
  // NO WRAPPING BELOW THE HEADER. A wrapped data cell grows its row's
  // height, so one long company name makes a tall row in a table of short
  // ones and the sheet reads as ragged. Only the header wraps, because
  // "Provisional payment end date" over two lines is what keeps its column
  // from being 28 characters wide.
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.alignment = {
        ...(cell.alignment ?? {}),
        horizontal: 'center',
        vertical: 'middle',
        wrapText: n === headerRow,
      };
    });
  });

  autoFitColumns(sheet, columns, headerRow);
}

/**
 * Column widths from the widest thing actually in them.
 *
 * The declared widths were guesses made once and never revisited, so
 * "Company in question" was cut off while "Currency" sat half empty. The
 * header is measured on its longest WORD rather than its whole length,
 * because it wraps; every other cell is measured whole, because nothing
 * else does.
 */
const MIN_COL_WIDTH = 9;
const MAX_COL_WIDTH = 34;
const WIDTH_PADDING = 3;

function autoFitColumns(sheet, columns, headerRow) {
  for (let n = 1; n <= columns.length; n += 1) {
    let widest = 0;
    sheet.getColumn(n).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      const text = String(cell.text ?? '');
      if (!text) return;
      // A wrapping header only needs room for its longest word.
      const measured = rowNumber === headerRow
        ? Math.max(...text.split(/\s+/).map((w) => w.length))
        : text.length;
      if (measured > widest) widest = measured;
    });
    sheet.getColumn(n).width = Math.min(
      MAX_COL_WIDTH,
      Math.max(MIN_COL_WIDTH, widest + WIDTH_PADDING),
    );
  }
}

/**
 * ONE SHEET, every group, shaped like the boss's own file.
 *
 * What "Export master sheet" produces: a replacement for the working
 * document, so it looks like the working document — a single tab, the
 * Group column carrying which row is whose, rows in the sheet's own order,
 * and no totals, because his sheet has none.
 */
// `rows` here have ALREADY been through withRates: the caller applies them
// once before choosing a shape, so both branches write the same figures.
function buildSingleTab(wb, rows, chosen, { tintEmpty = false, includeTags = false, rawMonthly = false } = {}) {
  const cols = pickColumns(COLUMNS_WITH_GROUP, chosen);
  const sheet = wb.addWorksheet('Master sheet');
  sheet.columns = cols;
  styleHeader(sheet, 1);

  // Grouped in the tab order the rest of the system uses, so one group's
  // rows stay together the way they do on his sheet — but as ROWS, not
  // tabs. And inside a group, one COMPANY at a time: this file is the
  // drop-in replacement for the working document, and the working document
  // is written company by company. See byCompany.
  const groups = new Map();
  for (const r of rows) {
    const key = r.group_name || 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // The written span, so the colour rules cover every row and no more.
  const FIRST_ROW = 2;
  let lastRow = FIRST_ROW - 1;

  for (const groupName of sortGroupNames(groups.keys())) {
    for (const deals of byCompany(groups.get(groupName))) {
      for (const r of deals) {
        const added = sheet.addRow({ group_name: r.group_name, ...toRow(r) });
        // THE FOUR DERIVED CELLS BECOME FORMULAS, so this file is one he
        // can work in rather than only read: typing an appointment date
        // moves the payment start, the end date, the payable days and the
        // payable amount, exactly as his own sheet does.
        //
        // HERE AND NOT IN addDealRow. The month tabs write their totals as
        // flat values through countsTowardTotal, which reads the colour
        // setting, and no Excel formula can reach a settings row. Live rows
        // above a static total drift apart on the first edit. This tab has
        // no totals, which is why it is the one that can be live.
        // WHAT IT ACTUALLY WROTE. A formula it skipped leaves the cell
        // holding its flat value, and the two readers below have to know
        // which happened.
        const asFormula = applyFormulas(added, r, cellByKey, { rawMonthly });
        // AFTER the formulas, so a derived cell that resolves to nothing
        // is still read as empty. A manual row owns its whole colour, so
        // the gap tint stands down on one rather than colouring half.
        if (tintEmpty) {
          tintBlanks(added, { derived: derivedValues(added, r, cellByKey, asFormula) });
        }
        // THIS TAB TOO. It is the one he works in, so it is the one where
        // "why is this blank" matters most. After the gap tint for the same
        // reason: the cell is explained, not missing.
        if (includeTags) writeTag(added, r, derivedValues(added, r, cellByKey, asFormula));
        lastRow = added.number;
      }
    }
  }

  // LIVE, not painted. Written after the rows so the span is known, and
  // it recalculates with the preset exactly like the formulas beside it.
  paymentStartRules(sheet, { firstRow: FIRST_ROW, lastRow });

  styleNumberColumns(sheet, cols, 1);
  return scrubWorkbook(wb);
}

/**
 * @param {object[]} rows
 * @param {object} opts
 * @param {boolean} [opts.companyTotals] a total block under each company.
 * @param {boolean} [opts.groupTotals]  a total block at the foot of the tab.
 * @param {boolean} [opts.singleTab]    one sheet with a Group column, like
 *   master.xlsx, instead of one tab per group.
 * @param {boolean} [opts.companyList]  the Active company list beside the
 *   rows. On for a month tab, OFF for the working file, which has never
 *   carried one.
 *
 * BOTH TOTALS DEFAULT OFF, so an export is the working sheet's own shape
 * unless somebody asked for more. They are two switches rather than one
 * because the questions are different: what does this person get, and what
 * does this group cost. A run signed off per group wants the second and not
 * always the first.
 */
function buildMasterSheetWorkbook(
  rows,
  // `breakdown` defaults ON, unlike the two totals. Those add to the
  // sheet's own shape and the sheet has none; the breakdown is the boss's
  // own pivot, rebuilt by hand every month, and having it is the point.
  {
    companyTotals = false, groupTotals = false, breakdown = true, singleTab = false,
    // The Active company list beside the deal rows. A MONTH tab wants it;
    // the working file has never had one. See where it is written.
    companyList = true,
    tiers, columns, breakdownDesign, percentagesTable, usdRate, usdRateSource, localLocations, perUsd, primaryColor, secondaryColor,
    colorUsesEndDate = false, rates = null, cryptoPercent = 0,
    // Keep Monthly amount at the stored wage while Payable carries the
    // rates. Only the file that gets uploaded back needs it.
    rawMonthly = false,
    // A proofreading pass, off by default. See EMPTY_FILL.
    tintEmpty = false,
    includeTags = false,
    // The month the document is FOR. Unrolled rows are judged against it
    // rather than against whatever month the server is in today.
    month,
  } = {},
) {
  // Every painted value in this file, from the picked pair. See setPalette.
  setPalette(primaryColor, secondaryColor);
  // Passed down, never stashed on the module. As a shared let it was set by
  // this entry point only, so buildDivisionSheet totalled on whatever the
  // last export left behind.
  const useEndDate = Boolean(colorUsesEndDate);
  const wb = new ExcelJS.Workbook();

  /**
   * ===============================
   * * THE RATES ARE APPLIED HERE, ONCE, AND NOWHERE ELSE IN THIS FILE
   * ===============================
   * Every row below carries its Monthly and Payable with the add on, the
   * crypto charge and the fee already in them, exactly as his own sheet
   * writes them. The deal rows, the side table, the breakdown and the total
   * blocks then all add the numbers in front of them.
   *
   * Before this the rows were raw and the breakdown added the rates at the
   * foot, so a row said 4,700 while the total it fed said 4,935 and a block
   * underneath existed to explain the difference.
   *
   * NO FIGURE MOVES. Pro-rating and a rate are both multiplications, so
   * applying the rate to the monthly and pro-rating it gives the same penny
   * as pro-rating first. See shared/rates.helper.
   */
  /**
   * `rawMonthly` PUTS THE WAGE BACK, for the one file that is uploaded
   * again. Payable still carries every rate, because `mapSheetRow` ignores
   * that column on the way in and recomputes it; Monthly it reads as the
   * wage, so a rated one comes back as a raise and compounds next month.
   * Only the master sheet template asks for it. See its own banner.
   */
  const rated = rows.map((r) => {
    const out = withRates(r, rates, { cryptoPercent });
    if (!rawMonthly || out.monthly_amount_raw === undefined) return out;
    return { ...out, monthly_amount: out.monthly_amount_raw };
  });

  if (singleTab) return buildSingleTab(wb, rated, columns, { tintEmpty, includeTags, rawMonthly });

  const groups = new Map();
  for (const r of rated) {
    const key = r.group_name || 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  if (groups.size === 0) groups.set('MASTER SHEET', []);

  // Narrowed once, outside the loop: every tab in one file carries the
  // same columns or it is not one document.
  const cols = pickColumns(COLUMNS, columns);

  // Excel refuses seven characters in a tab name and exceljs THROWS, so one
  // group called `TAKEOFF / OLD` used to take the whole export down with a
  // 500. When a name has to change, the tab stops saying which group it is,
  // so the Group column goes back on that tab to carry it: a Group column
  // beats the worksheet name on the way in, so the round trip survives.
  const taken = new Set();

  for (const groupName of sortGroupNames(groups.keys())) {
    const { name, changed } = sheetNameFor(groupName, taken);
    const sheet = wb.addWorksheet(name);
    sheet.columns = changed ? [GROUP_COLUMN, ...cols] : cols;

    // ===============================
    // * HEADERS ON ROW 1. No title, no blank.
    // ===============================
    // It carried the group name on row 1 and a blank row 2, and the blank
    // was not decoration: readSheets treats a blank row as the start of a
    // new table, so it was the only thing stopping the TITLE being read as
    // the header row on re-upload.
    //
    // Both go together. With no title there is nothing for the blank to
    // protect the file from, and the group was never read from it anyway:
    // it comes from the TAB NAME, which is unchanged. Verified by building
    // both shapes and re-parsing them, tabbed and per-group, including with
    // a filename naming no group so only the tab could place the rows.
    styleHeader(sheet, HEADER_ROW);

    // One path whatever the toggles say. A second branch for "no totals"
    // was where the ended tint went missing: the same rows written by two
    // pieces of code came out marked on one and unmarked on the other.
    const groupRows = groups.get(groupName);
    writeGroup(sheet, groupName, groupRows, {
      companyTotals, groupTotals, useEndDate, tintEmpty, includeTags,
    });

    // Styled BEFORE the two extra tables. styleNumberColumns walks every
    // written row to centre it and autoFitColumns sizes only the deal
    // columns, so a breakdown written first would be centred out of its
    // own left-aligned indent and the side table's widths overwritten.
    styleNumberColumns(sheet, cols, HEADER_ROW);

    /**
     * ===============================
     * * THE WORKING FILE HAS NEITHER OF THESE
     * ===============================
     * Both are readings of the rows above them, so neither can disagree
     * with the figures on the tab, and on a MONTH tab the whole point is
     * that he stops rebuilding them by hand.
     *
     * The MASTER SHEET is a different document: it is the working copy he
     * edits and uploads back, and it has no side table and no pivot. When
     * "one workbook, tab per group" was added it came through this path and
     * inherited both, so the file he opened had an Active company list
     * pinned beside his rows and a Grand Total under them. He spotted it
     * on sight, 2026-09-22.
     *
     * DEFAULT ON, so every month tab is exactly as it was.
     */
    if (companyList) {
      writeSideTable(sheet, activeCompanies(groupRows, tiers), HEADER_ROW, cols.length);
    }
    // `breakdown: false` is the old switch and still means no block, so a
    // saved link keeps working. Otherwise the design decides, including
    // whether it draws anything at all.
    writeBreakdown(
      sheet,
      groupRows,
      {
        design: breakdown === false ? NONE_ID : breakdownDesign,
        percentagesTable,
        usdRate, usdRateSource, localLocations, perUsd,
        primaryColor, secondaryColor, rates, cryptoPercent, useEndDate, month,
      },
    );
  }

  return scrubWorkbook(wb);
}

module.exports = {
  buildMasterSheetWorkbook,
  listExportColumns,
  listSheetPresets, SHEET_PRESETS, RATES_COLUMN, presetFileWord,
  // Shared with buildPayoutSheet.js: it borrows styleHeader, which reads
  // the fills this sets. Without it a payout-only export painted its
  // headers in whatever the last month sheet left behind.
  setPalette,
  // Shared with buildPayoutSheet.js, which narrows its own lists against its
  // own required set. One narrowing rule, so a chosen set behaves the same
  // whichever document it is narrowing.
  pickColumns,
  MASTER_SHEET_COLUMNS: COLUMNS_WITH_GROUP,
  // Exported so the colour test asserts the SAME three the file paints.
  RUNNING_ARGB, STARTED_ARGB, NOT_STARTED_ARGB,
  // Shared with buildPayoutSheet.js so the cash, bank and expensing files
  // are styled by the same code as the master sheet rather than a copy of
  // it — one place decides what an exported sheet looks like.
  styleHeader,
  styleNumberColumns,
  sortGroupNames,
  METHOD_LABELS,
  // The breakdown block's own method words. Exported so the Division
  // Sheet renders the SAME block, not a second vocabulary for it.
  METHOD_SHORT,
};
