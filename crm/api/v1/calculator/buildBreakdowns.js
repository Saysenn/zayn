const ExcelJS = require('exceljs');

/**
 * Turns mapSheetRow.js's output into the workbooks the boss's own spec
 * describes (docs/boss/Structure for the maths.docx, "Format to spit out
 * results"): a general Expensing sheet (everyone), then Cash and Bank —
 * subsets filtered by payment method, one row per person. One tab per
 * group in every file ("groups should be independent of one another").
 * Plus a fourth, admin-only file — docs/boss/knowledge.md §5.
 *
 * `should_be_paid`/`paid` on each row are expected to already be resolved
 * (CRM override applied on top of the sheet's default) by the caller —
 * see calculator.js's generateBreakdowns() — this module just renders
 * whatever it's given.
 */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EFE8' } };
const REVIEW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCEEE0' } };
const DATE_FMT = 'yyyy-mm-dd';

// The known groups' tab order — matches the order already implicit in
// whatbot's own employee/types.js comment ("MILKMAN, INDIGO, NEXUS,
// MANBAT, ALL GROUPS, TAKEOFF"). TAKEOFF is pinned last regardless of
// where it sorts in this list — it's payroll-only (no WhatsApp number,
// never messaged) and not a company/appointment-based group like the
// others, so it reads as an appendix, not a peer. Anything not in this
// list (a genuinely new group, or a not-yet-normalized name) sorts
// alphabetically between the known ones and TAKEOFF, rather than being
// silently dropped to the end or the start.
// Known groups in reading order. Anything not listed sorts
// alphabetically between these and TAKEOFF rather than being dropped, so
// a group the sheet invents next month still appears.
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

function byGroup(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.group || 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  // Rebuilt in canonical order — a plain Map iterates in insertion order,
  // which otherwise means "whichever group happened to appear first in
  // the sheet" decides tab order, not something predictable.
  const ordered = new Map();
  for (const key of sortGroupNames(groups.keys())) ordered.set(key, groups.get(key));
  return ordered;
}

function tabName(name) {
  return String(name).slice(0, 31); // Excel's own sheet-name limit
}

function addSheet(wb, groupName, columns) {
  const sheet = wb.addWorksheet(tabName(groupName));
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = HEADER_FILL;
  return sheet;
}

const yesNo = (v) => (v ? 'Yes' : 'No');
const paidLabel = (v) => (v ? 'Paid' : 'Not paid');

// "The amount needed to be requested from the groups" — cash + crypto
// payable, excluding bank, per group per currency (summed separately per
// currency rather than blended — a group can legitimately be paid in more
// than one currency, and adding them together would be meaningless).
function buildTotalsSheet(wb, rows) {
  const totals = new Map(); // `${group}|${currency}` -> number
  for (const r of rows) {
    if (r.paymentMethod !== 'cash' && r.paymentMethod !== 'crypto') continue;
    const key = `${r.group || 'UNKNOWN'}|${r.currency || ''}`;
    totals.set(key, (totals.get(key) ?? 0) + (r.payableAmount ?? 0));
  }

  const sheet = wb.addWorksheet('Totals');
  sheet.columns = [
    { header: 'Group', key: 'group', width: 16 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Cash + crypto total (excl. bank)', key: 'total', width: 28 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = HEADER_FILL;

  const entries = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, total] of entries) {
    const [group, currency] = key.split('|');
    sheet.addRow({ group, currency, total: Math.round(total * 100) / 100 });
  }
}

// One tab per group, one row per person — the boss's own Expensing column
// list, in order. `Staff`, `Should be paid`, and `Flag` are additions
// beyond his spec: Staff and Should-be-paid per docs/boss/knowledge.md
// §5, Flag marks rows the sheet itself couldn't resolve (a "TBC" deal, an
// unrecognized payment method) so an incomplete entry stays visible
// instead of silently dropping out of Cash/Bank with no trace anywhere.
function buildExpensingWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  buildTotalsSheet(wb, rows);
  const groups = byGroup(rows);

  for (const [groupName, groupRows] of groups) {
    // Exactly the boss's own Expensing list, in his order (docs/boss/
    // Structure for the maths.docx). Earlier versions carried extra
    // `Staff` and `Should be paid` and `Flag` columns — removed on the
    // user's explicit call to match the spec column for column.
    // Should-be-paid lives on the Cash sheet only, which is where he
    // actually asked for it.
    const sheet = addSheet(wb, groupName, [
      { header: 'Role', key: 'role', width: 16 },
      { header: 'Name of individual', key: 'personName', width: 24 },
      { header: 'Company in question', key: 'company', width: 30 },
      { header: 'Appointment date', key: 'appointmentOn', width: 16, style: { numFmt: DATE_FMT } },
      { header: 'Payment start date', key: 'paymentStartOn', width: 16, style: { numFmt: DATE_FMT } },
      { header: 'Preset date', key: 'presetOn', width: 14, style: { numFmt: DATE_FMT } },
      { header: 'Payable days this month', key: 'payableDays', width: 12 },
      { header: 'Method of payment', key: 'paymentMethod', width: 14 },
      { header: 'Monthly amount', key: 'monthlyAmount', width: 14 },
      { header: 'Payable amount', key: 'payableAmount', width: 14 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Location', key: 'location', width: 18 },
    ]);

    for (const r of groupRows) {
      const row = sheet.addRow({
        role: r.role,
        personName: r.personName,
        company: r.company,
        appointmentOn: r.appointmentOn,
        paymentStartOn: r.paymentStartOn,
        presetOn: r.presetOn,
        payableDays: r.payableDays,
        paymentMethod: r.paymentMethod ?? r.paymentMethodRaw ?? '',
        monthlyAmount: r.monthlyAmount,
        payableAmount: r.payableAmount,
        currency: r.currency,
        location: r.location,
      });
      // The "Flag" column went with the others, but the warning itself
      // stays as a row tint — a row the parse couldn't resolve otherwise
      // looks complete when it isn't, and losing that was never the point
      // of matching the spec.
      if (r.needsReview) row.eachCell((cell) => { cell.fill = REVIEW_FILL; });
    }
  }

  return wb;
}

function buildCashWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const groups = byGroup(rows.filter((r) => r.paymentMethod === 'cash'));

  for (const [groupName, groupRows] of groups) {
    // The boss's own Cash list, in his order. This is the ONE sheet he
    // asked for "Should be paid or not" on — Expensing and Bank
    // deliberately don't carry it.
    const sheet = addSheet(wb, groupName, [
      { header: 'Name of individual', key: 'personName', width: 24 },
      { header: 'Contact number', key: 'phone', width: 16 },
      { header: 'Post code', key: 'postcode', width: 12 },
      { header: 'Amount', key: 'amount', width: 12 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Label', key: 'label', width: 14 },
      { header: 'Where', key: 'where', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Should be paid or not', key: 'shouldBePaid', width: 16 },
      { header: 'Notes', key: 'notes', width: 24 },
    ]);

    for (const r of groupRows) {
      sheet.addRow({
        personName: r.personName,
        phone: r.phone,
        postcode: r.postcode,
        amount: r.payableAmount,
        currency: r.currency,
        label: r.label,
        where: r.location,
        status: paidLabel(r.paid),
        shouldBePaid: yesNo(r.shouldBePaid),
        // The reason someone isn't being paid IS the note worth carrying
        // here, so it wins over the sheet's own general notes when set.
        notes: r.shouldBePaidNote || r.notes || '',
      });
    }
  }

  return wb;
}

function buildBankWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const groups = byGroup(rows.filter((r) => r.paymentMethod === 'bank'));

  for (const [groupName, groupRows] of groups) {
    // The boss's own Bank list — five columns, nothing else. It's handed
    // to whoever makes the transfers, so it holds only what's needed to
    // make one. No should-be-paid, no status: those decisions are made on
    // the Cash sheet and in the CRM, not here.
    const sheet = addSheet(wb, groupName, [
      { header: 'Name of individual', key: 'personName', width: 24 },
      { header: 'Contact number', key: 'phone', width: 16 },
      { header: 'Amount payable', key: 'amount', width: 14 },
      { header: 'From which company', key: 'company', width: 30 },
      { header: 'Bank details of the individual', key: 'bankDetails', width: 34 },
    ]);

    for (const r of groupRows) {
      sheet.addRow({
        personName: r.personName,
        phone: r.phone,
        amount: r.payableAmount,
        company: r.company,
        bankDetails: r.bankDetails,
      });
    }
  }

  return wb;
}

// A separate file for the recurring Admin/Tech/Closer/Workforce roster.
// Cited docs/boss/knowledge.md §5, which does not exist: see todo.md
// 2026-09-14. The shape below is what ships either way. Same column shape
// as Expensing (minus Flag/needsReview handling — staff rows are never
// TBC placeholders) since it's the same kind of general breakdown, just
// filtered to staff instead of everyone.
function buildAdminWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const groups = byGroup(rows.filter((r) => r.staff));

  for (const [groupName, groupRows] of groups) {
    const sheet = addSheet(wb, groupName, [
      { header: 'Role', key: 'role', width: 16 },
      { header: 'Name of individual', key: 'personName', width: 24 },
      { header: 'Company in question', key: 'company', width: 30 },
      { header: 'Method of payment', key: 'paymentMethod', width: 14 },
      { header: 'Monthly amount', key: 'monthlyAmount', width: 14 },
      { header: 'Payable amount', key: 'payableAmount', width: 14 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Location', key: 'location', width: 18 },
    ]);

    for (const r of groupRows) {
      sheet.addRow({
        role: r.role,
        personName: r.personName,
        company: r.company,
        paymentMethod: r.paymentMethod ?? r.paymentMethodRaw ?? '',
        monthlyAmount: r.monthlyAmount,
        payableAmount: r.payableAmount,
        currency: r.currency,
        location: r.location,
      });
    }
  }

  return wb;
}

function buildBreakdowns(rows) {
  return {
    expensing: buildExpensingWorkbook(rows),
    cash: buildCashWorkbook(rows),
    bank: buildBankWorkbook(rows),
    admin: buildAdminWorkbook(rows),
  };
}

module.exports = { buildBreakdowns, buildExpensingWorkbook, buildCashWorkbook, buildBankWorkbook, buildAdminWorkbook };
