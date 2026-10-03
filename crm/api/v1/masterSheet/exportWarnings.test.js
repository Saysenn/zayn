const test = require('node:test');
const assert = require('node:assert/strict');

const { exportWarnings } = require('./exportWarnings');

/**
 * ***************************************************
 * * The warning SHAPE is a contract, and it has two halves
 * ***************************************************
 *
 * Two renderers draw these now: the export modal, and Diane's export panel.
 * Neither shares a file with the other, so the field names are the only
 * thing holding them together.
 *
 * THIS HALF PINS WHAT IS EMITTED. The other half is
 * web/src/components/agentOrb/forms/exportSession.test.js, which pins that
 * her panel reads these exact names. Her panel was written against guessed
 * ones (`title`, `message`, `rowIds`) and rendered a row of blanks.
 */

const BANK_NO_DETAILS = {
  id: 1, person_id: 'paddy', person_name: 'Paddy', group_name: 'NEXUS', company: 'A J Rayson',
  payment_method: 'bank', bank_details: 'Will never be bank', account_number: '', sort_code: '',
  payable_amount: 100, currency: 'GBP', preset_on: '2026-08-01',
};

test('every warning carries the fields both renderers draw', () => {
  const warnings = exportWarnings([BANK_NO_DETAILS], { month: '2026-08', template: 'bank' });
  assert.ok(warnings.length > 0, 'nothing to check');

  for (const w of warnings) {
    // The sentence, said as it is. Never assembled by a renderer.
    assert.equal(typeof w.text, 'string', 'a warning with no text renders blank');
    assert.ok(w.text.length > 0);
    // WHICH GROUP, because a file can hold several and "1 row" alone does
    // not say where to look.
    assert.equal(typeof w.group, 'string');
    // How loudly to say it.
    assert.ok(['warning', 'info'].includes(w.severity), `unknown severity: ${w.severity}`);
    // A stable key per group, for React and for de-duping.
    assert.equal(typeof w.kind, 'string');
    // THE ROW IDS, so a renderer can offer to fix them in place rather
    // than sending somebody off to find them.
    assert.ok(Array.isArray(w.ids));
    assert.equal(typeof w.count, 'number');
  }
});

test('the names Diane\'s panel first guessed are NOT the ones emitted', () => {
  // Guards the guard: if `title` or `rowIds` ever became real, the test
  // above would pass while the panel silently drew the wrong field.
  const [w] = exportWarnings([BANK_NO_DETAILS], { month: '2026-08', template: 'bank' });
  assert.equal(w.title, undefined);
  assert.equal(w.message, undefined);
  assert.equal(w.rowIds, undefined);
});

test('a bank row with nothing to pay into is warned about', () => {
  const warnings = exportWarnings([BANK_NO_DETAILS], { month: '2026-08', template: 'bank' });
  assert.ok(
    warnings.some((w) => w.kind === 'bank-without-details'),
    'the one warning a payout file exists to raise',
  );
});

/**
 * ===============================
 * * NO MONTH SCOPE, NO MONTH WARNING
 * ===============================
 * `exportQuery`'s `monthValue` returns NULL for an export that is not
 * scoped to a month, and a default parameter only fires on undefined. So
 * `month` stayed null and the panel showed a button reading
 * **"Set to Invalid Date"** on EVERY row: `isForMonth(r, null)` is false
 * for all of them, so a file that excludes nothing announced that
 * everything was excluded.
 *
 * Only visible once the panel was switched back on, 2026-09-08.
 */

const IN_JULY = {
  id: 9, group_name: 'GROUP ONE', person_name: 'A', preset_on: '2026-07-01',
  monthly_amount: 1000, payment_method: 'cash', status: 'active', payment_period: 'active',
};

const monthKinds = (month) => exportWarnings([IN_JULY], { month }).map((w) => w.kind);

test('an export with NO month scope raises no month warning', () => {
  // null is what monthValue actually returns, and it is the case that broke.
  assert.ok(!monthKinds(null).includes('preset-other-month'));
  assert.ok(!monthKinds(undefined).includes('preset-other-month'));
});

test('and a month that is not a month is treated the same way', () => {
  assert.ok(!monthKinds('nonsense').includes('preset-other-month'));
  assert.ok(!monthKinds('2026-13').includes('preset-other-month'));
});

test('NO BUTTON EVER READS "Invalid Date"', () => {
  // The symptom, pinned on its own: a label is what somebody presses.
  for (const month of [null, undefined, 'nonsense', '2026-13', '2026-08']) {
    for (const w of exportWarnings([IN_JULY], { month })) {
      assert.ok(
        !/invalid date/i.test(w.fix?.label ?? ''),
        `month ${String(month)} produced the label "${w.fix?.label}"`,
      );
    }
  }
});

test('a real month still warns, and still names itself', () => {
  const [w] = exportWarnings([IN_JULY], { month: '2026-08' });
  assert.equal(w.kind, 'preset-other-month');
  assert.equal(w.fix.label, 'Set to August 2026');
  assert.equal(w.fix.value, '2026-08-01');
});

test('a row already on the month is not warned about', () => {
  assert.ok(!monthKinds('2026-07').includes('preset-other-month'));
});

// ===============================
// * THE COUNT AND THE LIST ARE THE SAME ROWS
// ===============================
// A panel that says "2 rows" over a list of 1 is a panel lying about how
// much work is left, and the reader has no way to find the row it hid.
// Both come off `hits`, so they cannot drift here; this pins that, and
// pins the ids as distinct so the client cannot drop one on a key clash.
test('every row-carrying warning counts exactly what it lists', () => {
  const rows = [
    { id: 1, group_name: 'INDIGO', person_name: 'A', monthly_amount: 0, preset_on: '2026-09-01' },
    { id: 2, group_name: 'INDIGO', person_name: 'B', monthly_amount: null, preset_on: '2026-09-01' },
    { id: 3, group_name: 'MILKMAN', person_name: 'C', monthly_amount: 0, preset_on: '2026-09-01' },
    { id: 4, group_name: 'INDIGO', person_name: 'D', monthly_amount: 500, preset_on: '2026-09-01' },
  ];
  const out = exportWarnings(rows, { month: '2026-09' });
  const listed = out.filter((w) => w.field && w.rows.length > 0);
  assert.ok(listed.length > 0, 'the fixture has to produce at least one listable warning');
  for (const w of listed) {
    assert.equal(w.count, w.rows.length, `${w.kind}/${w.group} counts what it lists`);
    const ids = w.rows.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `${w.kind}/${w.group} has distinct row ids`);
  }
  const money = out.find((w) => w.kind === 'no-monthly-amount' && w.group === 'INDIGO');
  assert.equal(money.count, 2, 'zero and null both count as no monthly amount');
  assert.deepEqual(money.rows.map((r) => r.personName), ['A', 'B']);
});

// ===============================
// * A ROW IN THE FILE IS A ROW THE PANEL CAN MENTION
// ===============================
// `isPeriodEnded` counts NOT_STARTED as ended, so 19 of the live 96 were
// skipped by every scenario. That is right for the money ones: their
// figures are already correct and already marked. It was wrong for the
// dates, which decide no figure and exist so the file leaves carrying the
// dates his own sheet would. Those 19 shipped with empty end dates and the
// panel could not offer to fill one. Found 2026-09-08.
const notStarted = {
  id: 90,
  group_name: 'INDIGO',
  person_name: 'Tobias Wright',
  company: 'Social work partners PR',
  monthly_amount: 500,
  preset_on: '2026-09-01',
  assigned_on: '2026-08-05',
  payment_start_on: '2026-11-03', // after the preset month: not_started
  end_on: null,
  payment_period: 'not_started',
};

test('a NOT-STARTED row still gets its missing date offered', () => {
  const out = exportWarnings([notStarted], { month: '2026-09' });
  const dates = out.find((w) => w.kind === 'derivable-dates');
  assert.ok(dates, 'the dates scenario opts out of the ended skip');
  assert.equal(dates.count, 1);
  assert.equal(dates.rows[0].personName, 'Tobias Wright');
  assert.equal(dates.rows[0].suggest.direction, 'forward');
  assert.deepEqual(dates.rows[0].suggest.fields, { endOn: '2027-08-05' });
});

test('the MONEY scenarios still skip it, because its figures are not in play', () => {
  // Same row, no monthly amount. The skip it opts out of is a money rule,
  // so lifting it for the dates must not lift it for the rest.
  const out = exportWarnings([{ ...notStarted, monthly_amount: 0 }], { month: '2026-09' });
  assert.equal(out.find((w) => w.kind === 'no-monthly-amount'), undefined);
  assert.equal(out.find((w) => w.kind === 'preset-other-month'), undefined);
  assert.ok(out.find((w) => w.kind === 'derivable-dates'), 'the dates still come through');
});

test('an ACTIVE row is unaffected by the opt-out', () => {
  const active = { ...notStarted, payment_start_on: '2026-08-05', payment_period: 'active' };
  const dates = exportWarnings([active], { month: '2026-09' }).find((w) => w.kind === 'derivable-dates');
  assert.equal(dates.count, 1, 'listed as it always was');
});

/**
 * ===============================
 * * THE REVIEW'S SECOND DOOR
 * ===============================
 * The first is the Review button on the master sheet, which you walk
 * through when you go looking. This one comes to find you, so a payout file
 * cannot be built over deals nobody has answered for.
 */
const UNANSWERED = {
  id: 91, person_id: 'ajr', person_name: 'Paddy', group_name: 'NEXUS', company: 'A J Rayson',
  payment_method: 'bank', monthly_amount: 1200, payable_amount: 1200, currency: 'GBP',
  preset_on: '2026-08-01', end_on: '2025-08-01',
};

test('AN UNANSWERED REVIEW IS A WARNING ON THE EXPORT', () => {
  const out = exportWarnings([UNANSWERED], {
    month: '2026-08', unanswered: new Set([91]),
  });
  const hit = out.find((w) => w.kind === 'unanswered-review');
  assert.ok(hit, 'the file must say so before it is built');
  assert.equal(hit.count, 1);
  assert.equal(hit.severity, 'warning', 'the money is going out, so it is not a note');
  assert.match(hit.text, /still being paid/);
});

test('IT OFFERS NO FIX, because the answer is a decision per deal', () => {
  // A button saying "mark them all yes" here would be the review answered
  // without being read, which is the whole thing it exists to prevent.
  const out = exportWarnings([UNANSWERED], { month: '2026-08', unanswered: new Set([91]) });
  const hit = out.find((w) => w.kind === 'unanswered-review');
  assert.equal(hit.fix, null);
  assert.equal(hit.field, null);
  assert.deepEqual(hit.rows, []);
});

test('AN ANSWERED DEAL RAISES NOTHING', () => {
  const out = exportWarnings([UNANSWERED], { month: '2026-08', unanswered: new Set() });
  assert.equal(out.find((w) => w.kind === 'unanswered-review'), undefined);
});

test('NO REVIEW DATA AT ALL IS NOT "EVERYTHING IS UNANSWERED"', () => {
  // A caller that forgets to pass the set must warn about nothing, never
  // flag every row on the sheet.
  const out = exportWarnings([UNANSWERED], { month: '2026-08' });
  assert.equal(out.find((w) => w.kind === 'unanswered-review'), undefined);
});
