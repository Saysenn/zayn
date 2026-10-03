/**
 * A tb_mastersheet row (snake_case, straight from Postgres) -> the exact
 * shape whatbot's own AssignmentSchema expects.
 *
 * Mapped here rather than on whatbot's side because this is the contract
 * boundary: whatbot pulls these every 5 minutes and drops them straight
 * into its roster, so anything it would have to reshape after receiving is
 * a shape we should just have sent.
 */

// pg returns a `date` column as a Date at LOCAL midnight. toISOString() on
// that shifts to UTC and can roll back a day for any positive-offset zone —
// which would quietly move somebody's payment start date. Reading the local
// components instead keeps the calendar date the DB actually stores.
function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// numeric comes back as a string from pg; whatbot's schema wants a number.
function toNumber(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toAgentRow(r) {
  return {
    // whatbot's assignmentId — the same string the CRM stores as sync_key,
    // just named for what whatbot calls it.
    assignmentId: r.sync_key,
    personId: r.person_id,
    personName: r.person_name,
    phone: r.phone ?? '',
    role: r.role,
    seat: r.seat ?? null,
    roleLabel: r.role_label,
    group: r.group_name,
    company: r.company ?? null,
    assignedOn: toIsoDate(r.assigned_on),
    paymentStartOn: toIsoDate(r.payment_start_on),
    presetOn: toIsoDate(r.preset_on),
    endOn: toIsoDate(r.end_on),
    payableDays: toNumber(r.payable_days),
    monthlyAmount: toNumber(r.monthly_amount),
    payableAmount: toNumber(r.payable_amount),
    currency: r.currency,
    paymentMethod: r.payment_method,
    location: r.location ?? '',
    postcode: r.postcode ?? '',
    label: r.label ?? '',
    shouldBePaid: r.should_be_paid ?? '',
    paid: r.paid ?? '',
    notes: r.notes ?? '',
    bankDetails: r.bank_details ?? '',
    status: r.status,
    needsReview: r.needs_review,
    reviewReason: r.review_reason ?? '',
  };
}

/**
 * The reverse: whatbot's assignment shape -> the repo's field names, for
 * the month-start push. Only the fields the sheet owns — `source` is never
 * accepted from the wire (see masterSheetRows.repo.js's syncUpsert).
 */
function fromAgentRow(a) {
  return {
    syncKey: a.assignmentId,
    personId: a.personId,
    personName: a.personName,
    phone: a.phone ?? '',
    role: a.role,
    seat: a.seat ?? null,
    roleLabel: a.roleLabel,
    groupName: a.group,
    company: a.company ?? null,
    assignedOn: a.assignedOn ?? null,
    paymentStartOn: a.paymentStartOn ?? null,
    presetOn: a.presetOn ?? null,
    endOn: a.endOn ?? null,
    payableDays: a.payableDays ?? 0,
    monthlyAmount: a.monthlyAmount ?? 0,
    payableAmount: a.payableAmount ?? 0,
    currency: a.currency ?? 'GBP',
    paymentMethod: a.paymentMethod ?? 'cash',
    location: a.location ?? '',
    postcode: a.postcode ?? '',
    label: a.label ?? '',
    shouldBePaid: a.shouldBePaid ?? '',
    paid: a.paid ?? '',
    notes: a.notes ?? '',
    bankDetails: a.bankDetails ?? '',
    status: a.status ?? 'active',
    // whatbot's lenient parse flags anything its own strict schema would
    // have rejected, and sends it anyway — this table is where a human
    // fixes it. See whatbot's sheet/parseSheet.js `lenient` mode.
    needsReview: Boolean(a.needsReview),
    reviewReason: String(a.reviewReason ?? '').slice(0, 500),
  };
}

module.exports = { toAgentRow, fromAgentRow };
