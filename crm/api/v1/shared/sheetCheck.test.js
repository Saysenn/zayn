const test = require('node:test');
const assert = require('node:assert/strict');
const { sheetCheck, MAX_PER_SECTION } = require('./sheetCheck.helper');

/**
 * ***************************************************
 * * EVERY DISCREPANCY, AND NOTHING THAT IS NOT ONE
 * ***************************************************
 *
 * Both halves matter and the second one more. A report that flags healthy
 * rows is one nobody opens twice, and the sheet it is describing is the
 * one the boss is paid from.
 *
 * No database: rows in, findings out.
 */

const MONTH = '2026-09';

// A row with nothing wrong with it. Every case below is this, bent once.
const OK = {
  id: 1,
  person_name: 'Zayn',
  person_id: 'zayn',
  group_name: 'MILKMAN',
  company: 'Workforce',
  role_label: 'Tech',
  monthly_amount: 4000,
  payable_amount: 4000,
  payable_days: 30,
  currency: 'AED',
  payment_method: 'cash',
  phone: '07700900000',
  preset_on: '2026-09-01',
  assigned_on: '2025-01-01',
  payment_start_on: '2025-04-01',
  end_on: null,
  stopped_on: null,
  addon_percent: 0,
  fee_percent: 0,
  person_addon_percent: 0,
  needs_review: false,
};

const check = (row, opts = {}) => sheetCheck([{ ...OK, ...row }], { month: MONTH, monthName: 'September', ...opts });
const faults = (row, opts) => check(row, opts).sections.flatMap((s) => s.rows.map((r) => r.fault));
const sectionOf = (row, opts) => check(row, opts).sections.map((s) => s.key);

test('A CLEAN ROW IS SILENT', () => {
  const out = sheetCheck([OK], { month: MONTH });
  assert.equal(out.total, 0);
  assert.deepEqual(out.sections, []);
});

/* ---- pays wrong ---- */

test('PAYABLE OVER MONTHLY, with both figures said', () => {
  assert.deepEqual(faults({ payable_amount: 4100 }), ['payable 4,100 over monthly 4,000']);
  assert.deepEqual(sectionOf({ payable_amount: 4100 }), ['paysWrong']);
});

test('RATES ON BOTH LEVELS STACK, and the sum is said', () => {
  // 5% on the person plus 3% on the deal is 8% on that row. The surprise
  // is the whole reason this is flagged.
  assert.deepEqual(
    faults({ person_addon_percent: 5, addon_percent: 3 }),
    ['5% profile + 3% deal stack to 8%'],
  );
  // One level alone is ordinary.
  assert.deepEqual(faults({ person_addon_percent: 5 }), []);
  assert.deepEqual(faults({ addon_percent: 3 }), []);
});

test('A FEE THAT TAKES EVERYTHING', () => {
  assert.deepEqual(faults({ fee_percent: 100 }), ['fee 100%, takes the whole amount']);
  assert.deepEqual(faults({ fee_percent: 99 }), []);
});

test('OWED THIS MONTH AND ZERO PAYABLE', () => {
  assert.deepEqual(faults({ payable_amount: 0 }), ['owed this month, 0 payable']);
});

test('BUT A ZERO ON A ROW THAT OWES NOTHING IS CORRECT, not a fault', () => {
  // Marked for August, so September owes nothing and the zero is right.
  assert.deepEqual(faults({ payable_amount: 0, preset_on: '2026-08-01' }).filter((f) => /0 payable/.test(f)), []);
});

test('MONTHLY ZERO ON A LIVE DEAL', () => {
  assert.match(faults({ monthly_amount: 0, payable_amount: 0 }).join(), /monthly 0 on a live deal/);
});

test('MORE PAYABLE DAYS THAN THE MONTH HAS', () => {
  assert.deepEqual(faults({ payable_days: 45 }), ['payable days 45, September has 30']);
  assert.deepEqual(faults({ payable_days: 30 }), []);
});

/* ---- cannot be paid ---- */

test('NO CURRENCY, NO BANK, NO WALLET', () => {
  assert.deepEqual(faults({ currency: '' }), ['no currency set']);
  assert.deepEqual(faults({ payment_method: 'bank' }), ['bank method, no account number']);
  assert.deepEqual(
    faults({ payment_method: 'bank', account_number: '123' }),
    ['bank method, no sort code'],
  );
  assert.deepEqual(faults({ payment_method: 'crypto' }), ['crypto method, no wallet']);
  // Filled in, so nothing to say.
  assert.deepEqual(faults({ payment_method: 'bank', account_number: '123', sort_code: '00-00-00' }), []);
});

/* ---- breaks the next upload ---- */

test('NO GROUP DUPLICATES ITSELF, which is the whole reason it is flagged', () => {
  assert.match(faults({ group_name: '' }).join(), /duplicates itself each upload/);
});

test('NO COMPANY, EXCEPT WHERE A GROUP DOES NOT NEED ONE', () => {
  assert.match(faults({ company: '' }).join(), /no company, and MILKMAN needs one/);
  // ALL GROUPS and TAKEOFF legitimately have none.
  assert.equal(faults({ company: '', group_name: 'ALL GROUPS' }).some((f) => /no company/.test(f)), false);
});

test('AN ORPHANED ROW', () => {
  assert.match(faults({ person_id: '' }).join(), /orphaned by an old delete/);
});

/* ---- contradicts itself ---- */

test('STOPPED BUT STILL COUNTED', () => {
  // `isOwedThisMonth` says a stop wins, so this pair cannot both be true.
  const out = faults({ stopped_on: '2026-08-31' });
  assert.equal(out.some((f) => /still counted this month/.test(f)), false, 'the stop is honoured');
});

test('A CLOSED COMPANY WITH A LIVE DEAL', () => {
  const companies = [{ name: 'Workforce', status: 'closed' }];
  assert.match(faults({}, { companies }).join(), /its company is closed, but this deal is live/);
});

test('A LIQUIDATING COMPANY WHOSE DEAL IS NOT MARKED FOR REVIEW', () => {
  const companies = [{ name: 'Workforce', status: 'liquidation' }];
  assert.match(faults({}, { companies }).join(), /not marked for review/);
  // Ticked, so nothing to say.
  assert.equal(
    faults({ review_monthly: true }, { companies }).some((f) => /not marked for review/.test(f)),
    false,
  );
});

test('PAST ITS END DATE, UNANSWERED, STILL PAYING', () => {
  assert.match(faults({ end_on: '2026-07-31' }).join(), /past its end date 2026-07-31/);
});

/* ---- dates do not follow ---- */

test('NO APPOINTMENT, SO NOTHING DERIVES', () => {
  assert.match(faults({ assigned_on: null }).join(), /no appointment date/);
});

test('THE CHAIN IS THE SHEET\'S OWN, on rows the CRM derived', () => {
  const { startFromAppointment } = require('./fromAppointment.helper');
  const start = startFromAppointment(new Date('2025-03-10T00:00:00Z')).toISOString().slice(0, 10);
  const manual = { source: 'manual', assigned_on: '2025-03-10', payment_start_on: start, end_on: '2026-03-10' };
  assert.equal(faults(manual).some((f) => /its appointment gives/.test(f)), false, 'the derived start is not a fault');
  assert.match(
    faults({ ...manual, payment_start_on: '2025-09-09' }).join(),
    new RegExp(`payment start 2025-09-09, its appointment gives ${start}`),
  );
  assert.match(faults({ ...manual, end_on: '2026-12-25' }).join(), /end date 2026-12-25, its appointment gives 2026-03-10/);
});

test('A WEEK ONE APPOINTMENT IS NOT PLUS 90, and is not flagged', () => {
  const { startFromAppointment } = require('./fromAppointment.helper');
  const start = startFromAppointment(new Date('2026-03-03T00:00:00Z')).toISOString().slice(0, 10);
  assert.equal(faults({
    source: 'manual', assigned_on: '2026-03-03', payment_start_on: start, end_on: '2027-03-03',
  }).some((f) => /its appointment gives/.test(f)), false);
});

test('HIS SHEET\'S DATES AND HAND SET DATES ARE NOT JUDGED', () => {
  assert.equal(faults({ source: 'synced', payment_start_on: '2025-09-09' }).some((f) => /its appointment gives/.test(f)), false);
  assert.equal(faults({
    source: 'manual', payment_start_on: '2025-09-09', manually_overridden_fields: ['payment_start_on'],
  }).some((f) => /payment start/.test(f)), false);
});

test('DATES FROM THE DATABASE ARE DATES, not "Fri Jan 30"', () => {
  assert.match(faults({ preset_on: new Date(2026, 7, 1) }).join(), /preset 2026-08, already closed/);
});

test('PROSE IN THE PAYMENT START WITH NOTHING TO RESOLVE IT', () => {
  assert.match(
    faults({ assigned_on: null, payment_note: 'AUGUST END FULL' }).join(),
    /says "AUGUST END FULL", no appointment to resolve it/,
  );
  // His END date words are legitimate and are not payment start prose.
  assert.equal(faults({ end_note: 'Going concern' }).some((f) => /says "Going concern"/.test(f)), false);
});

test('ACROSS ROWS: a twin, the odd currency out, and money differing by group', () => {
  const rows = [
    { ...OK, company: 'Northstar Care', id: 1 },
    { ...OK, company: 'Northstar Care', id: 2 },
    { ...OK, company: 'Northstar Care', id: 3, person_name: 'B', person_id: 'b', currency: 'AED' },
    { ...OK, company: 'Northstar Care', id: 4, person_name: 'C', person_id: 'c', currency: 'GBP' },
    { ...OK, company: 'Northstar Care', id: 5, person_name: 'D', person_id: 'd', currency: 'AED' },
    { ...OK, company: 'Northstar Care', id: 6, group_name: 'INDIGO', monthly_amount: 1000, payable_amount: 1000 },
  ];
  const all = sheetCheck(rows, { month: MONTH, monthName: 'September' }).sections.flatMap((s) => s.rows);
  assert.ok(all.some((r) => r.id === 2 && /exact duplicate of #1/.test(r.fault)));
  assert.ok(!all.some((r) => r.id === 1 && /exact duplicate/.test(r.fault)), 'the first keeps its place');
  assert.ok(all.some((r) => r.id === 4 && /GBP on Northstar Care, where the rest are AED/.test(r.fault)));
  assert.ok(all.some((r) => r.id === 6 && /1,000 here, 4,000 in MILKMAN/.test(r.fault)));
});

test('A SENTINEL ON A BANK ROW', () => {
  assert.match(
    faults({ payment_method: 'bank', account_number: 'Will never be bank', sort_code: '00-00-00' }).join(),
    /account number reads "Will never be bank"/,
  );
});

test('A PRESET ALREADY CLOSED, AND NO PRESET AT ALL', () => {
  assert.match(faults({ preset_on: '2026-08-01' }).join(), /preset 2026-08, already closed/);
  assert.match(faults({ preset_on: null }).join(), /no preset, so counted every month/);
});

/* ---- order, capping and shape ---- */

test('SECTIONS COME IN COST ORDER, and empty ones are absent', () => {
  const rows = [
    { ...OK, id: 1, phone: '' },
    { ...OK, id: 2, person_id: 'p2', payable_amount: 9000 },
    { ...OK, id: 3, person_id: 'p3', currency: '' },
  ];
  assert.deepEqual(
    sheetCheck(rows, { month: MONTH }).sections.map((s) => s.key),
    ['paysWrong', 'cannotPay', 'worthALook'],
  );
});

test('A LONG SECTION IS CUT, AND SAYS IT WAS', () => {
  // A cap you cannot see is the bug. Forty of the same sentence teaches
  // nothing the first one did, so it cuts and reports the number.
  const many = Array.from({ length: 40 }, (_, i) => ({ ...OK, id: i + 1, person_id: `p${i}`, phone: '' }));
  const [section] = sheetCheck(many, { month: MONTH }).sections;
  assert.equal(section.count, 40);
  assert.equal(section.rows.length, MAX_PER_SECTION);
  assert.equal(section.cut, 40 - MAX_PER_SECTION);
});

test('EVERY FINDING NAMES A ROW, or nobody can act on it', () => {
  const [row] = sheetCheck([{ ...OK, payable_amount: 4100 }], { month: MONTH }).sections[0].rows;
  assert.equal(row.id, 1);
  assert.equal(row.who, 'Zayn');
  assert.equal(row.where, 'MILKMAN · Workforce');
});

test('A ROW WITH NO NAME OR PLACE STILL SAYS SO', () => {
  const [row] = sheetCheck(
    [{ ...OK, person_name: '', group_name: '', company: '', payable_amount: 4100 }],
    { month: MONTH },
  ).sections[0].rows;
  assert.equal(row.who, '(no handler)');
  assert.equal(row.where, 'no group · no company');
});

test('THE HEADER COUNTS ROWS READ AND FINDINGS, separately', () => {
  const out = sheetCheck([OK, { ...OK, id: 2, person_id: 'p2', phone: '' }], { month: MONTH });
  assert.equal(out.rows, 2, 'rows read');
  assert.equal(out.total, 1, 'findings');
});

test('A BROKEN ROW DOES NOT TAKE THE REPORT DOWN', () => {
  // A check is worth less than the rows it reads.
  const out = sheetCheck([null, undefined, {}, OK], { month: MONTH });
  assert.ok(out.total >= 0);
});

// 2026-09-30: internal staff are paid in several currencies on purpose.
test('WORKFORCE IS NEVER THE ODD CURRENCY OUT', () => {

  const base = { group_name: 'ALPHA', company: 'Workforce', role_label: 'Admin', monthly_amount: 1000, payable_amount: 1000, payable_days: 30, payment_method: 'cash', preset_on: '2026-09-01', phone: '1' };
  const rows = [
    { ...base, id: 1, person_name: 'Alex Example', currency: 'GBP' },
    { ...base, id: 2, person_name: 'Blake Example', currency: 'GBP' },
    { ...base, id: 3, person_name: 'Casey Example', currency: 'AED' },
  ];
  const out = sheetCheck(rows, { month: '2026-09' });
  const faults = out.sections.flatMap((s) => s.all ?? s.rows).map((r) => r.fault);
  assert.equal(faults.some((f) => /where the rest are/.test(f)), false);
});
