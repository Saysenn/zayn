const { scrubWorkbook } = require('../shared/scrubWorkbook.helper');
const { DATE_FMT, MONEY_FMT } = require('../shared/sheetFormats');
const ExcelJS = require('exceljs');
const {
  styleHeader, styleNumberColumns, sortGroupNames, METHOD_LABELS, pickColumns,
  setPalette,
} = require('./buildWorkbook');
const { countsTowardTotal } = require('../shared/owedThisMonth.helper');
const { PERIOD_LABEL } = require('../shared/paymentPeriod.helper');
const { fillsFor } = require('./breakdowns/palette');

/**
 * The three payout files: Expensing, Cash and Bank.
 *
 * ONE BUILDER, THREE COLUMN LISTS. The three differ only in which columns
 * they carry — the tabs, the styling, the group split and the totals are
 * identical — so writing three builders would mean three places to fix the
 * next time a header changes, and the first one anybody edited would be the
 * only one that got it.
 *
 * WHY A GENERAL TAB PLUS ONE PER GROUP. The user's rule: "the groups should
 * be independent of one another, the people they pay for their groups and
 * only the groups payments get released." So a group's tab is handed to
 * whoever releases that group's money and contains nothing else. The
 * General tab is the same rows unsplit, for whoever signs off the whole run.
 *
 * The FILTER is not here. Which rows reach this builder is decided by the
 * export's preset (cash = paid in cash, bank = paid by transfer, expensing
 * = everyone). A template decides shape; a preset decides membership.
 */

const GENERAL_TAB = 'General';

/**
 * SHOULD THIS ROW'S MONEY GO OUT. One definition, used by the column and by
 * the total, so the file can never say "no" beside a figure it counted.
 *
 * NULL is a real third state on this column — "nobody decided" — and the CRM
 * resolves it to yes, so the file says what the CRM would act on rather than
 * leaving a cell empty for the reader to guess at. Only an explicit false is
 * a refusal.
 */
const shouldBePaid = (r) => r.override_should_be_paid !== false;

/**
 * TWO REASONS A ROW IS ON THE SHEET BUT NOT IN THE TOTAL, and a payout file
 * is the document the money goes out from, so neither is money going out.
 *
 *   nothing owed   the shared rule: starts after this month, or (when the
 *                  setting says so) ended before it, or marked for another
 *                  month. ONE definition, in shared/owedThisMonth.helper.
 *   should not be  an admin decided against it. The whole point of the
 *                  switch, and it used to be counted anyway: the Cash sheet
 *                  printed "no" beside a row and added its amount to the
 *                  cash to draw.
 *
 * WAS `!isPeriodEnded(r)`, the end-date-direct exclusion. It dropped ten
 * MILKMAN rows and £6,500 the boss's own August sheet pays, including two
 * who ended on the 26th and are still paid the full month. The master sheet
 * and the division sheet were fixed and this file was missed, so the three
 * exports disagreed about the same money.
 */
const paidOut = (r, useEndDate) => countsTowardTotal(r, { useEndDate }) && shouldBePaid(r);

function totalsByCurrency(rows, useEndDate) {
  const out = new Map();
  for (const r of rows) {
    if (!paidOut(r, useEndDate)) continue;
    const amount = Number(r.payable_amount);
    if (!Number.isFinite(amount)) continue;
    const currency = r.currency || 'GBP';
    out.set(currency, Math.round(((out.get(currency) ?? 0) + amount) * 100) / 100);
  }
  return out;
}


/**
 * "Should be paid or not" is in all three default sets.
 *
 * The CRM is the source of truth for whether money goes out, and these files
 * are how that reaches the person paying. Cash always carried the column;
 * Bank and Expensing carried the FLAG in their data and showed nothing on
 * the page, so a row the admin had refused looked identical to one they had
 * approved and its amount sat in the total either way. The tint is what
 * makes it findable, not its position.
 */
const paidCell = (r) => (shouldBePaid(r) ? 'yes' : 'no');

/**
 * EVERY FIELD A PAYOUT SHEET CAN CARRY, in one catalogue.
 *
 * Three sheets that overlap in most of their columns used to hold three
 * lists and three row builders. Adding a field meant three edits and the
 * first one anybody forgot was the bug: Bank went months without an account
 * number because only two of the three had been given one.
 *
 * A sheet now says WHICH fields it carries and IN WHAT ORDER, and nothing
 * else. The header, the width and the number format come from here.
 */
const FIELDS = {
  group_name: { header: 'Group', width: 14 },
  role_label: { header: 'Role', width: 14 },
  person_name: { header: 'Name of individual', width: 22 },
  phone: { header: 'Contact number', width: 18 },
  company: { header: 'Company in question', width: 28 },
  assigned_on: { header: 'Appointment date', width: 16, style: { numFmt: DATE_FMT } },
  payment_start_on: { header: 'Payment start date', width: 16, style: { numFmt: DATE_FMT } },
  preset_on: { header: 'Preset date', width: 14, style: { numFmt: DATE_FMT } },
  payable_days: { header: 'Payable days this month', width: 14 },
  payment_method: { header: 'Method of payment', width: 16 },
  monthly_amount: { header: 'Monthly amount', width: 14, style: { numFmt: MONEY_FMT } },
  payable_amount: { header: 'Payable amount', width: 14, style: { numFmt: MONEY_FMT } },
  currency: { header: 'Currency', width: 10 },
  location: { header: 'Location', width: 18 },
  postcode: { header: 'Post code', width: 14 },
  door_number: { header: 'Door number', width: 16 },
  bank_details: { header: 'Bank details of the individual', width: 32 },
  account_number: { header: 'Account number', width: 18 },
  sort_code: { header: 'Sort code', width: 14 },
  accepting_postals: { header: 'Accepting postals', width: 16 },
  label: { header: 'Label', width: 14 },
  status: { header: 'Status', width: 12 },
  should_be_paid: { header: 'Should be paid or not', width: 18 },
  notes: { header: 'Notes', width: 28 },
};

/**
 * WHERE A SHEET CALLS A FIELD SOMETHING ELSE, as the user dictated it.
 * "Location generic", "From Which company", "Where", "Amount". These files
 * are read by people who know those names, and renaming one to something
 * tidier only makes it unfamiliar, so the catalogue's header is the default
 * and these win.
 */
const HEADERS = {
  expensing: { location: 'Location generic' },
  cash: { payable_amount: 'Amount', location: 'Where' },
  bank: { payable_amount: 'Amount payable', company: 'From Which company' },
};

/**
 * ONE ROW BUILDER for all three, because the VALUE of a field never depends
 * on which sheet it is printed on — only its header does. Narrowing drops
 * whatever the sheet did not ask for.
 */
function rowValues(r) {
  return {
    group_name: r.group_name,
    role_label: r.role_label,
    person_name: r.person_name,
    phone: r.phone,
    company: r.company ?? '',
    assigned_on: r.assigned_on,
    payment_start_on: r.payment_start_on,
    preset_on: r.preset_on,
    payable_days: r.payable_days,
    payment_method: METHOD_LABELS[r.payment_method] ?? r.payment_method,
    monthly_amount: num(r.monthly_amount),
    payable_amount: num(r.payable_amount),
    currency: r.currency,
    location: r.location,
    postcode: r.postcode,
    door_number: r.door_number,
    // Verbatim, sentinels included. "Will never be bank" is a real value the
    // sheet writes (canonical.js names it) and it means this person is never
    // paid by transfer. Blanking it would read as details somebody has to
    // chase, which is the opposite of what it says. Account number stays
    // TEXT: coerced to a number it loses a leading zero and stops being an
    // account number.
    bank_details: r.bank_details,
    account_number: r.account_number,
    sort_code: r.sort_code,
    accepting_postals: r.accepting_postals,
    label: r.label,
    // The PAYMENT PERIOD, the deal's own state derived from its dates,
    // never the company's open/closed. Confirmed with the user. Labelled,
    // because a cell reading "not_started" is a variable name in a document
    // somebody sends out.
    status: PERIOD_LABEL[r.payment_period ?? r.status] ?? r.payment_period ?? r.status,
    // The ADMIN's decision, not the sheet's free text. This is what the
    // toggles in the CRM write and what it treats as authoritative; the
    // sheet's own column is blank on 87 of 96 rows.
    should_be_paid: paidCell(r),
    notes: r.notes,
  };
}

/**
 * A DEFAULT, NOT A FIXED SHAPE, since 2026-08-24.
 *
 * These three were deliberately fixed: "a column missing from one of those
 * is a broken payout file rather than a shorter one". That reasoning still
 * holds for what a file carries when nobody touches it, so `send` below is
 * each sheet's exact previous column list, in its exact previous order — an
 * untouched export is byte for byte the document it was yesterday. What is
 * new is that the admin can drop one or add any other field.
 *
 * ONLY "Name of individual" CAN NEVER GO, on any of them. A payout line that
 * identifies nobody is not a payout line. The master sheet's other three
 * required columns do not apply: these are payment documents, never uploaded
 * back, and their headers do not match the parser's in the first place.
 *
 * ORDER IS NEVER THE CALLER'S, the same rule the master sheet's picker
 * follows. `send` first in its own order, so the familiar document never
 * reshuffles, then everything else in catalogue order underneath it.
 */
const SEND = {
  expensing: [
    'role_label', 'person_name', 'company', 'assigned_on', 'payment_start_on',
    'preset_on', 'payable_days', 'payment_method', 'monthly_amount',
    'payable_amount', 'currency', 'location', 'should_be_paid',
  ],
  cash: [
    'person_name', 'phone', 'postcode', 'payable_amount', 'currency',
    'label', 'location', 'status', 'should_be_paid', 'notes',
  ],
  bank: [
    'person_name', 'phone', 'payable_amount', 'company',
    'bank_details', 'account_number', 'sort_code', 'should_be_paid',
  ],
};

const REQUIRED = new Set(['person_name']);

/** The catalogue narrowed to one sheet's vocabulary, `send` first. */
function columnsFor(kind) {
  const send = SEND[kind];
  const rest = Object.keys(FIELDS).filter((k) => !send.includes(k));
  return [...send, ...rest].map((key) => ({
    ...FIELDS[key],
    key,
    header: HEADERS[kind]?.[key] ?? FIELDS[key].header,
  }));
}

const SHEETS = Object.fromEntries(
  ['expensing', 'cash', 'bank'].map((kind) => [kind, {
    id: kind,
    label: { expensing: 'Expensing', cash: 'Cash', bank: 'Bank' }[kind],
    send: SEND[kind],
    required: REQUIRED,
    columns: columnsFor(kind),
    row: rowValues,
  }]),
);

/**
 * What the Export modal offers for a payout sheet, same shape as the master
 * sheet's `listExportColumns`. Metadata only, never the column objects.
 *
 * A spec with no `send` list has no picker: its whole list is its shape.
 */
function listPayoutColumns(kind) {
  const spec = SHEETS[kind];
  if (!spec || !spec.send) return null;
  const send = new Set(spec.send);
  return spec.columns.map((c) => ({
    key: c.key,
    header: c.header,
    required: spec.required?.has(c.key) ?? false,
    inSend: send.has(c.key),
  }));
}

// Postgres hands numeric back as a string; written as-is that puts text in
// a money column and Excel cannot sum it.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// A total band across the first three columns, matching the month sheet.
// WAS A HARDCODED BLACK, the same one the month sheet carried, so a payout
// file ignored the colour picked beside it. Set per build by setPalette.
let TOTAL_FILL = fillsFor().head;
let TOTAL_TEXT = fillsFor().headText;

function writeTotals(sheet, rows, useEndDate) {
  sheet.addRow([]);
  for (const [currency, total] of totalsByCurrency(rows, useEndDate)) {
    const row = sheet.addRow([]);
    row.getCell(1).value = 'Total';
    row.getCell(2).value = currency;
    row.getCell(3).value = total;
    for (const n of [1, 2, 3]) {
      row.getCell(n).fill = TOTAL_FILL;
      row.getCell(n).font = { bold: true, color: TOTAL_TEXT };
    }
    row.getCell(3).numFmt = MONEY_FMT;
  }
}

/**
 * GREEN FOR YES, RED FOR NO, on the one cell that says it.
 *
 * The cell, not the whole row: the row is still a real deal whose name,
 * amount and bank details are all correct and all worth reading. It is one
 * fact about it that changed, and washing eleven columns in red to say so
 * makes the sheet look broken rather than making the fact clear.
 *
 * Both states are tinted, not just the refusal. A single red cell in a
 * column of white ones reads as an error somebody made; red against green
 * reads as a decision somebody took, which is what it is. It also means a
 * blank cell is visibly a bug rather than an implied yes.
 *
 * Pale fills with a strong text colour, the same treatment the grand total
 * block uses, so this reads as part of the document instead of a highlighter
 * run over it.
 */
const PAID_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F3EC' } };
const PAID_TEXT = { argb: 'FF1C7A4F' };
const UNPAID_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE4E4' } };
const UNPAID_TEXT = { argb: 'FFB42318' };
// Out of the total is a fact, not a refusal, so it does not take the red
// above. FROM THE PICKED SECONDARY, the same `tint` the workbook marks its
// amounts with: it was typed here and again in buildWorkbook, so a file
// picked in one colour marked its amounts in another. Set by setPalette.
let ENDED_FILL = fillsFor().tint;
// A dark amber that carries on every pale tint in the palette, so the
// words stay readable whichever secondary is picked.
const ENDED_TEXT = { argb: 'FF8A5A12' };

function addTab(wb, name, spec, rows, cols, useEndDate) {
  const sheet = wb.addWorksheet(String(name).slice(0, 31));
  sheet.columns = cols;
  styleHeader(sheet, 1);

  // Where the column landed on THIS sheet, after any narrowing. Found by
  // key rather than by a number per spec: it is last on two of them, tenth
  // on the third, and moves again the moment somebody drops a column ahead
  // of it. Zero means it was not picked, and then nothing is tinted.
  const paidCol = cols.findIndex((c) => c.key === 'should_be_paid') + 1;
  // THE AMOUNT, not the Status column. An excluded row is a row whose money
  // is not in the total, so the amount is the cell the fact is about — and
  // Status is not in the bank or expensing default sets, which left an
  // excluded row on those files completely unmarked: on the page, out of
  // the figure, with nothing saying so. Status is tinted as well when it
  // was picked, since it is the cell that states the reason.
  const outCols = ['payable_amount', 'status']
    .map((key) => cols.findIndex((c) => c.key === key) + 1)
    .filter(Boolean);

  for (const r of rows) {
    const added = sheet.addRow(spec.row(r));

    // TINTED OFF THE TOTAL'S OWN RULE, not off `isPeriodEnded`. That marked
    // a row the total had already counted and left an uncounted one plain,
    // so the mark and the figure were answering two different questions.
    if (!countsTowardTotal(r, { useEndDate })) {
      for (const n of outCols) {
        const cell = added.getCell(n);
        cell.fill = ENDED_FILL;
        cell.font = { bold: true, color: ENDED_TEXT };
      }
    }

    if (!paidCol) continue;
    const cell = added.getCell(paidCol);
    const yes = shouldBePaid(r);
    cell.fill = yes ? PAID_FILL : UNPAID_FILL;
    cell.font = { bold: true, color: yes ? PAID_TEXT : UNPAID_TEXT };
  }

  if (rows.length > 0) writeTotals(sheet, rows, useEndDate);
  styleNumberColumns(sheet, cols, 1);
  return sheet;
}

/**
 * @param {object[]} rows already filtered by the export's preset
 * @param {'expensing'|'cash'|'bank'} kind
 * @param {object} [opts]
 * @param {string[]} [opts.columns] the admin's chosen set. ABSENT MEANS THE
 *   SEND SET, not every column — the opposite of the master sheet's picker,
 *   and deliberately so. An export with no selection is the boss's own
 *   document, so a script or an old saved link keeps handing over the file
 *   it always did rather than a twenty-four column dump of everything.
 */
function buildPayoutWorkbook(
  rows,
  kind,
  { columns, colorUsesEndDate = false, primaryColor, secondaryColor } = {},
) {
  // styleHeader is buildWorkbook's, and it paints from buildWorkbook's
  // module fills. Setting them here is what makes a payout file the colour
  // the picker showed rather than the last month sheet's.
  const fills = setPalette(primaryColor, secondaryColor);
  TOTAL_FILL = fills.head;
  TOTAL_TEXT = fills.headText;
  ENDED_FILL = fills.tint;
  const useEndDate = Boolean(colorUsesEndDate);
  const spec = SHEETS[kind];
  if (!spec) throw new Error(`buildPayoutSheet: no sheet called ${kind}`);

  const chosen = Array.isArray(columns) && columns.length > 0 ? columns : spec.send;
  // Narrowed ONCE, outside the loop: every tab in one file carries the same
  // columns or it is not one document.
  const cols = pickColumns(spec.columns, chosen, spec.required);

  const wb = new ExcelJS.Workbook();
  // General first: it is the whole run, and the group tabs after it are
  // the parts. Reading order matches how the file is used.
  addTab(wb, GENERAL_TAB, spec, rows, cols, useEndDate);

  const groups = new Map();
  for (const r of rows) {
    const key = r.group_name || 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const name of sortGroupNames(groups.keys())) {
    addTab(wb, name, spec, groups.get(name), cols, useEndDate);
  }

  return scrubWorkbook(wb);
}

// SEND is exported so Diane's cards narrow to the SAME columns a payout
// file carries. A second list in the agent would be a second answer to
// "what does a bank run need", and the two would drift.
module.exports = {
  buildPayoutWorkbook, listPayoutColumns, PAYOUT_SHEETS: SHEETS, SEND, REQUIRED,
};
