const { isPeriodEnded } = require('../shared/paymentPeriod.helper');
const { isForMonth, currentMonth } = require('../shared/presetMonth.helper');
// Read only: it says what a date COULD be and never writes one.
const { suggestDates } = require('../shared/suggestDates.helper');

/**
 * WHAT WILL BE WRONG WITH THIS FILE, said before it is generated.
 *
 * The count box answers "how many". This answers "and what is wrong with
 * them", at the one moment somebody is about to send a payment document.
 *
 * ONLY THINGS THAT CHANGE THE FINAL TOTAL. Not every flag on every row: a
 * panel that lists everything is a panel nobody reads, and the Master Sheet
 * page already marks per-row problems on the column that caused them. What
 * belongs here is the money — a row silently excluded, or included at zero,
 * or included with nowhere to send it.
 *
 * GROUPED BY GROUP, because that is how they get acted on and how the boss
 * asks about them: "six rows in INDIGO", not "six rows".
 *
 * A FIX IS A BUTTON ONLY WHERE ONE VALUE IS OBVIOUSLY RIGHT. The preset
 * qualifies: there is exactly one month being generated. "Set the monthly
 * amount" does not, so it has no `fix` and the panel gives a field per row
 * instead. A button on an ambiguous fix is how somebody bulk-writes the
 * wrong number onto twelve rows in one press.
 */

// The month shape, restated rather than imported: exportQuery imports THIS
// file, so taking its MONTH back off it would be a require cycle.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// "Will never be bank" is a real sentinel (canonical.js) meaning this person
// is never paid by transfer. On a row whose METHOD is bank, that is a
// contradiction, not a value.
const NO_BANK = /^will never be bank$/i;
const missingBankDetail = (v) => {
  const text = String(v ?? '').trim();
  return text === '' || NO_BANK.test(text);
};

/**
 * Each scenario says how to spot it, what it costs, and how it is fixed.
 *
 * `fix` present  -> one value corrects every listed row, offered as a button
 * `fix` absent   -> the panel edits `field` per row
 * `only`         -> scenarios that belong to one export, like bank details
 */
const SCENARIOS = [
  {
    kind: 'preset-other-month',
    // Meaningless without a month scope: a file that filters on no month
    // excludes nothing for being on the wrong one.
    needsMonth: true,
    // Excluded from the total entirely. The biggest one by value: a sheet
    // still set to last month generates a file whose total is almost
    // nothing, and nothing on the figure itself says why.
    severity: 'warning',
    hit: (r, { month }) => !isForMonth(r, month),
    text: (n, { monthLabel }) => `${n} ${n === 1 ? 'row is' : 'rows are'} set to a different month, so they are NOT in the total`,
    fix: ({ month }) => ({
      label: (monthLabel) => `Set to ${monthLabel}`,
      field: 'presetOn',
      value: `${month}-01`,
    }),
  },
  {
    kind: 'should-not-be-paid',
    // Excluded on purpose, but worth saying: it is a decision somebody made
    // once and may not remember making.
    severity: 'info',
    hit: (r) => r.override_should_be_paid === false,
    text: (n) => `${n} ${n === 1 ? 'row is' : 'rows are'} marked should not be paid, and are out of the total`,
    // THE PERSON'S, his call 2026-10-08: yes goes onto every live deal of
    // each person listed, or they would be left half yes, half no.
    fix: () => ({ label: () => 'Set these people to yes', field: 'overrideShouldBePaid', value: true, wholePerson: true }),
  },
  {
    kind: 'no-monthly-amount',
    // In the total, contributing nothing. No safe single value.
    severity: 'warning',
    hit: (r) => !(Number(r.monthly_amount) > 0),
    text: (n) => `${n} ${n === 1 ? 'row has' : 'rows have'} no monthly amount, so they add £0`,
    field: 'monthlyAmount',
    input: 'money',
  },
  {
    kind: 'derivable-dates',
    // NOT in the total and not wrong, which is why it is info rather than
    // warning: a missing end date changes no figure. It is here because
    // the sheet leaving the building should carry the dates his own file
    // would, and because a missing payment start makes a row read as
    // "Ongoing" when it is only unfilled.
    //
    // SUGGESTED, NEVER APPLIED. suggestDates works out what each date would
    // be; a human presses Accept per row. A back-derived appointment date
    // in particular is an invented onboarding date, so it can never be
    // written by a rule. See shared/suggestDates.helper.js.
    //
    // ===============================
    // * IN THE FILE, SO IN THE PANEL
    // ===============================
    // The ONE scenario that opts out of the ended skip below, and the
    // reason is the reason it exists. That skip is a money rule: an ended
    // row's figures are already correct and already marked, so repeating
    // them as a fault on every count is noise. This scenario changes no
    // figure. It is about the sheet leaving the building carrying the
    // dates his own file would, and `not_started` means a deal has not
    // BEGUN, not that it is over.
    //
    // 19 of the live 96 are not-started, every one ships inside the file,
    // and the panel could not mention a single one of them: the end dates
    // were missing on screen with nothing in the export offering to fill
    // them. Found 2026-09-08.
    includeEnded: true,
    severity: 'info',
    hit: (r) => suggestDates(r) !== null,
    text: (n) => `${n} ${n === 1 ? 'row is' : 'rows are'} missing a date that can be worked out from the others`,
    field: 'suggestedDates',
    input: 'dates',
  },
  {
    // ===============================
    // * THE DOOR THAT COMES TO FIND YOU
    // ===============================
    // The other door is the Review button on the master sheet, which you
    // walk through when you go looking. This one exists so a payout file
    // cannot be built over deals nobody has answered for.
    //
    // WARNING, NOT INFO, AND IT IS IN THE TOTAL. An unanswered deal keeps
    // being paid, deliberately: defaulting to stopped would silently cut
    // real people off. So the money is going out and the question has not
    // been answered, which is precisely when somebody needs telling.
    //
    // NO BULK FIX AND NO FIELD. The answer is a decision per deal, and a
    // button here that said "mark them all yes" would be the review
    // answered without being read.
    kind: 'unanswered-review',
    severity: 'warning',
    // The ids come from the review repo, passed in rather than queried
    // here: this file is pure over its rows and stays that way.
    hit: (r, { unanswered }) => Boolean(unanswered?.has(r.id)),
    text: (n) => `${n} ${n === 1 ? 'deal is' : 'deals are'} past their end date with no answer this month, and are still being paid`,
  },
  {
    kind: 'bank-without-details',
    // In the total and payable nowhere. Bank only: on a cash sheet the
    // absence of an account number is the correct state.
    severity: 'warning',
    only: ['bank', 'bank-details'],
    hit: (r) => r.payment_method === 'bank'
      && (missingBankDetail(r.account_number) || missingBankDetail(r.sort_code)),
    text: (n) => `${n} ${n === 1 ? 'row is' : 'rows are'} paid by transfer with no account number or sort code`,
    field: 'accountNumber',
    input: 'text',
  },
];

/**
 * @param {object[]} rows the rows the file will actually contain
 * @param {object} opts
 * @param {string} [opts.month] the run's month, 'YYYY-MM'. Defaults to now.
 * @param {string} [opts.template] which export, so bank-only checks are
 *   skipped on the others.
 * @returns {object[]} one entry per scenario per group, worst first
 */
function exportWarnings(rows, { month, template, unanswered } = {}) {
  // ===============================
  // * NO MONTH SCOPE, NO MONTH WARNING
  // ===============================
  // `monthValue` returns NULL for an export that is not scoped to a month,
  // and a default parameter only fires on undefined. So `month` stayed null
  // and two things went wrong at once: the button read "Set to Invalid
  // Date", and `isForMonth(r, null)` is false for every row, so a file that
  // excludes nothing announced that every row was excluded.
  //
  // Defaulting to the current month would have fixed the label and kept the
  // lie. A file with no month scope drops no row for being on the wrong
  // month, so the warning is not mislabelled, it is MEANINGLESS, and the
  // honest fix is not to run it.
  const scoped = MONTH.test(String(month ?? ''));
  const monthLabel = scoped
    ? new Date(`${month}-01T00:00:00Z`)
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;

  const out = [];
  for (const scenario of SCENARIOS) {
    if (scenario.only && !scenario.only.includes(template)) continue;
    if (scenario.needsMonth && !scoped) continue;

    // Per group, because that is the unit somebody acts on.
    const byGroup = new Map();
    for (const r of rows) {
      // An ended period is already correct and already marked in the file,
      // so it is not repeated here as a fault on every other count. That is
      // a rule about MONEY: `includeEnded` opts out the one scenario that
      // decides no figure. See derivable-dates above.
      if (!scenario.includeEnded && isPeriodEnded(r)) continue;
      if (!scenario.hit(r, { month, unanswered })) continue;
      const g = r.group_name || '(no group)';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(r);
    }

    for (const [group, hits] of byGroup) {
      const fix = scenario.fix?.({ month });
      out.push({
        kind: scenario.kind,
        severity: scenario.severity,
        group,
        count: hits.length,
        ids: hits.map((r) => r.id).filter((id) => id != null),
        text: scenario.text(hits.length, { monthLabel }),
        // A bulk fix, or the field the panel should edit per row.
        fix: fix ? { label: fix.label(monthLabel), field: fix.field, value: fix.value, wholePerson: Boolean(fix.wholePerson) } : null,
        field: scenario.field ?? null,
        input: scenario.input ?? null,
        // Enough to draw a row without a second request.
        rows: scenario.field
          ? hits.map((r) => ({
            id: r.id,
            personName: r.person_name,
            company: r.company,
            roleLabel: r.role_label,
            // A dates row carries the whole patch it is proposing, not one
            // value, because filling a missing appointment fills two more
            // with it. `suggest` is what an Accept sends back verbatim.
            ...(scenario.input === 'dates'
              ? { suggest: suggestDates(r), value: null }
              : { value: r[COLUMN_FOR_FIELD[scenario.field]] ?? null }),
          }))
          : [],
      });
    }
  }

  // Warnings before facts, then the biggest group first: the panel is read
  // top down and the expensive one should not be under a note.
  const rank = (w) => (w.severity === 'warning' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.count - a.count);
}

// Only the fields a scenario can edit, so the panel can show the current
// value beside each row. Not the repo's full map: this is a read, and a
// short list is one that cannot accidentally expose a column.
const COLUMN_FOR_FIELD = {
  monthlyAmount: 'monthly_amount',
  accountNumber: 'account_number',
  presetOn: 'preset_on',
  paymentStartOn: 'payment_start_on',
};

module.exports = { exportWarnings };
