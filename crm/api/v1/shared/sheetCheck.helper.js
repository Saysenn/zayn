const { isForMonth } = require('./presetMonth.helper');
const { INTERNAL_COMPANY } = require('../masterSheet/groupTables');
const { isOwedThisMonth } = require('./owedThisMonth.helper');
// THE SHEET'S OWN CHAIN, never restated. "+ 90 days" was restated here and is
// wrong for a week-one appointment (last Friday of month three), so every
// such row read as broken. 2026-09-30.
const { startFromAppointment, endFromAppointment } = require('./fromAppointment.helper');

/**
 * ***************************************************
 * * EVERY DISCREPANCY ON THE SHEET, IN COST ORDER
 * ***************************************************
 *
 * His call 2026-09-30. `audit_master_sheet` already found eight things and
 * read them out as counts: "7 rows with no phone number", then you had to
 * ask again to learn who. Two turns for one answer, nothing ranked, and
 * "no phone number" sat at the same weight as "payable above monthly"
 * when only one of those is money.
 *
 * ---- SIX SECTIONS, AND THE ORDER IS WHAT IT COSTS ----
 *
 *   pays wrong          money is going out at the wrong figure
 *   cannot be paid      the payout file cannot pay them at all
 *   breaks next upload  the identity is wrong, so the sheet will double
 *   contradicts itself  two facts on the row disagree
 *   dates do not follow the appointment chain is broken
 *   worth a look        real, and nobody is losing anything over it
 *
 * You read top down and stop when you stop caring. A report where
 * everything is equally urgent is one nobody reads twice.
 *
 * ---- PURE, AND THAT IS THE POINT ----
 *
 * Rows in, findings out. No SQL, no month of its own, no repo: the eight
 * checks that already existed were SQL fragments, and a ninth would have
 * been a ninth fragment nobody could test without a database. Every rule
 * below is one line of JavaScript with a test beside it.
 *
 * NOTHING HERE DECIDES WHAT A MONTH OWES. `isOwedThisMonth` is the one
 * definition of that and it is imported, never re-stated: a check that
 * disagreed with the total would be a discrepancy report generating
 * discrepancies.
 */

// The sections, in the order they are read. The key is what the web draws
// by; the label is what it says.
const SECTIONS = Object.freeze([
  ['paysWrong', 'PAYS WRONG'],
  ['cannotPay', 'CANNOT BE PAID'],
  ['breaksUpload', 'WILL BREAK THE NEXT UPLOAD'],
  ['contradicts', 'CONTRADICTS ITSELF'],
  ['dates', 'DATES DO NOT FOLLOW'],
  ['missingInfo', 'MISSING INFO'],
  ['worthALook', 'WORTH A LOOK'],
]);

/**
 * A CAP YOU CAN SEE. A sheet with forty missing phone numbers is forty
 * lines of the same sentence, and the fortieth teaches nothing the first
 * did. Cut, and SAY it was cut: hiding is what he objected to, not
 * counting.
 */
const MAX_PER_SECTION = 12;

const text = (v) => String(v ?? '').trim();
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const fold = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Days in the month a row is marked for, for a payable days sanity check. */
function daysIn(period) {
  const [y, m] = String(period ?? '').split('-').map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * 'YYYY-MM-DD' from what the row holds. pg hands a `date` back as a Date at
 * LOCAL midnight, and String(Date) is "Fri Jan 30 2026 ...", so slicing it
 * gave "Fri Jan 30" and every date comparison here was comparing words.
 * Local getters for a Date, the first ten characters for a string.
 */
const pad = (n) => String(n).padStart(2, '0');
function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

/** A UTC midnight Date for the chain helpers, which take Dates only. */
function asUtcDate(v) {
  const iso = dateOnly(v);
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const utcIso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);

/**
 * ONLY A ROW THE CRM DERIVED is judged against the chain. A synced row
 * carries his sheet's own dates, which are the truth: run on the real sheet
 * the chain flagged 40 of them, a report of the sheet disagreeing with a
 * rule it never used. 2026-09-30.
 */
const crmDerived = (r) => r.source === 'manual';

/** Set by hand, so the chain does not own it. */
const byHand = (r, column) => (r.manually_overridden_fields ?? []).includes(column);

/**
 * WHO AND WHERE, said the way every other list says it. A finding that
 * cannot be traced to one row is a finding nobody can act on.
 */
const whoOf = (row) => text(row.person_name) || '(no handler)';
const whereOf = (row) => [text(row.group_name) || 'no group', text(row.company) || 'no company']
  .join(' · ');

/**
 * ===============================
 * * THE RULES, one line each, in the section they belong to
 * ===============================
 * Each returns a FAULT SENTENCE or null. The sentence is what the admin
 * reads, so it names the figures rather than the column: "payable 4,100
 * over monthly 4,000" is actionable and "payable_over_monthly" is not.
 */
const RULES = [
  // ---- PAYS WRONG ----
  ['paysWrong', (r) => {
    const payable = num(r.payable_amount);
    const monthly = num(r.monthly_amount);
    return payable !== null && monthly !== null && payable > monthly
      ? `payable ${payable.toLocaleString()} over monthly ${monthly.toLocaleString()}`
      : null;
  }],
  ['paysWrong', (r) => {
    // BOTH LEVELS STACK. 5% on the person and 3% on the deal is 8% on that
    // row, and that is the one people are surprised by.
    const onDeal = Number(r.addon_percent) || 0;
    const onPerson = Number(r.person_addon_percent) || 0;
    return onDeal > 0 && onPerson > 0
      ? `${onPerson}% profile + ${onDeal}% deal stack to ${Math.round((onPerson + onDeal) * 100) / 100}%`
      : null;
  }],
  ['paysWrong', (r) => {
    const fee = Number(r.fee_percent) || 0;
    return fee >= 100 ? `fee ${fee}%, takes the whole amount` : null;
  }],
  ['paysWrong', (r, ctx) => (
    ctx.owedNow(r) && Number(r.payable_amount) === 0 && Number(r.monthly_amount) > 0
      ? 'owed this month, 0 payable'
      : null
  )],
  ['paysWrong', (r) => (
    Number(r.monthly_amount) === 0 && !r.stopped_on ? 'monthly 0 on a live deal' : null
  )],
  ['paysWrong', (r, ctx) => {
    const days = num(r.payable_days);
    const inMonth = daysIn(ctx.month);
    return days !== null && inMonth && days > inMonth
      ? `payable days ${days}, ${ctx.monthName} has ${inMonth}`
      : null;
  }],

  // ---- CANNOT BE PAID ----
  ['cannotPay', (r) => (!text(r.currency) ? 'no currency set' : null)],
  ['cannotPay', (r) => {
    if (fold(r.payment_method) !== 'bank') return null;
    if (!text(r.account_number)) return 'bank method, no account number';
    if (!text(r.sort_code)) return 'bank method, no sort code';
    return null;
  }],
  ['cannotPay', (r) => (
    fold(r.payment_method) === 'crypto' && !text(r.bank_details)
      ? 'crypto method, no wallet'
      : null
  )],
  ['cannotPay', (r) => {
    // A SENTINEL LEFT AS DATA: "Will never be bank" is the sheet's own
    // words for someone who is not paid by bank, sitting on a bank row.
    if (fold(r.payment_method) !== 'bank') return null;
    const account = text(r.account_number);
    return /[a-z]{3,}/i.test(account) ? `bank method, account number reads "${account}"` : null;
  }],

  // ---- WILL BREAK THE NEXT UPLOAD ----
  ['breaksUpload', (r) => (
    // The group is part of the deal key, so a row without one cannot be
    // matched next time and arrives again as a new deal.
    !text(r.group_name) ? 'no group, duplicates itself each upload' : null
  )],
  ['breaksUpload', (r) => (
    !text(r.company) && !['ALL GROUPS', 'TAKEOFF'].includes(text(r.group_name))
      ? `no company, and ${text(r.group_name)} needs one`
      : null
  )],
  ['breaksUpload', (r) => (!text(r.person_id) ? 'no person id, orphaned by an old delete' : null)],
  ['breaksUpload', (r, ctx) => (
    // THE SAME DEAL TWICE: person, company, group and role all equal. Not a
    // near miss, the identical row, and the next upload matches only one.
    ctx.twinOf(r) ? `exact duplicate of #${ctx.twinOf(r)}` : null
  )],

  // ---- CONTRADICTS ITSELF ----
  ['contradicts', (r, ctx) => (
    r.stopped_on && ctx.owedNow(r)
      ? `stopped ${dateOnly(r.stopped_on)}, still counted this month`
      : null
  )],
  ['contradicts', (r, ctx) => {
    const status = fold(ctx.companyStatus(r.company));
    return (status === 'closed' || status === 'dissolved') && !r.stopped_on
      ? `its company is ${status}, but this deal is live`
      : null;
  }],
  ['contradicts', (r, ctx) => (
    fold(ctx.companyStatus(r.company)) === 'liquidation' && r.review_monthly !== true
      ? 'company in liquidation, this deal is not marked for review'
      : null
  )],
  ['contradicts', (r, ctx) => (
    // Past its term, nobody has answered, and it is still being paid.
    r.end_on && dateOnly(r.end_on) < `${ctx.month}-01` && !r.stopped_on && ctx.owedNow(r)
      ? `past its end date ${dateOnly(r.end_on)}, unanswered, still paying`
      : null
  )],

  // ---- DATES DO NOT FOLLOW ----
  ['dates', (r) => (
    !r.assigned_on && (r.payment_start_on || r.end_on)
      ? 'no appointment date, so nothing derives'
      : null
  )],
  ['dates', (r) => {
    // The sheet's own chain for the payment start, unless set by hand.
    if (!crmDerived(r) || !r.assigned_on || !r.payment_start_on || byHand(r, 'payment_start_on')) return null;
    const want = utcIso(startFromAppointment(asUtcDate(r.assigned_on)));
    return want && dateOnly(r.payment_start_on) !== want
      ? `payment start ${dateOnly(r.payment_start_on)}, its appointment gives ${want}`
      : null;
  }],
  ['dates', (r) => {
    // And for the end date: a year from the appointment, unless set by hand.
    if (!crmDerived(r) || !r.assigned_on || !r.end_on || byHand(r, 'end_on')) return null;
    const want = utcIso(endFromAppointment(asUtcDate(r.assigned_on)));
    return want && dateOnly(r.end_on) !== want
      ? `end date ${dateOnly(r.end_on)}, its appointment gives ${want}`
      : null;
  }],
  ['dates', (r) => (
    // PROSE IN THE PAYMENT START COLUMN is kept in payment_note ("AUGUST END
    // FULL"). end_note is the END date's words ("Going concern"), which are
    // legitimate, and reading that here mislabelled them. 2026-09-30.
    text(r.payment_note) && !r.assigned_on
      ? `payment start says "${text(r.payment_note)}", no appointment to resolve it`
      : null
  )],
  ['dates', (r, ctx) => (
    r.preset_on && dateOnly(r.preset_on).slice(0, 7) < ctx.month
      ? `preset ${dateOnly(r.preset_on).slice(0, 7)}, already closed`
      : null
  )],
  ['dates', (r) => (
    !r.preset_on && !r.stopped_on ? 'no preset, so counted every month' : null
  )],

  // ---- WORTH A LOOK ----
  ['worthALook', (r, ctx) => {
    // THE ODD CURRENCY OUT on its company: one AED row among GBP ones.
    // Not on Workforce: internal staff are paid in whatever they are paid
    // in, and 8 of 15 "worth a look" rows were that. 2026-09-30.
    if (INTERNAL_COMPANY.test(text(r.company))) return null;
    const odd = ctx.oddCurrency(r);
    return odd ? `${text(r.currency)} on ${text(r.company)}, where the rest are ${odd}` : null;
  }],
  ['worthALook', (r, ctx) => {
    // Same person, same company, another group, different money. Can be
    // right; worth naming because it is usually a missed edit. Not on the
    // INTERNAL company: staff pay differs by group on purpose. 2026-09-30.
    if (INTERNAL_COMPANY.test(text(r.company))) return null;
    const other = ctx.otherGroupMoney(r);
    return other ? `${Number(r.monthly_amount).toLocaleString()} here, ${other}` : null;
  }],
  // ---- MISSING INFO ----
  // EVERY EMPTY FIELD, NAMED. "Missing infos" listed Liam Edwards as "no
  // phone", and his postcode and door number were empty too. His call
  // 2026-10-05: say exactly what is missing. Bank details are cannotPay's.
  ['missingInfo', (r) => {
    const gone = [['phone', r.phone], ['postcode', r.postcode], ['door number', r.door_number], ['location', r.location]]
      .filter(([, v]) => !text(v)).map(([label]) => label);
    return gone.length ? `no ${gone.join(', ')}` : null;
  }],
  // THE REASON ITSELF: payday flags rows too now, so "the import" was a guess.
  ['worthALook', (r) => (r.needs_review === true ? (text(r.review_reason) || 'flagged for a check') : null)],
];

/**
 * @param {object[]} rows      live deals, as the repo returns them
 * @param {object} opts
 * @param {string} opts.month  'YYYY-MM', the business month. Never guessed here.
 * @param {string} opts.monthName  how to say it, so this spells no dates
 * @param {Map|object} opts.companyStatus  company name to its status
 * @param {boolean} opts.useEndDate  passed straight to isOwedThisMonth
 * @returns {{ month, monthName, rows, total, sections }}
 */
function sheetCheck(rows = [], {
  month, monthName = month, companies = [], useEndDate = false,
} = {}) {
  const statusOf = new Map(
    (companies ?? []).map((c) => [fold(c.name), c.status]),
  );

  // ---- ACROSS ROWS, built once. A rule sees one row; these see the sheet.
  // A malformed row is skipped here too, as the rule loop skips it below.
  const list = (rows ?? []).filter((r) => r && typeof r === 'object');
  const personKey = (r) => fold(r.person_id) || fold(r.person_name);
  // Exact twins: the FIRST keeps its place, every later copy names it.
  const firstOf = new Map();
  const twin = new Map();
  for (const r of list) {
    const key = [personKey(r), fold(r.company), fold(r.group_name), fold(r.role_label)].join('|');
    if (firstOf.has(key)) twin.set(r.id, firstOf.get(key)); else firstOf.set(key, r.id);
  }
  // The usual currency on each company, and only when one clearly wins.
  const byCompany = new Map();
  for (const r of list) {
    const c = fold(r.company);
    const cur = text(r.currency).toUpperCase();
    if (!c || !cur) continue;
    if (!byCompany.has(c)) byCompany.set(c, new Map());
    const counts = byCompany.get(c);
    counts.set(cur, (counts.get(cur) ?? 0) + 1);
  }
  const oddCurrency = (r) => {
    const counts = byCompany.get(fold(r.company));
    const cur = text(r.currency).toUpperCase();
    if (!counts || counts.size < 2 || !cur) return null;
    const [top, topN] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return top !== cur && topN > (counts.get(cur) ?? 0) ? top : null;
  };
  // The same person on the same company in another group, for different money.
  const samePlace = new Map();
  for (const r of list) {
    const key = `${personKey(r)}|${fold(r.company)}`;
    if (!fold(r.company)) continue;
    if (!samePlace.has(key)) samePlace.set(key, []);
    samePlace.get(key).push(r);
  }
  const otherGroupMoney = (r) => {
    const others = (samePlace.get(`${personKey(r)}|${fold(r.company)}`) ?? [])
      .filter((o) => o.id !== r.id && fold(o.group_name) !== fold(r.group_name)
        && Number(o.monthly_amount) !== Number(r.monthly_amount));
    return others.length
      ? others.map((o) => `${Number(o.monthly_amount).toLocaleString()} in ${text(o.group_name)}`).join(', ')
      : null;
  };
  const ctx = {
    month,
    monthName,
    companyStatus: (name) => statusOf.get(fold(name)) ?? null,
    twinOf: (r) => twin.get(r.id) ?? null,
    oddCurrency,
    otherGroupMoney,
    // TWO QUESTIONS, and they are not the same one. `isForMonth` asks
    // whether the row is marked for this month; `isOwedThisMonth` asks
    // whether it owes anything at all. Both, or a row marked for August
    // reads as owed in September.
    owedNow: (r) => isForMonth(r, month) && isOwedThisMonth(r, { useEndDate }),
  };

  const found = new Map(SECTIONS.map(([key]) => [key, []]));
  for (const row of rows ?? []) {
    for (const [section, rule] of RULES) {
      let fault = null;
      // A rule that throws on a shape nobody predicted must not take the
      // whole report down: a check is worth less than the rows it reads.
      try { fault = rule(row, ctx); } catch { fault = null; }
      if (fault) {
        found.get(section).push({
          id: row.id, who: whoOf(row), where: whereOf(row), fault,
        });
      }
    }
  }

  const sections = SECTIONS
    .map(([key, label]) => {
      const all = found.get(key);
      return {
        key,
        label,
        count: all.length,
        rows: all.slice(0, MAX_PER_SECTION),
        // EVERY row, for the reading: the card cuts at twelve, her voice
        // does not. See agent/screenReading.js.
        all,
        // SAID, never silent. A cap you cannot see is the bug.
        cut: Math.max(0, all.length - MAX_PER_SECTION),
      };
    })
    .filter((s) => s.count > 0);

  return {
    month,
    monthName,
    rows: (rows ?? []).length,
    total: sections.reduce((n, s) => n + s.count, 0),
    sections,
  };
}

module.exports = { sheetCheck, SECTIONS, MAX_PER_SECTION };
