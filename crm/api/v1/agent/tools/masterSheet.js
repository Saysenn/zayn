const { randomUUID } = require('node:crypto');
const repo = require('../../repos/masterSheetRows.repo');

// ONE definition of how far ahead "soon" reaches: the repo writes the SQL,
// this file says it out loud. Two numbers here would disagree in the reply.
const { ENDING_SOON_MONTHS } = repo;
const { personIdOf, parseRole, statusFor } = require('../../masterSheet/identity');
const {
  isForMonth, currentMonth, monthOf, currentDay,
} = require('../../shared/presetMonth.helper');
const {
  farOffMonth, monthsFromNow, monthForRead, monthNamed,
  monthsInQuestion,
} = require('../../shared/guessedYear.helper');
const { isOwedThisMonth, paymentStartState, START_STATE } = require('../../shared/owedThisMonth.helper');
// A day and a month as words, spelled out. One definition for every tool.
const { dayText, monthText } = require('../../shared/dayText.helper');
// "The month this is about" is defined once, in the guard that reads her
// replies. A write asked for one month must not land on another.
const { forMonthsIn, monthNumberOf, MONTHS: MONTH_WORDS } = require('../checkMonths');
// Which field actually tells one person's deals apart. Its own file, like
// resolvePerson: closure asks the same question and must not import this one.
const { whatSeparates, dealsWhere } = require('./whichDeal');
// READ THE REQUEST BEFORE ACTING ON IT. The order, and every question it
// asks when something is genuinely unclear, lives there and nowhere else.
const { pickDeal, scopeArgs, readRequest } = require('../resolveRequest');
// Every discrepancy on the sheet, grouped by what it costs. Pure: rows in,
// findings out, so each check is testable without a database.
const { sheetCheck } = require('../../shared/sheetCheck.helper');
// ONE BOOLEAN, read in code. Not a table she can reach: the setting decides
// how the exports total, and a figure she quotes has to be the same figure.
const settingsRepo = require('../../repos/settings.repo');
// The EXPORT'S own column sets. A second list here would be a second
// answer to "what does a bank run need", and the two would drift.
const { SEND } = require('../../masterSheet/buildPayoutSheet');
const { dealKey } = require('../../masterSheet/dealKey');
const peopleRepo = require('../../repos/people.repo');
const { isProfileRateField } = require('../../shared/profileRateLog.helper');
const { COMPANY_LOGGED_FIELD } = require('../../shared/companyFieldLog.helper');
const { asksUndo, undoSentence, USE_UNDO } = require('../undoIntent');
const companiesRepo = require('../../repos/companies.repo');
const { broadcast } = require('../../sockets/index');
const { SENTINELS } = require('../../masterSheet/canonical');
const { recallConversations } = require('./recall');
const { showPastConversation, deletePastConversations } = require('./conversations');
const { recomputePayable } = require('../../shared/recomputePayable.helper');
// The month's own arithmetic, so her confirm names the figure the switch
// will add rather than describing it. Never a second formula here.
const { payableFromDays, daysInMonthOf } = require('../../calculator/computePayable');
const {
  SPECIAL_CASE_SWITCH, SPECIAL_CASE_LABEL, quotedPhrases,
} = require('../../shared/specialCase');
// The chain's first link, so the explanation carries the real number.
const { PAYMENT_START_OFFSET_DAYS } = require('../../shared/fromAppointment.helper');
const {
  amountWithRates, ratesFor, stackedRates, partsOf, MAX_PERCENT, RATE_DIRECTIONS,
} = require('../../shared/rates.helper');
const { ratedRows } = require('../../shared/ratedRows.helper');
// Two decimals always. One definition, shared: see shared/money.helper.js.
// Aliased: `money(row)` below is a different thing, the card's headline.
const { money: amount2dp } = require('../../shared/money.helper');
const { periodFor, PERIOD, PERIOD_LABEL } = require('../../shared/paymentPeriod.helper');
const {
  resolvePerson, personKey, fold, peopleIn, saidFor, personMentionedIn, within,
} = require('./resolvePerson');
const { exportSheet } = require('./exportSheet');
const { confirmFirst } = require('./confirmFirst');
const { applyCompanyStatus, wouldStop } = require('../../shared/companyStatus.helper');
// "Add 3%" written as "set to 3" took 160 AED out of a month in silence.
// The confirm names the LEVEL, the FROM and the TO. See rateChange.js.
const {
  settleRates, RATE_FIELDS, rateVerdict, overwroteAnAmount,
} = require('../rateChange');
// The two rate fields, from the file that defines them. A third list of
// them here is how "which of these is a rate" ends up answered twice.
const RATE_FIELD_KEYS = new Set(Object.keys(RATE_FIELDS));
// The same two plus their increments, as arguments a call can carry.
const RATE_ARG_KEYS = [...RATE_FIELD_KEYS].flatMap((k) => [k, `${k}Delta`]);
// A question about a rate, and one that asks to SEE the deal as well.
const ASKS_RATE = /\b(?:fees?|add[\s-]?ons?|rates?|percent(?:age)?s?)\b|\d\s*%/i;
const WANTS_CARD = /\b(?:show|details?|cards?|open|everything)\b/i;
// She asked which field, was answered with a list of DEALS, and filled the
// unanswered half in herself. See bulkIntent.js.
const { fieldNotNamed, endingNotSwitch, scopeMissesNamed, alreadySaid } = require('../bulkIntent');
// A card is an answer, not a way of asking which deal they meant.
const { isSetInstruction, isSetInstructionRecent } = require('../setIntent');
// The deal's own status, the pair read by priority. She may READ it; the
// write stays a click. See its banner in shared/dealStatus.helper.js.
const {
  DEAL_STATUS_VALUES, DEAL_STATUS_LABEL, dealStatusOf,
} = require('../../shared/dealStatus.helper');
const { notAPerson } = require('./notAPerson');
const { answerEach, listAsked, perGroup } = require('./answerEach');
const { compareMonths } = require('./monthHistory');
const { historicalBreakdown } = require('./historicalBreakdown');
const { backupStatus } = require('./backupStatus');
const {
  notAGroup, notACompany, resolveDealScope, splitTargetScope, groupsHeardIn,
} = require('./notAGroup');

// `findAll` answers `{ rows, total }`. Written defensively because a COUNT
// that throws would take the confirm gate with it, and a gate that fails
// open is worse than no gate.
const countOf = (r) => r?.total ?? r?.rows?.length ?? (Array.isArray(r) ? r.length : 0);
// Live rates and the conversion, shared with the export.
const fxRates = require('../../shared/fxRates.helper');
const {
  totalInUsd, AED_PER_USD, codeFor, normalizeRates,
} = require('../../shared/toUsd.helper');
// SHARED WITH THE WORKBOOK BUILDER, never a copy: what she reads out and
// what the exported tab prints are the same table.
const { activeCompanies } = require('../../masterSheet/groupTables');
const concernsRepo = require('../../repos/concerns.repo');
const snapshotsRepo = require('../../repos/monthSnapshots.repo');
// The window the dashboard's Recent Changes panel uses. ONE definition, or
// "nothing in 24 hours" keeps contradicting five entries on screen.
const { RECENT_CHANGE_HOURS } = require('../../dashboard/buildDashboard');

// A company's own detail, which lives on tb_companies.
const COMPANY_FIELD = /\b(?:tier|old group|status|company notes?|liquidation total|settlement)\b/i;
// The ones that live nowhere else: a deal has a status and notes, but none of these.
const COMPANY_ONLY_FIELD = /\b(?:tier|old group|liquidation total|settlement)\b/i;
// What the admin SAYS, to the logged company field it means. Status is not logged:
// closing is undone by reopening.
const COMPANY_UNDO_WORDS = [
  [/\btier\b/i, 'companyTier'],
  [/\bold group\b/i, 'companyOldGroup'],
  [/\bnotes?\b/i, 'companyNotes'],
  [/\b(?:liquidation total|settlement)\b/i, 'companyLiquidationTotal'],
];

// An instruction to delete a whole PERSON or COMPANY, which nothing in the CRM does.
const DELETES_WHOLE = /\b(?:delete|erase|remove)\b[^.?!]*\b(?:person|people|company|companies|profile)\b/i;

// A RATE IN THE CHANGE LOG READS AS A RATE: "fee: 0 -> 3" left her "3%" matching
// nothing a tool said, and the rate guard sent her off to answer rates. 2026-09-28.
const PERCENT_FIELD = /percent/i;
const changeValue = (field, value) => {
  if (value == null || value === '') return 'blank';
  return PERCENT_FIELD.test(field) && Number.isFinite(Number(value)) ? `${value}%` : value;
};

// A saved month, for the rate stored with it.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// The question shapes, shared with the guards that check this tool's work.
// `asksComparison` opens the tunnel to compare_months even when the model
// supplied one month or none: answering a comparison a month at a time is
// what produced "did we earn more than last month" answered with September
// alone. Same list `checkQuestion` uses to decide the answer was wrong, or
// the two disagree about what a comparison is.
const {
  asksComparison, asksCombined, asksToConvert, asksRateCheck,
} = require('../askShapes');
// They named a field, so the card's own labels answer it. See fieldAsked.js.
const { fieldsAsked, fieldAnswer } = require('../fieldAsked');

/**
 * What the polishing agent can actually do to tb_mastersheet.
 *
 * Same shape as whatbot's own tools/ (agent/toolRunner.js's contract:
 * `{ name, description, parameters, handler }`), reimplemented here rather
 * than shared — separate deployments, separate processes, never a shared
 * import (root CLAUDE.md).
 *
 * The rule the boss actually asked for: never guess, ask instead. That's
 * enforced by SHAPE, not by hoping the model behaves — search_rows returns
 * every candidate rather than "the best match," so when there's more than
 * one the model has no single row to act on and has to ask which one. It's
 * structurally unable to silently pick.
 */

function summarizeRow(r) {
  return {
    id: r.id,
    personName: r.person_name,
    roleLabel: r.role_label,
    groupName: r.group_name,
    company: r.company,
    payableAmount: r.payable_amount,
    currency: r.currency,
    status: r.status,
    // THE DEAL'S OWN RATES. Dropped here, she could not answer "what is
    // Gloria on for this company" from any tool that returns rows.
    addonPercent: Number(r.addon_percent) || 0,
    feePercent: Number(r.fee_percent) || 0,
    paymentMethod: r.payment_method,
  };
}

// Every column worth showing a human, in the order the printed sheet
// reads — id/sync_key/person_id are internal identity, not shown.
const DETAIL_FIELDS = [
  ['group_name', 'group'], ['role_label', 'role'], ['person_name', 'name'],
  ['company', 'company'], ['assigned_on', 'appointment date'], ['payment_start_on', 'payment start date'],
  ['preset_on', 'preset date'], ['end_on', 'end date'], ['payable_days', 'payable days'],
  /**
   * ===============================
   * * SPECIAL CASE, AND IT WAS ON THE CARD AND NOT IN HER FACTS
   * ===============================
   * Live transcript 2026-09-24: asked "is this Mayah deal a special case"
   * she re-ran the tool and said "the full details are on screen". The
   * CARD said "Special case: Yes" the whole time; this list, which is what
   * the model actually answers from, did not carry the column at all.
   *
   * The card is rendered for the admin. Anything she has to SAY has to be
   * in here, or she is being asked to read her own UI output.
   *
   * THE LABEL EXPLAINS IT, because "special case: true" is a column name
   * and not an answer.
   */
  ['special_case_deal', 'special case (this month pays it although the payment start says nothing is owed)'],
  ['payment_method', 'payment method'], ['monthly_amount', 'monthly amount'], ['payable_amount', 'payable amount'],
  ['currency', 'currency'], ['location', 'location'], ['door_number', 'door number'],
  ['postcode', 'postcode'], ['accepting_postals', 'accepting postals'], ['phone', 'phone'],
  ['label', 'label'], ['should_be_paid', 'should be paid (sheet)'], ['paid', 'paid (sheet)'],
  ['notes', 'notes'], ['bank_details', 'bank details'], ['account_number', 'account number'],
  // payment_period, not the stored `status`: same reason as the card.
  ['sort_code', 'sort code'], ['payment_period', 'payment period'],
  /**
   * ===============================
   * * BOTH LEVELS, because they STACK
   * ===============================
   * Asked whether "Gloria difference" had a percentage she said no, then
   * said yes when pushed. Both answers came off the same row: the DEAL's
   * add on is 0 and the PERSON's is 5, and only the deal's was ever in
   * front of her. She was not guessing, she was answering with half of it.
   *
   * The repo already carries the person's two (a subselect, so a cell can
   * warn that the pair stack). Showing only one level is what made a
   * complete answer impossible.
   */
  ['addon_percent', 'add on % (this deal, ADDED)'], ['fee_percent', 'fee % (this deal, DEDUCTED)'],
  ['person_addon_percent', 'add on % (the PERSON, ADDED, stacks with the deal one above)'],
  ['person_fee_percent', 'fee % (the PERSON, DEDUCTED, stacks with the deal one above)'],
  ['payment_outcome', 'payment outcome (whatsapp confirmation)'], ['payment_replied_at', 'confirmed at'],
  ['override_should_be_paid', 'should be paid (admin override)'], ['override_paid', 'paid (admin override)'],
  ['override_paid_at', 'admin marked paid at'],
  ['source', 'source'],
];

// pg hands `date` columns back as Date objects, and stringifying one gives
// "Tue Dec 31 2024 00:00:00 GMT-0800 (Pacific Standard Time)" — a wall of
// timezone detail on a column that stores no time at all, which then gets
// read back to the admin verbatim. Local components, not toISOString(),
// for the same reason as toAgentRow.js: UTC conversion can roll a
// date-only value back a day.
function formatValue(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '(invalid date)';
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${v.getFullYear()}-${m}-${d}`;
  }
  return String(v);
}

// A preset of null is NOT a gap: those rows are owed every month. Said in
// words, because "(not set)" reads as missing data.
// A month she may ask for. Anything else is dropped rather than guessed at.
const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;
const isMonth = (v) => YYYY_MM.test(v);

// Kept as its own name so the tests read as what they pin. `listAsked` is
// the shared cleaner; this is "the months a total was asked for".
const monthsAsked = (args, now = currentMonth()) => {
  if (args?.answeredPlural === 'months') return [];
  const said = monthsInQuestion(args?.said, now);
  return said.length > 1 ? said : listAsked(args?.months, isMonth);
};

function presetMonthName(v) {
  if (!v) return 'every month (no preset on this row)';
  // A 'YYYY-MM-DD' parses as UTC midnight, so it is read back in UTC: any
  // other zone names the month either side of it.
  const d = v instanceof Date ? v : new Date(String(v).slice(0, 10));
  if (Number.isNaN(d.getTime())) return 'unclear, the preset cell does not read as a date';
  return d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * THE SHEET'S SENTINELS, SAID AS WHAT THEY MEAN.
 *
 * These are deliberate values the boss's file writes in place of an
 * answer, canonicalised on upload and offered as options in the row
 * editor, which reads "Will never be bank" back to set its banking toggle.
 * Every other surface already understands them. Diane did not, and read
 * "account number: Will never be bank" back as though it were an account
 * number.
 *
 * The list is canonical.js's, not a second copy of it. Any sentinel
 * without a phrase here still reads back verbatim, which is correct for
 * the ones that already read as English ("In person meet", "Ongoing").
 *
 * Translated on DISPLAY only. Nothing is stripped or rewritten: the stored
 * value is what the toggle depends on.
 */
const NEVER_BANK = SENTINELS.find((s) => s === 'Will never be bank');
const INTERNAL = SENTINELS.find((s) => s === 'Handled internally');

const SENTINEL_SAYS = {
  [NEVER_BANK]: 'no bank details on file',
  [INTERNAL]: 'handled internally, not held here',
  'Not applicable': 'not applicable to this row',
};

// "Will never be bank" lands in all three banking columns at once, so it
// is said once on the bank line and these two go quiet rather than
// repeating the same sentence three times.
const QUIET_WHEN_NEVER_BANK = new Set(['account_number', 'sort_code']);

function readable(col, value) {
  if (value === NEVER_BANK && QUIET_WHEN_NEVER_BANK.has(col)) return null;
  return SENTINEL_SAYS[value] ?? formatValue(value);
}

// The three banking columns, taken from the payout sheet's own bank set so
// there is no fourth list of them. A SENTINEL IS NOT A DETAIL: "Will never
// be bank" is the sheet saying there is nothing to pay into.
const BANK_COLUMNS = SEND.bank.filter((c) => ['bank_details', 'account_number', 'sort_code'].includes(c));

function hasBankDetails(row) {
  return BANK_COLUMNS.some((col) => {
    const value = String(row?.[col] ?? '').trim();
    return value !== '' && !SENTINELS.includes(value);
  });
}

function formatRowDetails(r) {
  // EVERY field, including the empty ones. This used to filter blanks out,
  // which made a null column indistinguishable from one that was never
  // fetched — the admin asked for Gloria's details, saw no "end date"
  // line, and reasonably concluded Diane hadn't looked at it. An empty
  // end date is a fact about the row (it's ongoing), not an absence of
  // data, and it has to be shown as one.
  const lines = DETAIL_FIELDS.flatMap(([col, label]) => {
    const value = r[col];
    const empty = value === null || value === undefined || value === '';
    if (empty) return [`  ${label}: (not set)`];
    const said = readable(col, value);
    return said === null ? [] : [`  ${label}: ${said}`];
  });
  // The preset date already sits in the list above as 2026-08-01, and she
  // was quoting the boss a figure "for the preset month" rather than
  // translating it. Worked out here so the month has a name before she
  // ever has to say one.
  lines.push(`  marked for: ${presetMonthName(r.preset_on)}`);
  return `#${r.id} ${r.person_name}\n${lines.join('\n')}`;
}

/**
 * A DEAL AS A CARD, not thirty-one lines of `label: value`.
 *
 * The flat block treated every column as equally important and printed
 * "(not set)" a dozen times, so the thing somebody actually came to check
 * — the money, and whether it is paid — was buried among door numbers and
 * sort codes. Nothing about it said "this is a deal".
 *
 * Grouped the way the question is usually asked: who, then what they are
 * owed, then whether it has gone out. Empty fields are counted rather
 * than listed, because "12 not set" is one fact and twelve blank rows are
 * twelve.
 *
 * `editField` is the camelCase name update_master_sheet_row takes, carried
 * so the browser can offer a cell as editable without a second mapping
 * that could drift from this one.
 */
function money(row) {
  const amount = row.payable_amount ?? row.monthly_amount;
  if (amount === null || amount === undefined) return null;
  return `${row.currency || 'GBP'} ${Number(amount).toLocaleString('en-GB')}`;
}

/** Display-only name casing. Stored sheet values remain untouched. */
function displayPersonName(value) {
  return String(value ?? '').trim().replace(/(^|[\s-])([a-z])/g, (_, gap, letter) => (
    `${gap}${letter.toUpperCase()}`
  ));
}

/** Positive payable deals are scanned first; zero-value deals explain the tail. */
function sortDealsForDisplay(rows) {
  return rows.map((row) => ({ row }))
    .sort((a, b) => {
      const aZero = !(Number(a.row.payable_amount) > 0);
      const bZero = !(Number(b.row.payable_amount) > 0);
      return Number(aZero) - Number(bZero)
        || String(a.row.company ?? '').localeCompare(String(b.row.company ?? ''), 'en', { sensitivity: 'base' })
        || String(a.row.group_name ?? '').localeCompare(String(b.row.group_name ?? ''), 'en', { sensitivity: 'base' })
        || String(a.row.role_label ?? '').localeCompare(String(b.row.role_label ?? ''), 'en', { sensitivity: 'base' })
        || Number(a.row.id ?? 0) - Number(b.row.id ?? 0);
    })
    .map(({ row }) => row);
}

function mentionedDealValue(rows, said, field) {
  const values = [...new Set(rows.map((row) => String(row[field] ?? '').trim()).filter(Boolean))]
    .sort((a, b) => fold(b).length - fold(a).length);
  const whole = values.find((value) => personMentionedIn(said, value));
  if (whole || field !== 'company') return whole ?? null;
  /**
   * A COMPANY BY ONE OF ITS WORDS. "drew on monument" named Monument
   * Marketing, and with no whole name in the sentence the change asked
   * which of his five deals. A word of four letters or more, said whole,
   * that reaches exactly ONE of this person's companies, is that company.
   * Two or more is still a question. 2026-09-30.
   */
  // NEVER A WORD OF THEIR OWN NAME: "which company is peter gibson at"
  // narrowed to "Peter KP", one of his three. Clone 2026-10-05.
  const ownName = new Set(rows.flatMap((row) => String(row.person_name ?? '').toLowerCase().split(/[^a-z0-9]+/)));
  const heard = new Set(String(said ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !ownName.has(w)));
  const hits = values.filter((value) => value.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 4 && heard.has(w)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * ===============================
 * * A GROUP NAME SENT AS THE COMPANY
 * ===============================
 * Live 2026-09-24. Zayn holds two deals, both on the company "Workforce",
 * one in INDIGO and one in MILKMAN.
 *
 *   admin  "on Zayn's deal on milkman, at 3%"
 *   Diane  targetCompany: "MILKMAN"
 *          "There is no deal for Zayn with the company named MILKMAN
 *           exactly. There might be a slight difference in spelling."
 *
 * There is no spelling difference. MILKMAN is the GROUP, and it is how
 * the admin names that deal, because both of Zayn's companies are called
 * the same thing. Asked twice, she sent it twice and never once looked at
 * the group column.
 *
 * HER PROMPT ALREADY SAYS to check the group name before the company.
 * That is the sentence being ignored, so the resolution happens here.
 *
 * ONLY AMONG THE ROWS THIS PERSON HOLDS, so it can never reach a company
 * belonging to somebody else. AND ONLY WHEN IT IS UNAMBIGUOUS: a word
 * that matches a company AND a group on their own deals is a question,
 * which is `resolveDealScope`'s rule one level up.
 */
const DEAL_TARGET_FIELDS = ['company', 'group_name', 'role_label'];

function rehome(rows, field, value) {
  if (rows.some((row) => fold(row[field]) === fold(value))) return field;
  const elsewhere = DEAL_TARGET_FIELDS
    .filter((other) => other !== field)
    .filter((other) => rows.some((row) => fold(row[other]) === fold(value)));
  // Nowhere, or more than one place, and the caller reports it as missing.
  return elsewhere.length === 1 ? elsewhere[0] : field;
}

/**
 * What this person's deals ARE, for when the word they used matched none.
 *
 * "Zayn has no deal matching MILKMAN" left her asking about spelling, and
 * there was no spelling mistake. Naming their own deals turns a dead end
 * into a choice they can answer in one word. Live 2026-09-24.
 */
function dealsTheyHold(rows) {
  const each = (rows ?? []).map(
    (r) => [r.company, r.group_name, r.role_label].filter(Boolean).join(' · '),
  );
  return [...new Set(each)].join('; ');
}

function narrowPersonDeals(rows, args = {}) {
  const targets = [
    ['company', args.targetCompany ?? args.company ?? mentionedDealValue(rows, args.said, 'company')],
    ['group_name', args.targetGroup ?? mentionedDealValue(rows, args.said, 'group_name')],
    ['role_label', args.targetRole ?? args.roleLabel ?? mentionedDealValue(rows, args.said, 'role_label')],
  ]
    .filter(([, value]) => String(value ?? '').trim())
    /**
     * HALF A NAME THEY SAID WHOLE. "delia - ironleaf" is the company
     * "Delia - Ironleaf"; she sent company "ironleaf" and it matched none
     * of Delia's deals. The full value they typed wins over her cut of it.
     */
    .map(([field, value]) => {
      if (rows.some((row) => fold(row[field]) === fold(value))) return [field, value];
      const whole = mentionedDealValue(rows, args.said, field);
      if (whole && fold(whole).includes(fold(value))) return [field, whole];
      /**
       * OR ONE WORD OF IT, checked against THEIR deals. A held change comes
       * back on "yes" with company "harbor" and a sentence that no longer
       * names it: the preview found Harbor Nine, the yes found nothing.
       * One of this person's values holding it as a word is that value.
       */
      const word = String(value ?? '').trim().toLowerCase();
      const holders = [...new Set(rows.map((row) => String(row[field] ?? '').trim()).filter(Boolean))]
        .filter((v) => word.length >= 3 && v.toLowerCase().split(/[^a-z0-9]+/).includes(word));
      return holders.length === 1 ? [field, holders[0]] : [field, value];
    })
    .map(([field, value]) => {
      const home = rehome(rows, field, value);
      if (rows.some((row) => fold(row[home]) === fold(value))) return [home, value];
      /**
       * A WORD OF A VALUE IN ANOTHER FIELD. Clone 2026-10-04: "the umbrella
       * one" came as roleLabel "Umbrella", matched no role, and Drew was
       * told he has no Umbrella deal: his company is Umbrella UK Holdings.
       * Exactly one of this person's values, in any field, holding it as a
       * whole word is that value.
       */
      const word = String(value ?? '').trim().toLowerCase();
      const hits = [];
      for (const other of DEAL_TARGET_FIELDS) {
        for (const v of new Set(rows.map((row) => String(row[other] ?? '').trim()).filter(Boolean))) {
          if (word.length >= 3 && v.toLowerCase().split(/[^a-z0-9]+/).includes(word)) hits.push([other, v]);
        }
      }
      if (hits.length === 1) return hits[0];
      /**
       * SEVERAL WORDS ACROSS FIELDS: "baker director" is the group and the
       * role of one deal, and matched neither field whole. Suite 2026-10-05.
       * Every word found on exactly one of their deals is that deal.
       */
      const words = word.split(/[^a-z0-9]+/).filter(Boolean);
      if (words.length > 1) {
        const covering = rows.filter((row) => {
          const own = DEAL_TARGET_FIELDS.map((f) => String(row[f] ?? '').toLowerCase()).join(' ').split(/[^a-z0-9]+/);
          return words.every((w) => own.includes(w));
        });
        if (covering.length === 1) return ['id', covering[0].id];
      }
      return [home, value];
    });
  if (targets.length === 0) return { rows, targeted: false, missing: null };

  const selected = rows.filter((row) => targets.every(([field, value]) => fold(row[field]) === fold(value)));
  return {
    rows: selected,
    targeted: true,
    missing: selected.length === 0 ? targets.map(([, value]) => value).join(', ') : null,
  };
}

/**
 * THE SUBTITLE NAMES WHAT ACTUALLY DIFFERS. It said "Choose a company" on
 * every list, and Zayn's two deals are both on Workforce: the instruction
 * asked for the one thing that could not tell them apart. 2026-09-29, and
 * the fourth time this shape has been found. See `whichDeal`.
 */
function dealList(rows, title) {
  const by = whatSeparates(rows);
  const subtitle = by ? `Choose a ${by} to open one deal` : 'Choose a deal to open it';
  return { title, subtitle, rows: rows.map(listRow) };
}

/**
 * @param {string[]} [options] the closed set this cell's value comes from.
 *   Any word in it NAMES the cell, so "is his company liquidating" reaches
 *   Company status without the word "status" being said. See fieldAsked.js.
 */
function cell(label, value, editField, input = 'text', col = null, options = null) {
  const empty = value === null || value === undefined || value === '';
  // `readable` returns null for the columns NEVER_BANK silences, which is
  // right when reading a row aloud and wrong on the card: an empty cell
  // there counts toward "N not set", and these are deliberately not held
  // rather than missing.
  const said = empty ? null : (readable(col, value) ?? 'not held');
  return {
    label, value: said, editField, input, ...(options ? { options } : {}),
  };
}

/**
 * ===============================
 * * A CARD OF WHAT WAS ASKED FOR, not of everything
 * ===============================
 * `only` is a list of db columns, and the sets come from the EXPORT
 * (`buildPayoutSheet`'s SEND), never a fourth list typed here: what a bank
 * run needs is already answered once.
 *
 * The name is the card's own title, so `REQUIRED` holds by construction.
 * An unknown or empty set shows EVERYTHING: a card quietly missing the
 * field somebody asked about is worse than a long one.
 */
const camel = (col) => col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function narrowCard(card, only) {
  if (!only || only.length === 0) return card;
  const wanted = new Set(only.map(camel));
  const groups = card.groups
    .map((g) => ({ ...g, cells: g.cells.filter((c) => wanted.has(c.editField)) }))
    .filter((g) => g.cells.length > 0);
  // Nothing matched, so the set does not describe this row. Show the lot
  // rather than an empty card.
  if (groups.length === 0) return card;
  return {
    ...card,
    groups,
    switches: wanted.has('overrideShouldBePaid') || wanted.has('shouldBePaid') ? card.switches : [],
  };
}

/**
 * WHY a row is or is not in this month's figure, in words.
 *
 * The same two facts the card's own pill is drawn from, so it cannot
 * disagree with it: the derived payment period, and whether the row
 * actually owes anything. A row can be ACTIVE and owe nothing, which is
 * exactly the case that had no explanation: 0 payable days on 500 a month.
 *
 * `payment_period` is absent on a read that did not ask for it, and a
 * guessed answer about money is worse than an empty cell.
 */
function payableReason(r) {
  const period = r.payment_period;
  if (!period) return null;
  if (period !== PERIOD.ACTIVE) return `No, ${PERIOD_LABEL[period] ?? period}`;
  // WHY IT COUNTS, when the dates say it should not. A bare "Yes" beside a
  // payment start in the future reads as a bug in the card. Migration 064.
  if (Number(r.payable_amount) > 0) {
    return r.special_case_deal ? 'Yes, set to special case by hand' : 'Yes';
  }
  return Number(r.payable_days) === 0
    ? 'No, payable days is 0'
    : 'No, the payable amount is 0';
}

/**
 * ONE PERSON OR A LIST, never both and never neither.
 *
 * DUPLICATES COLLAPSE. "Nathan and Nathan" is one act on one person, and
 * writing him twice would apply an increment twice.
 *
 * @returns {{ names: string[] }|{ error: string }}
 */
function namesAsked(person, people) {
  const many = (Array.isArray(people) ? people : [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  const one = String(person ?? '').trim();
  if (one && many.length > 0) {
    return {
      error: 'You sent both `person` and `people`. Send ONE of them: `people` for two or more, '
        + '`person` for one. Nothing has been changed.',
    };
  }
  const names = one ? [one] : many;
  if (names.length === 0) {
    return { error: 'No name came through. Ask WHO they mean and change nothing.' };
  }
  const seen = new Set();
  return {
    names: names.filter((n) => {
      const key = fold(n);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

/**
 * A stacked rate, and its two halves whenever both carry one.
 *
 * The total alone beside a deal somebody set to 3 reads as a bug in the
 * card, so the row that HAS two levels says so. The 90 rows with one keep
 * a bare number.
 */
function stackedPercent(total, person, deal) {
  const both = (Number(person) || 0) > 0 && (Number(deal) || 0) > 0;
  return both ? `${total} (person ${Number(person)} + deal ${Number(deal)})` : total;
}

function dealCard(r) {
  const rate = stackedRates(r);
  const groups = [
    {
      title: 'The deal',
      cells: [
        cell('Group', r.group_name, 'groupName'),
        cell('Role', r.role_label, 'roleLabel'),
        cell('Company', r.company, 'company'),
        // THE COMPANY'S status, not the deal's, so "is his company
        // liquidating" is answerable from the person. Read only: it
        // belongs to the company, and update_company is where it changes.
        // Liquidation is STILL PAYING and the word must never read as an
        // ending, which is why the value is the repo's own, not a label.
        cell(
          'Company status', r.company_status ? String(r.company_status).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : r.company_status, null, 'text', null,
          // The repo's own closed set, so a new status is answerable the
          // day it is added rather than when somebody remembers this line.
          Object.values(companiesRepo.COMPANY_STATUS),
        ),
        // HIS WORD OR THE TICK, resolved by the one helper. Read only:
        // setting it writes two columns and can clear an end date, so it
        // goes through the tool that does both. It sits here rather than
        // under Money because it says what the DEAL is, not what it pays.
        cell('Deal status', DEAL_STATUS_LABEL[dealStatusOf(r)], null),
        cell('Label', r.label, 'label'),
        // Where the row came from. Read only: it is a fact about the write,
        // not a field anybody sets.
        cell('Source', r.source, null),
        // The DERIVED period, the one the pages show. `status` is stored,
        // written only at upload, and goes stale the day an end date
        // passes, so a card reading it would quietly disagree with the
        // Master Sheet. Editing still writes the stored column, which is
        // what a hand-set value overriding the derivation means.
        // Said, not stored. 'not_started' raw reads as a column name.
        // Derived, so the label is read only: `status` left ROW_FIELDS.
        cell('Status', PERIOD_LABEL[r.payment_period] ?? r.payment_period, 'status'),
      ],
    },
    {
      title: 'Money',
      cells: [
        cell('Monthly', r.monthly_amount, 'monthlyAmount', 'number'),
        cell('Payable', r.payable_amount, 'payableAmount', 'number'),
        cell('Payable days', r.payable_days, 'payableDays', 'number'),
        /**
         * ===============================
         * * SOMEBODY SAID THIS MONTH PAYS IT. Migration 064.
         * ===============================
         * NOT EDITABLE FROM THE CARD, though she may set it through the
         * tool. A card cell edit is one click with no confirm, and this
         * decides what a month OWES: it goes through
         * `confirmSpecialCaseDeal` or it does not happen.
         */
        cell(SPECIAL_CASE_LABEL, r.special_case_deal ? 'Yes' : 'No', null),
        cell('Currency', r.currency, 'currency'),
        cell('Method', r.payment_method, 'paymentMethod'),
        /**
         * ===============================
         * * AND WHY, not just whether
         * ===============================
         * "Why is Richard not payable this month" was answered "monthly
         * 500, payable 0", which is true and is not the reason. The reason
         * was payable days being 0, and nothing on the card said it.
         *
         * READ ONLY and DERIVED: it is the same pair the pill at the top of
         * the card is drawn from, said in words. Nothing new is computed
         * here, so it cannot disagree with the pill.
         */
        cell('Payable this month', payableReason(r), null),
        /**
         * ===============================
         * * BOTH LEVELS, ALREADY ADDED UP
         * ===============================
         * An add on is ADDED and a fee is DEDUCTED after it, and each sits
         * on the DEAL and on the PERSON at the same time. The card printed
         * all four numbers and left the reader to do the sum that every
         * other consumer gets from `rates.helper`: 5 on the person and 3 on
         * the deal is 8 on this row, and the card said 5 and 3.
         *
         * READ ONLY, because the figure is derived. Writing 8 back would
         * put the person's 5 on the deal as well; `update_deal` and
         * `update_person` still set their own halves.
         */
        cell('Add on %', stackedPercent(rate.addon, r.person_addon_percent, r.addon_percent), null),
        cell('Fee %', stackedPercent(rate.fee, r.person_fee_percent, r.fee_percent), null),
      ],
    },
    /**
     * ===============================
     * * WHATBOT'S OWN COLUMNS, and they are read only here
     * ===============================
     * The outcome is what the person said on WhatsApp, and the switches
     * above are the admin's decision. Two different facts, so they are not
     * merged, and nothing in the CRM writes these.
     */
    {
      title: 'Payment',
      cells: [
        cell('Outcome', r.payment_outcome, null),
        cell('Confirmed at', r.payment_replied_at, null, 'date'),
      ],
    },
    {
      title: 'Dates',
      cells: [
        cell('Appointment', r.assigned_on, 'assignedOn', 'date'),
        cell('Payment start', r.payment_start_on, 'paymentStartOn', 'date'),
        cell('Preset', r.preset_on, 'presetOn', 'date'),
        cell('End', r.end_on, 'endOn', 'date'),
      ],
    },
    {
      title: 'Contact and bank',
      cells: [
        cell('Phone', r.phone, 'phone', 'text', 'phone'),
        cell('Door number', r.door_number, 'doorNumber'),
        cell('Postcode', r.postcode, 'postcode', 'text', 'postcode'),
        // "Yes / No / Handled Internally", as the sheet writes it. A
        // sentinel, so `readable` translates it rather than stripping it.
        cell('Accepting postals', r.accepting_postals, 'acceptingPostals'),
        cell('Location', r.location, 'location'),
        cell('Bank', r.bank_details, 'bankDetails', 'text', 'bank_details'),
        cell('Account', r.account_number, 'accountNumber', 'text', 'account_number'),
        cell('Sort code', r.sort_code, 'sortCode', 'text', 'sort_code'),
      ],
    },
  ];

  return {
    id: r.id,
    name: displayPersonName(r.person_name || '(no handler)'),
    subtitle: [r.company, r.group_name, r.role_label].filter(Boolean).join(' | '),
    headline: money(r),
    // `payment_period` ONLY, never the stored `status` behind it. With the
    // override gone, paymentPeriodSql computes exactly what
    // isOwedThisMonth answers, setting included, so ACTIVE here is the same
    // fact the total uses. The `?? r.status` that used to sit here was the
    // stale upload value, which is how a card said "not payable this month"
    // over money that was still in the figure. Every repo read carries
    // payment_period; without it the pill is left off rather than guessed,
    // and DealCard already only draws it for a boolean.
    payableThisMonth: r.payment_period
      ? r.payment_period === PERIOD.ACTIVE && Number(r.payable_amount) > 0
      : undefined,
    // The two SWITCHES, called out on their own. They are the answer to
    // "has she been paid", which is the commonest reason to open a row,
    // and as `true`/`false` among thirty other rows they read as noise.
    // `fallback` is what an undecided NULL resolves to, and it is the same
    // pair the repo's COALESCE uses. Carried from here so the card renders
    // the faded default the CRM's own pages show, rather than inventing a
    // visible "not set" that exists nowhere else.
    switches: [
      {
        label: 'Should be paid',
        value: r.override_should_be_paid,
        editField: 'overrideShouldBePaid',
        fallback: true,
      },
      { label: 'Paid', value: r.override_paid, editField: 'overridePaid', fallback: false },
    ],
    // The sheet's own words, kept apart from the switches above so the two
    // can never be mistaken for each other.
    sheetSays: [r.should_be_paid, r.paid].some(Boolean)
      ? { shouldBePaid: r.should_be_paid || null, paid: r.paid || null }
      : null,
    groups,
    notes: r.notes || null,
    needsReview: Boolean(r.needs_review),
    reviewReason: r.review_reason || null,
  };
}

const rowDetails = {
  name: 'get_master_sheet_row_details',
  description:
    'Get every column of one or more specific rows, by id, formatted for the admin to read and decide what (if anything) to change. Use this when asked for someone\'s "details", "info", "columns", or "data", as opposed to editing them. ALWAYS call find_and_show_details first to resolve each name to a row id, exactly the same way you would before an edit, if a name matches more than one row, list them and ask which one before calling this, never guess which row someone meant.',
  parameters: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'integer' }, description: 'Row ids, resolved via find_and_show_details first' },
      severalPeople: {
        type: 'boolean',
        description: 'Only when the admin asked about MORE THAN ONE PERSON on purpose. '
          + 'Leave it out otherwise: ids spanning several people is nearly always the wrong ids.',
      },
      expectedPeople: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required with severalPeople. The exact people the admin asked for, used to reject stale ids from another answer.',
      },
    },
    required: ['ids'],
  },
  async handler(args) {
    let rows = (await Promise.all(args.ids.map((id) => repo.findById(id)))).filter(Boolean);
    if (rows.length === 0) return { summary: 'None of those ids matched a row.' };
    /**
     * A COMPANY THEY NAMED NARROWS THE IDS. "show me his souracore deal" came
     * with three remembered ids, two of them other companies. When their
     * words name a company some rows carry, only those are shown. 2026-10-03.
     */
    const heard = String(args.said ?? '').toLowerCase();
    const onNamed = rows.filter((r) => r.company && heard.includes(String(r.company).toLowerCase()));
    if (onNamed.length > 0 && onNamed.length < rows.length) rows = onNamed;
    /**
     * AND A COMPANY NONE OF THE IDS CARRY is looked up for the same person:
     * the remembered ids missed the Souracore deal entirely, and she showed
     * his Social work first PR deal under "show me his souracore deal".
     */
    if (onNamed.length === 0) {
      const persons = [...new Set(rows.map((r) => r.person_name).filter(Boolean))];
      if (persons.length === 1) {
        const theirs = ((await repo.findAll({ q: persons[0], pageSize: 200 }).catch(() => null))?.rows ?? [])
          .filter((r) => r.person_name === persons[0] && r.company && heard.includes(String(r.company).toLowerCase()));
        if (theirs.length > 0) rows = theirs;
      }
    }

    /**
     * WHOSE ROWS THESE ACTUALLY ARE, said first.
     *
     * Ids are not sequential by person, and asking for ids "near" a found
     * one silently returns strangers: row 30 is Nicola, 28, 29 and 31 are
     * three other people, and that mistake once became a total of 3,700
     * against a real 2,900. Asking for several people at once is
     * legitimate, so this is not an error, but the names lead the summary
     * so a wrong id cannot pass unnoticed.
     */
    // KEYED ON person_id, the same key find_and_show_details uses. On the
    // name alone, two different people who share one would pass the guard,
    // which is the case it exists for.
    const people = new Map(rows.map((r) => [
      String(r.person_id ?? r.person_name ?? '').trim().toLowerCase(),
      String(r.person_name ?? '(no handler)').trim(),
    ]));
    const names = [...people.values()];

    /**
     * ===============================
     * * NO CARDS FOR IDS SHE DID NOT LOOK UP
     * ===============================
     * This used to WARN and return the cards anyway. She rendered them and
     * narrated three strangers as the person who had been asked about:
     * asked for Gloria, she passed Zayn's ids from two turns earlier and
     * called the result Gloria's deals.
     *
     * A warning in the summary is a prompt, and prompting is not a guard.
     * The cards are what reach the screen, so withholding them is the only
     * thing that actually stops it. Asking about several people at once is
     * legitimate, so it is a second call with `severalPeople`, never a
     * refusal: the same two-call shape as bulk_update_master_sheet.
     */
    const actualNames = [...new Set(names.map(fold))];
    const expectedNames = [...new Set((args.expectedPeople ?? []).map(fold).filter(Boolean))];
    const expectedMatch = expectedNames.length === actualNames.length
      && actualNames.every((name) => expectedNames.includes(name));

    if (names.length > 1 && (!args.severalPeople || !expectedMatch)) {
      return {
        summary: `THOSE IDS ARE ${names.length} DIFFERENT PEOPLE: ${names.join(', ')}. `
          + 'NOTHING HAS BEEN SHOWN. Almost always this means the ids are wrong, carried over '
          + 'from an earlier answer. Do NOT describe these rows and do NOT name them. '
          + 'Search by NAME again for the people the admin actually asked about. '
          + 'If they really did ask about several people, call this again with severalPeople true '
          + 'and expectedPeople containing every requested name.',
        rows: rows.map(summarizeRow),
      };
    }

    // WHOSE ROWS THESE ARE, said first, so her narration can be checked
    // against the cards beside it. Never add figures across people.
    const whose = names.length > 1
      ? `THESE ARE ${names.length} DIFFERENT PEOPLE: ${names.join(', ')}. Name them as such, `
        + 'and never add their figures together.\n\n'
      : '';

    // THE SENTENCE IS BUILT from the rows, never written over them. Left
    // to her, Nathan's Souracore card (payable GBP 474.19 this month) came
    // with "owed nothing for October 2026". 2026-10-03.
    const fieldOnly = askedFieldReply(rows, args.said, args.saidRecent);
    if (fieldOnly) {
      return { summary: `${fieldOnly} No card was drawn.`, rows: rows.map(summarizeRow), computedMonths: [], reply: fieldOnly, computedReply: true };
    }
    const owed = rows.length === 1
      ? ` ${Number(rows[0].payable_amount) > 0 && isOwedThisMonth(rows[0])
        ? `Payable this month: ${rows[0].currency || 'GBP'} ${Number(rows[0].payable_amount).toLocaleString('en-GB')}.`
        : 'Nothing is payable on it this month.'}`
      : '';
    return {
      summary: whose + cardSummary(rows),
      cards: rows.map(dealCard),
      rows: rows.map(summarizeRow),
      // Dates on detail cards are facts, not computed monthly totals.
      computedMonths: [],
      reply: names.length === 1
        ? `${displayPersonName(names[0])}: ${rows.map((r) => [r.company, r.group_name].filter(Boolean).join(' in ')).join('; ')}.${owed}`
        : detailsCardReply(rows),
      computedReply: true,
    };
  },
};

// One instruction, used by both the details tool and the combined
// find-and-show one below. Says "one line per field" explicitly because
// she was double-spacing every field, turning one person into 25 lines —
// the blank line is meant to separate PEOPLE, not fields.
/**
 * What she is told once the CARD is already on screen.
 *
 * The old instruction was "relay this block verbatim", because the block
 * WAS the answer. It is not any more: the browser is drawing it. So her
 * job changes from transcribing to saying the one thing worth hearing,
 * which is also the only part that gets spoken aloud.
 *
 * The values are still included. She has to be able to answer "is she
 * paid" without a second lookup, and she cannot read the card.
 */
function cardSummary(rows) {
  const facts = rows.map(formatRowDetails).join('\n\n');
  // ONE CARD PER DEAL, and one person often holds several. It said "a
  // card" whatever the count, which read as though the other three were
  // missing.
  const what = rows.length === 1
    ? 'The full details are ALREADY ON SCREEN as a card.'
    : `All ${rows.length} of their deals are ALREADY ON SCREEN, one card each.`;
  /**
   * ===============================
   * * ONE ROW'S AMOUNT IS NOT THE PERSON'S TOTAL
   * ===============================
   *
   * "Show me gloria" drew four cards at GBP 500 each and she said "Gloria
   * is owed 500 GBP for September 2026". She is owed 2,000. Nothing caught
   * it: 500 is a real figure off a real row, so `checkFigures` is happy,
   * and it is a FIGURE not a count, so `checkCounts` never looks.
   *
   * The line below teaching the shape ("owed 500 for August") did not
   * help. This tool adds nothing up on purpose, so with several rows it
   * has no total to give and must not let her invent one from a card.
   */
  const oneRow = rows.length === 1;
  const total = oneRow
    ? 'Name the month in words. "owed 500 for August", never "for the preset month".'
    : `THESE ARE ${rows.length} SEPARATE DEALS AND THIS TOOL DID NOT ADD THEM UP. Do NOT quote `
      + 'one card\'s amount as what they are owed, and do NOT add the cards up yourself. If they '
      + 'asked what this person is owed, call total_master_sheet and use ITS figure. Until then '
      + 'say how many deals they hold, not a number of pounds. Name any month in words.';

  /**
   * ===============================
   * * ANSWER FROM THE ROW. Do not dump it, and do not hedge about it.
   * ===============================
   *
   * This said "for your reference only, not to be repeated" and, two lines
   * above, "if they asked about a phone number, say THAT". A please-do-not
   * beside a here-it-is, so whether she named a value came down to the
   * roll: some turns she quoted the phone, some turns she would not.
   *
   * The inconsistency was the defect, never the phone number. There is one
   * admin, one credential, and every field here is already on the card in
   * front of them, on the master sheet page and in every export, so there
   * was nothing to withhold in the first place.
   *
   * What the rule is actually protecting is the CARD: thirty one lines of
   * `label: value` repeated underneath a card already showing all thirty
   * one. That part stays.
   */
  return `${what} Do NOT dump every field as text underneath it: the card already shows them `
    + 'all, so relisting them adds nothing.\n\n'
    + 'Say ONE short sentence answering THE QUESTION THEY ACTUALLY ASKED, and NAME THE VALUES '
    + 'that answer it. A date, a phone number, a bank detail, a role: if it is the answer, say '
    + 'it plainly. Do not fall back to the money every time, and do not hedge about what is on '
    + 'the row in front of you. Then stop. If they now tell you to change something on it, just '
    + `make that change.\n\n${total}\n\n`
    + `The row, to answer from:\n${facts}`;
}

/**
 * ===============================
 * * WHAT IS UNUSUAL ABOUT A ROW, IN WORDS
 * ===============================
 * Live transcript 2026-09-24: asked "is this a special deal" she showed
 * the card, said "the full details are on screen", and never answered.
 * Asked again she called the tool a second time and `notTwice` fired.
 *
 * The card is rendered for the ADMIN, who may not be looking at it. Her
 * reply has to carry the fact, so the flags a question is likely to be
 * ABOUT are said out loud rather than left on screen.
 *
 * ONLY WHAT IS TRUE, so an ordinary row's reply is exactly as it was and
 * the sentence never becomes a second card.
 */
function notableOf(row) {
  const out = [];
  if (row.special_case_deal) {
    const starts = dateInWords(row.payment_start_on);
    out.push(starts
      ? `a special case: ${presetMonthName(row.preset_on)} pays it although the payment start is ${starts}`
      : `a special case: ${presetMonthName(row.preset_on)} pays it although the dates say nothing is owed`);
  }
  if (row.stopped_on) out.push(`archived on ${dateInWords(row.stopped_on)}`);
  if (row.needs_review) out.push('flagged as needing review');
  return out;
}

/**
 * ===============================
 * * ONE DETAIL ASKED, ONE DETAIL SAID
 * ===============================
 * Live 2026-10-03: "what's nathan's phone number?" got "Nathan has 5 deals.
 * The full details are on screen." The number was on the card and never in
 * the answer. A question about one field is answered with that field.
 */
const ASKED_FIELDS = [
  [/\b(?:phone|mobile|number to call|contact number|phone number|(?:a|the|his|her|their) number for|(?:his|her|their) number)\b/i, 'phone', 'phone number'],
  [/\bpost ?code\b/i, 'postcode', 'postcode'],
  [/\b(?:location|where (?:is|are|does) \w+ (?:based|live))\b/i, 'location', 'location'],
  [/\b(?:account number|bank account)\b/i, 'account_number', 'account number'],
  [/\bsort code\b/i, 'sort_code', 'sort code'],
  [/\bbank details\b/i, 'bank_details', 'bank details'],
  [/\bpayment start\b/i, 'payment_start_on', 'payment start'],
  [/\bend date\b/i, 'end_on', 'end date'],
  // "what group is theo brandt in" was answered "the group name is not
  // specified" with the row in hand. 2026-10-03.
  [/\b(?:what|which) groups?\b/i, 'group_name', 'group'],
  [/\b(?:what|which) company\b|\bwhere does \w+(?: \w+)? work\b/i, 'company', 'company'],
  [/\b(?:what(?:'s| is)? (?:\w+(?: \w+)?'s )?role|what (?:does|do) \w+(?: \w+)? do|what (?:\w+ ){1,3}does(?! \w+ (?:get|earn|owe|make|cost)))\b/i, 'role_label', 'role'],
];
/**
 * ===============================
 * * A DEAL CARD ONLY WHEN THEY ASK TO SEE ONE
 * ===============================
 * His rule, 2026-10-03: "Diane shouldn't send deal cards unless
 * specifically asked." A question about somebody is answered in words; the
 * card is for "show me", "details", "pull up", "open", "the card".
 */
const ASKS_FOR_CARD = /\b(?:show(?: me)?|cards?|details?|full|pull (?:up|out)|open|display|view|see|look at|everything (?:on|about)|info(?:rmation)?|profile)\b/i;
const wantsCard = (said, saidRecent = '') => ASKS_FOR_CARD.test(String(said ?? ''))
  || (FOLLOW_UP_WORDS.test(String(said ?? '')) && ASKS_FOR_CARD.test(String(saidRecent ?? '')));
const FOLLOW_UP_WORDS = /^\s*(?:and|what about|how about|also)\b/i;

// In words, when no card is drawn: each deal on one line.
function dealsInWords(rows) {
  const names = [...new Set(rows.map((r) => displayPersonName(r.person_name)).filter(Boolean))];
  // THE ROLE TOO: "remind me what karin vole does" got the money and not the job.
  const line = (r) => `${r.role_label ? `${r.role_label} at ` : ''}${r.company || 'no company'} in ${r.group_name || 'no group'}: `
    + `${r.currency || 'GBP'} ${Number(r.monthly_amount ?? 0).toLocaleString('en-GB')} a month`
    + `${r.stopped_on ? ', stopped' : ''}`;
  const head = names.length === 1
    ? `${names[0]} has ${rows.length === 1 ? 'one deal' : `${rows.length} deals`}`
    : `${rows.length} deals for ${listOf(names)}`;
  return `${head}:\n${rows.map(line).join('\n')}`;
}

// "and gloria's?" right after "what's drew's phone number?" asks the same field.
const FOLLOW_UP = /^\s*(?:and|what about|how about|also)\b/i;

function askedFieldReply(rows, said, saidRecent = '') {
  const text = FOLLOW_UP.test(String(said ?? '')) ? `${said} ${saidRecent ?? ''}` : String(said ?? '');
  const hit = ASKED_FIELDS.find(([re]) => re.test(text));
  if (!hit || rows.length === 0) return null;
  const [, column, label] = hit;
  const names = [...new Set(rows.map((row) => displayPersonName(row.person_name)).filter(Boolean))];
  if (names.length !== 1) return null;
  // "Handled internally" is said as what it means, never read out as a number.
  const shownOne = (v) => (column.endsWith('_on') ? dateInWords(v) : (SENTINEL_SAYS[v] ?? String(v ?? '').trim()));
  /**
   * "BANK DETAILS" IS THE BANK, THE ACCOUNT AND THE SORT CODE. Clone run
   * 2026-10-05: "whats peter gibsons bank details" got "Peter Gibson's bank
   * details is Barclays." and nothing anyone could pay into.
   */
  const bankBits = (r) => [
    shownOne(r.bank_details),
    r.account_number && !SENTINEL_SAYS[r.account_number] ? `account ${String(r.account_number).trim()}` : '',
    r.sort_code && !SENTINEL_SAYS[r.sort_code] ? `sort code ${String(r.sort_code).trim()}` : '',
  ].filter(Boolean).join(', ');
  const cellOf = (r) => (column === 'bank_details' ? bankBits(r) : shownOne(r[column]));
  const verb = column === 'bank_details' ? 'are' : 'is';
  const values = [...new Set(rows.map(cellOf).filter(Boolean))];
  if (values.length === 0) return `${names[0]} has no ${label} on file.`;
  if (values.length === 1) return `${names[0]}'s ${label} ${verb} ${values[0]}.`.replace(` ${verb} handled internally`, ': handled internally');
  /**
   * EACH VALUE ONCE, with where it is held. "Nathan has 2 different groups:
   * INDIGO (...), MILKMAN (...), MILKMAN (...)" named a group per deal, and
   * "companys: Peter KP (Peter KP)" named a company by itself. 2026-10-05.
   */
  const bank = column === 'bank_details';
  const whereOf = (r) => (column === 'company' ? r.group_name : column === 'group_name' ? r.company : (r.company || r.group_name));
  const byValue = new Map();
  for (const r of rows) {
    const v = cellOf(r);
    if (!v) continue;
    byValue.set(v, [...(byValue.get(v) ?? []), whereOf(r)].filter(Boolean));
  }
  const plural = bank ? label : label.endsWith('y') ? `${label.slice(0, -1)}ies` : `${label}s`;
  const parts = [...byValue].map(([v, where]) => `${v} (${[...new Set(where)].join(', ')})`);
  return `${names[0]} has ${values.length} different ${plural}: ${parts.join(bank ? '; ' : ', ')}.`;
}

function detailsCardReply(rows, said = '', saidRecent = '') {
  const field = askedFieldReply(rows, said, saidRecent);
  if (field) return field;
  const names = [...new Set(rows.map((row) => displayPersonName(row.person_name)).filter(Boolean))];
  // ONE ROW, ONE SENTENCE. Across several the flags belong to different
  // deals and naming them all here is the card again, in prose.
  const notable = rows.length === 1 ? notableOf(rows[0]) : [];
  const tail = notable.length > 0 ? ` It is ${listOf(notable)}.` : '';
  if (names.length === 1) {
    const count = rows.length === 1 ? 'one deal' : `${rows.length} deals`;
    return `${names[0]} has ${count}.${tail} The full details are on screen.`;
  }
  return `Showing ${rows.length} deals for ${listOf(names)}. The full details are on screen.`;
}

function requestedPeopleInOrder(rows, said) {
  const found = peopleIn(rows, said);
  if (found.length < 2) return found;
  const ordered = [];
  for (const part of String(said ?? '').split(/\b(?:and|plus)\b|[,&]/i)) {
    const candidates = found
      .filter((name) => personMentionedIn(part, name))
      .sort((a, b) => fold(b).length - fold(a).length);
    if (candidates[0] && !ordered.includes(candidates[0])) ordered.push(candidates[0]);
  }
  return [...ordered, ...found.filter((name) => !ordered.includes(name))];
}

function detailsSummary(rows) {
  return 'Relay the block(s) below to the admin exactly as given: one field per line, '
    + 'no blank line between fields, a single blank line between people. '
    + 'Use these field names and values verbatim, do not compress them into prose '
    + 'and do not reformat them as a bulleted list.\n\n'
    + rows.map(formatRowDetails).join('\n\n');
}

/**
 * The same rows written as the FINAL ANSWER, not as instructions to the
 * model.
 *
 * Returning this as `reply` lets runAgent end the turn immediately instead
 * of spending a second model call — measured at roughly 12 seconds —
 * whose only job is to retype a block the tool already formatted
 * correctly. It was also the round where she reintroduced the double
 * spacing and the bullet points we keep stripping back out.
 *
 * Only used where the tool output genuinely IS the whole answer. An
 * ambiguous search must NOT use it: "did you mean Zane or Zayn?" is a real
 * reply that needs the model, not a data dump.
 */
function detailsReply(rows) {
  const who = rows.length === 1 ? `${rows[0].person_name}'s` : 'the';
  return `Here are ${who} full details:\n\n${rows.map(formatRowDetails).join('\n\n')}`;
}

/**
 * Find someone AND show their details, in one call.
 *
 * The two-step version cost three sequential model round trips for "show
 * me Zane's details" — search, then details, then the reply — at roughly
 * two seconds each before the tool work itself. Measured end to end at
 * 34 seconds.
 *
 * The safety property that made two steps worth it is kept: this only
 * shows details when the search resolves to exactly ONE row. Two or more
 * and it returns the candidates and asks, exactly as before, because
 * guessing which person the admin meant is the one thing Diane must never
 * do. So the round trip is saved in the common case and preserved in the
 * ambiguous one.
 */
const findAndShow = {
  name: 'find_and_show_details',
  description:
    'Find a person by name and show their details in ONE step. Use this whenever the admin asks to see someone\'s details, info, columns or data by NAME — it is the ONLY way to turn a name into rows, and it resolves the name itself. If the name matches more than one row it returns the candidates instead, and you must list them and ask which one rather than guessing. '
    + 'SET `show` WHEN THEY ASKED FOR ONE THING: "bank" for bank details, account or sort code, "cash" for where and how much, "expensing" for the terms and dates. Leave it out for a general "show me X" and they get every column. '
    + 'A FOLLOW-UP NARROWS TOO. "Bank details only", "just the bank ones", "what about their account number" after you have already shown someone means CALL THIS AGAIN for the same name with show="bank". Showing the whole card a second time is the wrong answer to a request for less.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The person\'s name as the admin said it, typos and all' },
      groupName: { type: 'string', description: 'Narrow to one group, if the admin named one' },
      company: { type: 'string', description: 'Narrow to one company, if the admin named one' },
      roleLabel: { type: 'string', description: 'Narrow to one role, if the admin named one' },
      show: {
        type: 'string',
        enum: ['bank', 'cash', 'expensing'],
        description: 'Narrow the card to one payout sheet. bank also covers crypto: same columns, different rows.',
      },
      allMatches: {
        type: 'boolean',
        description: 'Only after this tool returned an ambiguous name and the admin answered "show both" or "show all". Shows every candidate from the same fresh name lookup without passing row ids.',
      },
    },
    required: ['name'],
  },
  async handler(args) {
    /**
     * "IS MARA QUILL IN CORVID?" IS A YES OR NO. Held-out wording 2026-10-04:
     * narrowed to CORVID she was not there, and the nearest name IN CORVID
     * (Silas Moor) was offered as "a close guess". A person who exists, just
     * not where they asked, is answered with where they are.
     */
    // "IS BYRON IN NEXUS?" with only the name sent: the place is read off
    // their sentence. 2026-10-04.
    // A GREETING IN FRONT ("hi diane, quick one - is zayn in nexus?") is
    // not the question. Clone 2026-10-05.
    const askedLine = String(args.said ?? '')
      .replace(/^\s*(?:(?:hi|hey|hello|hiya|yo|morning|ok(?:ay)?|so|right|diane|babe|darling|quick (?:one|q(?:uestion)?)|question|sorry|pls|please)\b[\s,.!:;-]*)+(?=\S)/i, '');
    const placeSaid = /^\s*(?:is|are)\s+.+?\s+(?:in|at|on|with|part of)\s+([a-z][\w &'-]{1,40}?)\s*\?*\s*$/i.exec(askedLine)?.[1];
    const askedGroup = args.groupName ?? args.company ?? placeSaid;
    // ONLY A QUESTION GETS A YES OR NO: "the umbrella one" (picking a deal)
    // was answered "No, Drew is not in Umbrella". And a word of the name
    // counts: Umbrella is Umbrella UK Holdings. 2026-10-04.
    const asksIn = /^\s*(?:is|are|does)\b/i.test(askedLine);
    const within = (value) => {
      const w = String(askedGroup ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const v = String(value ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return fold(value) === fold(askedGroup) || (w.length > 0 && w.every((x) => v.includes(x)));
    };
    if (args.name && askedGroup && asksIn) {
      const exact = ((await repo.findAll({ q: args.name, pageSize: 200 }).catch(() => null))?.rows ?? [])
        .filter((r) => !r.stopped_on && fold(r.person_name) === fold(args.name));
      const inside = exact.filter((r) => within(r.group_name) || within(r.company));
      // AND YES IS AN ANSWER TOO: "is mara quill in baker?" drew her card.
      if (inside.length > 0 && asksIn) {
        const where = [...new Set(inside.map((r) => `${r.group_name}${r.company ? ` (${r.company})` : ''}`))].join(', ');
        const reply = `Yes, ${inside[0].person_name} is in ${where}.`;
        return { summary: `${reply} Say exactly that.`, reply, computedReply: true, rows: inside.map(summarizeRow) };
      }
      if (exact.length > 0 && inside.length === 0) {
        const where = [...new Set(exact.map((r) => `${r.group_name}${r.company ? ` (${r.company})` : ''}`))].join(', ');
        const reply = `No, ${exact[0].person_name} is not in ${askedGroup}. ${exact[0].person_name} is in ${where}.`;
        return { summary: `${reply} Say exactly that.`, reply, computedReply: true, rows: exact.map(summarizeRow) };
      }
    }
    // The model may pass only the longest of several names. Resolve the
    // current sentence against the live sheet before accepting that lookup.
    if (/\b(?:and|plus|both)\b|[,&]/i.test(String(args.said ?? ''))) {
      const found = await repo.findAll({
        group: args.groupName, page: 1, pageSize: TOTAL_ROW_LIMIT,
      });
      const allRows = found?.rows ?? [];
      const requested = requestedPeopleInOrder(allRows, args.said);
      if (requested.length > 1) {
        const selected = requested.flatMap((name) => sortDealsForDisplay(
          allRows.filter((row) => fold(row.person_name) === fold(name)),
        ));
        const only = SEND[args.show] ?? null;
        return {
          summary: wantsCard(args.said, args.saidRecent) ? cardSummary(selected)
            : `${dealsInWords(selected)}\n\nNO CARD WAS DRAWN: they did not ask to see one. Answer from these rows in words.`,
          cards: askedFieldReply(selected, args.said, args.saidRecent) || !wantsCard(args.said, args.saidRecent) ? [] : selected.map((row) => narrowCard(dealCard(row), only)),
          rows: selected.map(summarizeRow),
          computedMonths: [],
          reply: askedFieldReply(selected, args.said, args.saidRecent) ?? (wantsCard(args.said, args.saidRecent) ? detailsCardReply(selected, args.said, args.saidRecent) : dealsInWords(selected)),
          computedReply: true,
        };
      }
    }

    /**
     * A GROUP OR COMPANY GLUED INTO THE NAME, split here too. "add 100 to
     * zayn milkman" reaches for THIS door first, and without the split it
     * matched Zayn and Milkman Jones and asked which. Same reading the
     * write doors use, so the two can never disagree about who was meant.
     */
    if (!args.groupName && !args.company) {
      const read = await scopeArgs({ person: args.name, said: args.said, saidRecent: args.saidRecent }, peopleRepo);
      if (read.person && read.person !== args.name && (read.group || read.company)) {
        // eslint-disable-next-line no-param-reassign
        args = { ...args, name: read.person, groupName: read.group ?? args.groupName };
        if (read.company) args.scopeCompany = read.company;
      }
    }

    let rows = await repo.searchFuzzy({ q: args.name, group: args.groupName });
    if (args.scopeCompany) {
      const onIt = rows.filter((r) => fold(r.company) === fold(args.scopeCompany));
      if (onIt.length > 0) rows = onIt;
    }

    if (rows.length === 0) {
      /**
       * IN THE ARCHIVE IS AN ANSWER, not a miss. Live 2026-09-30: Casey
       * Test's only deal was stopped, so the lookup offered "did you mean
       * Drew?", and the fee meant for Casey landed on Drew.
       */
      // A FIRST NAME COUNTS: "set theo's monthly" (Theo Brandt, stopped) was
      // told nobody is close to "theo". Whole words, so "the" is not Theo.
      // 2026-10-04.
      const words = (v) => String(v ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const sameOrPart = (person) => fold(person) === fold(args.name)
        || (words(args.name).length > 0 && words(args.name).every((w) => words(person).includes(w)));
      const archivedAll = ((await repo.findAll({ stopped: true, q: args.name, pageSize: 20 }).catch(() => null))?.rows ?? [])
        .filter((r) => sameOrPart(r.person_name));
      // One person only: two stopped Theos is a question, not an answer.
      const archived = new Set(archivedAll.map((r) => fold(r.person_name))).size === 1 ? archivedAll : [];
      if (archived.length > 0) {
        const where = archived.map((r) => `${r.company || 'no company'} in ${r.group_name}, stopped ${String(r.stopped_on instanceof Date ? r.stopped_on.toISOString() : r.stopped_on).slice(0, 10)}`).join('; ');
        return {
          summary: `${archived[0].person_name} has no live deal: ${archived.length === 1 ? 'their only deal is' : 'their deals are'} `
            + `STOPPED and in the Archive (${where}). NOTHING can be changed on a stopped deal. Say so, `
            + 'and offer to resume it first. Do NOT offer anyone else, and do NOT change anyone else.',
          reply: `${archived[0].person_name}'s deal is stopped and in the Archive (${where}). Want me to resume it first?`,
          computedReply: true,
        };
      }
      // Never dead-end on a name. The admin knows the person exists; they
      // just said it badly, or it was transcribed badly. A second, far
      // looser pass turns "nothing found" into "did you mean one of
      // these", which is the difference between the admin having to guess
      // the spelling and them picking from a list.
      const near = await repo.searchFuzzy({ q: args.name, group: args.groupName, loose: true, limit: 5 });
      if (near.length > 0) {
        return {
          summary: `No exact match for "${args.name}"${args.groupName ? ` in ${args.groupName}` : ''}, `
            + `but these are the closest names on the sheet: `
            + `${near.map((r) => `#${r.id} ${r.person_name}${r.company ? ` (${r.company})` : ''} in ${r.group_name}`).join('; ')}. `
            + 'Offer these as "did you mean" and ask which one, if any. '
            + 'Be clear these are guesses, not matches, and do not show anyone\'s details until they pick.',
          rows: near.map(summarizeRow),
        };
      }
      return {
        summary: (await notAPerson(args.name))
          ?? `Nothing on the sheet is close to "${args.name}"${args.groupName ? ` in ${args.groupName}` : ''}, `
          + 'not even loosely. Say so plainly and ask them to check the spelling or the group.',
      };
    }

    // An EXACT name match wins outright, even when fuzzier neighbours came
    // back alongside it. Loosening the search threshold (so "Zine" finds
    // "Zane") also made "Zane" match "Zayn" — and asking "did you mean Zane
    // or Zayn?" when the admin typed Zane exactly is worse than the dead
    // end it replaced. Only ambiguous if two rows share the SAME exact name.
    // resolvePerson: the exact-name exit and the which-PERSON rule, shared
    // by every tool that takes a name. See its banner for both rules.
    const picked = resolvePerson(rows, args.name, args.said);
    if (picked.ambiguous) {
      // Deliberately NOT resolved by picking the top score. Two people can
      // legitimately be a near-tie.
      const named = [...new Map(picked.rows.map((r) => [
        String(r.person_id ?? r.person_name ?? '').trim().toLowerCase(), r,
      ])).values()];

      const askedForAll = /\b(?:all|both|every|everything)\b/i.test(String(args.said ?? ''));
      if (args.allMatches === true && askedForAll) {
        const selected = sortDealsForDisplay(picked.rows);
        return {
          summary: `ONLY these ${named.length} people matched the requested name: ${picked.names.join(', ')}. `
            + `Their ${picked.rows.length} matching deals are already on screen, one card each. `
            + 'Name only these people and do not calculate a total from the cards.',
          cards: askedFieldReply(selected, args.said, args.saidRecent) || !wantsCard(args.said, args.saidRecent) ? [] : selected.map((r) => narrowCard(dealCard(r), SEND[args.show] ?? null)),
          rows: selected.map(summarizeRow),
          computedMonths: [],
          reply: askedFieldReply(selected, args.said, args.saidRecent) ?? (wantsCard(args.said, args.saidRecent) ? detailsCardReply(selected, args.said, args.saidRecent) : dealsInWords(selected)),
          computedReply: true,
        };
      }

      return {
        summary: `"${args.name}" matches ${picked.names.length} different people: `
          + `${picked.names.join('; ')}. `
          + 'List these for the admin and ask which ONE they mean. Do not show details for any of them yet.\n\n'
          + 'WHEN THEY ANSWER, call this tool again with the name and group they picked. '
          + `If they say to show ALL or BOTH, call this same tool again with name "${args.name}" `
          + 'and allMatches true. Do not use row ids for that follow-up.',
        // A REAL ambiguity, marked as one. See checkAmbiguity.js: she
        // invented this refusal on a name only one person holds.
        ambiguous: true,
        rows: picked.rows.map(summarizeRow),
      };
    }
    /**
     * THE NAME LANDED ON NOBODY, and the fuzzy result happened to hold one
     * person. "kirna baker" drew Baker Jones's card: a guess, shown as an
     * answer. A name that did not land is a question. 2026-09-29.
     */
    if (!picked.matched) {
      const closest = [...new Set(picked.rows.map((r) => displayPersonName(r.person_name)))].slice(0, 4);
      return {
        summary: `Nobody on the sheet is called "${args.name}". The closest `
          + `${closest.length === 1 ? 'name is' : 'names are'} ${closest.join(', ')}. Ask whether they meant `
          + `${closest.length === 1 ? 'that person' : 'one of them'}, and show nothing until they say.`,
        ambiguous: true,
        rows: picked.rows.map(summarizeRow),
      };
    }
    const narrowed = narrowPersonDeals(picked.rows, args);
    if (narrowed.missing) {
      const reply = `${displayPersonName(picked.rows[0]?.person_name)} has no deal matching `
        + `${narrowed.missing}. Their deals are: ${dealsTheyHold(picked.rows)}.`;
      return { summary: reply, reply, computedReply: true };
    }
    rows = sortDealsForDisplay(narrowed.rows);

    if (/\b(?:list|which|what)\b.*\bdeals?\b|\bdeals?\b.*\b(?:list|which|what)\b/i.test(String(args.said ?? ''))
      && !narrowed.targeted) {
      const person = displayPersonName(rows[0]?.person_name);
      const groups = [...new Set(rows.map((row) => row.group_name).filter(Boolean))];
      const scope = groups.length === 1 ? ` in ${groups[0]}` : '';
      return {
        summary: `${person} has ${rows.length} deals${scope}. They are already listed on screen.`,
        list: dealList(rows, `${person}'s ${rows.length} deals`),
        rows: rows.map(summarizeRow),
        reply: `${person} has ${rows.length} deals${scope}. Choose a company to open one.`,
        computedReply: true,
      };
    }

    // ASKED FOR BANK DETAILS THAT DO NOT EXIST, answered in a sentence.
    // She drew seven full cards for three people and then said none of them
    // had any. The cards were the answer to a question nobody asked.
    if (args.show === 'bank' && !rows.some(hasBankDetails)) {
      const who = rows[0].person_name;
      const methods = [...new Set(rows.map((row) => String(row.payment_method ?? '').trim().toLowerCase()).filter(Boolean))];
      const method = methods.length === 1 ? methods[0] : null;
      const reply = method
        ? `${displayPersonName(who)} is paid by ${method} and has no bank details on file.`
        : `${displayPersonName(who)} has no bank details on file.`;
      return {
        summary: `${who} has ${rows.length} row${rows.length === 1 ? '' : 's'} and NOT ONE of them `
          + 'has bank details. Use the known payment method when there is one. Do not list '
          + 'the rows, and do not show what is missing field by field.',
        rows: rows.map(summarizeRow),
        reply,
        computedReply: true,
      };
    }

    /**
     * ===============================
     * * A CARD IS AN ANSWER, NOT A WAY OF ASKING WHICH
     * ===============================
     * Live 2026-09-24, twice. "Update Zayn's..." drew both of his deals as
     * full cards before asking which one. "Add 5% for this person's Nicola
     * Nathan" drew TEN, every field of every deal, and then summarised
     * them wrongly.
     *
     * Neither was a request to see anything. They were instructions, and
     * the lookup was her working out which row to write to: that is what
     * the one line list is for, and she uses it correctly elsewhere in the
     * same conversation.
     *
     * EVEN FOR ONE DEAL. "Add 3% on his Milkman deal" wants the change,
     * not the row's twenty eight fields, and a rule with an exception at
     * one row is a rule that comes back at two.
     */
    /**
     * ===============================
     * * AND WITH ONE DEAL, NOTHING IS DRAWN AT ALL
     * ===============================
     * The summary above said "no cards were drawn and none should be" and
     * then drew a list anyway. A LIST IS A WAY OF PICKING ONE: it carries
     * a person finder and a row you can press. Over a single resolved deal
     * there is nothing to pick, so "add 100 to zayn milkman" answered a
     * change with a chooser. His call 2026-09-29.
     *
     * Not a contradiction of the rule above, which is about full CARDS. A
     * card is an ANSWER and was being used to ask which; a list is the
     * ASKING, and asking is only a thing when there is more than one.
     */
    if (isSetInstructionRecent(args.said, args.saidRecent)) {
      const who = displayPersonName(rows[0]?.person_name);
      const one = rows.length === 1;
      return {
        summary: one
          ? `${who} holds ONE deal and it is the one they mean: ${dealsWhere(rows)}, id ${rows[0].id}. `
            + 'THEY ASKED FOR A CHANGE, not for details, so nothing was drawn and nothing should be. '
            + `Make the change they asked for, on id ${rows[0].id}.`
          : `${who} has ${rows.length} deals, listed on screen. THEY ASKED FOR A CHANGE, not for `
            + 'details, so no cards were drawn and none should be. Ask WHICH ONE, in one short line.',
        ...(one ? {} : { list: dealList(rows, `${who}'s ${rows.length} deals`) }),
        rows: rows.map(summarizeRow),
      };
    }

    // One person. Every row they hold IS the answer, however many.
    const only = SEND[args.show] ?? null;
    const scoped = only
      ? `Showing the ${args.show} fields only. Say so, so nobody reads a narrowed card as the whole row.

`
      : '';
    /**
     * THE FIELD IS LOOKED FOR ON THE WHOLE ROW, never on the narrowed card.
     *
     * `show` is HER narrowing, not theirs. Asked for "only Richard's
     * payable days" with `show: 'cash'` set, the day count had been cut out
     * of the card before the match ran, so "Payable" was the nearest cell
     * left and she answered 500 to a question about 30.
     */
    const full = rows.map(dealCard);
    const cards = full.map((card) => narrowCard(card, only));

    /**
     * ===============================
     * * A NARROWED ASK GETS A NARROWED ANSWER
     * ===============================
     * "What's Richard's payable days" drew a twenty cell card and said
     * "the full details are on screen". Then it said the value AND drew the
     * card, which is the same wall with a sentence on top.
     *
     * The rule is the one already in this file eight lines up, where a bank
     * ask with nothing to show answers in a sentence: THE CARD WAS THE
     * ANSWER TO A QUESTION NOBODY ASKED. Naming a field is that question
     * asked out loud, so it gets the value and NOTHING ELSE.
     *
     * ONE DEAL ONLY. Four deals hold four different values, so there is no
     * single value to say and the cards stay the answer. See fieldAsked.js.
     */
    /**
     * A RATE QUESTION IS ANSWERED BY THE RATES. "is dov on a 5% fee?" drew two
     * cards and "the full details are on screen": no yes, no no. 2026-09-25.
     */
    const onePerson = new Set(rows.map(personKey)).size === 1;
    if (onePerson && ASKS_RATE.test(String(args.said ?? '')) && !WANTS_CARD.test(String(args.said ?? ''))) {
      return checkRates.handler({ person: displayPersonName(rows[0].person_name), said: args.said });
    }

    const named = full.length === 1 ? fieldsAsked(full[0], args.said) : [];

    /**
     * A PAYOUT SET IS NOT A FIELD. "Bank details" names the `bank` set and
     * `Bank` is one cell inside it, so answering that one cell would hand
     * back less than the narrowed card they asked for.
     *
     * Only when the set word is ALL they named. "Show me only Richard's
     * payable days" set `show` as well, and the old `!args.show` test threw
     * the field answer away and drew a narrowed card captioned "the full
     * details are on screen", which was neither the field nor true.
     */
    const setAsk = Boolean(args.show)
      && named.length > 0
      && named.every((f) => fold(f.label) === fold(args.show));
    const asked = setAsk ? [] : named;
    // THEIR WORDS NAME THE FIELD TOO, when she did not: "what's nathan's
    // phone number?" drew five full deal cards under the number. 2026-10-03.
    const answer = fieldAnswer(displayPersonName(rows[0]?.person_name), asked)
      ?? askedFieldReply(rows, args.said, args.saidRecent);

    if (answer) {
      return {
        // NO CARD, and the summary must say so. Left as cardSummary it told
        // the model the full details were on screen when nothing was.
        summary: `${answer} They asked for that field and nothing else, so NO card was drawn. `
          + 'Say exactly that line and stop. Do not offer to show the rest unless they ask.',
        rows: rows.map(summarizeRow),
        computedMonths: [],
        reply: answer,
        computedReply: true,
      };
    }

    if (!wantsCard(args.said, args.saidRecent)) {
      const words = dealsInWords(rows);
      return {
        summary: `${scoped}${words}\n\nNO CARD WAS DRAWN: they did not ask to see one. Answer their `
          + 'question from these rows in words. If they want the full card they will ask.',
        rows: rows.map(summarizeRow),
        computedMonths: [],
        reply: words,
        computedReply: true,
      };
    }

    return {
      summary: scoped + cardSummary(rows),
      cards,
      rows: rows.map(summarizeRow),
      // Dates on detail cards are facts, not computed monthly totals.
      computedMonths: [],
      reply: detailsCardReply(rows, args.said, args.saidRecent),
      computedReply: true,
    };
  },
};

/**
 * SPEAK NOW, KEEP WORKING.
 *
 * Everything else here answers a question and ends the turn. This one puts
 * a line on screen mid-turn and carries on, so a lookup that takes four
 * seconds is not four seconds of nothing.
 *
 * ---- why a tool and not an automatic filler ----
 * A canned "one moment" on every request is worse than silence: it is
 * obviously a machine, it fires on questions she answers instantly, and
 * after a day nobody reads it. As a tool SHE decides, which means she can
 * greet, think out loud, warn that something will take a second, or say
 * nothing at all — and the judgement lives in the prompt where it can be
 * tuned, rather than in a timer.
 *
 * The handler does nothing. Emitting is runAgent's job (it owns onEvent);
 * this exists so the model has something to call and gets a result back
 * telling it to carry on rather than stopping to report what it just said.
 *
 * The two rules below it kept breaking are GUARDS now, in `interimLine.js`:
 * alone in a round, or ending in a question, the line never reaches screen.
 */
const say = {
  name: 'say',
  description:
    'Say one short line to the admin RIGHT NOW, then carry on working in the same turn. '
    + 'CALL THIS FIRST, in the same round as your other tool calls, whenever answering will take '
    + 'more than one lookup — an audit, a comparison, several people, anything open ended. '
    + 'Without it they watch a blank screen for several seconds. Write it in your own voice and '
    + 'vary it; there is no house phrase. It does NOT end your turn and it is not the answer, so '
    + 'you must still reply properly afterwards. Skip it on anything you can answer in one step. '
    + 'NEVER USE IT TO ASK A QUESTION. It is a line before WORK. Asking through it and then asking '
    + 'again in your reply is the same question twice, which is what it looks like on screen: '
    + 'if you are asking rather than working, just ask, once, in the reply.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'One short sentence, in your own voice.' },
    },
    required: ['text'],
  },
  // Marks it for runAgent: emitted to the browser rather than fed back as
  // data, and never counted as the answer.
  interim: true,
  async handler(args) {
    const text = String(args?.text ?? '').trim();
    if (!text) return { summary: 'Nothing to say — skipped.' };
    const requestedMonths = monthsInQuestion(args?.said);
    const progressMonths = monthsInQuestion(text);
    if (
      requestedMonths.length > 1
      && progressMonths.some((month) => !requestedMonths.includes(month))
    ) {
      return { summary: 'Progress line skipped because its months did not match the request.' };
    }
    return {
      // Blunt, because the first version ("Said, now answer properly") got
      // the line repeated verbatim at the top of the final answer — shown
      // twice on screen and spoken twice.
      summary: `DELIVERED. The admin has already seen and heard "${text}". `
        + 'Do NOT repeat it, quote it, or open your final answer with it. '
        + 'Carry on and answer the actual question, starting from the next thing you have to say.',
      said: text,
    };
  },
};

// search_master_sheet RETIRED 2026-08-29. It returned every candidate
// and never resolved, so the exact name sat in a list being offered
// back: "Gloria Difference" was answered with five rows to choose from,
// and answering re-ran the same search. find_and_show_details takes a
// name and resolves it; filter_master_sheet answers set questions,
// including by company. Two tools took one job and only one had an exit.


// Every editable field, exposed to the model exactly as the CRUD route
// validates them (masterSheet.js's toFields) — the tool schema and the
// route's own validation both exist so a bad value is caught twice, same
// reasoning as whatbot's toolRunner.js re-validating what it already sent
// the model a schema for.
const ROW_FIELDS = {
  personName: { type: 'string' },
  roleLabel: { type: 'string', description: 'e.g. "Mid 1", "Director", "Visa co D"' },
  groupName: { type: 'string' },
  company: { type: 'string' },
  assignedOn: { type: 'string', description: 'YYYY-MM-DD' },
  paymentStartOn: { type: 'string', description: 'YYYY-MM-DD' },
  presetOn: { type: 'string', description: 'YYYY-MM-DD' },
  endOn: { type: 'string', description: 'YYYY-MM-DD' },
  payableDays: { type: 'integer', minimum: 0, maximum: 31 },
  /**
   * ===============================
   * * THE ONE FIELD HERE THAT DECIDES WHAT A MONTH OWES
   * ===============================
   * Migration 064. Hers as of 2026-09-23, and GATED: `confirmSpecialCaseDeal`
   * makes it the two call shape, so the first call cannot change anything
   * and there is nothing for her to misreport. Every other field on this
   * list moves one cell; this one moves a total, a tint and a badge at
   * once, which is why it is the only one carrying a confirm of its own.
   */
  specialCaseDeal: {
    type: 'boolean',
    description: `Make this deal a SPECIAL CASE for the month its PRESET is for: paid although `
      + `its payment start says nothing is owed. Forces the whole month. The switch on screen is `
      + `"${SPECIAL_CASE_SWITCH}", so THIS is the field for ${quotedPhrases()} and any other way `
      + `of saying a named deal is a special case. Not overrideShouldBePaid, which carries no `
      + `month. Never set it because a figure looks wrong: it is the admin saying this row is `
      + `paid anyway. Takes a confirmed call.`,
  },
  paymentMethod: { type: 'string', enum: ['cash', 'bank', 'crypto'] },
  monthlyAmount: { type: 'number', minimum: 0 },
  payableAmount: { type: 'number', minimum: 0 },
  // Not an enum: the sheet writes "EURO", and new currencies arrive
  // without asking. Uppercased on the way in so case drift doesn't fork
  // one currency into two.
  currency: { type: 'string', description: 'As the sheet writes it — GBP, AED, EURO…' },
  location: { type: 'string' },
  // The four columns the importer used to drop on the floor. All
  // strings, never numbers — the real sheet writes "Will never be bank"
  // as an account number and "In person meet" as a door number.
  doorNumber: { type: 'string' },
  postcode: { type: 'string' },
  acceptingPostals: { type: 'string', description: 'Yes / No / Handled Internally, as the sheet writes it' },
  phone: { type: 'string' },
  label: { type: 'string' },
  // THIS DEAL'S rates, stacking with the person's own. An add on is
  // ADDED, a fee DEDUCTED after it. See shared/rates.helper.js.
  addonPercent: {
    type: 'number',
    minimum: 0,
    maximum: MAX_PERCENT,
    description: 'ADDED on top of this row. Stacks with the person rate, never replaces it.',
  },
  feePercent: {
    type: 'number',
    minimum: 0,
    maximum: MAX_PERCENT,
    description: 'DEDUCTED from this row after add ons. Stacks with the person rate.',
  },
  // The SHEET's own free-text columns, exactly as the boss's file has
  // them ("shoukd be paid or not" / "Paid") — deliberately strings, not
  // booleans: they hold whatever the team typed, often blank.
  shouldBePaid: { type: 'string', description: "The sheet's own free-text column. NOT the switch. Only set this when quoting what the boss's file says." },
  paid: { type: 'string', description: "The sheet's own free-text column. NOT the switch. Only set this when quoting what the boss's file says." },

  /**
   * THE ADMIN'S DECISION, and what every switch in the UI writes.
   *
   * These were deliberately kept from Diane — "a business decision made in
   * one place, not two". That reasoning held while she was a polishing
   * assistant, and broke as soon as anyone asked her the obvious thing.
   * "Mark Zayn as paid" wrote the sheet's free-text column instead: a
   * write that succeeds, reports success, and moves nothing on screen,
   * because the People page reads the override and not the text. Silently
   * doing the wrong thing is worse than refusing.
   *
   * TRI-STATE, and null is not false. Untouched (null) means nobody has
   * decided and the queries resolve their own defaults; false is somebody
   * deciding NO. Setting one to false is a real decision about money, so
   * her prompt requires her to say what she is about to do and get a yes
   * before writing it.
   */
  overrideShouldBePaid: {
    type: ['boolean', 'null'],
    description: 'The should-be-paid SWITCH, a STANDING answer with no month in it. '
      + 'true = yes, false = no and the row leaves every payout total, null = nobody has decided. '
      + `This is what the People page shows. NOT FOR "${SPECIAL_CASE_SWITCH}" or any wording `
      + `about one month: a row owed nothing because its payment start has not arrived is `
      + `specialCaseDeal. Takes a confirmed call.`,
  },
  overridePaid: {
    type: ['boolean', 'null'],
    description: 'The paid SWITCH: whether the money ARRIVED, never whether it is owed. '
      + 'true = it arrived, false = it did not, null = nobody has decided. Takes a confirmed call.',
  },
  // `status` IS GONE FROM HERE, 2026-09-09. It used to be settable, and a
  // stored value won over the formula on every read, so a row could show
  // Ended beside a green payment start cell with its amount still in the
  // month's total. See NOT_SETTABLE below and docs/state.md.
  notes: { type: 'string' },
  bankDetails: { type: 'string' },
  accountNumber: { type: 'string', description: "Text, not a number — often 'Will never be bank'" },
  sortCode: { type: 'string', description: "As written, e.g. '20 - 82 - 23'" },
  // The "this row came in messy" flag. Clearing it is a real admin action
  // ("I looked at it, it's fine") — the same thing the page's "Save and
  // mark it sorted" button does, so Diane can do it too. `reviewReason`
  // is deliberately NOT here: it's the parser's own explanation of what
  // looked wrong, not admin data, and it's cleared automatically with the
  // flag (see the handler below).
  needsReview: { type: 'boolean', description: 'Set false to clear the "needs a check" flag on a row you have sorted out' },
};

function coerceDate(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  // A month alone is its first day: "preset to october" arrived as 2026-10.
  if (/^\d{4}-\d{2}$/.test(v)) return `${v}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`bad date "${v}", expected YYYY-MM-DD`);
  return v;
}

// Shared by create and update — same reasoning as masterSheet.js's own
// toFields(): one place decides what a field means, so create and update
// can't silently drift into validating differently.
const DATE_FIELDS = ['assignedOn', 'paymentStartOn', 'presetOn', 'endOn'];

/**
 * ===============================
 * * A YEAR SHE WAS NEVER TOLD IS A YEAR SHE GUESSED
 * ===============================
 *
 * Asked to "update all the presets to September" she wrote `2024-09-01` on
 * all 96 rows. September, and the wrong year by two. Nothing on screen said
 * so: the filters answered correctly, "an old month" showed 96 and "this
 * month" showed none, and the sheet quietly owed NOTHING for the month,
 * forever, because a preset in a past year is never counted.
 *
 * This exact shape is already in `todo.md` as money at risk: Anteep
 * Sourcing sat on `2024-09-01` and computed as nothing.
 *
 * A BARE MONTH HAS NO YEAR IN IT, so somebody has to supply one, and she is
 * the one party in the room who must not guess. So a preset landing outside
 * this window is refused UNLESS the admin's own words carry the year.
 * `said` is injected, never passed, so she cannot satisfy this by writing
 * the year herself.
 */
// The rule itself lives in `shared/guessedYear.helper.js`: every tool that
// takes a month reads it, and a copy here would be the one that drifted.
/**
 * @returns {string|null} the reason to refuse, or null to allow.
 */
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * ===============================
 * * A MONTH SAID WITHOUT A YEAR IS THE NEAREST ONE
 * ===============================
 * gpt-4.1 sweep, 2026-10-06: "kiran preset month november for all" came as
 * 2023-11-01, the year she was trained in. The refusal below caught it and
 * asked the year, and the yes that followed applied nothing. Their words
 * named the month and no year, so the year is not hers to pick and not
 * theirs to be asked: it is the occurrence of that month nearest to now,
 * worked out here, the same for every date column. The preview shows the
 * full date, so the year is seen before the yes.
 *
 * Only when their sentence names THAT month and NO year. A year they said,
 * or a date with no month word in it, is left exactly as it came.
 */
function pinSaidYears(fields, said) {
  const text = String(said ?? '').toLowerCase();
  if (/\b(?:19|20)\d{2}\b/.test(text)) return;
  const [cy, cm] = currentMonth().split('-').map(Number);
  for (const key of DATE_FIELDS) {
    const iso = fields[key];
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const m = Number(iso.slice(5, 7));
    if (!new RegExp(`\\b${MONTH_NAMES[m - 1]}`).test(text)) continue;
    const best = [cy - 1, cy, cy + 1]
      .map((y) => ({ y, d: Math.abs((y - cy) * 12 + (m - cm)) }))
      .sort((a, b) => a.d - b.d)[0].y;
    fields[key] = `${best}${iso.slice(4)}`;
  }
}

function farOffPreset(fields, said) {
  pinSaidYears(fields, said);
  const iso = fields.presetOn;
  if (!iso || !farOffMonth(iso, said)) return null;

  const now = currentMonth();
  const away = monthsFromNow(iso, now);
  const year = iso.slice(0, 4);

  const ago = Math.abs(away) >= 12
    ? `${Math.round(Math.abs(away) / 12)} year${Math.abs(away) >= 18 ? 's' : ''}`
    : `${Math.abs(away)} months`;

  // THEY NAMED IT RELATIVELY, so the month is known and asking the year is
  // a question with an answer already in hand. "next month" became 2023.
  const relative = RELATIVE_MONTH.exec(String(said ?? ''));
  if (relative) {
    // "NEXT MONTH" IS A MONTH THE CODE KNOWS. It was refused with the right
    // answer in hand, and she asked them to confirm a date nobody was unsure
    // of; the yes then went nowhere. Corrected here and shown in the preview.
    // gpt-4.1 messy sweep, 2026-10-06.
    const meant = shiftMonth(now, RELATIVE_SHIFT[relative[1].toLowerCase()]);
    fields.presetOn = `${meant}-01`;
    return null;
  }
  return `NOTHING HAS BEEN CHANGED. That preset is ${iso}, which is ${ago} `
    + `${away < 0 ? 'BEFORE' : 'AFTER'} ${monthName(now)}, and they never said the year `
    + `${year}. A preset in another year is never counted, so those rows would be owed `
    + 'NOTHING and nothing on screen would say why. Ask them which year they mean, out loud, '
    + 'and use the year they answer with.';
}

/**
 * ===============================
 * * FREE TEXT IS THEIR WORDS OR NOTHING
 * ===============================
 * Live sweep 2026-09-29: "add a note to otto fenn" gave no note, and she
 * wrote one of the runtime's own instructions to her into the notes cell:
 * "THEY TOLD YOU TO DO SOMETHING AND YOU LOOKED IT UP INSTEAD...". A note,
 * a label, an address or a bank detail has no formula behind it, so the
 * only source it can have is the admin's own sentence, this turn or the
 * last few. Anything else is asked for.
 */
const FREE_TEXT_FIELDS = [
  'notes', 'label', 'location', 'postcode', 'doorNumber', 'acceptingPostals',
  'bankDetails', 'accountNumber', 'sortCode', 'phone',
];
function freeTextNotSaid(fields, said) {
  const heard = fold(said);
  // No sentence at all is a caller outside a conversation (a form, a test),
  // not a model inventing text. The runtime always passes `said`.
  if (!heard) return null;
  for (const key of FREE_TEXT_FIELDS) {
    const value = fields[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (heard.includes(fold(value))) continue;
    return `NOTHING HAS BEEN CHANGED. They have not said what the ${FIELD_LABELS[key] ?? key} should say. `
      + 'Ask them for the exact text in one short line, and write nothing until they give it.';
  }
  return null;
}

/**
 * ===============================
 * * A FIGURE IS THEIRS OR IT IS NOT WRITTEN
 * ===============================
 * Live sweep 2026-09-29, auto mode on: a new deal starting in October was
 * owed nothing this month, the tool told her to ASK how many days, and she
 * wrote 30 days and GBP 900 on her own. Nobody said 30. A day count, an
 * amount or a rate is only ever a number they said (this turn or the last
 * few); an "add" or a "delta" is its own argument and never reaches here.
 */
const SAID_NUMBER_FIELDS = ['payableDays', 'monthlyAmount', 'payableAmount', 'feePercent', 'addonPercent'];
const CLEARS = /\b(?:clear|remove|reset|zero|none|nothing|no|off|take|drop|scrap)\b/i;
function numbersHeard(text) {
  const out = new Set();
  const plain = String(text ?? '').replace(/(\d),(\d{3})/g, '$1$2');
  for (const m of plain.matchAll(/(\d+(?:\.\d+)?)\s*(k)?\b/gi)) {
    out.add(Number(m[1]) * (m[2] ? 1000 : 1));
  }
  return out;
}
function numberNotSaid(fields, said) {
  if (!String(said ?? '').trim()) return null;
  const heard = numbersHeard(said);
  for (const key of SAID_NUMBER_FIELDS) {
    const v = fields[key];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || heard.has(n)) continue;
    if (n === 0 && CLEARS.test(String(said))) continue;
    return `NOTHING HAS BEEN CHANGED. They never said ${n} for the ${FIELD_LABELS[key] ?? key}. `
      + 'If they asked to ADD or TAKE OFF an amount ("deduct 1k", "add 100"), call this again with '
      + '`add` instead, negative to take off, and never work the new figure out yourself. '
      + 'Otherwise ask them for the figure in one short line, and write nothing until they give it.';
  }
  return null;
}

/**
 * ===============================
 * * A DATE SAID WITHOUT A YEAR GETS OURS, NOT HERS
 * ===============================
 * Live sweep 2026-09-29: "appointment to 1 march" wrote 2023-03-01,
 * "payment start to 1 april" wrote 2024-04-01, and "end date to next year"
 * wrote 2025-12-31, which ENDED the deal. Every one was the model's guess
 * at a year nobody said.
 *
 * So the year is decided here, one rule per field, only when their words
 * carry no year at all:
 *   appointment, payment start   this year
 *   end date                     the next time that day comes round
 *   preset                       the nearest one to this month
 * "next year", "last year" and "this year" set it outright. "next year"
 * with no day in it names no date, and is asked about rather than invented.
 *
 * @returns {string|null} a refusal, or null with `fields` corrected in place
 */
const MONTH_WORD = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const YEAR_WORD = /\b(?:19|20)\d{2}\b/;
const RELATIVE_YEAR = /\b(next|last|this)\s+year\b/i;
const YEAR_LABELS = {
  assignedOn: 'appointment', paymentStartOn: 'payment start', presetOn: 'preset', endOn: 'end date',
};
function settleYears(fields, said) {
  const text = String(said ?? '');
  if (YEAR_WORD.test(text)) return null;
  const [cy, cm] = currentMonth().split('-').map(Number);
  const relative = RELATIVE_YEAR.exec(text)?.[1]?.toLowerCase();
  for (const key of DATE_FIELDS) {
    const iso = fields[key];
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const [y, m] = iso.split('-').map(Number);
    let want;
    if (relative) {
      want = { next: cy + 1, last: cy - 1, this: cy }[relative];
      if (!MONTH_WORD.test(text) && !/\b\d{1,2}(?:st|nd|rd|th)?\b/.test(text.replace(RELATIVE_YEAR, ''))) {
        return `NOTHING HAS BEEN CHANGED. They said "${relative} year" for the ${YEAR_LABELS[key]} but no `
          + `day or month, so there is no date to write. Ask which date in ${want} they mean, in one line.`;
      }
    } else if (!MONTH_WORD.test(text)) {
      continue;
    } else if (key === 'endOn') {
      want = m >= cm ? cy : cy + 1;
    } else if (key === 'presetOn') {
      want = [cy - 1, cy, cy + 1].sort((a, b) => Math.abs((a - cy) * 12 + m - cm) - Math.abs((b - cy) * 12 + m - cm))[0];
    } else {
      want = cy;
    }
    // eslint-disable-next-line no-param-reassign
    if (want && want !== y) fields[key] = `${want}${iso.slice(4)}`;
  }
  return null;
}

// "next month" and its kin, against the business month.
const RELATIVE_MONTH = /\b(next|this|last|previous)\s+month\b/i;
const RELATIVE_SHIFT = Object.freeze({ next: 1, this: 0, last: -1, previous: -1 });
function shiftMonth(yyyymm, by) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// Tri-state: true, false, or null for "nobody has decided". Never a string.
const TRISTATE_FIELDS = ['overrideShouldBePaid', 'overridePaid'];

/**
 * A model sends `"true"` about as often as `true`, and the repo rejects
 * the string outright ("must be true, false, or null"). Coerced here so
 * that arrives as a working edit rather than a 400 Diane has to explain.
 * Anything genuinely unreadable still throws, because guessing which way
 * a payment decision was meant is the one thing not to do.
 */
function coerceTristate(v, key) {
  if (v === null || v === '' || v === 'null') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y'].includes(s)) return true;
  if (['false', 'no', 'n'].includes(s)) return false;
  throw new Error(`bad ${key} "${v}", expected true, false or null`);
}

/**
 * ===============================
 * * A REAL COLUMN SHE CANNOT SET, AND THE TRUE REASON WHY
 * ===============================
 * Dropping a field out of ROW_FIELDS is enough to stop the write, but the
 * "not a column on a deal" message it falls into afterwards is a lie:
 * `status` IS a column, it is just worked out rather than typed. A wrong
 * reason is worse than no reason, because she then repeats it.
 *
 * `specialCaseDeal` sat here for a day. It is hers now, gated by
 * `confirmSpecialCaseDeal`, because an ask she cannot act on is worse than no
 * ask: she was to raise the question and then hand the click back.
 */
const NOT_SETTABLE = {
  status: 'The payment period is worked out from the payment start, the preset and the end '
    + 'date, every time it is read, so it cannot be set on its own. Change one of those three '
    + 'and it follows.',
};

/**
 * ***************************************************
 * * THE TWO CALL SHAPE FOR THE ONE FIELD THAT MOVES A TOTAL
 * ***************************************************
 *
 * Every other field on ROW_FIELDS moves one cell. `specialCaseDeal` moves a
 * total, a tint and a badge at once, and in the direction nobody audits:
 * money going IN. So it takes the same shape `rename_company` and the bulk
 * writes take, and for the same reason. A description saying "confirm
 * first" is not a guard; she has invented both a confirmation and its
 * result before.
 *
 * IT NAMES THE FIGURE, because the count is not the surprise here. One
 * deal is always one deal; what the admin has to agree to is the amount it
 * adds to a named month.
 *
 * @returns {object|null} the pending summary, or null to proceed
 */
/**
 * The month a special case is for and the figure it moves: ON adds the whole
 * month, OFF gives back what the row carries now. One definition, read by the
 * single deal confirm and the per deal bulk preview.
 */
function specialCaseFigure(before, on) {
  const month = monthName(monthOf(before?.preset_on) ?? currentMonth());
  const amount = on
    ? payableFromDays({
      monthlyAmount: before?.monthly_amount,
      presetOn: before?.preset_on ? new Date(before.preset_on) : null,
      payableDays: daysInMonthOf(new Date(before?.preset_on ?? Date.now())),
    })
    : Number(before?.payable_amount);
  const currency = before?.currency || 'GBP';
  const figure = Number.isFinite(Number(amount))
    ? `${currency} ${Number(amount).toLocaleString('en-GB')}`
    : 'its monthly amount';
  return { month, figure };
}

function confirmSpecialCaseDeal(args, before, fields) {
  if (fields.specialCaseDeal === undefined) return null;
  if (Boolean(before?.special_case_deal) === fields.specialCaseDeal) return null;

  const who = `${displayPersonName(before?.person_name)} at ${before?.company}`;
  const { month, figure } = specialCaseFigure(before, fields.specialCaseDeal);

  // A LINE, relayed word for word. As a bare act she paraphrased it ("Kiran
  // Vale at BAKER"), the confirm check never found "Brightwell" in what she
  // showed, and every yes re-asked the same question forever. 2026-09-29.
  return confirmFirst(args.confirmed, {
    act: fields.specialCaseDeal ? 'make this deal a special case' : 'stop this deal being a special case',
    count: 1,
    keeps: 'The payment start, the preset and the end date are not touched.',
    lines: [fields.specialCaseDeal
      ? `${who}: special case ON for ${month}, paid although the payment start says nothing is owed, adding ${figure} to that month`
      : `${who}: special case OFF for ${month}, taking ${figure} back out of that month`],
  });
}

/**
 * ***************************************************
 * * THE TWO SWITCHES THAT SAID "CONFIRM" AND ENFORCED NOTHING
 * ***************************************************
 *
 * THE INCIDENT, 2026-09-23, found by driving her twice in the browser.
 * "Drew at Umbrella UK Holdings should be paid this month" and "pay Mayah
 * at Churchill Knight for September anyway" both wrote
 * `overrideShouldBePaid: null -> true` IMMEDIATELY, on live rows, with no
 * confirmation asked.
 *
 * TWO FAULTS AT ONCE, and the second is the one that matters.
 *
 * She reached for the wrong field: "should be paid this month" matches
 * `overrideShouldBePaid` on the words and `specialCaseDeal` on the
 * meaning. That is a description problem and both are reworded below.
 *
 * BUT THE WRITE LANDED, and that is not. `overrideShouldBePaid`'s
 * description has said "Confirm with the admin before setting it" since it
 * was written, which is a SENTENCE. The guard was built for
 * `specialCaseDeal` alone, so the one field with a real guard sat beside
 * two that asked nicely, and she routed around it without trying to.
 *
 * `override_should_be_paid = false` EXCLUDES A ROW FROM A PAYOUT TOTAL, so
 * this moves money in the direction nobody audits, exactly like the field
 * it sits next to. Same two call shape, same reason.
 *
 * @returns {object|null} the pending summary, or null to proceed
 */
const SWITCH_WORDS = {
  overrideShouldBePaid: {
    column: 'override_should_be_paid',
    label: 'should be paid',
    unset: true,
    on: 'mark {who} as SHOULD BE PAID',
    off: 'mark {who} as NOT to be paid, which takes {figure} out of every payout total',
    keeps: 'The figures, the dates and whether the money has arrived are not touched.',
  },
  overridePaid: {
    column: 'override_paid',
    label: 'paid',
    unset: false,
    on: 'record that {who} HAS been paid {figure}',
    off: 'record that {who} has NOT been paid',
    keeps: 'The figures and the dates are not touched, and nothing is owed differently.',
  },
};

/** A switch reads "paid: off to on", never `to "true"`. NULL is its resolved default. */
function switchWord(key, v) {
  const on = v === null || v === undefined ? SWITCH_WORDS[key].unset : coerceTristate(v, key);
  return on ? 'on' : 'off';
}

function switchLine(key, value, row = null) {
  const from = row ? `${switchWord(key, row[SWITCH_WORDS[key].column])} to ` : '';
  return `${SWITCH_WORDS[key].label}: ${from}${switchWord(key, value)}`;
}

function confirmPaymentSwitch(args, before, fields) {
  for (const [key, words] of Object.entries(SWITCH_WORDS)) {
    if (fields[key] === undefined) continue;
    // Setting it to what it already is decides nothing, so it asks nothing.
    if ((before?.[words.column] ?? null) === fields[key]) continue;

    const who = `${displayPersonName(before?.person_name)} at ${before?.company}`;
    const currency = before?.currency || 'GBP';
    const amount = Number(before?.payable_amount);
    const figure = Number.isFinite(amount)
      ? `${currency} ${amount.toLocaleString('en-GB')}`
      : 'their payable amount';
    const say = (t) => t.replace('{who}', who).replace('{figure}', figure);

    // A LINE for the same reason as the special case: see confirmSpecialCaseDeal.
    const pending = confirmFirst(args.confirmed, {
      act: 'change a pay switch on this deal',
      count: 1,
      keeps: words.keeps,
      lines: [say(fields[key] ? words.on : words.off)],
    });
    if (pending) return pending;
  }
  return null;
}

/**
 * ===============================
 * * THE QUESTION SHE ASKS INSTEAD OF LEAVING A ROW AT ZERO
 * ===============================
 * Not triggered by anybody saying "special case". A phrase fires when it is
 * said and misses every time it is not; this is the STATE, so it catches
 * the next one without anybody remembering the words.
 *
 * The shape: the row is marked for the month, it is worth something a
 * month, and it still counts nothing toward that month. Nothing else
 * produces that, and it is exactly what a payment start after the month
 * looks like from the admin's side.
 *
 * SILENT WHEN THE SWITCH IS ALREADY ON, or she would ask about a row she
 * has just been told about.
 *
 * @returns {string|null} the question, or null when there is nothing to ask
 */
function specialCaseDealAsk(row, fields = null) {
  if (!row || row.special_case_deal) return null;
  /**
   * ===============================
   * * NOT WHEN THEY JUST TURNED IT OFF
   * ===============================
   * Live 2026-09-24. The admin said "turn it off", it was turned off, and
   * the same reply ended "Should September 2026 pay them anyway? Say yes
   * and I will set it." Asking whether to undo the thing they had asked
   * for, one sentence after doing it.
   *
   * The trigger is the STATE, which is right and stays: turning it off
   * PRODUCES that state, so the state alone cannot tell the two apart.
   * The write that just happened can.
   */
  if (fields?.specialCaseDeal === false) return null;
  if (!(Number(row.monthly_amount) > 0)) return null;
  if (!row.preset_on || isOwedThisMonth(row)) return null;

  const month = monthName(monthOf(row.preset_on) ?? currentMonth());
  const starts = dateInWords(row.payment_start_on);
  const why = starts
    ? `Their payment start is ${starts}, so ${month} owes nothing`
    : `${month} owes nothing on this row`;
  return `${why}. Should ${month} pay them anyway? Say yes and I will set it.`;
}

/** @returns {string|null} the refusal, or null when nothing derived was asked for */
function derivedFieldAsked(args) {
  const hit = Object.keys(NOT_SETTABLE).find((k) => args?.[k] !== undefined);
  return hit ? `NOTHING HAS BEEN CHANGED. ${NOT_SETTABLE[hit]}` : null;
}

function normalizeFields(args) {
  const out = {};
  for (const key of Object.keys(ROW_FIELDS)) {
    if (args[key] === undefined) continue;
    if (DATE_FIELDS.includes(key)) out[key] = coerceDate(args[key]);
    else if (TRISTATE_FIELDS.includes(key)) out[key] = coerceTristate(args[key], key);
    else out[key] = args[key];
  }
  if (args.groupName) out.groupName = String(args.groupName).toUpperCase();
  if (out.endOn !== undefined) out.status = statusFor(out.endOn);
  return out;
}

/**
 * TYPE INTO THE FORM THAT IS ALREADY OPEN, rather than writing the row.
 *
 * With a form on screen the admin says the deal out loud. Without this she
 * takes that as an instruction and calls add_deal straight away, so the
 * row is created behind a form still sitting there empty: no review, no
 * chance to catch a misheard amount, and a stale form they then submit a
 * second time.
 *
 * So dictation FILLS and the button stays theirs. That is also the only
 * thing that catches a wrong number, because it lands in a box they can
 * see instead of becoming a row they have to find and undo.
 */
const fillForm = {
  name: 'fill_form',
  description:
    'Type values into the form ALREADY ON SCREEN, without submitting it. Use this whenever a form '
    + 'is open and the admin tells you any of its details, whether one field or all of them. Send '
    + 'ONLY the fields they actually said; leave the rest empty rather than guessing. Do NOT call '
    + 'add_deal or update_master_sheet_row while a form is open, they press the button themselves. '
    + 'Afterwards say what you put in, what is still needed, and ask if it looks right.',
  parameters: { type: 'object', properties: ROW_FIELDS },
  async handler(args) {
    const values = normalizeFields(args);
    const names = Object.keys(values);
    if (names.length === 0) {
      return { summary: 'Nothing recognisable to fill in. Ask them which field they meant.' };
    }
    return {
      summary: `Filled in on screen: ${names.join(', ')}. The form is NOT submitted. `
        + 'Read back what you put in, name anything still required, and ask if it is right.',
      formFill: values,
    };
  },
};

/**
 * A LIST, not cards. NOT "not THIRTY cards": not any.
 *
 * `CARDS_MAX = 4` lived here, so a filter matching a handful drew full
 * deal cards. That turned a counting question into a thirty field dump:
 * "show me the special cases" matched one row and opened its dates and
 * bank columns to answer "one, and it is Mayah". Removed 2026-09-24.
 *
 * The card belongs to "show me her details", a different tool and a
 * different question. Asking for one by name still brings its full card
 * back.
 */

// How many matches still fit in a spoken sentence. Past this, "whose" is
// answered with a count and an offer, not a roll call.
const NAMES_IN_SUMMARY = 12;

function listAmount(r) {
  const cur = r.currency || 'GBP';
  const fmt = (v) => Number(v).toLocaleString('en-GB');
  if (r.monthly_amount == null) return money(r);
  const monthly = `${cur} ${fmt(r.monthly_amount)}`;
  return r.payable_amount != null && Number(r.payable_amount) !== Number(r.monthly_amount)
    ? `${monthly} · payable ${fmt(r.payable_amount)}`
    : monthly;
}

function listRow(r) {
  return {
    id: r.id,
    name: r.person_name || '(no handler)',
    where: [r.company, r.group_name].filter(Boolean).join(' · '),
    role: r.role_label || null,
    // THE MONTHLY, and the payable beside it only when they differ. It
    // showed the payable alone, so Drew's 1,250 deal read as 2,000. 2026-09-30.
    amount: listAmount(r),
    preset: r.preset_on ? formatValue(r.preset_on) : null,
    paid: r.override_paid,
    company: r.company || null,
    group: r.group_name || null,
  };
}

/**
 * WHAT A TOTAL COVERS, named. A company's total was headed "the whole sheet"
 * because the label read the group alone. 2026-09-25.
 */
// Words, not + and -: a minus reads as a dash in her replies. 2026-09-28.
const SIGN_WORD = Object.freeze({ add: 'plus', less: 'less' });
const capitalised = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);

function narrowedLabel(args) {
  const { company, ...narrowing } = filtersIn(args);
  // The GROUP from args: filtersIn never carries it, so a group total read "the whole sheet". 2026-09-28.
  const group = args?.group || null;
  // THE COMPANY LEADS: "the whole sheet, ..., at Co B" read as the sheet.
  const named = company ? [company].flat().join(' or ') : null;
  const base = named ? `${named}${group ? ` in ${group}` : ''}` : (group ?? 'the whole sheet');
  return Object.keys(narrowing).length === 0 ? base : `${base}, ${describeFilter({ ...narrowing, said: args?.said })}`;
}

/** What was asked for, in words, so the list says what it is. */
function describeFilter(a) {
  const bits = [];
  const has = (raw, value) => (Array.isArray(raw) ? raw.includes(value) : raw === value);
  const list = (raw) => (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const words = (raw) => list(raw).join(' or ');
  if (has(a.presetWhen, 'old')) bits.push('marked for an earlier month');
  if (has(a.presetWhen, 'future')) bits.push('marked for a later month');
  // Said differently from the preset on purpose. "Marked for a later
  // month" and "not started until a later month" are two different facts,
  // and reading them back with the same words is how they got confused.
  if (has(a.paymentStartWhen, 'future')) bits.push('not starting until a later month');
  if (has(a.paymentStartWhen, 'this-month')) bits.push('starting this month');
  if (has(a.paymentStartWhen, 'past')) bits.push('already started');
  if (has(a.presetWhen, 'current')) bits.push('marked for this month');
  if (has(a.source, 'manual')) bits.push('added by hand');
  if (has(a.source, 'synced')) bits.push('from an imported sheet');
  // The END DATE, said apart from the payment period on purpose: "ending"
  // is a date on the row, "ended" is what the period predicate decided.
  if (has(a.endWhen, 'soon')) bits.push(`ending within ${a.endSoonMonths ?? ENDING_SOON_MONTHS} months`);
  if (has(a.endWhen, 'this-month')) bits.push('ending this month');
  if (has(a.endWhen, 'future')) bits.push('ending after this month');
  if (has(a.endWhen, 'past')) bits.push('with an end date already passed');
  if (has(a.endWhen, 'none')) bits.push('with no end date, so ongoing');
  if (a.status) bits.push(`payment period ${words(a.status).replace(/_/g, ' ')}`);
  if (a.needsReview) bits.push('needs a check');
  if (a.paid === false) bits.push('not paid');
  if (a.paid === true) bits.push('paid');
  if (a.shouldBePaid === false) bits.push('should not be paid');
  if (a.missingPerson) bits.push('no handler');
  if (a.missingCompany) bits.push('no company');
  if (a.missingPhone) bits.push('no phone');
  if (a.missingBank) bits.push('no bank details');
  if (a.company) bits.push(`at ${words(a.company)}`);
  if (a.roleLabel) bits.push(`in the ${words(a.roleLabel)} role`);
  if (a.tier) bits.push(`on tier ${words(a.tier)}`);
  if (a.amountField && (a.amountMin != null || a.amountMax != null)) {
    // camelCase since the values became the repo's own keys, so it is split
    // on the capital rather than on an underscore that is no longer there.
    const field = a.amountField.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    // SAID THE WAY IT WAS APPLIED: "above 1000" never reads "1000 to any",
    // which sounds as though 1000 itself was counted. 2026-09-30.
    const { amountMinStrict, amountMaxStrict } = strictBounds(a);
    const lo = a.amountMin != null ? (amountMinStrict ? `above ${a.amountMin}` : `${a.amountMin} or more`) : null;
    const hi = a.amountMax != null ? (amountMaxStrict ? `below ${a.amountMax}` : `up to ${a.amountMax}`) : null;
    bits.push(`${field} ${[lo, hi].filter(Boolean).join(' and ')}`);
  }
  if (a.payableVsMonthly) {
    bits.push({ above: 'with a payable ABOVE their monthly', below: 'with a payable BELOW their monthly', equal: 'with a payable equal to their monthly' }[a.payableVsMonthly]);
  }
  if (a.currency) bits.push(`paid in ${words(a.currency)}`);
  if (a.paymentMethod) bits.push(`paid by ${words(a.paymentMethod)}`);
  // NAMED, so the sentence says what was actually searched. "matching
  // Manchester" is a different claim from "with Manchester in the location".
  if (a.q) {
    bits.push(a.searchField
      ? `with "${a.q}" in the ${list(a.searchField).map((field) => field
        .replace(/([A-Z])/g, ' $1').toLowerCase()).join(' or ')}`
      : `matching "${a.q}"`);
  }
  return bits.join(', ') || 'everything';
}

/**
 * THE PAGE'S OWN FILTERS, reachable by asking out loud.
 *
 * Everything the Master Sheet page narrows by, Diane narrows by, because
 * both go through repo.findAll. One definition of what "old preset" or
 * "ended" means, rather than her reimplementing it in prose and quietly
 * disagreeing with the screen — which is the failure that matters when
 * somebody is being told a number rather than reading it.
 *
 * SHE ASKS WHICH GROUP when the answer would otherwise be most of the
 * sheet. "Which rows are on an old preset" across 96 rows is not an
 * answer, and the group is nearly always what the question was scoped to.
 */
/**
 * ===============================
 * * ONE VOCABULARY FOR NARROWING THE SHEET
 * ===============================
 *
 * The list tool had seventeen ways to narrow and the TOTAL tool had two, so
 * "what are we paying the cash people in INDIGO" had no tool at all. She
 * does not refuse when a filter is missing: she reaches for the nearest
 * thing that exists, and on a total that is money.
 *
 * Declared ONCE and spread into both, so a filter added here reaches the
 * list and the figure in the same change and they cannot disagree about
 * what "ended" or "old preset" means. `group` is not in here: both tools
 * describe it in their own words because it is the one they ask for first.
 *
 * IT MIRRORS `repo.findAll`. A name here that the repo does not destructure
 * is silently ignored, which is exactly what knownArgs.js refuses.
 */
const pluralFilter = ({ type, enum: values, description }) => ({
  type: 'array',
  items: { type, ...(values ? { enum: values } : {}) },
  description: `${description} Pass every value in ONE array. This widens one answer; never call `
    + 'the tool once per value.',
});

const FILTER_PARAMS = {
  // WHEN THE MONEY STARTS, which is a DIFFERENT COLUMN from which
  // month a row is FOR. Asked which people have a payment start in a
  // future month she had no filter for it, improvised with presetWhen,
  // answered ONE, improvised again and answered TEN. It was EIGHT.
  paymentStartWhen: pluralFilter({
    type: 'string',
    enum: ['past', 'this-month', 'future'],
    description: 'The PAYMENT START date, by MONTH, against this month. Use it for "who has not started yet", "whose payment starts later", "started this month". NOT the same as presetWhen, which is the month the row is FOR.',
  }),
  // THE END DATE, which had no filter at all. "Whose deals are ending
  // soon" was answered off `status` ("none are marked as ended") while
  // rows ending this month sat on the sheet.
  endWhen: pluralFilter({
    type: 'string',
    enum: ['soon', 'this-month', 'future', 'past', 'none'],
    description: `The END DATE, by MONTH. Use it for "ending soon" (soon = this month or the next ${ENDING_SOON_MONTHS}), "ending this month", "already past their end date", "ongoing with no end date". NOT the same as status: status is the payment period this month, endWhen is the date written on the row.`,
  }),
  // WHERE THE ROW CAME FROM. The page has had this since the counts in
  // its toolbar ("96 from the sheet, 0 added by hand") became clickable,
  // and she was the only one who could not ask it.
  source: pluralFilter({
    type: 'string',
    enum: ['synced', 'manual'],
    description: 'synced = came from an imported sheet. manual = added by hand in the CRM. Use it for "which rows did we add ourselves" and "what is not on his sheet".',
  }),
  presetWhen: pluralFilter({
    type: 'string',
    // The same three the page offers, deliberately. A row with NO
    // preset belongs to none of them: it is owed every month, so it is
    // not "a different month" and claiming it under a fourth option
    // would make her list disagree with the screen.
    enum: ['current', 'old', 'future'],
    description: 'current = marked for this month, counted in the total. old/future = marked for another month, so NOT in this month\'s total. Rows with no preset at all are matched by none of these; they are owed every month.',
  }),
  status: pluralFilter({
    type: 'string',
    enum: [PERIOD.ACTIVE, PERIOD.ENDED, PERIOD.NOT_STARTED],
    description: 'Payment period. active = owed this month. not_started = its payment start '
      + 'is after the month, so nothing is owed YET. ended = finished, which only happens '
      + 'when the end date setting is on. The last two are NOT the same thing.',
  }),
  needsReview: { type: 'boolean' },
  shouldBePaid: { type: 'boolean', description: 'The admin switch, not the sheet\'s text column' },
  paid: { type: 'boolean', description: 'The admin switch' },
  missingPerson: { type: 'boolean', description: 'Orphaned by a deleted person' },
  missingCompany: { type: 'boolean', description: 'Orphaned by a deleted company' },
  missingPhone: { type: 'boolean', description: 'true: no phone number on the deal' },
  // "does anyone have no bank details?" ran the whole sheet check. 2026-10-03.
  missingBank: { type: 'boolean', description: 'true: no bank details and no account number on the deal' },
  company: pluralFilter({
    type: 'string',
    description: 'Exact company names. Use this instead of a text search when the company is known.',
  }),
  roleLabel: pluralFilter({ type: 'string', description: 'Roles exactly as the sheet writes them.' }),
  tier: pluralFilter({
    type: 'string',
    description: 'The boss\'s free text company tier, such as T3, Provider or In prep.',
  }),
  /**
   * ===============================
   * * THE REPO'S OWN KEYS, and they were snake_case here
   * ===============================
   * `AMOUNT_COLUMNS` in the repo is keyed camelCase and the page sends
   * camelCase. This declared `payable_days`, which is on no allow list, so
   * the lookup returned undefined and THE RANGE WAS SILENTLY DROPPED: the
   * query ran unfiltered and the whole sheet came back as the answer to
   * "who is on 0 payable days".
   *
   * The same shape `knownArgs.js` exists for, one level down: there it is a
   * filter that does not exist, here it is a filter whose VALUE does not.
   * Ignored rather than refused, either way.
   */
  amountField: {
    type: 'string',
    enum: ['monthlyAmount', 'payableAmount', 'payableDays', 'addonPercent', 'feePercent'],
    description: 'Which figure the min and max bound. The two percentages are figures too, so "an add on over 5%" is a range like any other.',
  },
  amountMin: { type: 'number' },
  amountMax: { type: 'number' },
  payableVsMonthly: {
    type: 'string',
    enum: ['above', 'below', 'equal'],
    description: 'The PAYABLE amount compared with the same deal\'s MONTHLY amount: "above" for '
      + '"payable exceeds the monthly", "below" for "paid less than their monthly", "equal". This '
      + 'is the ONLY way to answer those; a count from any other filter is not an answer to it.',
  },
  // Two closed sets off the sheet's own values, so they are PICKED.
  // The page gained both and this tool did not, so "who is paid in
  // crypto" had to be answered by reading a list.
  currency: pluralFilter({ type: 'string', description: 'As the sheet writes it: GBP, AED, EURO, USD. Case does not matter.' }),
  paymentMethod: pluralFilter({ type: 'string', enum: ['cash', 'bank', 'crypto'], description: 'How they are paid' }),
  q: { type: 'string', description: 'Free text. Searches name, company, group and role unless searchField says otherwise.' },
  // Free text columns no filter can reach. Same allow-list the page's
  // dropdown uses; an unknown value falls back to searching everything.
  /**
   * THE COMPANY'S OWN STATUS, which is not the deal's.
   *
   * `repo.findAll` has taken this since the closure work and no tool
   * offered it, so "who is on a company in liquidation" had no route at
   * all. `liquidation` is STILL PAYING, at amounts set per deal, and that
   * is exactly the set somebody needs to see.
   *
   * The values come from the repo, never typed here: one definition.
   */
  companyStatus: pluralFilter({
    type: 'string',
    enum: Object.values(companiesRepo.COMPANY_STATUS),
    description: "The COMPANY's status, not the deal's. liquidation is still paying. closed and "
      + 'dissolved have both ended and stopped every deal on it. This finds the DEALS on such a '
      + 'company. To name the COMPANIES themselves, "which companies are in liquidation", that is '
      + 'list_companies, not this.',
  }),
  /**
   * THE DEAL'S OWN STATUS, which is not the company's and not the queue.
   *
   * Shipped 2026-09-22 and never reached her. Asked "how many deals are
   * reviewed monthly" she called `list_monthly_review` and answered with
   * its 17 unanswered against the 12 rows that carry the status: a
   * confident number, about a different question.
   *
   * READ ONLY, deliberately. Setting it writes two columns and can clear
   * an end date, so it stays a click until the user says otherwise.
   * See docs/diane.md.
   */
  dealStatus: pluralFilter({
    type: 'string',
    enum: DEAL_STATUS_VALUES,
    description: `The DEAL's status: ${DEAL_STATUS_VALUES.map((v) => `${v} is "${DEAL_STATUS_LABEL[v]}"`).join(', ')}. `
      + 'Use it for "which deals are reviewed monthly", "which are going concerns", "how many are '
      + 'active". This is the STATUS ON THE ROW, a fact. list_monthly_review is the QUEUE of deals '
      + 'still to be answered this month, which is a different question and a different number. '
      + 'To CHANGE it, use update_master_sheet_row with dealStatus; it previews first.',
  }),
  /**
   * ===============================
   * * SPECIAL CASE, AND IT HAD NO FILTER EITHER, 2026-09-24
   * ===============================
   * Live transcript: "tell me those deals that are special cases" came
   * back "I cannot filter deals by special case directly" followed by an
   * offer to answer a DIFFERENT question, deals with a preset for this
   * month. The column was on every row she had already read.
   *
   * NOT `pluralFilter`. It is a boolean, not a set, and false has to be
   * askable: "which ones are NOT special cases" is a real question.
   */
  specialCaseDeal: {
    type: 'boolean',
    description: 'True for deals set to pay their preset month although the payment start says nothing is owed, false for the ordinary ones. Use it for "show me the special cases". The switch is on the payment start cell on the master sheet page.',
  },
  /**
   * ===============================
   * * SEVEN COLUMNS THAT HAD NO FILTER, 2026-09-17
   * ===============================
   * Each was a question she could not answer and would not refuse: a
   * filter that does not exist is IGNORED by the query, so the answer came
   * back as the whole sheet described as something narrower.
   *
   * The two RATES went to `amountField` instead of becoming filters of
   * their own: they are figures, and "an add on over 5%" is a range like
   * any other. One mechanism, not two.
   */
  appointmentWhen: pluralFilter({
    type: 'string',
    enum: ['past', 'this-month', 'future', 'none'],
    description: 'The APPOINTMENT date, by month, against this month. Use it for "who did we take on in August", "who started recently". `none` is a row with no appointment at all, which is why its payment start cannot be checked. The other three dates derive FROM this one.',
  }),
  acceptingPostals: pluralFilter({
    type: 'string',
    description: 'As the sheet writes it: Yes, No, Handled Internally. Free text, so match what is there rather than assuming a closed set.',
  }),
  label: pluralFilter({ type: 'string', description: "The row's label column, as the sheet writes it." }),
  paymentOutcome: pluralFilter({
    type: 'string',
    enum: ['confirmed', 'partial', 'not_received', 'sent', 'no_response'],
    description: "What the person said on WhatsApp. Whatbot's own column: confirmed and partial switch Paid on, not_received off, sent and no_response touch nothing.",
  }),
  oldGroup: {
    type: 'string',
    description: "HIS own earlier group name on the COMPANY (Milky, Wallaby 1, V3), never one of ours. A company's real groups come from its deals.",
  },
  sheetShouldBePaid: pluralFilter({
    type: 'string',
    description: "The BOSS's own free text column, not the admin switch. Use `shouldBePaid` for the switch.",
  }),
  sheetPaid: pluralFilter({
    type: 'string',
    description: "The BOSS's own free text column, not the admin switch. Use `paid` for the switch.",
  }),
  searchField: pluralFilter({
    type: 'string',
    enum: ['company', 'location', 'postcode', 'bankDetails', 'accountNumber', 'sortCode', 'notes', 'doorNumber'],
    description: 'Point `q` at one or more columns instead of the usual four. Use `company` for "everyone at Northstar Care", location for "who is in North City", bankDetails for "who banks with Example Bank", or a postcode or account number.',
  }),
};

// Just the narrowing arguments she actually sent, so `group`, `month`,
// `person` and the rest never reach a filter check meant for rows.
const FILTER_KEYS = Object.keys(FILTER_PARAMS);

/**
 * THE SAME FILTERS, SAID ONCE. FILTER_PARAMS is spread into three tools and
 * its descriptions carry the incident that made each one, about 8.5 KB a
 * copy, sent on every turn. The filter keeps them in full; the total and
 * the bulk edit get each description's first sentence, with every enum and
 * type intact, so what she may send is unchanged. 2026-10-03.
 */
const shortDescription = (text) => {
  const t = String(text ?? '');
  const first = /^[\s\S]*?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}...` : first;
};
const shorten = (spec) => {
  if (!spec || typeof spec !== 'object') return spec;
  const out = { ...spec };
  if (out.description) out.description = shortDescription(out.description);
  if (out.items) out.items = shorten(out.items);
  if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map(shorten);
  if (Array.isArray(out.oneOf)) out.oneOf = out.oneOf.map(shorten);
  return out;
};
const FILTER_PARAMS_SHORT = Object.fromEntries(Object.entries(FILTER_PARAMS).map(([k, v]) => [k, shorten(v)]));

function filtersIn(args) {
  const out = {};
  for (const k of FILTER_KEYS) if (args?.[k] !== undefined && args[k] !== null) out[k] = args[k];
  return out;
}

// `said` travels, or the INVENTED branch can never fire. Every call site
// omitted it, so a name the model made up was reported to the admin as a
// missing company exactly as though they had asked about it.
async function unknownCompanyFilter(raw, said = '') {
  const companies = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  for (const company of companies) {
    // eslint-disable-next-line no-await-in-loop
    const wrong = await notACompany(company, said);
    if (wrong) return wrong;
  }
  return null;
}

/**
 * ===============================
 * * WHO IS RESOLVED HERE, WHICH ROWS IS DECIDED BY THE SQL
 * ===============================
 *
 * "What is Nathan owed in cash" needs both: the name resolves through
 * `searchFuzzy` with its ambiguity rules, and `cash` is a column. Writing a
 * second predicate in JS would put two definitions of every filter in the
 * codebase and the money one would be the one that drifted.
 *
 * So the filters run as the query they already are, and the answer is the
 * INTERSECTION. One definition, and the list and the figure cannot
 * disagree about what "ended" means.
 */
/**
 * "MORE THAN 1000" DOES NOT INCLUDE 1000, in every place a bound is read:
 * the list, the total over a list, and the group total. Three copies drifted
 * and the total counted what the list left out. 2026-09-30.
 */
function strictBounds(args, said = args?.said) {
  const heard = String(said ?? '');
  return {
    amountMinStrict: args?.amountMin != null
      && /\b(?:more|greater|higher|bigger)\s+than\b|\bover\b|\babove\b|\bexceeding\b/i.test(heard),
    amountMaxStrict: args?.amountMax != null
      && /\b(?:less|lower|smaller|fewer)\s+than\b|\bunder\b|\bbelow\b/i.test(heard),
  };
}

async function narrowByFilters(rows, args) {
  const filters = filtersIn(args);
  if (Object.keys(filters).length === 0) return { rows };

  // The GROUP travels too. It cannot change the intersection, since that
  // only ever removes, but without it this reads the whole sheet to narrow
  // six rows and the row cap below could refuse a question it can answer.
  // THE SAME STRICTNESS the list uses, so "above 1000" totals what it listed.
  const found = await repo.findAll({
    ...filters,
    group: args.group,
    ...strictBounds(filters, args.said),
    page: 1,
    pageSize: TOTAL_ROW_LIMIT,
  });
  if (found.total > found.rows.length) {
    return {
      refused: `${found.total} rows match that, more than I add up in one go. `
        + 'Tell the admin to narrow it to one group or one person.',
    };
  }

  const allowed = new Set(found.rows.map((r) => r.id));
  return { rows: rows.filter((r) => allowed.has(r.id)) };
}

/**
 * How many rows were in SCOPE before the filters narrowed it.
 *
 * The same query with the row filters taken off, so "30 of 39 in INDIGO"
 * comes from one definition rather than a second count written by hand.
 * `group` is not a row filter here: it is the scope the question was
 * asked inside, which is exactly what the denominator has to be.
 */
async function scopeCount(args) {
  const { total } = await repo.findAll({ group: args.group, page: 1, pageSize: 1 });
  return Number.isFinite(total) ? total : null;
}

/**
 * A GROUP TAKEN OUT OF SOMEBODY'S OWN NAME is not a scope. "add 100 to
 * milkman jones" was filtered as q "milkman jones" IN MILKMAN, found
 * nothing, and told them so. Dropped only when q is a whole name on the
 * sheet and they never said the group anywhere outside that name.
 */
async function groupOutOfOwnName(args) {
  if (!args?.q) return args;
  let options;
  try { options = await peopleRepo.filterOptions(); } catch { return args; }
  const people = options?.people ?? [];
  /**
   * AND THE OTHER WAY: a group glued INTO q. "kiran baker" came back as
   * "IS TWO THINGS, call again", she retried with a `person` argument that
   * does not exist here, and only the third call worked. Split it here
   * with the rule every other door uses.
   */
  if (!args.group && !args.company) {
    const read = readRequest({ person: args.q, said: args.said, saidRecent: args.saidRecent }, options);
    if (read.person && read.person !== args.q && read.group) return { ...args, q: read.person, group: read.group };
    if (read.person && read.person !== args.q && read.company) return { ...args, q: read.person, company: read.company };
    return args;
  }
  if (!args.group) return args;
  const name = people.map((p) => p.name).find((n) => fold(n) === fold(args.q));
  if (!name) {
    // The group came from their sentence (perGroup) and is STILL in q:
    // "kiran baker" in BAKER searched for somebody called that. Take it out.
    const read = readRequest({ person: args.q, said: args.said }, options);
    if (read.group && fold(read.group) === fold(args.group) && read.person && read.person !== args.q) {
      return { ...args, q: read.person };
    }
    return args;
  }
  const g = fold(args.group);
  if (!fold(name).includes(g)) return args;
  const said = fold(args.said ?? '');
  const inName = said.split(fold(name)).length - 1;
  const inSaid = said.split(g).length - 1;
  if (inSaid > inName) return args;
  const { group, ...rest } = args;
  return rest;
}

/**
 * ***************************************************
 * * ONE GENERAL READ: COUNT, SUM, AVERAGE, MIN, MAX, BY ANYTHING
 * ***************************************************
 * Held-out wording, 2026-10-04: "what's the average monthly in baker?" and
 * "how many people have more than one deal?" had no tool at all, so she
 * listed rows or ran the sheet check. Patching each phrasing did not carry
 * to the next one (a fresh set scored the same before and after), so this
 * is the general door: the same filters, then one measure, optionally per
 * person / company / group / role / currency / method, with a threshold.
 *
 * COMPUTED HERE. Money is never added across currencies: each currency is
 * its own figure, exactly as every total in this file does it.
 */
const SUMMARY_FIELD = { monthlyAmount: 'monthly_amount', payableAmount: 'payable_amount', payableDays: 'payable_days' };
const SUMMARY_BY = {
  person: (r) => r.person_name, company: (r) => r.company, group: (r) => r.group_name,
  role: (r) => r.role_label, currency: (r) => r.currency || 'GBP', paymentMethod: (r) => r.payment_method,
};
const summarizeDeals = {
  name: 'summarize_deals',
  description:
    'An AVERAGE, or a figure PER person / company / group / role / currency / method: "average monthly '
    + 'in X", "how many people have more than one deal" (count by person, atLeast 2), "people at each '
    + 'company", "what each group costs" (sum by group). NOT for a plain count of deals, a list, or who '
    + 'is above/below an amount: those are filter_master_sheet. Same filters as filter_master_sheet. '
    + 'Answers are computed; money is never added across currencies.',
  parameters: {
    type: 'object',
    properties: {
      group: { type: 'string', description: 'One group to look inside.' },
      ...FILTER_PARAMS_SHORT,
      measure: { type: 'string', enum: ['count', 'sum', 'average', 'min', 'max'], description: 'What to compute. count counts deals (or people, with countPeople).' },
      field: { type: 'string', enum: Object.keys(SUMMARY_FIELD), description: 'The amount measured, for sum/average/min/max. Defaults to monthlyAmount.' },
      countPeople: { type: 'boolean', description: 'With count: count distinct people instead of deals.' },
      by: { type: 'string', enum: Object.keys(SUMMARY_BY), description: 'Per what, if anything.' },
      atLeast: { type: 'number', description: 'Keep only the groups whose result is at least this ("more than one deal" is count by person, atLeast 2).' },
      atMost: { type: 'number', description: 'Keep only the groups whose result is at most this.' },
    },
    required: ['measure'],
  },
  async handler(args = {}) {
    // "MORE THAN ONE DEAL" IS PER PERSON, whatever was sent: it came as a
    // count of people with no grouping, and was answered "12 people".
    const perDeals = /\b(?:more than|over|at least|several|multiple)\s+(?:(one|two|three|four|five|\d+)\s+)?deals?\b/i.exec(String(args.said ?? ''));
    if (perDeals && !args.by) {
      const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
      const n = perDeals[1] ? (words[perDeals[1].toLowerCase()] ?? Number(perDeals[1])) : 1;
      const exact = /\bat least\b/i.test(perDeals[0]);
      args = { ...args, measure: 'count', countPeople: false, by: 'person', atLeast: exact ? n : n + 1 };
    }
    // "PEOPLE AT EACH COMPANY" IS PER COMPANY, counting people: it came as
    // by person and listed everyone with a deal count. 2026-10-04.
    const eachOf = /\b(?:at|in|for|per|by)?\s*(?:each|every|per)\s+(company|group|role|currency)\b/i.exec(String(args.said ?? ''));
    if (eachOf) {
      const by = eachOf[1].toLowerCase();
      const people = /\b(?:people|persons|staff|handlers|workers)\b/i.test(String(args.said ?? ''));
      args = { ...args, by, ...(people ? { countPeople: true, measure: args.measure && args.measure !== 'count' ? args.measure : 'count' } : {}) };
    }
    // "WHO HAS THE MOST DEALS" is a count per person, answered with the
    // top of it, ties named. It came as a plain count of the sheet. 2026-10-04.
    const most = /\b(?:who|which (?:person|people|company|group|role))\b[^.?!]*\b(most|fewest|least)\s+deals\b/i.exec(String(args.said ?? ''));
    if (most) {
      const byWord = /\bcompany\b/i.test(most[0]) ? 'company' : /\bgroup\b/i.test(most[0]) ? 'group' : /\brole\b/i.test(most[0]) ? 'role' : 'person';
      const rows = ((await repo.findAll({ ...filtersIn(args), ...(args.group ? { group: args.group } : {}), pageSize: 5000 }).catch(() => null))?.rows ?? [])
        .filter((r) => !r.stopped_on);
      const counts = new Map();
      for (const r of rows) {
        const k = SUMMARY_BY[byWord](r) || '(none)';
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const sorted = [...counts].sort((a, b) => (most[1].toLowerCase() === 'most' ? b[1] - a[1] : a[1] - b[1]));
      if (sorted.length === 0) {
        if (args.group) {
          const wrong = await notAGroup(args.group, args.said);
          if (wrong) return { summary: wrong };
        }
        const reply = 'There are no live deals to count.';
        return { summary: reply, reply, computedReply: true };
      }
      const top = sorted.filter(([, n]) => n === sorted[0][1]);
      const listed = top.slice(0, 6).map(([k]) => k);
      const names = top.length > 6 ? `${listed.join(', ')} and ${top.length - 6} more`
        : listed.length > 1 ? `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1]}` : listed[0];
      const reply = `${names} ${top.length === 1 ? 'has' : 'have'} the ${most[1].toLowerCase()} deals: ${sorted[0][1]}${top.length > 1 ? ' each' : ''}.`;
      return { summary: `${reply}\n\nCOMPUTED. Say it as written.`, reply, computedReply: true };
    }
    // A PLAIN COUNT OR A THRESHOLD LIST IS THE FILTER'S, which words it the
    // way every count reads ("14 deals", "5 deals ... held by 4 people").
    if (!args.by && (args.measure ?? 'count') === 'count') {
      const { measure: _m, field: _f, countPeople: _c, by: _b, atLeast: _l, atMost: _u, ...rest } = args;
      return filterRows.handler(rest);
    }
    const measure = args.measure ?? 'count';
    const field = SUMMARY_FIELD[args.field] ? args.field : 'monthlyAmount';
    const column = SUMMARY_FIELD[field];
    const rows = ((await repo.findAll({ ...filtersIn(args), ...(args.group ? { group: args.group } : {}), pageSize: 5000 }).catch(() => null))?.rows ?? [])
      .filter((r) => !r.stopped_on);
    // A GROUP THAT NEVER EXISTED IS NOT "No live deals in X": the same
    // confident zero the filter and the total refuse. Unit sweep 2026-10-06.
    if (rows.length === 0 && args.group) {
      const wrong = await notAGroup(args.group, args.said);
      if (wrong) return { summary: wrong };
    }
    const keyOf = SUMMARY_BY[args.by] ?? (() => 'all');
    const buckets = new Map();
    for (const r of rows) {
      const k = keyOf(r) || '(none)';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(r);
    }
    const money = (field === 'monthlyAmount' || field === 'payableAmount') && measure !== 'count';
    const fmt = (n) => Number(Math.round(n * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 });
    // One result per bucket: a number for count/days, per currency for money.
    const resultOf = (list) => {
      // Per person, "people" is always one: what is counted there is deals.
      const people = args.countPeople && args.by !== 'person';
      if (measure === 'count') return { n: people ? new Set(list.map((r) => r.person_id ?? r.person_name)).size : list.length };
      const byCur = new Map();
      for (const r of list) {
        const cur = money ? (r.currency || 'GBP') : '';
        if (!byCur.has(cur)) byCur.set(cur, []);
        byCur.get(cur).push(Number(r[column]) || 0);
      }
      const per = [...byCur].map(([cur, vals]) => {
        const v = measure === 'sum' ? vals.reduce((a, b) => a + b, 0)
          : measure === 'average' ? vals.reduce((a, b) => a + b, 0) / vals.length
            : measure === 'min' ? Math.min(...vals) : Math.max(...vals);
        return { cur, v };
      });
      return { per, n: per.length === 1 ? per[0].v : null };
    };
    let results = [...buckets].map(([k, list]) => ({ k, deals: list.length, ...resultOf(list) }));
    if (args.atLeast != null) results = results.filter((x) => x.n != null && x.n >= Number(args.atLeast));
    if (args.atMost != null) results = results.filter((x) => x.n != null && x.n <= Number(args.atMost));
    results.sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
    const label = measure === 'count' ? (args.countPeople && args.by !== 'person' ? 'people' : 'deals')
      : `${measure} ${field === 'monthlyAmount' ? 'monthly' : field === 'payableAmount' ? 'payable' : 'payable days'}`;
    const shown = (x) => (x.per
      ? x.per.map(({ cur, v }) => `${cur ? `${cur} ` : ''}${fmt(v)}`).join(' and ')
      : `${x.n}`);
    const where = [args.group, ...[].concat(args.company ?? [])].filter(Boolean).join(', ');
    let reply;
    if (rows.length === 0) reply = `No live deals${where ? ` in ${where}` : ''} match.`;
    else if (!args.by && measure === 'count') reply = `${shown(results[0])} ${label}${where ? ` in ${where}` : ''}.`;
    else if (!args.by) reply = `The ${label}${where ? ` in ${where}` : ''} is ${shown(results[0])}, over ${rows.length} live deals.`;
    else if (results.length === 0) {
      const bound = args.atLeast != null ? `at least ${args.atLeast}` : `at most ${args.atMost}`;
      reply = `No ${args.by}${where ? ` in ${where}` : ''} has ${measure === 'count' ? `${bound} ${label}` : `a ${label} of ${bound}`}.`;
    }
    else {
      const top = results.slice(0, 12).map((x) => `${x.k} ${shown(x)}`).join('; ');
      const plural = { person: 'people', company: 'companies', group: 'groups', role: 'roles', currency: 'currencies', paymentMethod: 'payment methods' };
      reply = `${results.length} ${results.length === 1 ? args.by : plural[args.by]}`
        + `${where ? ` in ${where}` : ''}, ${label}: ${top}${results.length > 12 ? '; and more' : ''}.`;
    }
    return { summary: `${reply}\n\nCOMPUTED from the live rows. Say it as written.`, reply, computedReply: true };
  },
};

const filterRows = {
  name: 'filter_master_sheet',
  description:
    'Narrow the master sheet exactly the way its page does, and show what matches. Use it for any '
    + '"which rows are…", "who is…", "show me everyone that…" question: an old or future preset, '
    + 'unpaid, ended, needs a check, missing a handler or company, an amount range. For which COMPANIES are in a group use active_companies instead. IF THE ADMIN '
    + 'HAS NOT SAID WHICH GROUP, ask them first — without one this searches all 96 rows and the '
    + 'answer is a list nobody can hold in their head. BUT when they said "all", "every" or '
    + '"everything", that IS their answer: search every group and do NOT ask which group '
    + 'afterwards. They are often not looking at the screen, '
    + 'so afterwards say the COUNT and what the rows have in common, out loud, in one sentence.',
  parameters: {
    type: 'object',
    properties: {
      group: { type: 'string', description: 'One group, e.g. ALPHA. Ask for this before searching the whole sheet.' },
      ...FILTER_PARAMS,
      sortBy: {
        type: 'string',
        enum: ['monthlyAmount', 'payableAmount', 'payableDays', 'assignedOn', 'paymentStartOn', 'endOn'],
        description: 'For "lowest", "highest", "smallest", "biggest", "earliest", "latest" about DEALS: '
          + 'the field to order the matching deals by. Amounts compare in USD across currencies.',
      },
      sortOrder: { type: 'string', enum: ['lowest', 'highest'], description: 'lowest / earliest first, or highest / latest first.' },
      limit: { type: 'number', description: 'How many to name after sorting: "the lowest" is 1, "top 3" is 3.' },
    },
  },
  async handler(args) {
    args = await groupOutOfOwnName(args);
    /**
     * ===============================
     * * LOWEST, HIGHEST, SMALLEST, BIGGEST: ORDERED IN CODE
     * ===============================
     * Held-out wording 2026-10-03: "whats the lowest monthly in corvid" got
     * "5 deals in CORVID", and "who's got the smallest deal" got the people
     * owed the MOST. Nothing could order deals. The matching rows are read
     * whole, put in USD where the field is money, sorted and cut here.
     */
    const heardSort = String(args.said ?? '');
    if (!args.sortBy) {
      const sup = /\b(lowest|smallest|cheapest|least|minimum|highest|biggest|largest|most expensive|maximum|top|bottom|earliest|latest|newest|oldest)\b/i.exec(heardSort);
      if (sup && /\b(?:deals?|monthly|payable|amount|salary|pay(?:ing)?|rate|appointed|appointment|start(?:s|ed)?|end(?:s|ing)?)\b/i.test(heardSort)
        && !/\b(?:owed|earners?|people|persons?)\b/i.test(heardSort)) {
        const word = sup[1].toLowerCase();
        args = {
          ...args,
          sortBy: /\bpayable\b/i.test(heardSort) ? 'payableAmount'
            : /\bappoint/i.test(heardSort) || /\b(?:newest|oldest)\b/i.test(word) ? 'assignedOn'
              : /\bstart/i.test(heardSort) ? 'paymentStartOn' : /\bend/i.test(heardSort) ? 'endOn' : 'monthlyAmount',
          sortOrder: /lowest|smallest|cheapest|least|minimum|bottom|earliest|oldest/.test(word) ? 'lowest' : 'highest',
        };
      }
    }
    if (args.sortBy) {
      const { sortBy, sortOrder = 'highest', limit, ...rest } = args;
      const n = Math.max(1, Math.min(20, Number(limit) || (/\b(?:top|bottom)\s*(\d+)/i.exec(heardSort)?.[1] ? Number(/\b(?:top|bottom)\s*(\d+)/i.exec(heardSort)[1]) : 1)));
      const all = ((await repo.findAll({ ...filtersIn(rest), ...(rest.group ? { group: rest.group } : {}), pageSize: 2000 }).catch(() => null))?.rows ?? []).filter((r) => !r.stopped_on);
      const column = { monthlyAmount: 'monthly_amount', payableAmount: 'payable_amount', payableDays: 'payable_days', assignedOn: 'assigned_on', paymentStartOn: 'payment_start_on', endOn: 'end_on' }[sortBy];
      const money = sortBy === 'monthlyAmount' || sortBy === 'payableAmount';
      const fxNow = money ? await fxRates.usdPerGbp() : null;
      const keyOf = (r) => {
        const v = r[column];
        if (v == null || v === '') return null;
        if (money) return totalInUsd([[r.currency || 'GBP', Number(v)]], fxNow.usdPerGbp, fxNow.perUsd).usd;
        return sortBy === 'payableDays' ? Number(v) : String(v).slice(0, 10);
      };
      const keyed = all.map((r) => ({ r, k: keyOf(r) })).filter((x) => x.k != null);
      keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) * (sortOrder === 'lowest' ? 1 : -1));
      let cut = keyed.slice(0, n);
      // A tie at the cut is named, never dropped.
      while (cut.length < keyed.length && cut.length < 30 && keyed[cut.length].k === cut[cut.length - 1]?.k) cut = keyed.slice(0, cut.length + 1);
      const shown = (r) => (money ? `${r.currency || 'GBP'} ${Number(r[column]).toLocaleString('en-GB')}`
        : sortBy === 'payableDays' ? `${r[column]} days` : dateInWords(r[column]));
      const label = { monthlyAmount: 'monthly', payableAmount: 'payable this month', payableDays: 'payable days', assignedOn: 'appointment', paymentStartOn: 'payment start', endOn: 'end date' }[sortBy];
      const where = [rest.group, ...[].concat(rest.company ?? [])].filter(Boolean).join(', ');
      const reply = cut.length === 0 ? `No deals${where ? ` in ${where}` : ''} have a ${label} to order by.`
        : `${sortOrder === 'lowest' ? 'Lowest' : 'Highest'} ${label}${where ? ` in ${where}` : ''}: `
          + `${cut.map(({ r }) => `${r.person_name} (${[r.company, r.group_name].filter(Boolean).join(' in ')}) ${shown(r)}`).join('; ')}.`;
      return { summary: `${reply}\n\nORDERED in code${money ? ', compared in USD' : ''}. Say it as written.`, reply, computedReply: true, rows: cut.map(({ r }) => summarizeRow(r)) };
    }
    /**
     * ===============================
     * * COUNTS AND RANKINGS OF THINGS THAT ARE NOT DEALS
     * ===============================
     * Held-out wording, 2026-10-03: "how many companies do we deal with?"
     * and "which company has the most deals?" were both answered "14 deals
     * across every group". The rows were right; the noun was not. Counted
     * here off the same live rows, by the noun in their question.
     */
    const heardNoun = String(args.said ?? '');
    const liveRowsFor = async () => ((await repo.findAll({ ...filtersIn(args), ...(args.group ? { group: args.group } : {}), pageSize: 2000 }).catch(() => null))?.rows ?? [])
      .filter((r) => !r.stopped_on);
    const NOUN = { compan: 'company', group: 'group_name', people: 'person_name', person: 'person_name' };
    const rankNoun = /\bwhich\s+(compan(?:y|ies)|groups?|person|people)\b[^.?!]*\b(most|fewest|least|biggest|smallest)\b[^.?!]*\b(deals?|people)\b/i.exec(heardNoun);
    if (rankNoun) {
      const by = NOUN[Object.keys(NOUN).find((k) => rankNoun[1].toLowerCase().startsWith(k))];
      const counting = rankNoun[3].toLowerCase().startsWith('deal') ? 'deals' : 'people';
      const tally = new Map();
      for (const r of await liveRowsFor()) {
        const key = r[by] || '(none)';
        if (!tally.has(key)) tally.set(key, { deals: 0, people: new Set() });
        tally.get(key).deals += 1;
        tally.get(key).people.add(r.person_id ?? r.person_name);
      }
      const most = !/fewest|least|smallest/i.test(rankNoun[2]);
      const ranked = [...tally].map(([k, v]) => [k, counting === 'deals' ? v.deals : v.people.size])
        .sort((a, b) => (most ? b[1] - a[1] : a[1] - b[1]));
      const top = ranked.filter((r) => r[1] === ranked[0]?.[1]);
      const reply = ranked.length === 0 ? 'There are no live deals.'
        : `${top.map((t) => t[0]).join(' and ')} ${top.length > 1 ? 'have' : 'has'} the ${most ? 'most' : 'fewest'} ${counting}: ${top[0][1]}. `
          + `Next: ${ranked.slice(top.length, top.length + 3).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}.`;
      return { summary: `${reply}\n\nCOUNTED in code over the live rows. Say it as written.`, reply, computedReply: true };
    }
    // "list the groups": the groups themselves, with how many live deals each.
    if (/\b(?:list|show|name|what are|which are)\b[^.?!]*\bgroups\b/i.test(heardNoun) && !/\bin\s+(?:the\s+)?groups?\b/i.test(heardNoun)) {
      const tally = new Map();
      for (const r of await liveRowsFor()) if (r.group_name) tally.set(r.group_name, (tally.get(r.group_name) ?? 0) + 1);
      const reply = tally.size === 0 ? 'There are no groups with live deals.'
        : `${tally.size} groups: ${[...tally].sort((a, b) => a[0].localeCompare(b[0])).map(([g, n]) => `${g} (${n} ${n === 1 ? 'deal' : 'deals'})`).join(', ')}.`;
      return { summary: `${reply}\n\nCOUNTED in code. Say it as written.`, reply, computedReply: true };
    }
    const countNoun = /\bhow many\s+(?:different\s+)?(compan(?:y|ies)|groups?|people|persons?)\b/i.exec(heardNoun);
    // "deal WITH" is a verb: "how many companies do we deal with" is still companies.
    if (countNoun && !/\bdeals\b|\bdeal\b(?!\s+with)/i.test(heardNoun.replace(countNoun[0], ''))) {
      const by = NOUN[Object.keys(NOUN).find((k) => countNoun[1].toLowerCase().startsWith(k))];
      const live = await liveRowsFor();
      const names = new Set(live.map((r) => (by === 'person_name' ? (r.person_id ?? r.person_name) : r[by])).filter(Boolean));
      const noun = by === 'company' ? 'companies' : by === 'group_name' ? 'groups' : 'people';
      const scopeWords = [args.group, ...[].concat(args.company ?? []), args.q].filter(Boolean).join(', ');
      const reply = `${names.size} ${noun} on live deals${scopeWords ? ` (${scopeWords})` : ''}${names.size <= 8 ? `: ${[...names].map((n) => live.find((r) => (r.person_id ?? r.person_name) === n)?.person_name ?? n).join(', ')}` : ''}.`;
      return { summary: `${reply}\n\nCOUNTED in code. Say it as written.`, reply, computedReply: true };
    }
    // "PASSED THEIR END DATE" IS THE DATE ON THE ROW, not the payment period
    // setting: she sent status ended and found none. 2026-10-03.
    if (/\bend(?:ed|ing)?\s*dates?\b|\bpast (?:their|the) end\b/i.test(heardNoun) && /\b(?:passed|past|gone|over|expired|before today)\b/i.test(heardNoun)) {
      const { status: _st, ...restEnd } = args;
      // eslint-disable-next-line no-param-reassign
      args = { ...restEnd, endWhen: ['past'] };
    }
    /**
     * "WHO STARTED THIS MONTH" HAS TWO ANSWERS, and the admin means both:
     * who was APPOINTED this month, and whose PAYMENT STARTS this month.
     * Live 2026-10-03 it named Testy McTest alone, though Nathan, Drew,
     * Mayah and Louis all start being paid on 11 October.
     */
    if (/\bwho\b[^.?!]*\b(?:start(?:ed|s|ing)?|join(?:ed|s|ing)?|began|begin(?:s|ning)?|new)\b[^.?!]*\bthis month\b/i.test(String(args.said ?? ''))) {
      const month = currentMonth();
      const all = (await repo.findAll({ pageSize: 2000, ...(args.group ? { group: args.group } : {}) }).catch(() => null))?.rows ?? [];
      const live = all.filter((r) => !r.stopped_on);
      const inMonth = (d) => String(d ?? '').slice(0, 7) === month;
      const label = (r) => `${r.person_name} (${[r.company, r.group_name].filter(Boolean).join(' in ')})`;
      const appointed = live.filter((r) => inMonth(r.assigned_on));
      const paying = live.filter((r) => inMonth(r.payment_start_on) && !inMonth(r.assigned_on));
      const lines = [];
      lines.push(appointed.length
        ? `Appointed this month: ${appointed.map(label).join(', ')}.`
        : 'Nobody was appointed this month.');
      if (paying.length) {
        const byDay = new Map();
        for (const r of paying) {
          const day = dateInWords(r.payment_start_on);
          byDay.set(day, [...(byDay.get(day) ?? []), label(r)]);
        }
        lines.push(`Payment starts this month: ${[...byDay].map(([day, who]) => `${who.join(', ')} on ${day}`).join('; ')}.`);
      } else {
        lines.push('Nobody\'s payment starts this month.');
      }
      const reply = lines.join('\n');
      return { summary: `${reply}\n\nCOMPUTED from the dates. Say it as written.`, reply, computedReply: true, rows: [...appointed, ...paying].map(summarizeRow) };
    }
    /**
     * NOTHING SENT, A PERSON NAMED: "what deals does nathan have?" arrived as
     * an empty filter and drew all 91 deals. A call with no filter at all,
     * from a sentence naming somebody on the sheet, is about that somebody.
     */
    if (Object.keys(filtersIn(args)).length === 0 && args.said) {
      const said = String(args.said).toLowerCase();
      const names = [...new Set(((await repo.findAll({ pageSize: 2000 }).catch(() => null))?.rows ?? [])
        .map((r) => r.person_name).filter(Boolean))]
        .filter((n) => namesPerson(said, n))
        .sort((a, b) => b.length - a.length);
      if (names.length > 0) args = { ...args, q: names[0] };
    }
    /**
     * "LIVE" IS THE SHEET, NOT A PAYMENT PERIOD. Asked "how many live deals
     * are on the master sheet right now?" she sent status 'active' (owed
     * this month) and answered 75, against 90 live deals. A period or a
     * deal status is only a filter when their words name one. 2026-10-03.
     */
    const heardFilter = String(args.said ?? '');
    if (/\b(?:live|on the (?:master )?sheet|right now|in total|altogether|all together)\b/i.test(heardFilter)
      && !/\b(?:owed|owing|paid|payable|not started|start(?:ed|s|ing)?|ended|ending|finish\w*|review\w*|going concern|active)\b/i.test(heardFilter)) {
      const { status, dealStatus, ...rest } = args;
      args = rest;
    }
    /**
     * A BOUND WITH NO FIELD WAS DROPPED IN SILENCE. Asked for "the zero
     * payable ones" she sent amountMax 0 and no amountField; the repo
     * ignored the bound and 15 unrelated deals came back as "the zero
     * ones". The field comes from their words. 2026-09-30.
     */
    if (!args.amountField && (args.amountMin != null || args.amountMax != null)) {
      const said = String(args.said ?? '');
      const field = /\bmonthly\b/i.test(said) ? 'monthlyAmount'
        : /\bdays?\b/i.test(said) ? 'payableDays' : 'payableAmount';
      args = { ...args, amountField: field };
    }
    const resolvedScope = await resolveDealScope(args);
    if (resolvedScope.question) return { summary: resolvedScope.question };
    args = resolvedScope.args;

    /**
     * "MORE THAN 1000" DOES NOT INCLUDE 1000. Live 2026-09-30 it listed four
     * deals of exactly GBP 1,000. The bound is strict when their words are.
     */
    /**
     * "ENDING IN THE NEXT 2 MONTHS" IS TWO, not the default three. Clone
     * 2026-10-05: answered "within the next 3 months".
     */
    if ([].concat(args.endWhen ?? []).includes('soon')) {
      const n = /\bnext\s+(\d+|one|two|three|four|five|six)\s+months?\b/i.exec(heardNoun)?.[1];
      const asNumber = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[String(n).toLowerCase()] ?? Number(n);
      // eslint-disable-next-line no-param-reassign
      if (asNumber > 0) args = { ...args, endSoonMonths: asNumber };
    }
    const { rows, total } = await repo.findAll({ ...args, ...strictBounds(args), page: 1, pageSize: TOTAL_ROW_LIMIT });
    // EVERY match, not the first 60: "show me all deals" drew 60 under a title
    // saying 90. The list scrolls; a cut nobody sees is the bug. 2026-09-30.
    if (rows.length === 0) {
      /**
       * NOTHING MATCHED IS OFTEN THE WRONG ARGUMENT, not an empty sheet.
       *
       * "Show me those paid in bank in nexus" came back empty because the
       * group name went into free text instead of `group`, and she then
       * told the admin his six row group had nothing in it. The repo has
       * always matched a group case insensitively; she just filtered on
       * the wrong field.
       *
       * So a miss checks what the word actually IS before it reports an
       * empty sheet. Same helper the name lookups use.
       */
      const tried = args.q ?? (args.groups?.[0] ?? args.group);
      const what = tried ? await notAPerson(tried) : null;
      if (what) {
        return {
          summary: `${what} You filtered on the wrong field, so nothing matched. Try again with `
            + 'that, and do not tell them the sheet is empty.',
        };
      }
      // AND THE OTHER DIRECTION. `notAPerson` says what a word IS and goes
      // quiet when the word is nothing at all, which is the case where she
      // reports an empty group that never existed.
      if (args.group) {
        const wrong = await notAGroup(args.group, args.said);
        if (wrong) return { summary: wrong };
      }
      if (args.company) {
        const wrong = await unknownCompanyFilter(args.company, args.said);
        if (wrong) return { summary: wrong };
      }
      // ===============================
      // * SAY WHAT WAS CHECKED, NOT WHAT IT IMPLIES
      // ===============================
      // "Nothing matches that" left her to name the filter herself, and she
      // widened it: asked for months ahead of August she answered "there are
      // no deals marked for any months ahead of August on the sheet", two
      // turns after quoting October at GBP 83,898. Every deal HAS a later
      // month; none is PRESET to one. The filter is named here so her
      // sentence cannot reach past it.
      /**
       * ===============================
       * * "FLAGGED" MEANS TWO DIFFERENT RECORDS
       * ===============================
       * A review flag lives on a DEAL; a concern lives on a PERSON. Live
       * 2026-09-07: "show me the flagged ones" answered "no deals need a
       * check or are flagged for review", and two turns later "any concerns
       * open" answered "16 people have open concerns". Both true, read as a
       * contradiction, because one word answered for both records.
       */
      const alsoConcerns = args.needsReview
        ? ' That is the review flag on a DEAL. An open CONCERN is a different record, kept '
          + 'against a PERSON, and this did not look at those. Say which one you checked and '
          + 'offer list_concerns for the other.'
        : '';
      /**
       * ===============================
       * * A QUESTION ABOUT COMPANIES ANSWERED IN DEALS
       * ===============================
       * "Which companies are in liquidation" reached this tool, found no
       * rows and answered "no deals are on companies in liquidation",
       * which is a different sentence: it leaves open whether such
       * companies exist at all. Asked three ways, she never once named a
       * company, because this tool cannot.
       *
       * The status belongs to the COMPANY, so the list does too. Handing
       * back the tool that owns it is the only thing that moves her:
       * a `describeFilter` sentence is not a route.
       */
      const alsoCompanies = args.companyStatus
        ? ' THEY ASKED ABOUT COMPANIES AND THIS COUNTS DEALS. No deals matching does NOT mean no '
          + 'such company exists. Call list_companies with the same status and name what it '
          + 'returns, before saying anything about what there is.'
        : '';
      return {
        summary: `No deals are ${describeFilter(args) || 'matching that'}`
          + `${args.group ? ` in ${args.group}` : ''}. Say exactly that and nothing wider: it is a `
          + `fact about this filter, not about what the sheet holds.${alsoConcerns}`
          + `${alsoCompanies} Then offer to widen it.`,
      };
    }

    const scope = args.group ? ` in ${args.group}` : ' across every group';
    const what = describeFilter(args);

    /**
     * ===============================
     * * A FILTERED COUNT MEANS NOTHING WITHOUT ITS DENOMINATOR
     * ===============================
     *
     * "Are all the INDIGO people paid in cash" was answered "there are 30
     * rows in INDIGO paid by cash", and INDIGO has 39: nine are paid by
     * bank. She filtered BY the premise and reported the matches as
     * agreement. The same shape answered "confirm everyone in INDIGO is
     * paid in cash" with a confirmation.
     *
     * She cannot help doing this with a bare count, so the count never
     * arrives bare. THIRTY OF THIRTY NINE answers the question; thirty
     * does not, and the gap is the part they asked about.
     *
     * AND PEOPLE ARE NOT ROWS. She said "36 people in INDIGO are paid in
     * GBP" over 36 rows held by 28 people. A person holds several deals
     * here, so the two counts are always different and she has to be handed
     * both rather than pick a noun.
     */
    const held = await scopeCount(args);
    const outside = held === null ? null : held - total;
    const people = new Set(rows.map((r) => r.person_id ?? r.person_name).filter(Boolean)).size;

    /**
     * AND "EVERY ROW" ONLY MEANS SOMETHING IF SOMETHING WAS FILTERED.
     *
     * The first version of this note answered "everyone in MILKMAN is on
     * GBP right" with "Yes, every one of the 33 rows". She had passed the
     * GROUP and no currency at all, so 33 of 33 matched and the note read
     * as agreement. One of the 33 is AED. A guard that confirms a false
     * premise is worse than the bias it replaced.
     */
    const narrowed = Object.keys(filtersIn(args)).length > 0;

    let denominator;
    // "show me all deals" is answered by the whole list: no follow up question.
    // A request to SEE everything, not "everyone in X is on GBP right", which is a check.
    const askedAll = /\b(?:show|list|see|give|pull up|display)\b.*\b(?:all|every|everything|everyone|whole)\b/i
      .test(String(args.said ?? ''));
    if (!narrowed && askedAll) {
      denominator = 'That is everything they asked for. End on the count. Do NOT ask a question '
        + 'or offer filters afterwards.';
    } else if (!narrowed) {
      denominator = 'YOU FILTERED ON NOTHING but the group, so this is the whole scope and it '
        + 'does NOT answer "are they all". Call this again with the thing they asked about.';
    } else if (outside === null || outside <= 0) {
      denominator = `That is EVERY row${scope}, so the answer to "are they all" is YES.`;
    } else {
      denominator = `${total} of ${held} rows${scope}. THE OTHER ${outside} `
        + `${outside === 1 ? 'DOES' : 'DO'} NOT MATCH. If they asked whether they all are, the `
        + 'answer is NO and that number is the answer.';
    }

    // The people count is only honest over the rows in hand; past the page
    // it is a page's worth, not the match's.
    const nouns = rows.length >= total
      ? ` ${total} ROWS, held by ${people} ${people === 1 ? 'person' : 'people'}. A person holds `
        + 'several deals, so never call a row count a number of people.'
      : ` ${total} ROWS. Do not call them people: a person holds several deals.`;

    /**
     * ===============================
     * * "WHOSE" NEEDS THE NAMES, or she goes and invents row ids
     * ===============================
     *
     * Asked whose deals were ending soon she got three cards, and the
     * summary told her not to read the fields back and gave her no names.
     * So she called `get_master_sheet_row_details` three times with ids she
     * had made up, two of which hit real rows, and answered "Tobias Wright
     * and Jim". The three are KJ, Drew and Ruth Harper.
     *
     * Withholding the names to keep her brief is what sent her looking for
     * them, and the place she looked was her own memory. Same incident as
     * the invented ids behind `total_master_sheet`.
     */
    const named = rows.length <= NAMES_IN_SUMMARY && rows.length >= total
      ? ` THEY ARE: ${listOf([...new Set(rows.map((r) => r.person_name).filter(Boolean))])}. `
        + 'Those are the ONLY names here. If they asked WHOSE, answer from this list and do NOT '
        + 'look any row up by id: an id you did not get from a tool this turn is a guess.'
      : '';

    /**
     * ===============================
     * * A FILTER ANSWERS WITH A LIST. ALWAYS. His call 2026-09-24.
     * ===============================
     * Four or fewer matches drew FULL CARDS, on the reasoning that a
     * handful is few enough to look at properly. In practice it meant a
     * COUNTING question got a thirty field card: "show me the special
     * cases" matched one row and opened Mayah's whole deal, dates, bank
     * columns and all, for an answer that was "one, and it is Mayah".
     *
     * The card belongs to "show me her details", which is a different
     * tool and a different question. A filter says how many and who.
     * Asking for one by name still brings its full card back.
     */
    /**
     * ===============================
     * * ONE MATCH IS A SENTENCE, NOT A PANEL. His call 2026-09-24.
     * ===============================
     * "Show me the special cases" matched one row and still drew a list
     * panel, which is what "why are you sending me the details" was
     * about. A panel to say one name is furniture around a word.
     *
     * The NAMES are already in the summary through `named` above, so she
     * has everything she needs to answer in a sentence.
     */
    /**
     * £0 PAYABLE IS NOT ALWAYS WRONG. A deal starting next month or marked
     * for another month is correctly at zero, and the audit leaves those
     * out. Asked for "the zero payable ones" this filter listed them all,
     * so the two answers disagreed. Split the same way, same rule. 2026-09-30.
     */
    let zeroSplit = '';
    // ASKED ABOUT ZERO, FILTERED ON SOMETHING ELSE. "the ones at zero you
    // left out" was answered with 15 rows marked for this month, described
    // as "at zero". None of them were. 2026-09-30.
    const zeroFiltered = args.amountField === 'payableAmount' && Number(args.amountMax) === 0;
    if (!zeroFiltered && /\b(?:zero|£\s?0|nothing payable|0 payable)\b/i.test(String(args.said ?? ''))) {
      zeroSplit = '\n\nTHIS DID NOT FILTER ON THE PAYABLE AMOUNT. Do NOT say any of these are at zero. '
        + 'For deals at zero, call this with amountField payableAmount and amountMax 0; for the ones the '
        + 'audit left out, call audit_master_sheet, which names them with the reason.';
    }
    if (zeroFiltered && rows.length > 0) {
      const useEndDate = Boolean((await settingsRepo.get())?.color_uses_end_date);
      const month = currentMonth();
      const owedNow = (r) => isForMonth(r, month) && isOwedThisMonth(r, { useEndDate });
      const who = (r) => `${displayPersonName(r.person_name)}${r.company ? ` at ${r.company}` : ''} in ${r.group_name}`;
      const wrong = rows.filter((r) => Number(r.monthly_amount) > 0 && owedNow(r));
      const fine = rows.filter((r) => !(Number(r.monthly_amount) > 0 && owedNow(r)));
      zeroSplit = '\n\nNOT ALL OF THESE ARE PROBLEMS. Say this split, not just the count.\n'
        + `Owed this month but at £0 (real discrepancies): ${wrong.length ? wrong.map(who).join('; ') : 'none'}.\n`
        + `Correctly at £0: ${fine.length ? fine.map((r) => `${who(r)} (${!isForMonth(r, month)
          ? `marked for ${monthName(monthOf(r.preset_on))}` : paymentReason(r, month, { useEndDate })})`).join('; ') : 'none'}.`;
    }

    // ONE PERSON AND ONE DETAIL ASKED: the detail, not a list of their deals.
    const oneDetail = rows.length > 0 && rows.length >= total
      && new Set(rows.map((r) => r.person_id ?? r.person_name)).size === 1
      ? askedFieldReply(rows, args.said, args.saidRecent) : null;
    if (oneDetail) {
      return { summary: `${oneDetail} Say exactly that.`, reply: oneDetail, computedReply: true, rows: rows.map(summarizeRow) };
    }
    if (rows.length <= 1 && rows.length >= total) {
      return {
        summary: `${total === 0 ? 'Nothing' : `${total} deal`}${scope} ${total === 1 ? 'is' : 'are'} ${what}.${nouns}${named} `
          + 'ANSWER IN ONE SENTENCE and nothing else. Nothing is on screen for this, so the '
          + 'sentence IS the answer. Do NOT offer to open it, do NOT describe its fields, and '
          + 'do NOT ask what to do next.\n\n'
          + denominator + zeroSplit,
        rows: rows.map(summarizeRow),
      };
    }

    /**
     * "HOW MANY" IS A NUMBER, not a list. "how many deals do we have?"
     * drew all 90 and read every one aloud. 2026-09-30. Asking to see
     * them ("show", "list", "who", "which") still draws them.
     */
    const heardNow = String(args.said ?? '');
    // "HOWS MANY", "how mny": the typed slips of it too. Clone 2026-10-05.
    if (/\bhow'?s? (?:many|mny|manny)\b|\bhw many\b|\bnumber of\b/i.test(heardNow) && !/\b(?:show|list|who|which|name|see)\b/i.test(heardNow)) {
      const people = new Set(rows.map((r) => r.person_id ?? r.person_name).filter(Boolean)).size;
      /**
       * A NARROWED COUNT SAYS WHAT NARROWED IT, and out of how many. Live
       * 2026-10-03: "how many live deals" came back "75 deals" off a filter
       * nobody asked for, against 90 on the dashboard, and the filter was
       * invisible. Now it reads "75 of 90 deals are owed this month".
       */
      const reply = narrowed && held !== null && held > total
        ? `${total} of ${held} deals${scope} ${total === 1 ? 'is' : 'are'} ${what}, held by ${people} ${people === 1 ? 'person' : 'people'}.`
        : `${total} ${total === 1 ? 'deal' : 'deals'}${scope}${narrowed && what ? ` ${total === 1 ? 'is' : 'are'} ${what}` : ''}, held by ${people} ${people === 1 ? 'person' : 'people'}.`;
      return {
        summary: `${reply} Nothing was drawn: they asked how many. ${denominator}`,
        reply,
        computedReply: true,
        rows: rows.map(summarizeRow),
      };
    }

    return {
      summary: `${total} rows${scope} are ${what}${rows.length < total ? `, first ${rows.length} listed` : ''}.${nouns}${named} `
        + 'Already listed on screen, so do NOT list them again in text. Say ONE sentence with the '
        // NO OFFER. It said "then offer to open any of them by name", so
        // every filter answer ended in a question nobody asked. They will
        // say so if they want one.
        + 'count and what they have in common, then STOP. Do not offer to open any of them.\n\n'
        + denominator + zeroSplit,
      list: {
        title: `${total} ${total === 1 ? 'deal' : 'deals'}${scope}`,
        // The count in the title is the WHOLE match; the panel holds one
        // page of it. Saying so on screen too, because a header reading 76
        // above a list of 60 is a header that is wrong.
        subtitle: rows.length < total ? `${what} · showing the first ${rows.length}` : what,
        rows: rows.map(listRow),
      },
      rows: rows.map(summarizeRow),
      /**
       * A PLAIN LISTING HAS ITS SENTENCE BUILT: the count and who, nothing
       * else. Left to her it grew "They are all the deals in that group."
       * A narrowed list keeps her line, which says what the rows share.
       */
      ...(!narrowed ? {
        reply: `${total} ${total === 1 ? 'deal' : 'deals'}${scope}, held by ${people} ${people === 1 ? 'person' : 'people'}.`,
        computedReply: true,
      } : /\b(?:who|whose|which (?:people|person|ones?)|name them|is (?:any|some)(?:one|body)|are there any|does (?:any|some)(?:one|body)|any(?:one|body))\b/i.test(String(args.said ?? '')) && rows.length > 0 && rows.length <= 10 && rows.length >= total ? {
        // "WHOSE deals have passed their end date?" was answered "three
        // deals", correct and not what was asked. Who, when they ask who.
        reply: `${total} ${total === 1 ? 'deal' : 'deals'}${scope} ${total === 1 ? 'is' : 'are'} ${what}: `
          + `${rows.map((r) => `${r.person_name} (${[r.company, r.group_name].filter(Boolean).join(' in ')})`).join(', ')}.`,
        computedReply: true,
      } : {}),
    };
  },
};

/**
 * THE ARITHMETIC, DONE IN CODE. She reports it; she never works it out.
 *
 * ---- the failure this exists to make impossible ----
 * Asked to total Nicola's August, she answered 3,700. The real figure is
 * 2,900. Two separate mistakes compounded:
 *
 *   1. SHE INVENTED ROW IDS. Nicola's rows are 14, 19, 30 and 32. She
 *      found 30 and then asked for its NEIGHBOURS, 28, 29 and 31, which
 *      belong to Jason Taylor, Byron and Lucy Okenabirhie. Their money
 *      was reported as Nicola's.
 *   2. SHE ADDED IT UP HERSELF, in prose, from those wrong rows.
 *
 * The CRM's own rule is that figures are code and never the model
 * (v1/calculator/ is pure computation for exactly this reason). A model
 * that can pick ids by hand and sum them in a sentence will eventually do
 * both wrong on a document somebody is paid from.
 *
 * So this takes a NAME, not ids, resolves it itself, and returns a sum it
 * computed. There is nothing for her to choose and nothing for her to add.
 *
 * PER CURRENCY, NEVER BLENDED, the same rule groupTables.js follows: GBP
 * plus AED is a number that means nothing.
 *
 * COUNTED AND UNCOUNTED ARE BOTH RETURNED. A row worth 0 this month
 * because its payment starts in November is not missing data, it is the
 * answer to "why is this less than I expected", and dropping it silently
 * is how a total looks wrong to the one person who knows the roster.
 */
function moneyTotals(rows, month, { useEndDate = false, rates = null, cryptoPercent = 0 } = {}) {
  const counted = [];
  const uncounted = [];
  for (const r of rows) {
    // THE SAME RULE THE EXPORTED SHEET TOTALS BY, from shared/. It read
    // `isPeriodEnded` directly, which the exports stopped doing: she would
    // have quoted a figure 6,500 under the file for MILKMAN's August.
    const owed = isOwedThisMonth(r, { useEndDate });
    const forMonth = isForMonth(r, month);
    (!owed || !forMonth ? uncounted : counted).push({
      row: r,
      why: paymentReason(r, month, { useEndDate, owed, forMonth }),
    });
  }

  const pence = (n) => Math.round(n * 100) / 100;

  /**
   * ===============================
   * * TWO RATES, OPPOSITE DIRECTIONS
   * ===============================
   * An add on is income ON TOP; a fee comes OFF the total after it. Both
   * stack person plus deal, and both are computed by shared/rates.helper
   * so her figure and the exported file cannot disagree.
   */
  const byCurrency = new Map();
  const addonByCurrency = new Map();
  const cryptoByCurrency = new Map();
  const feeByCurrency = new Map();
  const add = (m, k, n) => m.set(k, pence((m.get(k) ?? 0) + n));

  for (const c of counted) {
    const currency = c.row.currency || 'GBP';
    const { amount, addon, crypto, fee } = amountWithRates(c.row, rates, { cryptoPercent });
    if (!Number.isFinite(amount)) continue;
    add(byCurrency, currency, amount);
    if (addon > 0) add(addonByCurrency, currency, addon);
    if (crypto > 0) add(cryptoByCurrency, currency, crypto);
    if (fee > 0) add(feeByCurrency, currency, fee);
  }

  // What somebody actually has to find: owed, plus add ons and the crypto
  // charge, less fees. The same order the export applies them in.
  const withRates = new Map();
  for (const [currency, total] of byCurrency) {
    withRates.set(currency, pence(
      total + (addonByCurrency.get(currency) ?? 0) + (cryptoByCurrency.get(currency) ?? 0)
        - (feeByCurrency.get(currency) ?? 0),
    ));
  }

  return {
    counted, uncounted, byCurrency, addonByCurrency, cryptoByCurrency, feeByCurrency, withRates,
  };
}

// A day as words is `dayText.helper`'s job, and only its. This built one
// out of a Date and read it back in UTC, which is the shift that helper
// exists to avoid, and it spelled the month a second way.
const dateInWords = dayText;

/** The exact business-rule cause behind a zero, never a generic label. */
function paymentReason(row, month, { useEndDate = false, owed = null, forMonth = null } = {}) {
  const wanted = monthName(month ?? currentMonth());
  const matchesMonth = forMonth ?? isForMonth(row, month);
  const isOwed = owed ?? isOwedThisMonth(row, { useEndDate });

  if (!matchesMonth) {
    return row.preset_on
      ? `marked for ${monthName(monthOf(row.preset_on))}, not ${wanted}`
      : `not marked for ${wanted}`;
  }

  if (!isOwed) {
    const period = periodFor(row, { useEndDate });
    if (period === PERIOD.NOT_STARTED) {
      const starts = dateInWords(row.payment_start_on);
      return starts ? `payment starts ${starts}, after ${wanted}` : `payment has not started by ${wanted}`;
    }
    if (Array.isArray(row.manually_overridden_fields)
      && row.manually_overridden_fields.includes('status') && row.status === PERIOD.ENDED) {
      return 'payment status is manually set to Ended';
    }
    const ended = dateInWords(row.end_on);
    return ended ? `payment ended ${ended}, before ${wanted}` : `payment period ended before ${wanted}`;
  }

  const payable = Number(row.payable_amount);
  if (Number.isFinite(payable) && payable !== 0) return null;
  if (row.monthly_amount == null || row.monthly_amount === '') return 'monthly amount is not set';
  if (Number(row.monthly_amount) === 0) return 'monthly amount is 0';
  if (Number(row.payable_days) === 0) return 'payable days are 0';
  if (!Number.isFinite(payable)) return 'payable amount is not numeric';
  return 'payable amount is set to 0';
}

/**
 * ===============================
 * * ONE PLACE THAT TOTALS AND PHRASES IT
 * ===============================
 * Both entry points, one person and several, land here. Two copies
 * would be two answers to the same money, which is the failure this
 * whole tool exists to prevent.
 */
async function totalReply(rows, month, args, whoLabel = null, plural = false, {
  droppedPeople = [], droppedRows = 0,
} = {}) {
  /**
   * THE YEAR THE HANDLER DROPPED, recovered here rather than passed.
   *
   * It was a local in the handler and read from in here, which is a
   * ReferenceError at runtime and invisible until the branch is taken. The
   * export route lost every build to exactly that. Both values are already
   * arguments, so the fact is derivable rather than plumbed.
   */
  const askedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(args.month ?? '')) ? args.month : null;
  const droppedYear = askedMonth && askedMonth !== month ? askedMonth : null;
  // REPAIRED means they NAMED the month and she only got the year wrong, so
  // the answer is the one they asked for and there is nothing to ask back.
  const repairedYear = Boolean(droppedYear && month);

  const [settings, rates] = await Promise.all([
    settingsRepo.get(),
    // Only the people who have one, so this is a handful of rows.
    peopleRepo.rateMap(),
  ]);
  const useEndDate = Boolean(settings?.color_uses_end_date);
  // THE SAME RATE THE EXPORT ADDS. Left out, her figure is short for any
  // group holding a crypto row while the sheet beside her includes it.
  const cryptoPercent = Number(settings?.crypto_percent ?? 0);
  const {
    counted, uncounted, byCurrency, addonByCurrency, cryptoByCurrency, feeByCurrency, withRates,
  } = moneyTotals(rows, month, { useEndDate, rates, cryptoPercent });
  const who = whoLabel
    ?? (args.person ? String(rows[0]?.person_name ?? args.person) : narrowedLabel(args));
  // NAMED, never "this month". persona.js: "owed 500 for August", never
  // "for the preset month" — a month the reader has to work out is a
  // month they can get wrong, and this line is often read aloud.
  const when = monthName(month ?? currentMonth());

  const lines = counted.map((c) => `  ${c.row.company || '(no company)'} in ${c.row.group_name}: `
    + `${c.row.currency || 'GBP'} ${Number(c.row.payable_amount ?? 0).toLocaleString('en-GB')}`);
  const skipped = uncounted.map((u) => `  ${u.row.company || '(no company)'} in ${u.row.group_name}: `
    + `nothing this month, ${u.why}`);
  const totals = [...byCurrency.entries()].map(([c, t]) => `${c} ${t.toLocaleString('en-GB')}`);

  /**
   * ===============================
   * * THE FINISHED SENTENCE, not instructions to compose one
   * ===============================
   * The prompt already forbade adding figures up, quoting a remembered
   * one, or contradicting the tool, and it still happened: asked Nicola's
   * August total she answered "owed nothing, all her deals are marked for
   * another month" off the cards she had just shown, while the tool
   * computes 2,900. More prompting was not the lever. Handing her a line
   * to COPY is, the same way detailsSummary does.
   */
  /**
   * A COUNT, NOT A ROLL CALL, and never the same company twice.
   *
   * This mapped one entry per ROW, so NEXUS's six rows came back as
   * "A J Rayson, Nuvanta Resourcing, Nuvanta Resourcing, Gloria, Workforce,
   * A J Rayson, Pino, Workforce": two companies listed twice, two more
   * split in half by noDashes, and eight items for six rows.
   *
   * It also took `uncounted[0].why` for all of them, so a mixed set was
   * given one reason. Grouped by reason instead, with the row count, and
   * the companies named only while there are few enough to be worth
   * reading. She is here to answer, not to hand back a list to check.
   */
  const NAMES_MAX = 4;
  const byWhy = new Map();
  for (const u of uncounted) {
    const seen = byWhy.get(u.why) ?? { rows: 0, companies: new Set() };
    seen.rows += 1;
    if (u.row.company) seen.companies.add(u.row.company);
    byWhy.set(u.why, seen);
  }

  // IT HAS TO READ AS A SENTENCE. The first attempt produced "nothing from
  // 1 row (Social work partners PR) nothing owed for that month, nor from
  // 3 rows (...) marked for another month": no joining word, so the reason
  // ran straight into the count.
  const why = uncounted.length === 0 ? '' : `. Nothing from ${
    [...byWhy.entries()].map(([reason, seen]) => {
      const rows = seen.rows === 1 ? '1 row' : `${seen.rows} rows`;
      const names = [...seen.companies];
      const who = names.length > 0 && names.length <= NAMES_MAX ? ` (${names.join(', ')})` : '';
      return `${rows}${who}, because ${reason}`;
    }).join('; and nothing from ')
  }`;

  // EACH RATE ONLY WHERE THERE IS ONE. A "plus 0%" clause on every answer
  // is a clause that means nothing and gets read past.
  const money = (m) => [...m.entries()].map(([c, n]) => `${c} ${n.toLocaleString('en-GB')}`);
  const addons = money(addonByCurrency);
  const cryptos = money(cryptoByCurrency);
  const fees = money(feeByCurrency);
  const grand = money(withRates);

  /**
   * ===============================
   * * THE HEADLINE IS THE FIGURE, THE LINE UNDER IT IS WHY
   * ===============================
   * It used to state the RAW total and then talk its way up to the net in
   * the same sentence, so one answer carried the same money three times:
   * the headline, the clause, and again on the person's own line. His
   * words, 2026-09-14: "three representations of the same data".
   *
   * `owed` NOW MEANS THE NET, one meaning, which is why the line beneath
   * carries no noun at all. It is arithmetic, not a second sentence.
   *
   * ONE PERSON, ONE DEAL, ONE LINE: the company folds into the arithmetic
   * rather than repeating underneath as its own row.
   */
  const singlePerson = !plural && Boolean(args.person || whoLabel);
  const soleCompany = singlePerson && counted.length === 1
    ? (counted[0].row.company || null)
    : null;

  // The rate itself, when every row carrying one carries the SAME one.
  // Mixed rates have no single number to print, so it is left off rather
  // than averaged into something nobody agreed to.
  const ratePercent = (kind) => {
    const seen = new Set();
    for (const c of counted) {
      const effective = ratesFor(c.row, rates, { cryptoPercent });
      if (effective[kind] > 0) seen.add(effective[kind]);
    }
    return seen.size === 1 ? `${[...seen][0]}%` : null;
  };
  const rated = (label, amounts, kind) => {
    const pct = ratePercent(kind);
    return `${amounts.join(' and ')} ${label}${pct ? ` (${pct})` : ''}`;
  };

  const rateParts = [];
  if (addons.length > 0) rateParts.push(`${SIGN_WORD.add} ${rated(singlePerson ? 'add on' : 'add ons', addons, 'addon')}`);
  if (cryptos.length > 0) rateParts.push(`${SIGN_WORD.add} ${rated(singlePerson ? 'crypto charge' : 'crypto charges', cryptos, 'crypto')}`);
  if (fees.length > 0) rateParts.push(`${SIGN_WORD.less} ${rated(singlePerson ? 'fee' : 'fees', fees, 'fee')}`);

  const rateLine = rateParts.length === 0
    ? ''
    : `${totals.join(' and ')}${soleCompany ? ` at ${soleCompany}` : ''} ${rateParts.join(' ')}.`;

  // ONLY FOLDED IF THERE WAS A LINE TO FOLD IT INTO. With no rate there is
  // no arithmetic line, so the company still has to be listed underneath or
  // the answer never names it at all.
  const foldedCompany = rateParts.length > 0 ? soleCompany : null;

  /**
   * ===============================
   * * CONVERTED, WITH THE RATE SAID OUT LOUD
   * ===============================
   * Only when asked. A converted figure whose rate has no provenance
   * cannot be checked next month, so the rate and where it came from
   * travel with it and she is told to say them.
   *
   * A currency with NO RATE is never converted at par: it is named and
   * left out, and the reply says a figure is missing. Silently dropping it
   * is how a total becomes wrong without looking wrong.
   */
  let converted = null;
  /**
   * ===============================
   * * DOLLARS ONLY WHEN THEY ASKED FOR DOLLARS
   * ===============================
   *
   * The parameter said "use it when they ask", which is a prompt. She
   * passed it anyway: asked to add two people together she answered in GBP
   * and AED, correctly, and then tacked on "In dollars that is USD
   * 2,887.03" that nobody wanted. Two currencies in an answer is not a
   * request to merge them.
   *
   * It is not wrong, which is what makes it worth stopping: an unasked
   * third figure in a money sentence is one more number to reconcile, and
   * the admin's word for it was "why does she keep saying dollars".
   *
   * `said` is injected by runAgent, so she cannot satisfy this by writing
   * the word herself.
   */
  // OVER TWO TURNS, not one. "Convert it to usd" then "double check" lost
  // the request, so she answered without dollars and then offered to
  // convert what she had just converted. `saidRecent` is injected.
  const wantsUsd = ASKED_FOR_USD.test(String(args.saidRecent ?? args.said ?? ''));
  const skippedUsd = args.convertTo === 'USD' && !wantsUsd;

  if (args.convertTo === 'USD' && wantsUsd && withRates.size > 0) {
    const fx = await fxRates.usdPerGbp();
    const { usd, converted: used, unconvertible } = totalInUsd(withRates, fx.usdPerGbp, fx.perUsd);
    const missed = unconvertible.map((u) => `${u.currency} ${u.amount.toLocaleString('en-GB')}`);
    converted = {
      usd,
      rate: fx.usdPerGbp,
      source: fx.source,
      asOf: fx.asOf ?? null,
      unconvertible: missed,
      /**
       * EVERY RATE THAT WAS USED, not just the pound.
       *
       * "USD 2,887.03, at 1.354355 USD per GBP" named ONE rate for a
       * figure that converted two currencies: the AED went through the
       * 3.6725 peg and that number appeared nowhere. A converted figure
       * whose rate has no provenance cannot be checked next month, which
       * is the whole reason the rate is said out loud.
       */
      clause: ` In dollars that is USD ${usd.toLocaleString('en-GB')}, at `
        + `${listOf(ratesUsed(used, fx))} (${fx.source === 'live' ? 'today\'s rate' : `${fx.source} rate`}).`
        + (missed.length > 0
          ? ` ${missed.join(' and ')} could NOT be converted, no rate for it, so that is left out.`
          : ''),
    };
  }

  // 'are' for several people, 'is' for one. She reads these aloud.
  const verb = plural ? 'are' : 'is';
  // THE NET, not the raw. `grand` equals `totals` when nobody carries a
  // rate, so this is one line for both cases rather than two.
  const sentence = counted.length === 0
    ? `${capitalised(who)} ${verb} owed nothing for ${when}${why}.`
    : `${capitalised(who)} ${verb} owed ${grand.join(' and ')} for ${when}${why}.`
      + `${rateLine ? `\n${rateLine}` : ''}${converted?.clause ?? ''}`;

  /**
   * THE PERCENTAGES THEMSELVES, because "show me the percentages" is a
   * question this could not answer. It gave the money an add on came to
   * and never the rate behind it, so the admin had to ask a second time.
   * Per person, since two people in one total rarely share a rate.
   */
  const pct = (n) => `${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}%`;
  // ONE LINE PER PERSON while their rate is the same on every row. Four
  // deals at 5% listed four times reads as four different arrangements.
  // Split by row only where the deal level rate actually differs.
  const byPerson = new Map();
  for (const c of counted) {
    // `ratesFor` STACKS the person's standing rate with the deal's own, so
    // this cannot report 5% where the export applies 8%.
    const { addon, crypto, fee } = ratesFor(c.row, rates, { cryptoPercent });
    const bits = [];
    if (addon > 0) bits.push(`${pct(addon)} add on`);
    if (crypto > 0) bits.push(`${pct(crypto)} crypto charge`);
    if (fee > 0) bits.push(`${pct(fee)} fee`);
    if (bits.length === 0) continue;

    const name = c.row.person_name || 'that row';
    const seen = byPerson.get(name) ?? new Map();
    const where = `${c.row.company || 'no company'} in ${c.row.group_name}`;
    seen.set(bits.join(', '), [...(seen.get(bits.join(', ')) ?? []), where]);
    byPerson.set(name, seen);
  }

  const ratesSeen = [];
  for (const [name, byRate] of byPerson) {
    for (const [rate, wheres] of byRate) {
      ratesSeen.push(byRate.size === 1
        ? `  ${name}: ${rate}`
        : `  ${name} (${wheres.join('; ')}): ${rate}`);
    }
  }
  const pctBlock = ratesSeen.length > 0
    ? `\nRATES, already inside the figures above:\n${ratesSeen.join('\n')}\n`
    : '';

  const rateBlock = rateParts.length > 0
    ? `${addons.length > 0 ? `\nADD ONS (added): ${addons.join(' and ')}` : ''}`
      + `${cryptos.length > 0 ? `\nCRYPTO CHARGES (added): ${cryptos.join(' and ')}` : ''}`
      + `${fees.length > 0 ? `\nFEES (deducted): ${fees.join(' and ')}` : ''}`
      + `\nTO FIND: ${grand.join(' and ')}\n`
    : '';

  /**
   * The admin-facing answer is assembled beside the arithmetic. This keeps
   * it short and stops a model from expanding a two-line result back into
   * a paragraph full of repeated exclusions.
   */
  const amountText = (n) => Number(n).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const roundMoney = (n) => Math.round(Number(n) * 100) / 100;
  const moneyText = (currency, n) => `${currency || 'GBP'} ${amountText(n)}`;
  const percentText = (values) => (values.size === 1 ? `${amountText([...values][0])}%` : null);
  const personTotals = new Map();

  for (const c of counted) {
    const row = c.row;
    const name = row.person_name || 'Unknown person';
    const currency = row.currency || 'GBP';
    const byPerson = personTotals.get(name) ?? new Map();
    const item = byPerson.get(currency) ?? {
      amount: 0, addon: 0, crypto: 0, fee: 0, net: 0,
      addonRates: new Set(), cryptoRates: new Set(), feeRates: new Set(),
    };
    const values = amountWithRates(row, rates, { cryptoPercent });
    const effective = ratesFor(row, rates, { cryptoPercent });
    item.amount = roundMoney(item.amount + values.amount);
    item.addon = roundMoney(item.addon + values.addon);
    item.crypto = roundMoney(item.crypto + values.crypto);
    item.fee = roundMoney(item.fee + values.fee);
    item.net = roundMoney(item.net + values.net);
    if (values.addon > 0) item.addonRates.add(effective.addon);
    if (values.crypto > 0) item.cryptoRates.add(effective.crypto);
    if (values.fee > 0) item.feeRates.add(effective.fee);
    byPerson.set(currency, item);
    personTotals.set(name, byPerson);
  }

  /**
   * ===============================
   * * "WHO IS OWED THE MOST" IS A RANKING, DONE HERE
   * ===============================
   * Live 2026-10-03: asked for the top 3 in USD she named Paddy, Zayn and
   * Maid, the three people her previous answer happened to mention. The
   * real top three were Neo, Gary and SV. There was no ranking anywhere,
   * so she made one up. Each person's net is converted to USD at the same
   * rates every other total uses, so the order can be compared.
   */
  const rankBy = Number.isInteger(args.rank) && args.rank !== 0 ? args.rank : null;
  if (rankBy !== null) {
    const fxNow = await fxRates.usdPerGbp();
    const ranked = [...personTotals].map(([name, byCurrency]) => {
      const nets = [...byCurrency].map(([code, item]) => [code, item.net]);
      const { usd } = totalInUsd(nets, fxNow.usdPerGbp, fxNow.perUsd);
      const native = nets.filter(([, n]) => n > 0).map(([code, n]) => moneyText(code, n)).join(' and ');
      return { name, usd: Math.round(usd * 100) / 100, native };
    }).filter((r) => r.usd > 0).sort((a, b) => (rankBy > 0 ? b.usd - a.usd : a.usd - b.usd));
    const top = ranked.slice(0, Math.min(Math.abs(rankBy), 20));
    // A TIE AT THE CUT IS NAMED: "the lowest paid in INDIGO" said Abe Lincoln
    // alone, with Donaldo and Gloria on the same GBP 500. 2026-10-03.
    while (top.length > 0 && top.length < ranked.length && top.length < 30
      && ranked[top.length].usd === top[top.length - 1].usd) top.push(ranked[top.length]);
    const headline = `${rankBy > 0 ? 'Owed the most' : 'Owed the least'}, ${when}, in USD:`;
    const lines = top.map((r, i) => `${i + 1}. ${r.name}: USD ${amountText(r.usd)} (${r.native})`);
    const reply = top.length > 0 ? `${headline}\n${lines.join('\n')}` : `Nobody is owed anything ${when}.`;
    return {
      summary: `${reply}\n\nCOMPUTED, ranked in code across ${ranked.length} people at the saved rates. `
        + 'Say it exactly; never reorder it or add a name.',
      reply,
      computedReply: true,
    };
  }

  /**
   * WHAT THIS PERSON'S RATE DID, and by default NOT what it came to.
   *
   * "Nicola: GBP 2,900 + 5% add on (GBP 145)" is the whole of it: adding
   * "= GBP 3,045" restates a sum the reader just watched being made, and
   * the headline above already carries the group's net.
   *
   * `withTotal` is for the PLURAL answer, where each line IS that person's
   * answer rather than an explanation of one above it.
   */
  const adjustedLine = (name, currency, item, { withTotal = false } = {}) => {
    let line = `${displayPersonName(name)}: ${moneyText(currency, item.amount)}`;
    const piece = (sign, rates_, word, amount) => {
      const rate = percentText(rates_);
      return ` ${sign} ${rate ? `${rate} ${word}` : word} (${moneyText(currency, amount)})`;
    };
    if (item.addon > 0) line += piece(SIGN_WORD.add, item.addonRates, 'add on', item.addon);
    if (item.crypto > 0) line += piece(SIGN_WORD.add, item.cryptoRates, 'crypto charge', item.crypto);
    if (item.fee > 0) line += piece(SIGN_WORD.less, item.feeRates, 'fee', item.fee);
    const anyRate = item.addon > 0 || item.crypto > 0 || item.fee > 0;
    if (withTotal && anyRate) line += ` = ${moneyText(currency, item.net)}`;
    return withTotal ? `${line}.` : line;
  };

  /**
   * ===============================
   * * THE FINISHED SENTENCE HAS PARTS, AND THE ASK PICKS THEM
   * ===============================
   * It was one flat array joined with newlines, so "give me only the usd
   * value for Nathan" was impossible: runAgent returns a computed reply
   * WITHOUT a model round (see terminalComputed), which is what keeps every
   * figure out of the model's hands. With nobody there to trim, she replayed
   * the whole block and `saidAlready` stamped "I ran it again and it has not
   * moved" on top of it. Both guards were right; the contract had no way to
   * say WHICH PART was wanted.
   *
   * So the parts are named and `only` selects them. The tool still owns
   * every word and every figure, the model still never sees a number, and
   * the shortcut still fires. A new shape is an enum value, not a code path.
   */
  const part = { headline: [], breakdown: [], excluded: [], converted: [] };
  if (plural && personTotals.size > 0) {
    part.headline.push(`For ${when}:`);
    for (const [name, currencies] of personTotals) {
      for (const [currency, item] of currencies) {
        part.headline.push(adjustedLine(name, currency, item, { withTotal: true }));
      }
    }
    // "TOGETHER" ASKED, TOGETHER ANSWERED. "total for CORVID and otto fenn
    // together" listed six people and never gave the one figure asked for.
    // Per currency, never across them. 2026-09-29.
    if (asksCombined(args.said) && grand.length > 0) part.headline.push(`Together: ${grand.join(' and ')}.`);
  } else {
    /**
     * ===============================
     * * THE FINISHED SENTENCE CARRIES THE ARITHMETIC, NOT JUST THE RAW TOTAL
     * ===============================
     * `summary` told her to say "GBP 2,000 owed plus GBP 100 in add ons, so
     * GBP 2,100 to find" and this line said only "owed GBP 2,000". Two
     * halves of one tool result disagreeing about money: whichever she
     * followed was what the admin saw, and both were observed live on the
     * same person on the same day.
     *
     * An add on is money to find. Leaving it out of the finished sentence
     * understates the figure by exactly the rate.
     */
    part.headline.push(counted.length === 0
      ? `${capitalised(who)} ${verb} owed nothing for ${when}.`
      : `${capitalised(who)} ${verb} owed ${grand.join(' and ')} for ${when}.`);
    // The arithmetic belongs with the figure it explains, so asking for the
    // headline alone still says where the number came from.
    if (rateLine) part.headline.push(rateLine);

    /**
     * ===============================
     * * WHOSE RATE IT WAS, ON A GROUP ANSWER ONLY
     * ===============================
     * "+ GBP 205 add ons" on a group does not say whose, and that is the
     * one thing the line above cannot carry. One line per person who has a
     * rate, and no line for anyone on nothing: twelve rows reading 0% is
     * what stops a block being read.
     *
     * NOT FOR A SINGLE PERSON. The subject is already them, so their own
     * line would repeat the sentence above it, which is the duplication
     * this whole change removes.
     */
    if (!singlePerson) {
      for (const [name, currencies] of personTotals) {
        for (const [currency, item] of currencies) {
          if (item.addon > 0 || item.crypto > 0 || item.fee > 0) {
            part.breakdown.push(adjustedLine(name, currency, item));
          }
        }
      }
    }

    // A person's handful of deals explains the figure at a glance. Group
    // and whole-sheet totals stay compact instead of printing a roster.
    //
    // ONE DEAL NEEDS NO LIST: its company is already folded into the
    // arithmetic line above.
    const DEAL_DETAIL_MAX = 8;
    if ((args.person || whoLabel) && rows.length <= DEAL_DETAIL_MAX && !foldedCompany) {
      const positive = counted.filter((c) => Number(c.row.payable_amount) > 0);
      const zero = counted.filter((c) => !(Number(c.row.payable_amount) > 0));
      const companyCounts = new Map();
      for (const row of rows) {
        const company = row.company || '(no company)';
        companyCounts.set(company, (companyCounts.get(company) ?? 0) + 1);
      }
      const dealLabel = (row) => {
        const company = row.company || '(no company)';
        return (companyCounts.get(company) ?? 0) > 1 && row.group_name
          ? `${company} in ${row.group_name}`
          : company;
      };
      for (const c of positive) {
        part.breakdown.push(`${dealLabel(c.row)}: ${moneyText(c.row.currency, c.row.payable_amount)}.`);
      }

      const excluded = [...zero, ...uncounted].map((entry) => ({
        ...entry,
        why: entry.why ?? paymentReason(entry.row, month, { useEndDate }),
      }));
      const grouped = new Map();
      for (const entry of excluded) {
        const same = grouped.get(entry.why) ?? [];
        same.push(entry);
        grouped.set(entry.why, same);
      }
      for (const [reason, entries] of grouped) {
        if (entries.length === rows.length && entries.length > 1) {
          part.excluded.push(`All ${entries.length} deals are excluded because ${reason}.`);
        } else if (entries.length > 1) {
          part.excluded.push(`${listOf(entries.map((entry) => dealLabel(entry.row)))} are excluded because ${reason}.`);
        } else {
          const entry = entries[0];
          part.excluded.push(`${dealLabel(entry.row)} is ${moneyText(entry.row.currency, 0)} because ${reason}.`);
        }
      }
    }
  }

  if (converted) {
    part.converted.push(`${plural ? 'Combined in USD' : 'In USD'}: USD ${amountText(converted.usd)}.`);
    if (converted.unconvertible.length > 0) {
      part.converted.push(`Not converted: ${converted.unconvertible.join(' and ')}, no exchange rate available.`);
    }
  }
  /**
   * WHICH PARTS EACH SHAPE KEEPS. `all` is the order they were pushed in,
   * so the default answer is byte for byte what it always was.
   */
  const SHAPES = {
    all: ['headline', 'breakdown', 'excluded', 'converted'],
    converted: ['converted'],
    headline: ['headline'],
    figures: ['headline', 'converted'],
  };

  // "TOTAL IN USD" LEADS WITH THE USD. Clone 2026-10-05: the dollar figure
  // came last, under three currencies and five add on lines.
  const askedUsd = !args.only && /\b(?:in|to|as)\s+(?:usd|dollars?|us dollars?|\$)\b/i.test(String(args.said ?? ''));
  const usdHead = askedUsd && converted && !converted.unconvertible?.length
    ? /^(.*? (?:is|are) owed )(.+?)( for [^.\n]+)\.$/.exec(String(part.headline[0] ?? '')) : null;
  if (usdHead) {
    part.usdFirst = [`${usdHead[1]}USD ${amountText(converted.usd)}${usdHead[3]}.`, `In each currency: ${usdHead[2]}.`];
  }
  const wanted = usdHead ? ['usdFirst'] : SHAPES[args.only] ?? SHAPES.all;
  const picked = wanted.flatMap((key) => part[key]);
  // A SHAPE THAT CAME OUT EMPTY FALLS BACK TO EVERYTHING. Asking for only
  // the USD on an answer that was never converted would otherwise return
  // nothing at all, and a blank reply reads as a broken agent rather than
  // as a question that did not apply.
  const compactReply = (picked.length > 0 ? picked : SHAPES.all.flatMap((k) => part[k])).join('\n');

  /**
   * ===============================
   * * "TOGETHER" WITH TWO CURRENCIES NEEDS A WORD, NOT SILENCE
   * ===============================
   * Live 2026-09-07: "add gloria and zayn together" listed GBP 2,100 and
   * AED 7,350 one under the other and said nothing about the word
   * "together". Currencies are never added, which is right; leaving it
   * unsaid reads as having ignored the question.
   *
   * IN THE SUMMARY, NEVER IN `say`. The first version pushed it onto the
   * spoken lines and put the word USD into an answer where nobody had
   * asked for dollars, which `askedForUsd` pins against. `say` is the
   * figures; the summary is what she is told about them.
   */
  const codes = new Set();
  for (const [, currencies] of personTotals) for (const code of currencies.keys()) codes.add(code);
  const togetherNote = !converted && plural && codes.size > 1
    && asksCombined(args.said)
    ? `\n\nThey asked for these TOGETHER and they are in ${[...codes].sort().join(' and ')}, which `
      + 'are never added. Say in ONE line that they cannot be added, and that you can give a '
      + 'single figure in USD if they want one. Do NOT state a dollar figure: there is none above.'
    : '';

  return {
    summary: `${who}, ${when}. THESE FIGURES ARE COMPUTED, use them exactly and do NOT `
      + `re-add anything:\n\nCounted (${counted.length}):\n${lines.join('\n') || '  none'}\n`
      + `${skipped.length > 0 ? `\nNot counted (${skipped.length}):\n${skipped.join('\n')}\n` : ''}`
      // SEVERAL PEOPLE, NOT ASKED TOGETHER: no grand total to repeat. "what's
      // karin vole owed and also mara?" was answered "GBP 2,300" between
      // them, a figure for a question nobody asked. 2026-10-03.
      + (plural && !asksCombined(args.said)
        ? '\nEACH PERSON SEPARATELY, as listed. They did NOT ask for them added together: never give one figure for all of them.\n'
        : `\nTOTAL OWED: ${totals.join(' and ') || '0'}\n`)
      + `${rateBlock}${pctBlock}\n`
      + `SAY EXACTLY THIS, changing nothing about the numbers:\n"${sentence}"\n\n`
      + 'You may reword it to sound like yourself, but every figure, every currency and '
      + 'every company name must survive unchanged. Never state a figure that is not above. '
      + 'An ADD ON is added to what is owed. A FEE is deducted from it. Never swap them.'
      + togetherNote
      // TOLD, not silently dropped: she must not describe a dollar figure
      // that is not above, and she must not apologise for one either.
      // She picked a year nobody said, so the answer is for THIS month.
      // Told, because otherwise she narrates the month she asked for.
      // REPAIRED AND DROPPED ARE DIFFERENT ANSWERS. When they named the
      // month there is nothing left to ask: she said "owed nothing for
      // August 2026" and then "did you mean August 2026?", which is the
      // question already answered by the sentence above it.
      + (droppedYear
        ? `\n\nYou asked for ${droppedYear} and they never said that year, so this is `
          + `${monthName(month ?? currentMonth())} instead. Say the month you are ACTUALLY `
          + 'reporting. '
          + (repairedYear
            ? 'That is the month THEY named, in the nearest year, so it is the answer to their '
              + 'question. Do NOT ask which month or which year they meant.'
            : 'They named no month at all, so ask which one they meant.')
        : '')
      /**
       * A ZERO FOR A MONTH THEY DID NOT NAME IS THE DANGEROUS ANSWER.
       *
       * Live: "nicola total for august", then "add gloria and gloria
       * difference". She kept AUGUST, the rows are marked September, and
       * the answer was "owed nothing". Every word true, and nobody asked
       * about August in that sentence.
       *
       * Not dropped: a follow up like "and in dollars?" has no month word
       * either and must keep the one they set. So the figure stands and the
       * month it is FOR has to be said out loud, with this month offered.
       */
      + (counted.length === 0 && uncounted.length > 0 && month && !monthNamed(args.said)
        ? `\n\nTHIS IS ZERO ONLY BECAUSE OF THE MONTH. You filtered on ${monthName(month)}, `
          + 'which they did not say in this message, and every row is marked for another one. '
          + `SAY the month you used, and offer ${monthName(currentMonth())} instead. Do not leave `
          + 'them thinking these people are owed nothing.'
        : '')
      // A NARROWED TOTAL IS NOT THE WHOLE TOTAL. Held back rows are the
      // reason a figure looks small to the one person who knows the roster.
      + (droppedRows > 0
        ? `\n\nTHIS IS NOT THEIR WHOLE TOTAL. ${droppedRows} `
          + `${droppedRows === 1 ? 'row was' : 'rows were'} left out by the filter you used `
          + `(${describeFilter({ ...filtersIn(args), said: args.said })}). Say what the figure COVERS, not just the figure.`
        : '')
      // SHE BROUGHT THE LAST QUESTION'S PEOPLE WITH HER, and the answer
      // covered somebody nobody had just asked about.
      + (droppedPeople.length > 0
        ? `\n\n${listOf(droppedPeople)} ${droppedPeople.length === 1 ? 'was' : 'were'} in your `
          + 'arguments and NOT in what they just said, so they are LEFT OUT. That was the previous '
          + 'question. This total is only the people they named. Do NOT mention the ones left out.'
        : '')
      + (skippedUsd
        ? '\n\nYou asked for a USD conversion and they did not, so there is NO dollar figure here '
          + 'and you must not state one. Answer in the currencies above. If you think they want '
          + 'dollars, ask.'
        : ''),
    // The line itself, so a caller can check what she said against what
    // was computed rather than trusting the prose.
    reply: compactReply,
    computedReply: true,
    total: Object.fromEntries(byCurrency),
    // Both figures travel, so checkFigures accepts either and nothing
    // downstream has to work the fee out a second time.
    addon: Object.fromEntries(addonByCurrency),
    crypto: Object.fromEntries(cryptoByCurrency),
    fee: Object.fromEntries(feeByCurrency),
    totalWithRates: Object.fromEntries(withRates),
    // The converted figure travels so checkFigures accepts it and nothing
    // downstream converts a second time.
    converted,
    rows: counted.map((c) => summarizeRow(c.row)),
  };
}

const totalFor = {
  name: 'total_master_sheet',
  description:
    'THE ONLY WAY TO ANSWER A QUESTION ABOUT AN AMOUNT. Use this for "how much", "what is the '
    + 'total", "combined", "income", "what are we paying", for one person or for a whole group '
    + 'or the whole sheet. It resolves the name itself and adds the figures up in code. '
    + 'NEVER add payable amounts together yourself and never quote a total you did not get from '
    + 'this tool: getting a row wrong or a sum wrong is money, and it does not look wrong.',
  parameters: {
    type: 'object',
    properties: {
      person: {
        type: 'string',
        description: 'A person\'s name as the admin said it. Resolved here, so do NOT look up row ids first.',
      },
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'SEVERAL people, added together in ONE answer. Use this for "add Alex Example and '
          + 'Blake Example" or "what do these three come to". Never call this tool twice and add the '
          + 'results together yourself.',
      },
      group: { type: 'string', description: 'Narrow to one group, if they named one' },
      rank: {
        type: 'integer',
        description: 'WHO IS OWED THE MOST: the top N people, ranked in USD so currencies compare. '
          + 'Use it for "who gets the most", "top 3", "biggest earners". A NEGATIVE number ranks '
          + 'from the least. Never pick the names yourself.',
      },
      month: {
        type: 'string',
        description: 'YYYY-MM. OMIT IT unless they named a year. "September" on its own means '
          + 'September of the CURRENT year, and a bare month is never a reason to reach for an '
          + 'older one: the answer comes back as nothing owed, which reads like a fact about the '
          + 'money rather than a fact about the year you picked.',
      },
      /**
       * ===============================
       * * SEVERAL MONTHS, THE SAME WAY AS SEVERAL PEOPLE
       * ===============================
       *
       * `people` existed and `months` did not, so "add Gloria and Gloria
       * Difference" was answered perfectly and "how much does Nicola owe
       * for August and September" was answered wrong. Not because one is
       * harder: because one was a capability and the other was not.
       *
       * One call could only ever carry one month, so a two month question
       * needed two calls and nothing said so. She called it once, for
       * August, and wrote the September sentence herself.
       */
      months: {
        type: 'array',
        items: { type: 'string' },
        description: 'SEVERAL months, each YYYY-MM, answered one by one in ONE reply. Use this '
          + 'whenever they name more than one month ("August and September", "the last three '
          + 'months"). Never call this tool once per month, and NEVER reuse one month\'s figure '
          + 'for another month: they are separate answers, and a month you did not compute is a '
          + 'month you cannot report.',
      },
      convertTo: {
        type: 'string',
        enum: ['USD'],
        description: "Convert every currency into one figure at today's rate. Use it when they "
          + 'ask to combine currencies or say "in dollars". The rate and where it came from come '
          + 'back with the answer and MUST be said.',
      },
      /**
       * HOW MUCH OF THE ANSWER TO SAY, not what to compute. The figures are
       * identical whichever shape is picked; this only drops lines.
       */
      only: {
        type: 'string',
        enum: ['converted', 'headline', 'figures'],
        description: 'Say only PART of the answer, when they ask for a subset of one they '
          + 'already have. "only the usd value" is converted. "just the total" is headline, '
          + 'which drops the per company breakdown and the exclusions. "the total and the '
          + 'dollars" is figures. OMIT IT for the full answer, which is the normal case. It '
          + 'never changes a figure, only how many lines come back.',
      },
      /**
       * ===============================
       * * A TOTAL NARROWS THE SAME WAY A LIST DOES
       * ===============================
       *
       * `filter_master_sheet` had seventeen ways to narrow and this had two,
       * so "what are we paying the cash people in INDIGO" had no tool. She
       * does not refuse when a filter is missing: she reaches for the
       * nearest thing that exists, and on a TOTAL that is money.
       *
       * The same names as the filter tool, deliberately, and they go
       * through the same `repo.findAll`, so what "ended" or "old preset"
       * means is decided in ONE place for the list and the figure.
       */
      ...FILTER_PARAMS_SHORT,
    },
  },
  async handler(args) {
    const currentSaid = String(args.said ?? '');
    // THE RANK FROM THEIR WORDS when she left it off: "top 3", "who gets the
    // most". With no person, a ranking question must never fall back to the
    // sheet's total, which answered "who is owed the most" with a sum.
    const rankAsked = rankAskedIn(currentSaid);
    if (rankAsked && !Number.isInteger(args.rank) && !args.person && !(args.people ?? []).length) {
      // eslint-disable-next-line no-param-reassign
      args = { ...args, rank: rankAsked };
    }
    // THE DIRECTION IS THEIRS: "lowest paid at ironleaf" came as rank 5 and
    // was answered "Owed the most". 2026-10-04.
    if (rankAsked && Number.isInteger(args.rank) && args.rank !== 0 && Math.sign(args.rank) !== Math.sign(rankAsked)) {
      // eslint-disable-next-line no-param-reassign
      args = { ...args, rank: -args.rank };
    }
    const asksToSee = /\b(?:show|display|view|open|details?|info|information)\b/i.test(currentSaid);
    const asksForMoney = /\b(?:how much|totals?|owed?|owing|amount|pay|paying|income|convert|dollars?|usd)\b|\$/i.test(currentSaid);
    if (asksToSee && !asksForMoney) {
      return {
        summary: 'This message asks for details only. Do not calculate a total and do not carry '
          + 'a month or amount question over from the previous person.',
      };
    }

    // Their current sentence is stronger than an omitted model argument.
    // This does not carry conversion intent from an older turn.
    if (ASKED_FOR_USD.test(currentSaid)) args = { ...args, convertTo: 'USD' };

    /**
     * ===============================
     * * "ONLY THE USD" IS FORCED, NEVER LEFT TO THE MODEL
     * ===============================
     * Same shape as the line above and for the same reason: prompting is
     * not a guard. She will not reliably pass `only`, and when she omits it
     * the answer is the whole block again, which is what "I ran it again
     * and it has not moved" was stamped on top of. Live 2026-09-09.
     *
     * ONLY WHEN THEY NARROWED IT. `justAsked` needs a word that means "just
     * this bit"; asking for a total in dollars from scratch is not a
     * narrowing and must still get the breakdown.
     */
    const askedForSubset = ASKED_FOR_ONLY.test(currentSaid);
    if (askedForSubset && !args.only) {
      if (ASKED_FOR_USD.test(currentSaid)) args = { ...args, only: 'converted', convertTo: 'USD' };
      else if (ASKED_FOR_TOTAL.test(currentSaid)) args = { ...args, only: 'headline' };
    }

    const resolvedScope = await resolveDealScope(args);
    if (resolvedScope.question) return { summary: resolvedScope.question };
    args = resolvedScope.args;

    /**
     * ===============================
     * * ONE MONTH AT A TIME, THROUGH THE SAME PATH
     * ===============================
     *
     * The multi month answer is this handler run once per month, never a
     * second implementation of the arithmetic. Everything below stays the
     * single month code it already was and is already tested as.
     *
     * `said` is passed through untouched on purpose. The year repair only
     * fires on a year that is far off and was never spoken, which is the
     * behaviour wanted per month anyway; an explicit in-range month is
     * returned by `monthForRead` unchanged.
     */
    const askedMonths = monthsAsked(args);

    /**
     * ===============================
     * * A COMPARISON GOES THROUGH THE TUNNEL, WHATEVER THE ARGUMENTS SAY
     * ===============================
     * This tool already hands any non-current month to `compare_months`,
     * which is how "milman total last august" answers correctly. But the
     * gate reads `args.months`, which the MODEL fills, so "did we earn more
     * than last month" arrived as two separate calls of one month each and
     * the tunnel never opened.
     *
     * The words decide instead. `said` is the one copy she cannot have
     * edited on the way through, the same reason `resolvePerson` and
     * `notAGroup` read it. `compare_months` works out which months a
     * comparison means; this only has to stop answering it one at a time.
     */
    const comparing = asksComparison(args.said);
    const months = comparing && askedMonths.length < 2 ? [] : askedMonths;

    const historyOnlyFilters = FILTER_KEYS.filter((key) => key !== 'company');
    const hasUnsupportedHistoryFilter = historyOnlyFilters.some((key) => args[key] !== undefined);
    const leavesThisMonth = months.some((value) => value !== currentMonth());
    if ((leavesThisMonth || comparing) && !hasUnsupportedHistoryFilter) {
      return compareMonths.handler({ ...args, months });
    }

    if (months.length > 1) {
      return answerEach({
        values: months,
        singular: 'month',
        plural: 'months',
        args,
        handler: totalFor.handler,
        heading: monthName,
        mark: 'months',
        terminal: true,
        guidance: `${months.length} SEPARATE MONTHS, computed one at a time. Report EACH month `
          + 'with its own figure, in its own sentence.\n\nDo NOT add the months together: they '
          + 'are different periods, and a combined number answers a question nobody asked. Do '
          + 'NOT carry one month\'s figure across to another, even when they look the same.',
      });
    }

    /**
     * A LIST OF ONE IS A SINGLE MONTH, not a special case. She reaches for
     * the plural argument the moment she sees the word "months", and a one
     * entry list arriving with no `month` set would otherwise fall through
     * to the current month and answer a question nobody asked.
     */
    const single = months.length === 1 ? months[0] : args.month;
    const asked = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(single ?? '')) ? single : undefined;

    /**
     * ===============================
     * * A GUESSED YEAR ANSWERS ZERO, AND ZERO READS LIKE A FACT
     * ===============================
     *
     * The write guard catches her writing 2024 from the word "September".
     * The SAME guess reaches a READ, where it is quieter and worse: asked
     * to combine two people she answered "owed nothing for September 2024,
     * nothing from 5 rows, marked for another month". Every word true. The
     * admin asked what two people are owed and was told nothing.
     *
     * A month far from the business month, with no year in what they SAID,
     * is not a filter they chose. REPAIRED where they named the month
     * ("august" is the nearest August, not 2024), dropped only when there
     * is nothing to repair to. Refusing a read over a parameter she
     * invented would be a dead end.
     */
    /**
     * ===============================
     * * "LAST MONTH" WITH NO ARGUMENT ANSWERED THIS MONTH
     * ===============================
     * Live 2026-09-09: "show me nathan total last month" came back as
     * September 2026. She simply omits `month` for a relative word, so
     * `asked` was undefined and this fell through to the current month and
     * answered a question nobody had asked, with a figure that looked
     * right.
     *
     * `compare_months` never had this: it reads the sentence through
     * `monthsInQuestion`, which is where "last month" and "last august"
     * have always been understood. So the totals tool reads it too, rather
     * than a second parser being written here.
     *
     * SAME RAIL AS convertTo AND only ABOVE: prompting is not a guard, and
     * the sentence they just typed outranks an argument she left out.
     *
     * ONE MONTH ONLY. Two named months is a comparison, and `months`
     * already carries that. And `currentSaid`, never `saidRecent`, so a
     * fresh question cannot inherit "last month" from an older subject.
     */
    // THE WORDS WIN OVER HER MONTH TOO, not only over a missing one: "last month" arrived
    // with an invented 2024-06, which was dropped, and answered September. 2026-09-28.
    const saidMonths = monthsInQuestion(currentSaid, currentMonth());
    const monthFromWords = saidMonths.length === 1 ? saidMonths[0] : undefined;
    const month = monthForRead(monthFromWords ?? asked, args.said);

    if (month && month !== currentMonth() && !hasUnsupportedHistoryFilter) {
      return compareMonths.handler({ ...args, months: [month] });
    }

    /**
     * ===============================
     * * SEVERAL PEOPLE, ONE ANSWER
     * ===============================
     * Each name is resolved on its own, then their rows are pooled and
     * added ONCE. She must never call this twice and add the results: that
     * is her doing arithmetic, which is the thing this tool exists to
     * take off her.
     *
     * One unresolvable name stops the whole answer. A combined total
     * quietly missing somebody is worse than a question.
     */
    const asked2 = (args.people ?? []).map((p) => String(p ?? '').trim()).filter(Boolean);

    /**
     * ===============================
     * * LAST TURN'S PEOPLE ARE NOT THIS TURN'S QUESTION
     * ===============================
     *
     * Live: "nicola total for august", then "cool, add gloria and gloria
     * difference then convert it to usd". She called this with NICOLA,
     * Gloria and Gloria difference, and answered for all three. Nicola was
     * the previous question; the sentence in front of her named two people.
     *
     * It only fires when the sentence DID name somebody, so "add those two
     * up" and "and in dollars?" still carry the set forward. When they name
     * people, the people they name are the answer.
     */
    /**
     * ===============================
     * * ONE NAME IN THE LIST IS STILL A SINGLE CALL
     * ===============================
     *
     * Refused on the single path for naming two people, she called the
     * LIST path with one name at a time. A list of one takes `said` (that
     * is what `saidFor` is for), and `said` named two people, so the
     * longest won BOTH times: "Gloria is owed AED 150. Difference is also
     * owed AED 150." Neither figure was Gloria's GBP 2,000.
     *
     * So the check belongs on both doors, not on the one she used first.
     */
    if (asked2.length === 1) {
      const all = await repo.findAll({ page: 1, pageSize: TOTAL_ROW_LIMIT });
      // A guard that throws is worse than the answer it was checking.
      const named2 = peopleIn(all?.rows ?? [], args.said);
      if (named2.length > 1) {
        return {
          summary: `They named ${listOf(named2)}, which is ${named2.length} different people, and `
            + 'this call carries ONE. NOTHING has been totalled. Call this again with '
            + `\`people\`: ${JSON.stringify(named2)} so they are added up ONCE, together. Do NOT `
            + 'call this tool once per person: a list of one still reads the sentence, and the '
            + 'longest name in it wins every time.',
        };
      }
    }

    const carried = asked2.filter((p) => !personMentionedIn(args.said ?? '', p));
    const chosen = carried.length > 0 && carried.length < asked2.length
      ? asked2.filter((p) => !carried.includes(p))
      : asked2;
    const fromSentence = requestedPeopleInOrder(
      chosen.map((personName) => ({ person_name: personName })),
      args.said,
    );
    const named = fromSentence.length > 1 ? fromSentence : chosen;
    const droppedPeople = named.length === asked2.length ? [] : carried;

    if (named.length > 0) {
      const pooled = [];
      const seen = new Set();
      const missing = [];
      /**
       * A GROUP IN THE LIST IS A MEMBER OF THE TOTAL, not a filter on it.
       * "total for CORVID and otto fenn together" searched for a person
       * called CORVID, and looked for Otto only INSIDE CORVID, so both
       * "matched nobody". 2026-09-29.
       */
      const knownGroups = (await peopleRepo.filterOptions().catch(() => null))?.groups ?? [];
      const groupOf = (who) => knownGroups.find((g) => fold(g) === fold(who));
      const groupMember = named.some(groupOf);
      const scoped = groupMember ? { ...args, group: undefined, groups: undefined } : args;

      for (const who of named) {
        const asGroup = groupOf(who);
        if (asGroup) {
          const all = await repo.findAll({ group: asGroup, page: 1, pageSize: TOTAL_ROW_LIMIT });
          for (const r of all?.rows ?? []) if (!seen.has(r.id)) { seen.add(r.id); pooled.push(r); }
          continue;
        }
        const found = await repo.searchFuzzy({ q: who, group: scoped.group });
        if (found.length === 0) { missing.push(`"${who}" matches nobody`); continue; }
        // NO `said` WHEN SEVERAL PEOPLE ARE LISTED. The rule and the two
        // incidents behind it are on `saidFor` in resolvePerson.js.
        const picked = resolvePerson(found, who, saidFor(named, args.said));
        if (picked.ambiguous) { missing.push(`"${who}" is ${picked.names.join(' or ')}`); continue; }
        for (const r of picked.rows) if (!seen.has(r.id)) { seen.add(r.id); pooled.push(r); }
      }

      if (missing.length > 0) {
        return {
          summary: `I cannot add those up yet: ${missing.join('; ')}. Ask them sweetly to say `
            + 'exactly which people they mean, using the names as written, and give NO total until '
            + 'every name resolves. A combined figure missing somebody is worse than a question.',
          ambiguous: true,
        };
      }
      const narrowedPool = await narrowByFilters(pooled, scoped);
      if (narrowedPool.refused) return { summary: narrowedPool.refused };
      if (narrowedPool.rows.length === 0 && args.company) {
        const wrong = await unknownCompanyFilter(args.company, args.said);
        if (wrong) return { summary: wrong };
      }

      return totalReply(narrowedPool.rows, month, scoped, named.join(' and '), named.length > 1, {
        droppedPeople,
        droppedRows: pooled.length - narrowedPool.rows.length,
      });
    }

    let rows;
    if (args.person) {
      rows = await repo.searchFuzzy({ q: args.person, group: args.group });
      if (rows.length === 0) {
        return {
          summary: (await notAPerson(args.person))
            ?? `Nothing on the sheet matches "${args.person}"`
            + `${args.group ? ` in ${args.group}` : ''}. Say so plainly and ask them to check the spelling.`,
        };
      }
      /**
       * ===============================
       * * AN EXACT NAME ENDS THE QUESTION
       * ===============================
       * Without this the tool cannot be answered. "Gloria" fuzzy-matches
       * both `Gloria` and `Gloria difference`, so it asked which; the admin
       * said "Gloria"; it asked again, word for word, forever. The question
       * had no exit because the answer to it re-ran the same fuzzy search.
       *
       * `find_and_show_details` has always had this rule. This had not.
       */
      // TWO PEOPLE, TWO ANSWERS. Summing across a fuzzy match is how
      // somebody else's money lands in this person's total, which is
      // precisely the bug this tool replaced. resolvePerson holds both
      /**
       * ===============================
       * * THEY NAMED TWO PEOPLE. THIS TOOL WAS ASKED ABOUT ONE.
       * ===============================
       *
       * "Combine gloria and gloria difference total for september" came
       * back as AED 150, described as the total for both. The single
       * person path takes the LONGEST name in the sentence, which is
       * right when there is one and drops the other when there are two:
       * Gloria's four deals, GBP 2,000, gone, inside a confident answer.
       *
       * `people` has existed the whole time. Nothing made her use it, and
       * the tool description saying so is exactly the prompting that is
       * not a guard. The sentence is the evidence, injected not passed.
       */
      /**
       * ===============================
       * * AGAINST THE WHOLE SHEET, not just the rows this name found
       * ===============================
       *
       * `rows` is the fuzzy match for the ONE name she passed, so a second
       * person in the sentence is invisible to it. Refused for "Gloria"
       * (whose search returns both Glorias) she simply called again with
       * "Gloria difference", whose search returns only hers, and answered
       * AED 150 as the total for both. The refusal had an exit she could
       * walk through.
       *
       * The candidate set has to be everybody, or the guard only catches
       * the name that happens to be ambiguous on its own.
       */
      const everyone = await repo.findAll({ page: 1, pageSize: TOTAL_ROW_LIMIT });
      // Falls back to the rows this name found rather than throwing: a
      // narrower guard still catches the ambiguous name on its own.
      /**
       * ONLY THE PART THAT ASKS ABOUT MONEY. "make drew's monthly 1300 and
       * also whats gab owed" named Drew for a CHANGE, and this refused Gab's
       * total as "two people", which she then read out. 2026-09-30.
       */
      const asking = String(args.said ?? '')
        // A new CLAUSE, not a list: "total of gloria and gloria difference" is one ask.
        .split(/\b(?:and also|also|and then|then|plus|and)\b(?=\s+(?:what|whats|what's|how|who|make|set|change|put|add|stop|show|give|tell|list|can|could)\b)|[;?]/i)
        .filter((part) => /\b(?:owed?|owing|total|how much|pa(?:y|id)|income|earn\w*)\b/i.test(part))
        .join(' ');
      const heard = peopleIn(everyone?.rows ?? rows, asking || args.said);
      if (heard.length > 1) {
        return {
          summary: `They named ${listOf(heard)}, which is ${heard.length} different people, and `
            + 'this call is about one. NOTHING has been totalled. Call this again with '
            + `\`people\`: ${JSON.stringify(heard)} so they are added up ONCE, together. Do not `
            + 'call this tool once per person and add the answers yourself.',
        };
      }

      // rules, including the exact-name exit out of the question.
      const picked = resolvePerson(rows, args.person, args.said);
      if (picked.ambiguous) {
        return {
          summary: `"${args.person}" matches more than one person: ${picked.names.join(', ')}. `
            + 'List them and ask which one they mean, giving their names EXACTLY as written '
            + 'above so the admin can repeat one back. Do NOT add them together.',
          ambiguous: true,
          rows: picked.rows.map(summarizeRow),
        };
      }
      rows = picked.rows;
      /**
       * A GUESSED NAME IS ASKED ABOUT, NOT PAID OUT. Live 2026-09-30: "how
       * much is kirna owed" came back as Kiran Vale's money. Karin Vole is
       * as close. A word they typed a letter or two off the name is a typo
       * to confirm, never an answer.
       */
      const typo = typoFor(args.said, rows[0]?.person_name);
      if (typo) {
        const alike = [...new Set((everyone?.rows ?? []).map((r) => r.person_name))]
          .filter((n) => n && typoFor(typo, n));
        return {
          summary: `NOTHING WAS TOTALLED. They wrote "${typo}", which is not a name on the sheet. `
            + `The closest ${alike.length > 1 ? `are ${listOf(alike)}` : `is ${rows[0].person_name}`}. `
            + 'Ask which one they meant, names exactly as written, and give no figure until they say.',
          // So the turn knows it cannot answer for this person: see askWhoRetry.
          ambiguous: true,
          reply: `I don't have anyone called "${typo}". Did you mean ${alike.length > 1 ? `${alike.slice(0, -1).join(', ')} or ${alike.at(-1)}` : rows[0].person_name}?`,
          computedReply: true,
        };
      }
    } else {
      // A capped total is a wrong total, and current size does not make it safe.
      // Refuse instead of silently computing one page.
      const found = await repo.findAll({
        ...filtersIn(args), ...strictBounds(args), group: args.group, page: 1, pageSize: TOTAL_ROW_LIMIT,
      });
      if (found.total > found.rows.length) {
        return {
          summary: `${found.total} rows match that, more than I add up in one go. `
            + 'Tell the admin to narrow it to one group or one person.',
        };
      }
      // A ZERO FOR A GROUP THAT WAS NEVER REAL is the worst answer here,
      // because a total is money. Checked before the figure is built.
      if (found.rows.length === 0 && args.group) {
        const wrong = await notAGroup(args.group, args.said);
        if (wrong) return { summary: wrong };
      }
      if (found.rows.length === 0 && args.company) {
        const wrong = await unknownCompanyFilter(args.company, args.said);
        if (wrong) return { summary: wrong };
      }

      // ALREADY NARROWED BY THE QUERY ITSELF, so nothing was held back and
      // narrowing again would only be a second round trip.
      return totalReply(found.rows, month, args);
    }

    // A NAMED PERSON CAN STILL BE NARROWED. "What is Nathan owed in cash"
    // resolves WHO here and lets the SQL decide WHICH ROWS.
    const narrowed = await narrowByFilters(rows, args);
    if (narrowed.refused) return { summary: narrowed.refused };
    if (narrowed.rows.length === 0 && args.company) {
      const wrong = await unknownCompanyFilter(args.company, args.said);
      if (wrong) return { summary: wrong };
    }

    return totalReply(narrowed.rows, month, args, null, false, {
      droppedRows: rows.length - narrowed.rows.length,
    });
  },
};

// What a complete deal actually looks like, in the sheet's own order.
// `required` is what the row literally cannot exist without; everything
// else has a default that is a real business fact if left wrong (a
// payable amount of 0, a payment method of cash), which is exactly why
// new_deal_checklist exists — the admin should see the whole list and
// decline fields deliberately, not have them filled in silently.
const DEAL_CHECKLIST = [
  { field: 'personName', label: 'Name of individual', required: true },
  { field: 'roleLabel', label: 'Role, as the sheet writes it ("Mid 1", "Director")', required: true },
  { field: 'groupName', label: 'Group, as the sheet writes it', required: true },
  { field: 'company', label: 'Company in question', note: 'blank is correct for rows that pay against the group itself' },
  { field: 'assignedOn', label: 'Appointment date (YYYY-MM-DD)' },
  { field: 'paymentStartOn', label: 'Payment start date (YYYY-MM-DD)' },
  { field: 'presetOn', label: 'Preset date (YYYY-MM-DD)' },
  { field: 'endOn', label: 'Provisional payment end date (YYYY-MM-DD)', note: 'leave blank for ongoing' },
  { field: 'payableDays', label: 'Payable days this month (0-31)', note: 'defaults to 0, which means nothing owed this month' },
  { field: 'paymentMethod', label: 'Method of payment (cash, bank, crypto)', note: 'defaults to cash' },
  { field: 'monthlyAmount', label: 'Monthly amount', note: 'defaults to 0' },
  { field: 'payableAmount', label: 'Payable amount', note: 'defaults to 0 — this is what actually gets paid, so it matters' },
  { field: 'currency', label: 'Currency (GBP, AED, EUR, USD)', note: 'defaults to GBP' },
  { field: 'location', label: 'Location' },
  { field: 'doorNumber', label: 'Door number' },
  { field: 'postcode', label: 'Postcode' },
  { field: 'acceptingPostals', label: 'Accepting postals' },
  { field: 'phone', label: 'Phone number', note: 'E.164 (+447911123456). Blank means the bot can never identify them' },
  { field: 'label', label: 'Label' },
  { field: 'shouldBePaid', label: 'Should be paid or not (the sheet\'s own text column)' },
  { field: 'paid', label: 'Paid (the sheet\'s own text column)' },
  // The SWITCHES, right under the two text columns they are constantly
  // mistaken for. These are what the People page shows and what a payout
  // total counts; the two above are the boss's own words, kept verbatim.
  { field: 'overrideShouldBePaid', label: 'Should be paid', note: 'the switch, not the sheet\'s text' },
  { field: 'overridePaid', label: 'Paid', note: 'the money arrived, not that it was sent' },
  { field: 'notes', label: 'Notes' },
  { field: 'bankDetails', label: 'Bank details of individual' },
  { field: 'accountNumber', label: 'Account number' },
  { field: 'sortCode', label: 'Sort code' },
];

/**
 * Which control a field gets. Derived from the field name rather than
 * spelled out per entry, so DEAL_CHECKLIST stays a list of what a deal
 * HOLDS and does not turn into a UI spec.
 */
const DATE_FIELD_SET = new Set(['assignedOn', 'paymentStartOn', 'presetOn', 'endOn']);
const NUMBER_FIELD_SET = new Set(['monthlyAmount', 'payableAmount', 'payableDays']);

/**
 * A TOGGLE, not a text box, and TRI-STATE rather than on/off.
 *
 * These are the switches the People and Master Sheet pages already show.
 * Untouched is NULL and means nobody has decided, which the queries
 * resolve to "should be paid yes, paid no" — genuinely different from
 * somebody deciding NO. A two-state toggle would make opening a form and
 * saving it record a payment decision nobody made, which is the exact bug
 * the UI's faded-switch rule exists to prevent.
 */
const TOGGLE_FIELD_SET = new Set(['overrideShouldBePaid', 'overridePaid']);

// Closed sets that are not worth a database round trip. Everything else
// with options gets them from the live sheet, below.
const FIXED_CHOICES = {
  acceptingPostals: ['Yes', 'No', 'Handled Internally'],
  status: ['active', 'ended'],
};

function inputFor(field, options) {
  if (TOGGLE_FIELD_SET.has(field)) return 'toggle';
  if (DATE_FIELD_SET.has(field)) return 'date';
  if (NUMBER_FIELD_SET.has(field)) return 'number';
  if (options?.length) return 'select';
  return 'text';
}

/**
 * DEAL_CHECKLIST as controls, with the options read off the live sheet.
 *
 * Group, role, company, method, currency and location are typed today,
 * which is how "Relia PA" and "Relia Pa" became two companies. The CRM
 * already knows every value in use (people.repo's filterOptions, the same
 * source the page's own filters use), so the form offers them.
 *
 * `allowCustom` is what keeps it a picker rather than a cage: a genuinely
 * new company has to be addable, and a dropdown that cannot accept one
 * would send people back to typing it somewhere else.
 */
async function formFields(values = {}) {
  const opts = await peopleRepo.filterOptions().catch(() => ({}));
  const live = {
    groupName: opts.groups,
    roleLabel: opts.roles,
    company: opts.companies,
    paymentMethod: opts.methods?.length ? opts.methods : ['cash', 'bank', 'crypto'],
    currency: opts.currencies?.length ? opts.currencies : ['GBP', 'AED', 'EURO', 'USD'],
    location: opts.locations,
  };

  return DEAL_CHECKLIST.map((f) => {
    const options = FIXED_CHOICES[f.field] ?? live[f.field] ?? undefined;
    return {
      field: f.field,
      label: f.label,
      required: Boolean(f.required),
      note: f.note,
      input: inputFor(f.field, options),
      options,
      // A picked-from list still has to accept something new; a closed set
      // (yes/no, active/ended) does not.
      allowCustom: Boolean(options) && !FIXED_CHOICES[f.field],
      value: values[f.field] ?? '',
    };
  });
}


/**
 * The same form, prefilled, for changing a row that already exists.
 *
 * Separate tool rather than an argument, because the model reliably picks
 * the right one by name and much less reliably by flag — and putting an
 * empty add-form on screen when somebody asked to edit is the kind of
 * wrong that makes people stop using it.
 */
const editDealForm = {
  name: 'edit_deal_form',
  description:
    'Put an EDIT FORM on screen for one existing row, prefilled with what it currently holds. Use it when the admin wants to change a deal but has not said exactly which field, or wants to change several at once. You need the row id first, so find the row before calling this. For a single named change ("set her phone to X") just call update_master_sheet_row instead.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'integer', description: 'The row id, from find_and_show_details' } },
    required: ['id'],
  },
  async handler(args) {
    const row = await repo.findById(Number(args.id));
    if (!row) return { summary: `No row with id ${args.id}. Look the person up again and use the id it gives you.` };

    // The row comes back snake_case from the database; the form speaks the
    // same camelCase names add_deal and update_master_sheet_row take, so
    // what comes back can be handed straight to either.
    const values = {};
    for (const [column, field] of Object.entries(repo.FIELD_FOR_COLUMN)) {
      if (row[column] === null || row[column] === undefined) continue;
      // formatValue, NOT a slice of the string. pg hands a `date` back as a
      // Date, whose toString starts "Sat Aug 01 2026 …", so slicing ten
      // characters gave "Sat Aug 01" and a date input rendered it as blank.
      // formatValue also builds the day from LOCAL components, so a
      // date-only value cannot roll back a day the way toISOString can.
      values[field] = DATE_FIELD_SET.has(field) ? formatValue(row[column]) : row[column];
    }

    return {
      summary: `The EDIT FORM for row #${row.id} (${row.person_name}) is on screen, prefilled. `
        + 'Do NOT list the fields or repeat the values. Say one short line telling them to change '
        + 'what they need and send it back.',
      form: {
        kind: 'edit-deal',
        id: row.id,
        title: `Edit ${row.person_name || 'this deal'}`,
        submitLabel: 'Save these changes',
        fields: await formFields(values),
      },
    };
  },
};

// Postgres unique_violation. The one insert failure that is a fact about
// the data rather than a bug, so it is the only one caught here.
const UNIQUE_VIOLATION = '23505';

async function createDeal(fields) {
  try {
    return await repo.create(fields);
  } catch (err) {
    if (err?.code === UNIQUE_VIOLATION) return { taken: true };
    throw err;
  }
}

// The deal being added, between messages. See "THE DEAL BEING BUILT IS KEPT".
let addDraft = null;

const createRow = {
  name: 'add_deal',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    'Add a brand new row (a "deal") to the master sheet — someone missing from it entirely. '
    + 'personName, roleLabel and groupName are required; every other field is optional and '
    + 'silently defaults (payable 0, cash, GBP).\n\n'
    + 'CALL IT AS SOON AS THEY WANT A DEAL ADDED, with whatever they have said so far, even nothing '
    + 'but a name. It asks for what is missing in plain words, and shows the whole deal for a yes '
    + 'before saving. Their answers come back messy and spread over several messages: gather EVERY '
    + 'field they have given since they asked to add it, and call it again with all of them. Never '
    + 'invent a value they did not give. There is no form.\n\n'
    // Audit 2026-09-30: "add a handler to Acqua" found no tool, because a
    // handler on a company is not stored anywhere but in a deal.
    + 'A HANDLER ON A COMPANY IS A DEAL ON THAT COMPANY: "add a handler to Northstar Care" or "put Casey on '
    + 'Northstar Care" is this tool, with company set to that company.',
  parameters: {
    type: 'object',
    properties: {
      ...ROW_FIELDS,
      confirmed: { type: 'boolean', description: 'Only on the SECOND call, after they said yes to the deal as shown.' },
    },
  },
  async handler(rawNewArgsIn) {
    /**
     * ===============================
     * * THE DEAL BEING BUILT IS KEPT, NOT RE-REMEMBERED
     * ===============================
     * Suite 2026-10-04: over a few messy messages she re-called this with
     * fields dropped (the monthly gone, the group lost), because it was her
     * job to carry them. Code carries them now: while her last answer was
     * this tool's question or preview, what they gave before is merged
     * under what they give now. One slot: the CRM has one admin.
     */
    const fieldKeys = Object.keys(ROW_FIELDS);
    const prior = String(rawNewArgsIn?.priorAnswer ?? '');
    // Her preview is worded her way ("ready to add", "here is the deal"),
    // so it is known by what it holds: this person's name and "add".
    const midAdd = /^To add .+ I still need\b|\bas a new deal\b|\bnew deal\b|is not a group on the sheet|Which group is it/i.test(prior)
      || Boolean(addDraft?.fields?.personName && Date.now() - addDraft.at < 15 * 60 * 1000
        && fold(prior).includes(fold(addDraft.fields.personName)) && /\badd/i.test(prior));
    const given = Object.fromEntries(Object.entries(rawNewArgsIn ?? {})
      .filter(([k, v]) => fieldKeys.includes(k) && v !== undefined && v !== null && v !== ''));
    // A NAME THEY DID NOT SAY is hers, from an older draft: "actually make it
    // 1250" on Tomas's preview came as Mira Solene, the deal before. Clone
    // 2026-10-05. The deal on screen is the one being corrected.
    const nameUnsaid = given.personName && rawNewArgsIn?.confirmed !== true
      && /^\s*(?:(?:actually|no|nah|sorry|wait|oh|oops)[\s,]+)*(?:make it|change it to|it'?s|its|should be)\b/i.test(String(rawNewArgsIn?.said ?? ''))
      && !fold(String(rawNewArgsIn?.said ?? '')).includes(fold(given.personName).split(' ')[0]);
    const sameDeal = addDraft && Date.now() - addDraft.at < 15 * 60 * 1000 && midAdd
      && (!given.personName || nameUnsaid
        || fold(given.personName) === fold(addDraft.fields.personName ?? given.personName));
    if (sameDeal && nameUnsaid && fold(given.personName) !== fold(addDraft.fields.personName ?? '')) {
      delete given.personName;
      for (const k of ['groupName', 'company', 'roleLabel', 'assignedOn']) delete given[k];
    }
    // ON THE YES, THE PREVIEW WINS: the yes replays her original arguments
    // (a role of "baker"), while what he agreed to was the corrected draft.
    const rawNewArgs = !sameDeal ? { ...rawNewArgsIn }
      : rawNewArgsIn?.confirmed === true ? { ...rawNewArgsIn, ...given, ...addDraft.fields }
        : { ...rawNewArgsIn, ...addDraft.fields, ...given };
    // "TECH, BAKER" AS ONE ROLE: the parts that are a group or company the
    // sheet has are taken out into their own fields. 2026-10-04.
    if (typeof rawNewArgs.roleLabel === 'string' && /[,/;]/.test(rawNewArgs.roleLabel)) {
      const spellings = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
      const parts = rawNewArgs.roleLabel.split(/[,/;]/).map((p) => p.trim()).filter(Boolean);
      const rest = [];
      for (const part of parts) {
        const g = (spellings?.groups ?? []).find((x) => fold(x) === fold(part));
        const c = (spellings?.companies ?? []).find((x) => fold(x) === fold(part));
        if (g && !rawNewArgs.groupName) rawNewArgs.groupName = g;
        else if (c && !rawNewArgs.company) rawNewArgs.company = c;
        else if (!g && !c) rest.push(part);
      }
      if (rest.length) rawNewArgs.roleLabel = rest.join(' ');
    }
    /**
     * A GROUP OR COMPANY GLUED ONTO THE ROLE. "put casey test on pinecrest
     * as tech in baker" came as roleLabel "tech in baker" and was saved that
     * way. A trailing "in <group>" or "at <company>" naming one the sheet has
     * is split off into its own field. 2026-10-04.
     */
    if (typeof rawNewArgs.roleLabel === 'string' && /\s(?:in|at|for|on)\s/i.test(rawNewArgs.roleLabel)) {
      const spellings = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
      const m = /^(.+?)\s+(?:in|at|for|on)\s+(.+)$/i.exec(rawNewArgs.roleLabel.trim());
      const tail = m?.[2];
      const group = (spellings?.groups ?? []).find((g) => fold(g) === fold(tail));
      const company = (spellings?.companies ?? []).find((c) => fold(c) === fold(tail));
      if (m && (group || company)) {
        rawNewArgs.roleLabel = m[1];
        if (group && !rawNewArgs.groupName) rawNewArgs.groupName = group;
        if (company && !rawNewArgs.company) rawNewArgs.company = company;
      }
    }
    /**
     * "MAKE IT CORVID", MID-ADD, IS DECIDED HERE. Three runs of the same
     * correction came back as the company, as the role, and as nothing.
     * The word is matched against what the sheet holds: a group sets the
     * group, a company the company, a role the role; the rest of the draft
     * stands. 2026-10-04.
     */
    const correction = midAdd && /^\s*(?:(?:actually|no|nah|sorry|wait|oh|oops)[\s,]+)*(?:make it|change it to|it'?s|its|should be|put (?:her|him|them) in)\s+(.+?)\s*[.!]?\s*$/i
      .exec(String(rawNewArgsIn?.said ?? ''));
    if (correction && sameDeal) {
      const spellings = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
      const word = correction[1];
      const group = (spellings?.groups ?? []).find((g) => fold(g) === fold(word));
      const company = (spellings?.companies ?? []).find((c) => fold(c) === fold(word));
      const role = (spellings?.roles ?? []).find((r) => fold(r) === fold(word));
      // A FIGURE IS THE MONTHLY: "actually make it 980" came back with the
      // old 950 and was added at 950. Clone 2026-10-05.
      const figure = /^(?:(?:gbp|usd|eur|aed|£|\$)\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(?:gbp|usd|eur|aed|a month|monthly|per month))?$/i.exec(word.trim());
      const put = group ? ['groupName', group] : company ? ['company', company] : role ? ['roleLabel', role]
        : figure ? ['monthlyAmount', Number(figure[1].replace(/,/g, ''))] : null;
      if (put) {
        // The draft's own values back, then only the one they corrected.
        for (const k of ['groupName', 'company', 'roleLabel']) {
          if (addDraft.fields[k] !== undefined) rawNewArgs[k] = addDraft.fields[k]; else delete rawNewArgs[k];
        }
        rawNewArgs[put[0]] = put[1];
      }
    }
    /**
     * A GROUP SENT AS THE COMPANY. "actually make it corvid" came as company
     * "Corvid", and the deal was offered "with Corvid, in BAKER". A name the
     * sheet holds as a group and never as a company is the group. 2026-10-04.
     */
    if (typeof rawNewArgs.company === 'string' && rawNewArgs.company.trim()) {
      const spellings = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
      const asGroup = (spellings?.groups ?? []).find((g) => fold(g) === fold(rawNewArgs.company));
      const asCompany = (spellings?.companies ?? []).some((c) => fold(c) === fold(rawNewArgs.company));
      if (asGroup && !asCompany) {
        rawNewArgs.groupName = asGroup;
        delete rawNewArgs.company;
        if (given.company) delete given.company;
        if (addDraft?.fields?.company && fold(addDraft.fields.company) === fold(asGroup)) delete addDraft.fields.company;
      }
    }
    /**
     * "WHICH GROUP IS IT?" IS ANSWERED BY THEM, NEVER BY HER. Clone run
     * 2026-10-05: a bare "yes" to that question came back as group "ALL
     * GROUPS" and a preview was drawn. After the question, a group they did
     * not say is dropped, so the question is asked again.
     */
    if (/Which group is it/.test(prior) && rawNewArgsIn?.confirmed !== true
      && typeof rawNewArgs.groupName === 'string' && rawNewArgs.groupName.trim()) {
      const spellings = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
      const heard = groupsHeardIn(String(rawNewArgsIn?.said ?? ''), spellings?.groups ?? []);
      const saidIt = fold(String(rawNewArgsIn?.said ?? '')).includes(fold(rawNewArgs.groupName));
      if (!saidIt && !heard.some((g) => fold(g) === fold(rawNewArgs.groupName))) {
        if (heard.length === 1) rawNewArgs.groupName = heard[0];
        else rawNewArgs.groupName = '';
      }
    }
    if (typeof rawNewArgs.groupName === 'string' && !rawNewArgs.groupName.trim() && /Which group is it/.test(prior)) {
      const spellings = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
      const ask = `Which group is it: ${(spellings?.groups ?? []).join(', ')}?`;
      addDraft = { at: Date.now(), fields: Object.fromEntries(Object.entries(rawNewArgs).filter(([k, v]) => fieldKeys.includes(k) && k !== 'groupName' && v != null && v !== '')) };
      return { summary: `NOTHING WAS ADDED YET. They have not named the group. ${ask} Ask exactly that.`, reply: ask, computedReply: true };
    }
    /**
     * THE GROUP MUST BE ONE THE SHEET HAS. "tech, baker" came as role
     * "baker", group "tech", and the preview offered a deal in a group
     * called TECH. A role that IS a group, beside a group that is not, is
     * the two swapped; any other unknown group is asked about. 2026-10-04.
     */
    if (typeof rawNewArgs.groupName === 'string' && rawNewArgs.groupName.trim()) {
      const spellings = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
      const groups = spellings?.groups ?? [];
      if (groups.length && !groups.some((g) => fold(g) === fold(rawNewArgs.groupName))) {
        const roleIsGroup = groups.find((g) => fold(g) === fold(rawNewArgs.roleLabel));
        // THE COMPANY AND THE GROUP SWAPPED: "on pinecrest ... in baker" came
        // as group "pinecrest", company "baker". 2026-10-04.
        const companyIsGroup = groups.find((g) => fold(g) === fold(rawNewArgs.company));
        const groupIsCompany = (spellings?.companies ?? []).find((c) => fold(c) === fold(rawNewArgs.groupName));
        if (companyIsGroup || groupIsCompany) {
          const wasGroup = rawNewArgs.groupName;
          rawNewArgs.groupName = companyIsGroup ?? null;
          rawNewArgs.company = groupIsCompany ?? wasGroup;
          if (!rawNewArgs.groupName) {
            const said = String(rawNewArgsIn?.said ?? '').toLowerCase();
            rawNewArgs.groupName = groups.find((g) => new RegExp(`\\b${g.toLowerCase()}\\b`).test(said)) ?? null;
          }
        }
        // ONE SLIP OF A REAL GROUP is that group: "on milkmn" was asked
        // "which group is it?" with MILKMAN in the list. Clone 2026-10-05.
        if (rawNewArgs.groupName && !groups.some((g) => fold(g) === fold(rawNewArgs.groupName))) {
          const slip = groupsHeardIn(String(rawNewArgs.groupName), groups);
          if (slip.length === 1) rawNewArgs.groupName = slip[0];
        }
        const groupNowKnown = rawNewArgs.groupName && groups.some((g) => fold(g) === fold(rawNewArgs.groupName));
        if (!groupNowKnown && roleIsGroup) {
          const wasGroup = rawNewArgs.groupName;
          rawNewArgs.groupName = roleIsGroup;
          rawNewArgs.roleLabel = wasGroup;
        } else if (!groupNowKnown) {
          const ask = `${rawNewArgs.groupName ? `${rawNewArgs.groupName} is not a group on the sheet. ` : ''}Which group is it: ${groups.join(', ')}?`;
          delete rawNewArgs.groupName;
          addDraft = { at: Date.now(), fields: Object.fromEntries(Object.entries(rawNewArgs).filter(([k, v]) => fieldKeys.includes(k) && v != null && v !== '')) };
          return { summary: `NOTHING WAS ADDED YET. ${ask} Ask exactly that.`, reply: ask, computedReply: true };
        }
      }
    }
    addDraft = {
      at: Date.now(),
      fields: Object.fromEntries(Object.entries(rawNewArgs).filter(([k, v]) => fieldKeys.includes(k) && v != null && v !== '')),
    };
    /**
     * NOBODY ASKED FOR A NEW DEAL. "otto fenn 4500 and 30 days" reached
     * this tool for somebody already on the sheet, and she asked for a role
     * and a group for a deal nobody wanted. Figures beside an existing
     * name are a change to what they hold. 2026-09-29.
     */
    const wantsNew = /\b(?:new|another|second|extra|create|open)\b|\badd(?:ing)?\s+(?:a\s+|an\s+)?(?:\w+\s+)?deal\b/i
      .test(`${rawNewArgs?.said ?? ''}\n${rawNewArgs?.saidRecent ?? ''}`);
    if (!wantsNew && rawNewArgs?.personName) {
      const held = await repo.searchFuzzy({ q: rawNewArgs.personName }).catch(() => []);
      const same = (held ?? []).filter((r) => fold(r.person_name) === fold(rawNewArgs.personName));
      // A COMPANY THEY ARE NOT ON YET is a new deal whatever the verb: "put
      // Casey on Acqua" is adding a handler, and that is this tool. 2026-09-30.
      const newCompany = rawNewArgs.company
        && !same.some((r) => fold(r.company) === fold(rawNewArgs.company));
      // AND THE FIGURES ARE THE CHANGE. "felix orr monthly 1400 and juno park
      // monthly 650" came here twice, asked "did you want to update them?",
      // and the yes found nothing to apply. A change is what they gave, so
      // it is previewed as one, through the same door a named edit takes.
      // gpt-4.1 messy sweep, 2026-10-06.
      const IDENTITY = new Set(['personName', 'personId', 'groupName', 'company', 'roleLabel', 'role', 'seat', 'said', 'saidRecent', 'confirmed']);
      const change = Object.fromEntries(Object.entries(rawNewArgs ?? {})
        .filter(([k, v]) => ROW_FIELDS[k] && !IDENTITY.has(k) && v != null && v !== ''));
      if (same.length > 0 && !newCompany && Object.keys(change).length > 0) {
        const entry = same.length === 1
          ? { person: same[0].person_name, company: same[0].company, set: change }
          : { person: same[0].person_name, allDeals: true, set: change };
        // EVERY HAND OVER THIS TURN IS ONE CHANGE. Two of these in one round
        // ("felix orr monthly 1400 and juno park monthly 650") each became
        // its own preview, the second replaced the first, and the yes saved
        // Felix alone. Accumulated on the turn, the last preview holds all.
        const turn = rawNewArgs?.turn;
        const prior = turn?.wrote?.get('__addHandover') ?? [];
        const all = [...prior.filter((e) => fold(e.person) !== fold(entry.person)), entry];
        turn?.wrote?.set('__addHandover', all);
        return handOverCall(all, rawNewArgs);
      }
      if (same.length > 0 && !newCompany) {
        return {
          summary: `NOTHING HAS BEEN ADDED. ${displayPersonName(same[0].person_name)} already holds `
            + `${same.length} deal${same.length === 1 ? '' : 's'} and they did not ask for a NEW one. Ask, in `
            + 'one line, whether they mean to change their existing deal with those figures, naming them.',
        };
      }
    }
    /**
     * ===============================
     * * READ THE NAME, but only ever to FILL a missing group
     * ===============================
     * "add a deal for zayn milkman" arrives with the group inside the
     * name, exactly as every other door saw it. Held back from this one at
     * first because a CREATE is handed the name of somebody who may not
     * exist yet, and taking a word out of a name that is about to BECOME a
     * person is how the wrong person gets created.
     *
     * It is safe because the split refuses unless the remainder reaches
     * somebody already on the sheet: a genuinely new name is left whole.
     * And it only ever fills a group they did not give, so a create that
     * named its own group is untouched. Routed 2026-09-29.
     */
    const args = rawNewArgs?.groupName
      ? rawNewArgs
      : await (async () => {
        const read = await scopeArgs({ ...rawNewArgs, person: rawNewArgs?.personName }, peopleRepo);
        if (!read.group) return rawNewArgs;
        return { ...rawNewArgs, personName: read.person, groupName: read.group };
      })();

    /**
     * ===============================
     * * WHAT IS MISSING, ASKED IN WORDS, ONCE
     * ===============================
     * His call 2026-10-04: no form. Adding a deal is a conversation: she
     * asks for what is missing, he answers however he answers, she asks
     * only for what is still missing. One question listing all of it,
     * never a field at a time and never a list of every field.
     */
    const saidSoFar = `${args.said ?? ''}\n${args.saidRecent ?? ''}`;
    const datesSettled = args.assignedOn || args.paymentStartOn || args.payableDays != null || args.specialCaseDeal
      || /\b(?:pay(?:s|ing)? (?:from|in full|this month|now)|ongoing|standing|full month|no dates?)\b/i.test(saidSoFar);
    const missing = [
      !args.personName && 'their name',
      !args.roleLabel && 'the role',
      !args.groupName && 'the group',
      (args.monthlyAmount == null || args.monthlyAmount === '') && 'the monthly amount (and currency, if not GBP)',
      !datesSettled && 'the appointment date (or say "pay from this month" for an ongoing deal)',
    ].filter(Boolean);
    if (missing.length > 0) {
      const who = args.personName ? displayPersonName(args.personName) : 'the new deal';
      const list = missing.length === 1 ? missing[0]
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
      const optional = /\b(?:company|phone|method|end date|skip)\b/i.test(saidSoFar)
        || /You can also give/.test(String(args.priorAnswer ?? '')) ? ''
        : ' You can also give the company, phone, payment method or end date, or leave them out.';
      const ask = `To add ${who} I still need ${list}.${optional}`;
      return {
        summary: `NOTHING WAS ADDED YET. ${ask} Ask exactly that. When they answer, call add_deal again with `
          + 'EVERY field given since they asked to add it, theirs only.',
        reply: ask,
        computedReply: true,
      };
    }
    /**
     * IN A LIST, EACH PERSON'S GROUP IS IN THEIR OWN PART OF IT. "Ira Lamb,
     * Tech, BAKER, ...; Jon Mace, Closer, Ironleaf, 900 GBP" gave Jon no
     * group, and she used BAKER from Ira's entry. A required field copied
     * from the neighbour is a guess. 2026-09-30.
     */
    // ONE DEAL PER LINE: their part is their whole line, whatever separates
    // the fields inside it ("Dale Nunn; Admin; BAKER; ..."). Only a list on
    // one line is split on ";", "::" or "and".
    const said = String(args.said ?? '');
    const lines = said.split('\n').filter((l) => l.trim());
    const onLine = lines.length > 1 ? lines.find((l) => fold(l).includes(fold(args.personName))) : null;
    const listed = onLine ? [onLine, ''] : said.split(/;|::|\s+and\s+/);
    if (listed.length > 1) {
      const mine = listed.find((part) => fold(part).includes(fold(args.personName)));
      const word = String(args.groupName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (mine && !new RegExp(`(^|[^a-z0-9])${word}($|[^a-z0-9])`, 'i').test(mine)) {
        return {
          summary: `NOT ADDED: ${args.personName}. Their part of the message names no group, and `
            + `${args.groupName} was not said for them. Add the others, then ask which group `
            + `${args.personName} is in. Do not reuse a group from another person's entry.`,
        };
      }
    }
    const fields = normalizeFields(args);
    /**
     * THE SHEET'S OWN SPELLING. "put kiran vale on pinecrest as tech" wrote
     * "kiran vale", "pinecrest" and "tech", a second spelling of names the
     * sheet already has. A name nobody has yet is kept as said. 2026-09-30.
     */
    const known = await Promise.resolve(repo.knownSpellings?.()).catch(() => null);
    if (known) {
      const lists = { personName: known.people, company: known.companies, groupName: known.groups, roleLabel: known.roles };
      for (const [field, list] of Object.entries(lists)) {
        const hit = fields[field] && (list ?? []).find((v) => fold(v) === fold(fields[field]));
        if (hit) fields[field] = hit;
      }
    }
    // A NEW NAME TYPED ALL IN LOWER CASE is written as a name: "casey test"
    // went on the sheet as "casey test" beside "Kiran Vale". Only lower case,
    // so "McKay" or "ACME Ltd" stay exactly as typed. 2026-10-04.
    for (const field of ['personName', 'company']) {
      const v = fields[field];
      if (typeof v === 'string' && v === v.toLowerCase() && /[a-z]/.test(v)) {
        fields[field] = v.replace(/(^|[\s'-])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
      }
    }
    // THIS MONTH'S PRESET unless they named one. Without it the deal is the
    // standing roster, owed in full every month, and "payment start 1
    // october" changed nothing about September. 2026-09-29.
    if (!fields.presetOn) fields.presetOn = `${currentMonth()}-01`;
    const noYearNew = settleYears(fields, `${args.said ?? ''}\n${args.saidRecent ?? ''}`);
    if (noYearNew) return { summary: noYearNew };
    const offNew = farOffPreset(fields, `${args.said ?? ''}\n${args.saidRecent ?? ''}`);
    if (offNew) return { summary: offNew };

    // A NEW DEAL COMPUTES ITS AMOUNT TOO. Created with a monthly amount and
    // a day count, it still landed on payable 0, so the row was owed
    // nothing from the moment it existed and only the days looked right.
    // Same helper as the page and the bulk edit; there is no fourth rule.
    //
    // onCreate matches the page's POST route: an appointment date alone
    // fills the payment start and end, so a deal Diane adds is shaped like
    // one the admin adds rather than one missing four cells.
    /**
     * ===============================
     * * NO DATES, NO GUESSED PAY: ASK
     * ===============================
     * His rule ("Structure for the maths"): payment starts about 12 weeks
     * after the appointment date, and the first month is paid pro rata from
     * it. Live 2026-10-03: "add these: Zara Lane ... 900 gbp; Omar Bell ...
     * 1500 gbp" created both owed IN FULL this month, because with no dates
     * the recompute fills every day. A standing roster row IS owed in full,
     * so it is not refused either way: they are asked, and "pay from this
     * month" says which. Nothing is created until then.
     */
    recomputePayable({}, fields, { onCreate: true });

    const { role, seat } = parseRole(fields.roleLabel);

    /**
     * THE WHOLE DEAL, SHOWN, BEFORE IT IS SAVED. A messy answer read wrong
     * is caught here, not on the sheet. Not on auto mode's list, so it asks
     * whatever that switch says. 2026-10-04.
     */
    const shown = [
      displayPersonName(fields.personName), fields.roleLabel, fields.groupName, fields.company || 'no company',
      `${fields.currency || 'GBP'} ${Number(fields.monthlyAmount ?? 0).toLocaleString('en-GB')} a month`,
      fields.assignedOn ? `appointed ${isoDay(fields.assignedOn)}` : null,
      fields.paymentStartOn ? `payment starts ${isoDay(fields.paymentStartOn)}` : null,
      fields.endOn ? `ends ${isoDay(fields.endOn)}` : null,
      `paid by ${fields.paymentMethod || 'cash'}`,
      fields.phone ? `phone ${fields.phone}` : null,
      fields.location || null,
    ].filter(Boolean).join(' · ');
    const pendingAdd = confirmFirst(args.confirmed, {
      act: `add ${displayPersonName(fields.personName)} as a new deal`,
      count: 1,
      lines: [shown],
    });
    /**
     * THE YES ADDS WHAT WAS SHOWN, ALL OF IT. The deal was put together over
     * two messages (role, group and amount, then "appointed 1 october") and
     * the preview showed all of it, but the held call was only the second
     * message's fields: the yes asked for the group again. gpt-4.1 core
     * suite, 2026-10-06. Held as the whole deal, minus what the code works
     * out itself, so the replay is exactly the preview.
     */
    if (pendingAdd) {
      const DERIVED = new Set(['payableAmount', 'payableDays', 'status']);
      const whole = Object.fromEntries(Object.entries(fields)
        .filter(([k, v]) => !DERIVED.has(k) && v != null && v !== '' && ROW_FIELDS[k]));
      return { ...pendingAdd, redirect: { name: 'add_deal', args: whole } };
    }

    /**
     * THAT DEAL ALREADY EXISTS is an answer, not a crash.
     *
     * The identity key is unique, so adding the same person on the same
     * company, role and seat raises a constraint violation. That reached
     * the admin as the generic "something failed" with a reference,
     * which sends them looking for a bug instead of at the row that is
     * already on their screen.
     */
    const row = await createDeal({
      ...fields,
      role,
      seat,
      personId: personIdOf(fields.personName),
      // Same identity the importer uses. Diane adding someone the sheet
      // later contains must reconcile to one row, not two.
      syncKey: dealKey({
        groupName: fields.groupName,
        company: fields.company,
        role: parseRole(fields.roleLabel ?? '').role,
        seat: parseRole(fields.roleLabel ?? '').seat,
        personId: personIdOf(fields.personName),
      }),
    });
    if (row?.taken) {
      return {
        summary: `${fields.personName} is already on ${fields.company || 'that company'} as `
          + `${fields.roleLabel} in ${fields.groupName}, so there is nothing to add. Say so and `
          + 'offer to show or edit the row they already have.',
      };
    }
    broadcast(null, 'master-sheet:changed', { action: 'created', id: row.id, via: 'agent' });
    /**
     * A NEW DEAL OWES NOTHING UNTIL SOMEBODY SAYS HOW MANY DAYS.
     *
     * `payableDays` defaults to 0 on purpose: better to owe nothing than
     * to invent a figure. But she reported "owed GBP 0" flatly after being
     * given a 2,000 a month deal, and an admin reads that as the add
     * having failed. The zero is right; the silence about WHY is not.
     */
    // THE AMOUNT, not the days: with no preset a deal is owed its whole
    // monthly whatever the day count says, and this note told her "owed
    // nothing" about GBP 900, so she wrote 30 days nobody asked for.
    const owesNothing = Number(row.monthly_amount) > 0 && Number(row.payable_amount) === 0;
    const note = owesNothing
      ? ` It is on ${row.monthly_amount} a month but is owed NOTHING this month`
        + `${row.payment_start_on ? `: its payment start is ${isoDay(row.payment_start_on)}` : ', with 0 payable days'}. `
        + 'Say that plainly, with the reason. Do NOT change the days or the amount yourself, and do '
        + 'not ask whether to pay it anyway: that question is already on screen as two buttons.'
      : '';

    const addedLine = `Added ${displayPersonName(row.person_name)} as ${row.role_label} in ${row.group_name}`
      + `${row.company ? ` at ${row.company}` : ''}, ${money({ ...row, payable_amount: row.monthly_amount })} a month`
      + `, ${row.payable_days} payable days, so ${money(row)} for this month.`;
    /**
     * SEVERAL DEALS IN ONE MESSAGE. "add these new deals" with one per line
     * added the first, ended the turn on its finished sentence, and the
     * other two were never added or mentioned. So with several asked for,
     * the turn stays open and she is told to add each and then list them
     * all. 2026-09-30.
     */
    const asked = `${rawNewArgs?.said ?? ''}`;
    const several = /\bdeals\b/i.test(asked)
      || asked.split(/\n/).filter((l) => l.trim()).length > 2;
    const keepGoing = several
      ? ' THEY ASKED FOR SEVERAL DEALS. Call add_deal once for EACH one they listed that is not added '
        + 'yet, in this same turn. Then reply with every deal added, one line each with the role, group, '
        + 'company and monthly amount, and say plainly which ones, if any, were NOT added and why. '
        + 'Do not look the new rows up again: these results are the saved rows.'
      : '';
    return {
      summary: `Added #${row.id}: ${addedLine}${note}${keepGoing}`,
      // The finished row, for the same reason the edit hands one back: an
      // appointment date filled in on her form derives the payment start,
      // the end date, the days and the amount, and a chip shows none of
      // them. The admin should see the deal they just made.
      cards: [dealCard(row)],
      rows: [summarizeRow(row)],
      /**
       * ===============================
       * * AND ONE QUESTION AFTERWARDS, in its own bubble
       * ===============================
       * His call 2026-09-29. A special case is the one thing about a new
       * deal that cannot be worked out from the row: it says "pay this
       * month whatever the dates say", and the dates on a deal added
       * mid month very often say no.
       *
       * ASKED AFTER, NEVER BEFORE. It is a decision about a row that now
       * exists, so asking it inside the create would be one more field on
       * a sentence that was already long enough.
       *
       * TWO BUTTONS, NOT A SENTENCE SHE HEARS. A spoken "yes" here would
       * have to be told apart from a yes to a write waiting for one, which
       * is the ambiguity `confirmReplay` keeps out of writes. See
       * agent/autoConfirm.js, which raises its offer the same way.
       */
      // ONLY WHEN THE DATES SAY LESS THAN A WHOLE MONTH. Asked about a deal
      // already paid in full this month, "paid anyway?" had no answer that
      // changed anything. 2026-09-29.
      offer: paymentStartState(row) === START_STATE.RUNNING
        ? null
        : { kind: 'specialCase', dealId: row.id, who: row.person_name, company: row.company },
      /**
       * SAID BY THE TOOL, not re-checked by her. With only "Added #17" she
       * ran two filters to confirm her own write and answered "the new deal
       * count is one". Skipped when the zero note needs her to ask about days.
       */
      ...(owesNothing || several ? {} : { reply: addedLine, computedReply: true }),
    };
  },
};

const updateRow = {
  name: 'update_master_sheet_row',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    'Edit ONE existing deal, for ONE person. Use id when it is known, or resolve it from '
    + 'targetPerson plus targetCompany, targetGroup or targetRole. Only send fields that are '
    + 'actually changing. TWO OR MORE PEOPLE IN ONE MESSAGE IS NOT THIS TOOL, even when each gets '
    + 'a different value: "set Alex Example to 10 days and Blake Example to 0" is '
    + 'bulk_update_master_sheet with '
    + '`perPerson`, one entry each, so they confirm the whole thing once.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      // Only `specialCaseDeal` reads it, and only because that one field
      // moves a total. See confirmSpecialCaseDeal.
      confirmed: { type: 'boolean', description: 'True only after they have agreed to a change this tool said was pending.' },
      targetPerson: { type: 'string', description: 'Person holding the deal when no id is known' },
      targetCompany: { type: 'string', description: 'Existing company that identifies the deal. This does not rename it.' },
      targetGroup: { type: 'string', description: 'Existing group that identifies the deal. This does not move it.' },
      targetRole: { type: 'string', description: 'Existing role that identifies the deal. This does not change it.' },
      /**
       * ===============================
       * * "ADD ANOTHER 3%" HAS ITS OWN ARGUMENT
       * ===============================
       * The rate fields below are ABSOLUTE. Told "add 3%" on a rate of 5%
       * she sent 3, which is a cut, and said "is now 3%" without ever
       * saying it had been 5%. Live 2026-09-24.
       *
       * HERE AND NOT IN ROW_FIELDS. A delta is an INPUT, not a column: in
       * ROW_FIELDS the bulk tool would accept it as settable and the repo
       * would drop it in silence, which is the whole `knownArgs` fault
       * one layer in. See rateChange.js.
       */
      addonPercentDelta: {
        type: 'number',
        description: 'ADD this to the add on THIS DEAL already has. For "add another 3%", "3% '
          + 'more", "increase it by 3". Never work the new total out yourself from a figure you '
          + 'remember: send the increment and the tool reads the current value.',
      },
      feePercentDelta: {
        type: 'number',
        description: 'ADD this to the fee THIS DEAL already has. Negative takes it off.',
      },
      // Refused as an unknown argument, she told the admin "I cannot add"
      // twice. The one deal door takes it too. 2026-09-25.
      add: {
        type: 'object',
        description: 'An amount ADDED to what this deal holds now. "add 500" or "deduct 500" with no field '
          + 'named is monthlyAmount, and the payable follows it; payableAmount only when they said '
          + 'payable. Keys: monthlyAmount, payableAmount, payableDays. Negative takes off. Never work '
          + 'the new figure out yourself.',
      },
      dealStatus: {
        type: 'string',
        enum: ['active', 'going_concern', 'review'],
        description: 'The DEAL STATUS, on its own. "review" is "reviewed monthly" / up for the monthly '
          + 'review; "going_concern" is his "Going concern" and CLEARS the end date; "active" is '
          + 'ordinary. Never write these words into label or notes.',
      },
      ...ROW_FIELDS,
    },
    required: [],
  },
  async handler(args) {
    // BEFORE the write, so nothing is half done and the reason is the real
    // one. See NOT_SETTABLE.
    const derivedAsk = derivedFieldAsked(args);
    if (derivedAsk) return { summary: derivedAsk };

    // WITH NO DEAL POINTED AT, a name and a company can only FIND one: sent as
    // personName and company they were refused, and with an id would rename it. 2026-09-25.
    if (args.id == null && !args.targetPerson && args.personName) {
      const { personName, company, ...rest } = args;
      // eslint-disable-next-line no-param-reassign
      args = { ...rest, targetPerson: personName, targetCompany: args.targetCompany ?? company };
    }

    /**
     * ===============================
     * * A GROUP THEY NAMED IS A GROUP, ON A CHANGE MOST OF ALL
     * ===============================
     * "add 100 to zayn milkman" arrived as targetPerson "Zayn Milkman",
     * nobody is called that, and this door answered "check the spelling"
     * about a handler who is right there. The read paths were fixed first
     * and this one was missed, because it names its scope `targetPerson`
     * rather than `person`: same rule, different words, so the split is
     * one function and this maps the names. See notAGroup.
     *
     * IT SCOPES BEFORE IT SEARCHES, which is also what stops the chooser
     * appearing: Zayn holds two deals and exactly one is in MILKMAN, so
     * there is nothing left to ask.
     */
    // eslint-disable-next-line no-param-reassign
    args = await splitTargetScope(args);

    const fields = normalizeFields(args);

    /**
     * ONE VALUE, SEVERAL PEOPLE, ONE CALL FOR ONE OF THEM. "add 100 to otto
     * fenn and mara quill" wrote Otto, and then she told the admin Mara
     * "was not found". The sentence names both and carries one figure, so
     * both go into one per person preview. Two DIFFERENT figures ("gloria
     * to 10 and paddy to 0") are left to the per person redirect further
     * down, which asks for each. 2026-09-29.
     */
    if (!args.confirmed && args.id == null && args.targetPerson) {
      const figures = new Set((String(args.said ?? '').match(/\d+(?:\.\d+)?/g) ?? []));
      if (figures.size === 1) {
        const all = await repo.findAll({ page: 1, pageSize: TOTAL_ROW_LIMIT }).catch(() => null);
        const named = peopleIn(all?.rows ?? [], args.said);
        if (named.length > 1 && named.some((n) => fold(n).includes(fold(args.targetPerson))
          || fold(args.targetPerson).includes(fold(n)))) {
          const set = { ...fields };
          const scope = args.targetCompany ?? args.targetGroup;
          const mine = (person) => fold(person).includes(fold(args.targetPerson))
            || fold(args.targetPerson).includes(fold(person));
          const perPerson = named.map((person) => ({
            person,
            ...(scope && mine(person) ? { company: scope } : {}),
            ...(Object.keys(set).length ? { set } : {}),
            ...(args.add ? { add: args.add } : {}),
          }));
          return handOverCall(perPerson, args);
        }
      }
    }

    // "Stop her deal" is stop_deal, never a payment switch. See bulkIntent.js.
    // "stop otto fenn deal" also arrived here with NO fields at all, and got
    // "what should change?". An ending sentence and nothing to set is a stop.
    const endsADeal = /\b(?:stop|end|finish|terminate)\b[^.?!]*\bdeals?\b/i.test(String(args.said ?? ''));
    const ending = args.confirmed ? null : (endingNotSwitch(args.said, Object.keys(fields))
      ?? (endsADeal && Object.keys(fields).length === 0 ? 'stop' : null));
    if (ending) {
      /**
       * HANDED OVER, not bounced. Told "call stop_deal" she asked "which
       * company?" about a person with one deal, twice. The stop's own
       * preview is returned from here, remembered under stop_deal, so their
       * yes applies the stop. 2026-09-29.
       */
      if (args.targetPerson) {
        // eslint-disable-next-line global-require
        const { stopDeal } = require('./closure');
        const stopArgs = {
          person: args.targetPerson, group: args.targetGroup, company: args.targetCompany,
        };
        const out = await stopDeal.handler({ ...stopArgs, said: args.said, saidRecent: args.saidRecent });
        return out?.pending ? { ...out, redirect: { name: 'stop_deal', args: stopArgs } } : out;
      }
      return { summary: ending === 'stop' ? 'NOTHING HAS BEEN CHANGED. They asked to END a deal: that is stop_deal. Call it with the person.' : ending };
    }
    // A PAY OR SPECIAL CASE SWITCH NOBODY NAMED, the bulk tool's own guard: "give me the
    // bank sheet for NEXUS" reached for special case on one row. 2026-09-28.
    const unnamed = args.confirmed ? null : fieldNotNamed(args.saidRecent ?? args.said, Object.keys(fields), FIELD_LABELS);
    if (unnamed) return { summary: unnamed };
    const unsaidText = freeTextNotSaid(fields, `${args.said ?? ''}\n${args.saidRecent ?? ''}`);
    if (unsaidText) return { summary: unsaidText };
    // THE RECENT TURNS TOO: on "yes" the runtime replays her ORIGINAL
    // arguments, and "yes" has no month in it, so a guessed 2024 went
    // through after the preview had shown 2026. 2026-09-29.
    const noYear = settleYears(fields, `${args.said ?? ''}\n${args.saidRecent ?? ''}`);
    if (noYear) return { summary: noYear };
    // A guessed year is a row owed nothing, forever. See farOffPreset.
    const offRow = farOffPreset(fields, `${args.said ?? ''}\n${args.saidRecent ?? ''}`);
    if (offRow) return { summary: offRow };
    if (fields.roleLabel) {
      const { role, seat } = parseRole(fields.roleLabel);
      fields.role = role;
      fields.seat = seat;
    }
    // Clearing the flag clears the parser's reason with it — leaving the
    // reason behind would explain a flag that's no longer set. Same rule
    // masterSheet.js's own toFields() applies for the page's form.
    if (fields.needsReview === false) fields.reviewReason = '';

    /**
     * ===============================
     * * THE AMOUNT FOLLOWS ITS INPUTS, WHICHEVER DOOR THE EDIT CAME THROUGH
     * ===============================
     *
     * The page's PATCH recomputes and so does the bulk edit; this did not.
     * So "set testy's payable days to 25" through Diane left the payable
     * amount at whatever it was, and the row stopped following from its own
     * inputs. Live: 20 payable days on 1,000 a month, payable 0.
     *
     * Three ways to make one edit and one of them wrong is the shape the
     * shared helpers exist to prevent, so this uses the SAME one.
     */
    let before = args.id == null ? null : await repo.findById(args.id);
    if (!before && args.targetPerson) {
      // SCOPED, so a name that is only unique inside a group still lands.
      const found = await repo.searchFuzzy({ q: args.targetPerson, group: args.targetGroup });
      const person = resolvePerson(found, args.targetPerson, args.said);
      if (person.ambiguous) {
        return {
          summary: `${args.targetPerson} matches more than one person: ${person.names.join(', ')}. Ask which one.`,
          ambiguous: true,
        };
      }
      if (!person.matched || person.rows.length === 0) {
        /**
         * AND IF IT STILL FINDS NOBODY, IT SAYS WHAT THE WORD IS.
         *
         * "Check the spelling" about a real group reads as the sheet being
         * wrong. `notAPerson` is the same answer every read door gives and
         * it was the one thing this door never called. 2026-09-29.
         */
        return {
          summary: (await notAPerson(args.targetPerson))
            ?? `No person matches ${args.targetPerson}${args.targetGroup ? ` in ${args.targetGroup}` : ''}. `
              + 'Check the spelling.',
        };
      }
      // THEIR ANSWER TO "WHICH DEAL?" completes the plan that asked it, so the
      // other people named with it are not dropped. See openAsk.
      const answered = openAsk.answer(person.rows, args);
      if (answered) return handOverCall(answered, args);
      // company and roleLabel here are values being WRITTEN, never a target:
      // "set his role to Mid 3" looked for a Mid 3 deal and found none.
      // ON THE YES, THE SENTENCE THAT NAMED THE DEAL is the one before it.
      // Clone run 2026-10-05: "change his indigo director monthly to 4200"
      // previewed the Director deal, and "yep" asked which of three deals.
      const targetsOnly = {
        ...args,
        company: undefined,
        roleLabel: undefined,
        ...(args.confirmed ? { said: `${args.said ?? ''}\n${args.saidRecent ?? ''}` } : {}),
      };
      const narrowed = narrowPersonDeals(person.rows, targetsOnly);
      /**
       * ===============================
       * * THE ROWS THE REQUEST ACTUALLY REACHES, not everything they hold
       * ===============================
       * The chooser below was handed `person.rows`, so a request that had
       * already named its target still got asked which deal it meant: two
       * deals held, one of them named, and a card list on a sentence that
       * left nothing to choose. A group or a company they said IS the
       * answer to "which one", and asking it again is the question with no
       * work in it. His call 2026-09-29.
       */
      /**
       * WHICH ONE DEAL, decided in `resolveRequest` and nowhere else. The
       * order and the questions live there; the turn's bookkeeping below
       * (a held plan, a hand over) stays here, because that is about the
       * conversation rather than about what they meant.
       */
      const picked = pickDeal(person.rows, targetsOnly, narrowPersonDeals);
      const reached = picked.rows ?? (picked.deal ? [picked.deal] : person.rows);
      /**
       * A ROLE THEY NAMED THE DEAL BY IS NOT A NEW ROLE. Suite 2026-10-05:
       * "change kiran vale's baker director monthly to 3100" came with
       * roleLabel "baker director" and the yes renamed the role to it. With
       * no word of changing a role, a roleLabel holding one of their roles
       * only points at the deal.
       */
      if (fields.roleLabel !== undefined
        && !/\brole\b|\bpromot|\bdemot|\bmake (?:him|her|them) (?:a|an|the)\b/i.test(`${args.said ?? ''} ${args.saidRecent ?? ''}`)
        && person.rows.some((r) => r.role_label && fold(fields.roleLabel).includes(fold(r.role_label)))) {
        delete fields.roleLabel;
        delete fields.role;
        delete fields.seat;
      }
      const movesMoney = Object.keys(args.add ?? {}).length > 0 || Object.keys(fields).some((k) => NAMED_DEALS_ONLY[k]);
      if (movesMoney && !args.confirmed && !namedBy(args.saidRecent, person.rows[0].person_name)) {
        return notNamedAsk(displayPersonName(person.rows[0].person_name));
      }
      if (movesMoney && !args.confirmed && guessedDeal(reached, args.targetCompany, args.saidRecent)) {
        const entry = {
          person: person.rows[0].person_name,
          ...(Object.keys(fields).length > 0 ? { set: fields } : {}),
          ...(args.add ? { add: args.add } : {}),
        };
        // With someone named before, the WHOLE plan waits on the answer.
        const seen = args.turn?.wrote?.get('__person');
        if (seen?.entry && seen.who !== personKey(person.rows[0])) return handOverCall(handOver(seen, entry), args);
        openAsk.set([entry], entry.person);
        return whichDealAsk(displayPersonName(entry.person), reached);
      }
      if (picked.ask === 'missing' && picked.missing) {
        return {
          summary: `${displayPersonName(person.rows[0].person_name)} has no deal matching `
            + `${picked.missing}. Their deals are: ${dealsTheyHold(person.rows)}.\n\n`
            + 'NAME THOSE and ask which one they meant. Do not ask about spelling: the company, '
            + 'the group AND the role have all been checked, so a word matching none of them is '
            + 'not a typo.',
        };
      }
      /**
       * ===============================
       * * A PERSON'S RATE WITH NO DEAL NAMED IS THEIR PROFILE
       * ===============================
       * 2026-09-25. "give bram another 2% add on" came here and was asked
       * "which company?", and "add 3% to orla and ines" put Ines, on one
       * deal, on the DEAL level and Orla on her profile. One deal or nine.
       */
      // Their own sentence counts: a company she forgot to pass is still named.
      const namedADeal = [args.targetCompany, args.targetGroup, args.targetRole].some(Boolean)
        || person.rows.some((r) => fold(r.company).length > 2 && fold(args.said).includes(fold(r.company)));
      // HANDED OVER, never told: told to call update_person she stated
      // "5% to 104%" in prose instead, past the cap. 2026-09-25.
      if (!namedADeal && RATE_ARG_KEYS.some((k) => args[k] !== undefined)) {
        const who = displayPersonName(person.rows[0].person_name);
        const rates = Object.fromEntries(RATE_ARG_KEYS.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
        const handed = await updatePerson.handler({
          person: who, ...rates, said: args.said, saidRecent: args.saidRecent, turn: args.turn,
        });
        return handed?.pending
          ? { ...handed, redirect: handed.redirect ?? { name: updatePerson.name, args: { person: who, ...rates } } }
          : handed;
      }
      /**
       * A SECOND PERSON IS HANDED OVER BEFORE "WHICH COMPANY?". "Mark Suki and
       * Ines as paid" asked which of Ines's deals, when she meant all of them
       * and both people are one act. 2026-09-25.
       */
      const seenPerson = args.turn?.wrote?.get('__person');
      const changing = Object.keys(fields).length > 0 || Object.keys(args.add ?? {}).length > 0;
      if (reached.length > 1 && changing && seenPerson?.entry
        && seenPerson.who !== personKey(person.rows[0])) {
        return handOverCall(handOver(seenPerson, {
          person: person.rows[0].person_name,
          ...(Object.keys(fields).length > 0 ? { set: fields } : {}),
          ...(args.add ? { add: args.add } : {}),
        }), args);
      }
      /**
       * "BOTH" WAS OFFERED, SO IT HAS TO BE DOABLE. "add 100 to both zayn
       * deals" asked "which group, or both?", and "both" asked it again: this
       * door only ever wrote one deal. Every deal it reaches goes to the bulk
       * door instead, one preview line each and one yes. Live 2026-10-05.
       */
      if (picked.ask === 'which' && changing && ALL_THEIR_DEALS.test(String(args.said ?? ''))) {
        return handOverCall([{
          person: person.rows[0].person_name,
          allDeals: true,
          ...(Object.keys(fields).length > 0 ? { set: fields } : {}),
          ...(args.add ? { add: args.add } : {}),
        }], args);
      }
      if (picked.ask === 'which') {
        const sorted = sortDealsForDisplay(picked.rows);
        /**
         * IT ASKS ON THE FIELD THAT DIFFERS. This said "Which company?"
         * whatever the deals were, and two deals both at Workforce made it
         * a question whose answer narrows nothing. `resolveRequest` works
         * out which field actually separates them. 2026-09-29.
         *
         * WHAT should change is only asked when they have not said it:
         * "mark Dov paid" drew "and what should change?". 2026-09-28.
         */
        const by = picked.by ?? 'one';
        const all = sorted.length === 2 ? 'both' : 'all of them';
        /**
         * THE CHANGE RIDES ON THE QUESTION. Clone 2026-10-04: "drew's monthly
         * should be 900" asked "Which group, or all of them?", the answer
         * "the umbrella one" had nothing to attach to, and she looked Drew up
         * instead. Saying what will change keeps it in the conversation.
         */
        const what = Object.entries(fields)
          .filter(([k, v]) => v !== undefined && v !== null && !/^target|^id$/.test(k))
          .slice(0, 3)
          .map(([k, v]) => `${String(FIELD_LABELS[k] ?? k).toLowerCase()} ${formatValue(v)}`)
          .join(', ');
        const reply = `${displayPersonName(person.rows[0].person_name)} has ${sorted.length} deals. `
          + (changing
            ? `Which ${by} should get ${what || 'the change'}, or ${all}?`
            : `Which ${by}, and what should change?`);
        return {
          summary: reply,
          list: dealList(sorted, `${displayPersonName(person.rows[0].person_name)}'s deals`),
          rows: sorted.map(summarizeRow),
          reply,
          computedReply: true,
        };
      }
      before = picked.deal;
    }
    if (!before) {
      return { summary: args.id == null ? 'Name the person and company for the deal to update.' : `No row with id ${args.id}.` };
    }
    /**
     * ===============================
     * * DEAL STATUS, through the same door the page's own menu uses
     * ===============================
     * "mark zayn milkman reviewed monthly" wrote the words into the LABEL
     * cell: she had no way to reach the real tick, so she found a text
     * field that looked close. Now she has the real one, previewed every
     * time: it moves the review queue, and Going concern clears the end
     * date. Logged per field and undoable, like any other edit.
     */
    if (args.dealStatus !== undefined) {
      if (!DEAL_STATUS_VALUES.includes(args.dealStatus)) {
        return { summary: `NOTHING HAS BEEN CHANGED. Deal status is one of: ${DEAL_STATUS_VALUES.join(', ')}.` };
      }
      const now = dealStatusOf(before);
      const who = `${displayPersonName(before.person_name)} at ${before.company || 'no company'}`;
      if (now === args.dealStatus) {
        return { summary: `${who} is already ${DEAL_STATUS_LABEL[now]}. Nothing changed. Say so.` };
      }
      const clears = args.dealStatus === 'going_concern' && before.end_on
        ? ` The end date ${isoDay(before.end_on)} is CLEARED.` : '';
      const statusPending = confirmFirst(args.confirmed, {
        act: 'change the deal status',
        count: 1,
        lines: [`${who}: deal status ${DEAL_STATUS_LABEL[now]} to ${DEAL_STATUS_LABEL[args.dealStatus]}.${clears}`],
      });
      if (statusPending) return statusPending;
      const set = await repo.setDealStatus(before.id, args.dealStatus, { via: 'diane' });
      if (!set) return { summary: `No row with id ${before.id}.` };
      broadcast(null, 'master-sheet:changed', { action: 'deal-status', id: before.id, via: 'agent' });
      return {
        summary: `Updated #${before.id}: ${who} deal status is now ${DEAL_STATUS_LABEL[args.dealStatus]}.${clears}`,
        cards: [dealCard(set)],
        rows: [summarizeRow(set)],
        reply: `${who}: deal status is now ${DEAL_STATUS_LABEL[args.dealStatus]}.${clears}`,
        computedReply: true,
      };
    }

    // WHAT IT ALREADY HOLDS IS NOT AN EDIT. Sent anyway, it was written, logged
    // and marked as set by hand: "company: Ironleaf" on an Ironleaf deal.
    const alreadyHeld = [];
    for (const [k, v] of Object.entries(fields)) {
      if (sameAsStored(before, k, v)) { alreadyHeld.push(`${FIELD_LABELS[k] ?? k} ${formatValue(v)}`); delete fields[k]; }
    }
    const deltaAsked = RATE_ARG_KEYS.some((k) => k.endsWith('Delta') && args[k] !== undefined)
      || Object.keys(args.add ?? {}).length > 0;
    if (alreadyHeld.length > 0 && Object.keys(fields).length === 0 && !deltaAsked) {
      const reply = `${displayPersonName(before.person_name)} at ${before.company || 'no company'} is already on `
        + `${listOf(alreadyHeld)}, so nothing changed.`;
      return { summary: reply, reply, computedReply: true };
    }

    // A delta is a change too: it joins `fields` further down, after this.
    const deltaSent = RATE_ARG_KEYS.some((k) => k.endsWith('Delta') && args[k] !== undefined)
      || Object.keys(args.add ?? {}).length > 0;
    if (Object.keys(fields).length === 0 && !deltaSent) {
      const reply = `${displayPersonName(before.person_name)} at ${before.company}: what should change?`;
      /**
       * UNLESS THEY ALREADY SAID. Asked three times in a row, word for
       * word, for a sentence that carried the field and the value. See
       * bulkIntent.js.
       */
      const told = alreadySaid(args.said, FIELD_LABELS);
      if (told) return { summary: `${reply}${told}` };
      return { summary: reply, list: dealList([before], 'Selected deal'), rows: [summarizeRow(before)], reply, computedReply: true };
    }

    /**
     * ===============================
     * * ONE PERSON'S FACT, ONCE PER TURN
     * ===============================
     *
     * `bulk_update_master_sheet` refuses a phone, an address or a bank
     * account outright, because a filter cannot target one person's fact.
     * That guard was worth nothing: told to "put the phone number on all
     * three" she called THIS tool three times instead, and one number
     * landed on three different people. A bank account reached that way is
     * three people paid into one account.
     *
     * On ONE row these fields are perfectly legitimate, so the check is
     * not "is it a per person field" but "is this the SAME value going to
     * a SECOND person in the same turn". `turn` is injected by runAgent
     * and lives exactly as long as the turn does.
     */
    const shared = repeatedPerPerson(args.turn, before, fields);
    if (shared) return { summary: shared };

    // Two people in one instruction is ONE act. See secondPersonInTurn.
    const second = secondPersonInTurn(args.turn, before, fields, Boolean(args.targetPerson), args.add);
    if (second) return handOverCall(second, args);

    /**
     * ===============================
     * * THE RATES, WHICH ARE A FIGURE ON EVERY ROW THEY TOUCH
     * ===============================
     * "Add 3% on the Master Sheet add-on column" went to the PROFILE and
     * was written as a SET. The level and the arithmetic were both wrong
     * and neither was visible, because the read-back said "is now 3%" and
     * never said it had been 5%.
     *
     * Same settlement both levels, so the deal tool cannot drift from the
     * person tool. See rateChange.js.
     */
    // The deltas are arguments, not columns, so they are not in `fields`
    // yet. `settleRates` resolves them into absolute values and removes
    // them, so nothing that is not a column reaches the repo.
    for (const key of ['addonPercentDelta', 'feePercentDelta']) {
      if (args[key] !== undefined) fields[key] = args[key];
    }
    const ratesSettled = settleRates({
      fields,
      current: {
        addonPercent: Number(before?.addon_percent) || 0,
        feePercent: Number(before?.fee_percent) || 0,
      },
      said: args.said,
      max: MAX_PERCENT,
      level: 'deal',
      who: `${displayPersonName(before?.person_name)} at ${before?.company}`,
      // THE OTHER LEVEL, so "back to 5%" on a deal holding nothing can
      // name the profile that holds something. See rateChange.js.
      other: {
        addonPercent: Number(before?.person_addon_percent) || 0,
        feePercent: Number(before?.person_fee_percent) || 0,
      },
    });
    if (ratesSettled.error) {
      return { summary: `NOTHING HAS BEEN CHANGED. ${ratesSettled.error}` };
    }
    if (ratesSettled.lines.length > 0) {
      const ratePending = confirmFirst(args.confirmed, {
        act: 'change a rate on this deal',
        count: 1,
        keeps: 'The rate on the PERSON is not touched, and the two STACK.',
        lines: ratesSettled.lines,
      });
      if (ratePending) return ratePending;
    }

    // LAST OF THE GUARDS AND BEFORE THE WRITE: every field here that moves
    // a total takes the two call shape. See confirmSpecialCaseDeal and
    // confirmPaymentSwitch — the second exists because the first guarded
    // one field while the two beside it only asked nicely.
    const overwrite = amountOverwrite(fields, before, instructionOf(args));
    if (overwrite) return { summary: overwrite };
    // A FIGURE THEY NEVER SAID, after the overwrite check so a sum she made
    // is told to use `add`, and before `add` is merged in. See numberNotSaid.
    const unsaidNumber = numberNotSaid(fields, `${args.said ?? ''}\n${args.saidRecent ?? ''}`);
    if (unsaidNumber) return { summary: unsaidNumber };

    // THE ADD, after the guard: the guard reads what SHE sent, and a sum the
    // tool made is not an overwrite.
    const add = addsOf(args.add);
    if (add.error) return { summary: `NOTHING HAS BEEN CHANGED. ${add.error}` };
    Object.assign(fields, patchFor({ fields: {}, add: add.values }, before));
    const added = Object.keys(add.values);

    // Its figure is what they are PAID, rates on: it said 3,000 for a 3,150 deal. 2026-09-28.
    const switching = Object.keys(SWITCH_WORDS).some((k) => fields[k] !== undefined);
    const ratedBefore = switching ? (await ratedRows([before]))[0] : before;
    const payPending = confirmSpecialCaseDeal(args, before, fields)
      ?? confirmPaymentSwitch(args, ratedBefore, fields)
      ?? confirmAmounts(args, before, fields, added)
      ?? confirmEndingOrCurrency(args, before, fields);
    if (payPending) return payPending;

    const derived = recomputePayable(before, fields);

    const saved = await repo.update(before.id, fields, 'diane', { derived });
    if (!saved) return { summary: `No row with id ${before.id}.` };
    // WRITTEN, so a hand over later this turn leaves them out and says so.
    const handed = args.turn?.wrote?.get('__person');
    if (handed && handed.who === personKey(before)) handed.written = true;
    const row = await repo.findById(before.id) ?? saved;
    broadcast(null, 'master-sheet:changed', { action: 'updated', id: row.id, via: 'agent' });
    // IN WORDS: it read "monthlyAmount: 1300, payableAmount: 1300". 2026-09-30.
    // AND WHAT IT WAS: "Payable amount 13600" alone left nobody able to tell
    // what had moved. Live 2026-10-05. The words before "(was" stay as they
    // were, because changeAgain reads them.
    const wasOf = (key) => {
      const col = ADDABLE[key] ?? key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      const old = before?.[col];
      const same = String(old) === String(fields[key])
        || (old !== '' && Number.isFinite(Number(old)) && Number(old) === Number(fields[key]));
      return old === undefined || old === null || old === '' || same
        ? '' : ` (was ${formatValue(old)})`;
    };
    const changed = Object.keys(fields).map((key) => `${(FIELD_LABELS[key] ?? key).replace(/^./, (c) => c.toUpperCase())} ${formatValue(fields[key])}${wasOf(key)}`).join(', ');
    // THE ROW IS ON THE SHEET AND OWES NOTHING, so she asks rather than
    // leaving it at zero for somebody to find at the end of the month.
    // See specialCaseDealAsk: the trigger is the state, never a phrase.
    const ask = (args.specialCaseAnswered ?? []).includes(Number(row.id)) ? null : specialCaseDealAsk(row, fields);
    // The group too: "Gloria at Workforce" was four deals. 2026-10-03.
    // PAID BY BANK WITH NOTHING TO PAY INTO is said now, not found on the
    // bank run. Clone 2026-10-05: Johnathon moved to bank, no details held.
    const toBank = fields.paymentMethod !== undefined && /bank/i.test(String(row.payment_method ?? ''));
    const realAccount = String(row.account_number ?? '').trim() && !SENTINEL_SAYS[row.account_number];
    const noBank = !toBank || realAccount ? ''
      : SENTINEL_SAYS[row.account_number] || SENTINEL_SAYS[row.bank_details]
        ? ` Their bank details are marked "${row.bank_details ?? row.account_number}", so there is nothing to pay into until that is changed.`
        : ' There are no bank details on file for this deal yet, so add them before the bank run.';
    const reply = `${displayPersonName(row.person_name)} at ${[row.company, row.group_name].filter(Boolean).join(' in ')} updated. ${changed}.${noBank}`
      + (ask ? ` ${ask}` : '');
    return {
      summary: `Updated #${row.id}: ${row.person_name}.${ask ? ` ASK THIS, in your own words: ${ask}` : ''}`,
      // THE FINISHED ROW, not a six field chip.
      //
      // An edit used to hand back `summarizeRow`, which carries the payable
      // amount and none of the three dates. So the admin typed an
      // appointment date into her form, four more cells moved, and the only
      // place any of it appeared was a sentence. The card shows what the
      // row now IS, and it is the server's own answer rather than a guess
      // the browser painted.
      cards: [dealCard(row)],
      rows: [summarizeRow(row)],
      reply,
      computedReply: true,
    };
  },
};

/**
 * ***************************************************
 * * DELETING SEVERAL ROWS, NAMED, IN ONE ACT
 * ***************************************************
 *
 * Five rows was five confirmations, and nothing tied them together: an
 * admin who stopped after three had no way to see which three. The names
 * resolve through `rowsForNames`, the same one every other bulk act uses,
 * so a name that misses REFUSES THE WHOLE DELETE rather than quietly
 * removing the rows that did resolve.
 *
 * THE PREVIEW NAMES EVERY ROW. A count is the one thing nobody can check
 * against a delete that cannot be undone from here.
 */
const DELETE_MAX = 25;

async function deleteMany(args) {
  const { rows: pool, total } = await repo.findAll({
    group: args.group || undefined,
    company: args.company || undefined,
    page: 1,
    pageSize: BULK_MAX,
  });
  if (total > pool.length) {
    return {
      summary: `${total} rows are in scope, more than I can read in one go. Narrow it to a group `
        + 'or a company and try again. Nothing has been deleted.',
    };
  }

  let rows = [];
  if (args.people.length > 0) {
    const found = rowsForNames(pool, args.people, args.said);
    if (found.unknown.length > 0 || found.unclear.length > 0) {
      return {
        summary: nameTrouble(found, 'delete', 'DELETED'),
        ambiguous: found.unclear.length > 0,
      };
    }
    rows = found.rows;
  }
  if (args.ids.length > 0) {
    // Ids are taken as given, but only ones that really exist: a stale id
    // from an earlier answer is the commonest way the wrong row goes.
    const byId = new Map(pool.map((r) => [r.id, r]));
    const missing = args.ids.filter((id) => !byId.has(Number(id)));
    if (missing.length > 0) {
      return {
        summary: `NOTHING HAS BEEN DELETED. No row in scope has ${missing.length === 1 ? 'id' : 'ids'} `
          + `${missing.join(', ')}. Ids carried over from an earlier answer are how the wrong row `
          + 'goes. Look them up by name instead.',
      };
    }
    for (const id of args.ids) rows.push(byId.get(Number(id)));
  }

  // One row twice is one row: a person named AND their id passed.
  rows = [...new Map(rows.map((r) => [r.id, r])).values()];
  if (rows.length === 0) {
    return { summary: 'No row matches that, so there is nothing to delete. Say so and offer to widen it.' };
  }
  if (rows.length > DELETE_MAX) {
    return {
      summary: `That reaches ${rows.length} rows, more than the ${DELETE_MAX} this will delete at `
        + 'once. Ask them to narrow it. Nothing has been deleted.',
    };
  }

  const lines = rows.map((r) => `  ${r.person_name ?? '(no handler)'} · `
    + `${r.company || 'no company'} · ${r.group_name} · #${r.id}`);

  const pending = confirmFirst(args.confirmed, {
    act: `delete these entirely:\n${lines.join('\n')}\n`,
    count: rows.length,
    noun: 'row',
    keeps: 'NAME EVERY ONE of them when you ask, and say it CANNOT BE UNDONE from here. This is '
      + 'not the trash button on a row and it is not stopping a deal: the row and its history go.',
  });
  if (pending) return pending;

  const gone = await repo.removeMany(rows.map((r) => r.id), { via: 'diane' });
  const goneIds = new Set(gone.map((r) => r?.id ?? r));
  const failed = rows.filter((r) => !goneIds.has(r.id));

  broadcast(null, 'master-sheet:changed', { action: 'deleted', ids: [...goneIds], via: 'agent' });

  if (failed.length > 0) {
    return {
      summary: `${goneIds.size} of ${rows.length} rows were deleted and ${failed.length} DID NOT `
        + `GO: ${failed.map((r) => `#${r.id}`).join(', ')}. Say both numbers and name the ones `
        + 'that failed. Do NOT report this as done.',
    };
  }
  return {
    summary: `Deleted ${goneIds.size} ${goneIds.size === 1 ? 'row' : 'rows'}:\n${lines.join('\n')}\n\n`
      + 'Name who went. It cannot be undone from here.',
  };
}

const deleteRow = {
  name: 'delete_master_sheet_row',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    'Remove rows entirely. Name the PEOPLE whose deals are going, or pass ids if you already have '
    + 'them. It cannot be undone through this chat, so the first call always comes back with every '
    + 'row NAMED for the admin to confirm, and only the second one deletes. Several rows is ONE '
    + 'call with several names, never one call each.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'One row id, when you already have it.' },
      ids: { type: 'array', items: { type: 'integer' }, description: 'Several row ids.' },
      /**
       * BY NAME, like every other tool. This took an id ONLY, so deleting
       * somebody meant a lookup first and a number copied between turns,
       * and an id is precisely the argument she cannot sanity check: the
       * wrong one deletes somebody's payroll history with no undo here.
       */
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'The people whose deals are going, as the admin says them. EVERY deal they '
          + 'hold goes unless group or company narrows it. A name that matches nobody, or that '
          + 'could be two people, refuses the whole delete.',
      },
      group: { type: 'string', description: 'Narrow to one group.' },
      company: { type: 'string', description: 'Narrow to one company.' },
      confirmed: { type: 'boolean', description: 'Only on the SECOND call, after they agreed to THOSE rows.' },
    },
  },
  async handler(rawDeleteArgs) {
    // READ THE REQUEST FIRST, like every other door, and most of all here:
    // a delete that reaches the wrong row is the one nobody can undo from
    // the Archive. "delete zayn milkman's deal" is one name and two things.
    const args = await scopeArgs(rawDeleteArgs, peopleRepo);
    // NOTHING DELETES A PERSON OR A COMPANY (decided 2026-09-14). "Delete the person
    // Suki" was offered as deleting her deal instead. 2026-09-28.
    if (!args.confirmed && DELETES_WHOLE.test(String(args.said ?? '')) && !/\bdeals?\b/i.test(String(args.said ?? ''))) {
      return {
        summary: 'NOTHING HAS BEEN CHANGED. Nothing in the CRM deletes a person or a company, and you '
          + 'cannot either. Say so plainly. What exists: removing a DEAL (one pairing is over), or for '
          + 'a company, closing it, which is reversible. Ask whether they meant one of those; do not '
          + 'offer to delete their deals as if it were the same thing.',
      };
    }
    // NAMES OR SEVERAL IDS take the bulk path. One id keeps the original
    // one, which names that single row and reads more plainly for it.
    const named = (args.people ?? []).filter(Boolean);
    const ids = (args.ids ?? []).filter((n) => Number.isFinite(Number(n)));
    if (named.length > 0 || ids.length > 0) {
      return deleteMany({ ...args, people: named, ids });
    }
    if (args.id == null) {
      return {
        summary: 'Nothing to delete. Ask WHOSE deal is going, by name, and which company if they '
          + 'hold more than one.',
      };
    }
    /**
     * IT NAMES THE ROW BEFORE IT DELETES IT.
     *
     * This was the one destructive tool with nothing but a sentence in its
     * description telling the model to ask first. Every other one has a
     * two call guard, and an id is precisely the argument she cannot sanity
     * check herself: the wrong one deletes somebody's payroll history and
     * there is no undo for it here.
     */
    const found = await repo.findById(args.id);
    if (!found) return { summary: `No row with id ${args.id}.` };

    const pending = confirmFirst(args.confirmed, {
      act: `delete ${found.person_name ?? 'that row'} on ${found.company || 'no company'} `
        + `in the group ${found.group_name} (row #${found.id}) entirely`,
      count: 1,
      noun: 'row',
      // A LINE SHE RELAYS WORD FOR WORD: paraphrased, the group became "role MILKMAN". 2026-09-30.
      lines: [`${found.person_name ?? 'no handler'} · ${found.company || 'no company'} · group ${found.group_name} · ${found.role_label || 'no role'}`],
      keeps: 'NAME THE PERSON, THE COMPANY AND THE GROUP when you ask, and say it cannot be '
        + 'undone from here.',
    });
    if (pending) return pending;

    const row = await repo.remove(args.id);
    if (!row) return { summary: `No row with id ${args.id}.` };
    broadcast(null, 'master-sheet:changed', { action: 'deleted', id: row.id, via: 'agent' });
    return { summary: `Deleted row #${args.id}.` };
  },
};

// One category's rows -> "Name at Company (GROUP)" lines, for the detailed
// breakdown. `person` objects come straight off the jsonb_agg in
// auditSummary() (name/company/group keys).
function rowLines(people) {
  return people.map((p) => `${p.name}${p.company ? ` at ${p.company}` : ''} (${p.group})`).join('\n\n');
}

const auditRows = {
  name: 'audit_master_sheet',
  description:
    'Scan the whole master sheet for things worth the admin\'s attention: rows flagged during sync as messy, a payable amount of 0 despite a real monthly rate, missing payment start dates, missing company on a role that should have one, missing phone numbers, and possible duplicate rows (same person/company/group/role appearing more than once — this can be legitimate, so present it as "worth checking," not a confirmed error). Use this any time the admin\'s request could only be answered by actually looking at the data, not general spreadsheet-hygiene advice from your own knowledge: "what needs attention", "what should I clean up", "suggest edits/changes we can do", "anything to fix", "how does it look", a plain "audit" or "review", "discrepancies", a payable ABOVE the monthly, or asking for the full details/breakdown/list of names behind a count you already gave them, INCLUDING "the ones you left out" or "the ones not counted" (call this again, the specific rows and the left-out ones with their reasons are in this same result, you do not have them from a prior turn). Never answer a request like this from general knowledge without calling this tool first — there is nothing useful to say about "what needs fixing" that doesn\'t come from the actual rows.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'ONE person, when they ask what is wrong with them ("what\'s wrong with liam\'s dates"). Omit for the whole sheet.' },
      people: { type: 'array', items: { type: 'string' }, description: 'SEVERAL people, when they asked about more than one. Use this INSTEAD of `person`.' },
    },
  },
  async handler(rawArgs = {}) {
    // "WHAT'S WRONG WITH LIAM AND KIRAN" is two people's findings, each
    // under their own name. `person` alone could carry one. 2026-10-06.
    const people = listAsked(rawArgs.people);
    if (people.length > 1) {
      return answerEach({
        values: people,
        singular: 'person',
        plural: 'people',
        args: rawArgs,
        handler: auditRows.handler,
        guidance: `${people.length} SEPARATE PEOPLE, checked one at a time. Keep each person's findings under their own name.`,
      });
    }
    const args = people.length === 1 ? { ...rawArgs, person: people[0] } : rawArgs;
    /**
     * ONE PERSON'S FINDINGS. Browser on the clone, 2026-10-04: after the
     * check listed "Liam Edwards: payment start 2026-12-03, its appointment
     * gives 2026-11-27", "whats wrong with liam edwards dates" drew his card
     * and said nothing about the dates. The same check, narrowed to him,
     * in words.
     */
    if (args.person) {
      const [allRows, companyList] = await Promise.all([
        repo.findAllRows().catch(() => []),
        companiesRepo.findAll({ pageSize: 500 }).then((r) => r.rows ?? r).catch(() => []),
      ]);
      const month = currentMonth();
      const words = String(args.person).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const isHim = (r) => {
        const name = String(r.person_name ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        return words.length > 0 && words.every((w) => name.includes(w));
      };
      const theirs = allRows.filter(isHim);
      if (theirs.length === 0) {
        return { summary: (await notAPerson(args.person)) ?? `Nobody on the sheet is called "${args.person}". Say so.` };
      }
      const check = sheetCheck(allRows, { month, monthName: monthName(month), companies: companyList });
      const ids = new Set(theirs.map((r) => r.id));
      const lines = check.sections.flatMap((s) => s.all.filter((f) => ids.has(f.id))
        .map((f) => `${f.who} (${f.where}): ${s.label.toLowerCase()}, ${f.fault}`));
      const who = theirs[0].person_name;
      const reply = lines.length > 0
        ? `${lines.length === 1 ? 'One thing' : `${lines.length} things`} on the sheet check for ${who}:\n${lines.join('\n')}`
        : `Nothing on the sheet check for ${who}: their ${theirs.length === 1 ? 'deal looks' : 'deals look'} right.`;
      return { summary: `${reply}\n\nCOMPUTED from the sheet check. Say it as written.`, reply, computedReply: true };
    }
    /**
     * ===============================
     * * THE REPORT IS DRAWN, NOT READ OUT
     * ===============================
     * His call 2026-09-30. This returned counts for her to narrate, so
     * "7 rows with no phone number" cost a second turn to learn WHO, and
     * nothing was ranked: a missing phone read at the same weight as a
     * payable above the monthly, when only one of those is money.
     *
     * `sheetCheck` groups every finding into six sections in COST order
     * and names the row on the first answer. It goes back as `check`, a
     * structure the web draws, so none of it depends on her retyping it.
     *
     * THE COUNTS STAY. Her spoken summary is still built below from the
     * old audit, because a card on screen is not an answer to somebody
     * listening rather than looking.
     */
    const audit = await repo.auditSummary();
    /**
     * A ZERO IS ONLY WRONG ON A DEAL OWED THIS MONTH. Every £0 row was
     * counted, so a deal starting next month, marked for another month or
     * already over read as a discrepancy: "seventeen deals" where most were
     * correct. Same rule the totals use. 2026-09-30.
     */
    const useEndDate = Boolean((await settingsRepo.get())?.color_uses_end_date);
    // BOTH: marked for this month AND its dates owe it. isOwedThisMonth
    // judges a row against its OWN preset month, so a row marked for August
    // read as owed; the totals ask isForMonth as well, and so does this.
    const month = currentMonth();
    const owedNow = (r) => isForMonth(r, month) && isOwedThisMonth(r, { useEndDate });
    const zeroOwed = (audit.zero_payable_rows ?? []).filter(owedNow);
    const leftOut = (audit.zero_payable_rows ?? []).filter((r) => !owedNow(r));
    const notYet = leftOut.length;
    const whyNot = (r) => (!isForMonth(r, month)
      ? `marked for ${monthName(monthOf(r.preset_on))}, not ${monthName(month)}`
      : paymentReason(r, month, { useEndDate }));
    const categories = [
      ['needs_review', audit.needs_review, audit.needs_review_rows, 'flagged messy by the sync'],
      ['zero_payable', zeroOwed.length, zeroOwed, 'owed this month but £0 payable'],
      ['payable_over_monthly', audit.payable_over_monthly, audit.payable_over_monthly_rows, 'a payable amount ABOVE their monthly amount'],
      ['missing_payment_start', audit.missing_payment_start, audit.missing_payment_start_rows, 'no payment start date'],
      ['missing_company', audit.missing_company, audit.missing_company_rows, 'missing a company (excluding ALL GROUPS/TAKEOFF, which do not need one)'],
      ['missing_phone', audit.missing_phone, audit.missing_phone_rows, 'no phone number'],
      ['missing_currency', audit.missing_currency, audit.missing_currency_rows, 'no currency set'],
    ].filter(([, count]) => count > 0);

    if (categories.length === 0 && audit.possibleDuplicates.length === 0) {
      return { summary: 'Audit ran: nothing found. The sheet has no missing fields or duplicate rows right now.' };
    }

    const shortGaps = categories.map(([, count, , label]) => `${count} row(s) with ${label}`);
    const dupeText = audit.possibleDuplicates
      .map((d) => `${d.person_name}${d.company ? ` at ${d.company}` : ''} in ${d.group_name} (${d.n}x, worth checking not a mistake)`)
      .join('; ');

    const detailedSections = categories
      .map(([, count, rows, label]) => `${count} row(s) with ${label}:\n${rowLines(rows)}`)
      .join('\n\n');

    /**
     * EVERY FINDING, GROUPED AND RANKED, for the web to draw.
     *
     * The whole live sheet is read rather than counted in SQL: the checks
     * are one line of JavaScript each in `sheetCheck` and testable without
     * a database, where eight SQL fragments were neither. ~100 rows.
     */
    const [allRows, companyList] = await Promise.all([
      repo.findAllRows().catch(() => []),
      companiesRepo.findAll({ pageSize: 500 }).then((r) => r.rows ?? r).catch(() => []),
    ]);
    const check = sheetCheck(allRows, {
      month,
      monthName: monthName(month),
      companies: companyList,
      useEndDate,
    });

    return {
      // THE CARD IS THE ANSWER, so she says one line and stops. Reading a
      // drawn report back out loud is the wall this replaced.
      check,
      summary: [
        check.total > 0
          ? `THE REPORT IS ON SCREEN: ${check.total} thing(s) to look at across ${check.rows} rows, `
            + 'grouped by what it costs. Say ONE short line naming the count and the worst section, '
            + 'then stop. Do NOT list the rows: they are already drawn, and reading them out is the '
            + 'wall this replaced.'
          : `Nothing to flag: ${check.rows} rows and no discrepancies.`,
        'THE REST BELOW IS ONLY FOR A SPOKEN ANSWER, if they cannot see the screen.',
        shortGaps.length > 0 ? `Gaps found:\n${shortGaps.join('\n')}` : null,
        audit.possibleDuplicates.length > 0 ? `Possible duplicates: ${dupeText}.` : null,
        notYet > 0 ? `Not counted: ${notYet} deal(s) at £0 whose dates say nothing is owed this month. `
          + 'Those zeros are correct, not problems: mention them only if asked. IF ASKED about the ones '
          + 'left out, these are ALL of them, name each with its reason exactly as given:\n'
          + leftOut.map((r) => `  ${r.name}${r.company ? ` at ${r.company}` : ''} in ${r.group}: ${whyNot(r)}`).join('\n')
          : null,
        'IF THE ADMIN ASKS for full details, the breakdown, or exactly who: relay the section below',
        'instead, each name on its own line, grouped under its category heading exactly as given.',
        'Never invent or guess a reason a specific row is missing something, only report that it is.',
        detailedSections,
      ].filter(Boolean).join('\n'),
    };
  },
};

// "3m ago" / "2h ago" / "5d ago" — same idea the frontend's own timeAgo()
// helpers use, needed here too since this text goes straight into what
// the model relays, not through the frontend's formatting at all.
function timeAgo(date) {
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// camelCase field key -> what a human calls it. Falls back to the raw key
// (still readable — "monthlyAmount") for anything not worth a special case.
const FIELD_LABELS = {
  personName: 'name', groupName: 'group', roleLabel: 'role', company: 'company',
  payableAmount: 'payable amount', monthlyAmount: 'monthly amount', currency: 'currency',
  paymentMethod: 'payment method', paymentStartOn: 'payment start date', presetOn: 'preset date',
  endOn: 'end date', payableDays: 'payable days', phone: 'phone', location: 'location',
  postcode: 'postcode', doorNumber: 'door number', acceptingPostals: 'accepting postals',
  notes: 'notes', bankDetails: 'bank details', accountNumber: 'account number',
  sortCode: 'sort code', shouldBePaid: 'should be paid',
  addonPercent: 'add on %', feePercent: 'fee %',
  paid: 'paid', status: 'status', paymentOutcome: 'payment outcome (whatsapp)',
  overrideShouldBePaid: 'should be paid (admin override)', overridePaid: 'paid (admin override)',
  // ===============================
  // * THE SIX THAT HAD NO WORDING, 2026-09-24
  // ===============================
  // WORDING ONLY. Whether an undo may put a field back is the repo's
  // question (`isUndoableField`), and this map was answering it: a field
  // with no label here was reported to the admin as a DELETION. These six
  // were all undoable the whole time.
  assignedOn: 'appointment date',
  specialCaseDeal: SPECIAL_CASE_LABEL.toLowerCase(),
  endNote: 'the end date note (his word)',
  reviewMonthly: 'reviewed monthly',
  stoppedOn: 'stopped date',
  role: 'role',
  // Logged per deal, set on the PERSON. The level is the part she must say.
  personAddonPercent: 'PROFILE add on %', personFeePercent: 'PROFILE fee %',
  // Logged per deal, set on the COMPANY. Same reason.
  companyTier: 'COMPANY tier', companyOldGroup: 'COMPANY old group',
  companyNotes: 'COMPANY notes', companyLiquidationTotal: 'COMPANY liquidation total',
};

/**
 * ===============================
 * * A CAP YOU CANNOT SEE IS THE BUG
 * ===============================
 * Generous, because the answer is a LIST and a list cut short reads as a
 * complete one. When more rows exist than these, the summary says so and
 * names the number, so Diane can tell the admin rather than quietly
 * shortening their day.
 */
/** "2026-08" -> "August 2026". Never a bare month: two Augusts exist. */
// The wording is `dayText.helper`'s, so a month she says here and a month
// she says in the review queue cannot spell it differently.
const monthName = (month) => monthText(month) ?? 'this month';

const ROW_LIMIT = 200;
// People with something open, newest first. A reading, never a queue.
const CONCERN_LIMIT = 25;
const CHANGE_LIMIT = 1000;

// How far back an undo may reach. Wider than the 24 hour recap because
// "put that back" on Monday morning is about Friday afternoon's edit.
// A MONTH, his call 2026-09-22. It was 168, a week, on the reasoning that
// "put that back" on Monday is about Friday. A company status change is a
// monthly act, so the thing somebody wants back is last month's.
//
// WIDENING THIS ALONE WOULD HAVE BEEN A BUG. findChangeBatches limits
// before it groups, so a longer window can cut the oldest batch in half.
// The repo refuses a partial batch rather than offering half a cascade.
const UNDO_HOURS = 720;

// How many distinct values to name per field before "and others". A mass
// edit usually sets one; a mixed batch must not turn into a wall.
const VALUES_SHOWN = 3;

// How many people to name in a confirm before "and the rest". Enough to
// recognise the change, short enough to read aloud.
const NAMES_SHOWN = 6;

/**
 * DID THEY ASK FOR DOLLARS? Their words, not hers.
 *
 * Deliberately narrow. "Combine" and "together" are NOT here: "add those
 * two together" is a request for one TOTAL, not for one CURRENCY, and
 * reading it as the second is what produced an unasked USD figure on a GBP
 * and AED answer.
 */
const ASKED_FOR_USD = /\b(dollars?|usd|\$|in one currency|one currency|convert(ed)? (it|them|that|to)?)\b/i;

/**
 * THEY ASKED FOR A SUBSET OF AN ANSWER THEY ALREADY HAVE.
 *
 * Deliberately narrow. "how much in usd" is a whole question and still gets
 * the breakdown; "ONLY the usd" is a narrowing of one already on screen.
 * Widening this to any mention of usd would silently strip the per company
 * lines off every currency question anyone ever asks.
 */
const ASKED_FOR_ONLY = /\b(only|just|nothing but|alone)\b|\bwithout the (breakdown|detail|list)\b/i;

/** Which subset, when they narrowed but did not say a currency. */
const ASKED_FOR_TOTAL = /\b(total|sum|figure|number|amount|headline|overall)\b/i;

/**
 * The rates a converted figure ACTUALLY used, each named.
 *
 * It printed "at 1.354355 USD per GBP" for a figure that had converted two
 * currencies, so the AED peg was invisible. A rate with no provenance
 * cannot be checked next month, which is the only reason it is said.
 */
function ratesUsed(convertedList = [], fx) {
  const out = [];
  for (const { currency } of convertedList) {
    const code = String(currency ?? '').toUpperCase();
    if (code === 'USD') continue;
    if (code === 'GBP') out.push(`${fx.usdPerGbp.toFixed(6)} USD per GBP`);
    else if (code === 'AED') out.push(`${AED_PER_USD} AED per USD, a fixed peg`);
    else {
      const per = fx.perUsd?.[code];
      if (per) out.push(`${Number(per).toFixed(6)} ${code} per USD`);
    }
  }
  // Deduplicated: two GBP lines for two people is the same rate twice.
  return [...new Set(out)];
}

// How many field changes to show on one row of the changes list. It is one
// truncated line, so past this the newest would be pushed off the end.
const DIFFS_SHOWN = 3;

/**
 * ===============================
 * * WHAT A SET OF ROWS CANNOT SHARE
 * ===============================
 *
 * Every other column on a deal is bulk editable. These are not, and each
 * carries the REASON, because a refusal the admin cannot understand reads
 * as the CRM being broken.
 *
 * Identity is one half: two people cannot become one person by a filter.
 * The details money is paid into are the other, and they are the reason
 * this is a guard and not a note in a description.
 */
/**
 * ===============================
 * * NAMES TO ROWS, once, for everything that takes a list of people
 * ===============================
 *
 * `people` and `except` are the same act pointing opposite ways: one says
 * who is in, the other who is out. Two resolvers would drift, and the one
 * that drifted would be the one deciding whose row got changed.
 *
 * THREE OUTCOMES, and only one of them writes:
 *   resolved  the name landed on exactly one person
 *   unclear   it could be two people, so it stops and offers both
 *   unknown   nobody by that name is in the set, so it stops and says so
 *
 * A name that misses is never a silent no-op. On `except` it means the row
 * they were protecting gets changed; on `people` it means somebody they
 * named is left out of a change they asked for. Both are invisible in a
 * count.
 */
function rowsForNames(pool, names, said) {
  const rows = [];
  const unknown = [];
  const unclear = [];

  // NO `said` WHEN SEVERAL NAMES ARE LISTED. The rule and the two
  // incidents behind it are on `saidFor` in resolvePerson.js.
  const heard = saidFor(names, said);

  for (const name of names) {
    // The same resolver every lookup uses, so a name here tolerates the
    // typos a lookup tolerates and stops on the ambiguity it stops on.
    const picked = resolvePerson(pool, name, heard);
    if (picked.matched) {
      if (picked.ambiguous) unclear.push({ name, names: picked.names });
      else rows.push(...picked.rows);
      continue;
    }

    // PART OF A NAME IS STILL A NAME. "Gloria" with two Glorias in the set
    // is a QUESTION, not a miss: reporting nobody by that name sends them
    // looking for a spelling mistake that is not there.
    const part = fold(name);
    const partial = part ? pool.filter((r) => fold(r.person_name).includes(part)) : [];
    const who = new Set(partial.map(personKey));
    if (who.size === 1) rows.push(...partial);
    else if (who.size > 1) unclear.push({ name, names: [...new Set(partial.map((r) => r.person_name))] });
    else {
      // A POSSESSIVE IS NOT THE NAME. "kiran vales deals" came through as
      // "Kiran Vales": the preview found him from their sentence, and the
      // yes (whose sentence is only "yes") refused "nobody called Kiran
      // Vales". The name without its 's, when that is exactly one person.
      const bare = String(name).trim().replace(/['’]?s$/i, '');
      const again = bare !== String(name).trim() && bare.length >= 3 ? resolvePerson(pool, bare, heard) : null;
      if (again?.matched && !again.ambiguous) rows.push(...again.rows);
      else unknown.push(name);
    }
  }

  // `held` is the same array under the name the exception path reads.
  return {
    rows, held: rows, unknown, unclear,
  };
}

/**
 * ===============================
 * * THE SAME PERSONAL DETAIL, TO A SECOND PERSON, IN ONE TURN
 * ===============================
 *
 * Records what this turn has written and refuses the repeat. NOT a check on
 * the FIELD, which would break the legitimate single edit: a phone belongs
 * on one row and putting it there is the ordinary case. It is a check on
 * the same VALUE reaching a second person.
 *
 * `bulk_update_master_sheet` refuses these outright, and that guard was
 * worth nothing on its own: told to "put the phone number on all three" she
 * called the single row tool three times instead, and one number landed on
 * three different people. A bank account reached that way is three people
 * paid into one account.
 *
 * @param turn injected by runAgent, `{ wrote: Map }`. Absent (a test, some
 *   other caller) the guard simply does not apply.
 * @returns {string|null} the reason to refuse, or null to allow.
 */
/**
 * ===============================
 * * THE SECOND PERSON IN ONE TURN IS A BULK ACT
 * ===============================
 * "Set gloria to 10 payable days and paddy to 0" is ONE instruction, and
 * she answered it with two single row edits: two confirmations, two chances
 * to stop half way, and no one act to undo. `perPerson` exists for exactly
 * this and she reached past it.
 *
 * A description is not a route, so this refuses on the SECOND person. The
 * first write is what they asked for and stands; the second is turned back
 * with the tool that does both at once, so the worst case is one write and
 * a redirect rather than N silent ones.
 *
 * KEYED ON THE PERSON, not on the row: one person holding four deals is
 * four legitimate single row edits, and they are not a bulk act.
 */
function secondPersonInTurn(turn, row, fields, byName, add = null) {
  if (!turn?.wrote) return null;

  /**
   * BY NAME ONLY. An explicit `id` is deliberate row addressing and an
   * established path: `perPersonLoop.test.js` pins that the same payable
   * days going to two ids in one turn is an ordinary mass edit. A NAME is
   * her reading a sentence, and that is where "Gloria 10, Paddy 0" became
   * two confirmations. The live fault carried `targetPerson`.
   */
  if (!byName) return null;

  /**
   * ONLY WHERE THE BULK TOOL COULD HAVE TAKEN IT.
   *
   * A phone number, a postcode or a bank account belongs to ONE person and
   * `perPerson` refuses all three, so two people's phone numbers in one
   * turn is two legitimate single row edits. Redirecting those would be a
   * dead end: turned back here and refused there.
   */
  const shareable = Object.keys(fields ?? {}).every((key) => !PER_PERSON[key]);
  if (!shareable) return null;

  const who = personKey(row);
  // THE ENTRY, kept, so the redirect can hand over the finished call: told
  // only to "use perPerson" she never did, and two special cases stalled.
  const entry = {
    person: row.person_name,
    company: row.company,
    ...(Object.keys(fields ?? {}).length > 0 ? { set: fields } : {}),
    ...(add ? { add } : {}),
  };
  const seen = turn.wrote.get('__person');
  if (!seen) {
    turn.wrote.set('__person', { who, name: row.person_name ?? `row #${row.id}`, entry });
    return null;
  }
  if (seen.who === who) return null;
  return handOver(seen, entry);
}

/**
 * EVERY PERSON NAMED THIS TURN, as perPerson entries, gathered on the turn so
 * a third person joins the first two rather than replacing the second.
 */
function handOver(seen, entry) {
  // A first person already WRITTEN is not proposed again: perPersonUpdate
  // names them as saved instead.
  seen.entries = seen.entries ?? (seen.written ? [] : [seen.entry].filter(Boolean));
  if (!seen.entries.some((e) => fold(e.person) === fold(entry.person))) seen.entries.push(entry);
  return seen.entries;
}

/**
 * ===============================
 * * THE RUNTIME MAKES THE HAND OVER, NOT HER
 * ===============================
 * Told "call bulk_update_master_sheet NOW with exactly this", she dropped the
 * second person every time: Bram's special case, Ines's add, Ines's paid.
 * So the per person preview is built here, and remembered AS that call, so
 * "yes" applies every person in one act. 2026-09-25.
 */
async function handOverCall(perPerson, args) {
  const result = await perPersonUpdate({
    perPerson, said: args.said, saidRecent: args.saidRecent, turn: args.turn, handedOver: true,
  });
  if (!result?.pending) return result;
  return {
    ...result,
    redirect: { name: 'bulk_update_master_sheet', args: { perPerson } },
    summary: `EVERY PERSON THEY NAMED IS ONE CHANGE NOW, replacing anything proposed for them `
      + `this turn. ${result.summary}`,
  };
}

function repeatedPerPerson(turn, row, fields) {
  if (!turn?.wrote) return null;
  const who = personKey(row);

  for (const [key, value] of Object.entries(fields)) {
    if (!PER_PERSON[key] || value === undefined || value === null || value === '') continue;

    const at = `${key}=${value}`;
    const seen = turn.wrote.get(at);
    if (seen && seen.who !== who) {
      return `NOTHING HAS BEEN CHANGED on this row. ${FIELD_LABELS[key] ?? key} "${value}" was `
        + `just written to ${seen.name}, and this would put the SAME one on `
        + `${row.person_name ?? 'another person'}: ${PER_PERSON[key]}. Say that plainly and ask `
        + 'whose it actually is. Do NOT try the remaining rows either.';
    }
    if (!seen) turn.wrote.set(at, { who, name: row.person_name ?? `row #${row.id}` });
  }
  return null;
}

/**
 * What to say when a name did not land.
 *
 * @param act  what will NOT happen, for "Do NOT {act} anything"
 * @param done the past tense of it, for the opening. "Nothing has been
 *   changed" is wrong for a revert, and the opening line is the one part
 *   she is most likely to say word for word.
 */
/** The names that match nobody live but do hold stopped deals in the same scope. */
async function stoppedAmong(names, filter, said) {
  if (names.length === 0) return [];
  const { rows } = await repo.findAll({ ...filter, stopped: true, page: 1, pageSize: BULK_MAX });
  return names.filter((n) => {
    const hit = rowsForNames(rows, [n], said);
    return hit.unknown.length === 0 && hit.unclear.length === 0;
  });
}

function nameTrouble({ unknown, unclear }, act, done = 'CHANGED') {
  return `NOTHING HAS BEEN ${done}. `
    + (unknown.length > 0 ? `Nobody in that set is called ${listOf(unknown)}. ` : '')
    + unclear.map((u) => `"${u.name}" could be ${listOf(u.names)}. `).join('')
    + 'Say exactly which name you could not pin down and ask them which they meant. '
    + `Do NOT ${act} anything until every name resolves: a name that misses is invisible in a `
    + 'count, so nobody would know somebody had been left out.';
}

// The PER_PERSON columns that are a fact about the person, not about who
// they are: safe on every deal of ONE named person (perPerson), never on a
// filtered set that could reach somebody else.
/**
 * A person named in the sentence, by their full name or their first name
 * as a word ("kirans" and "kiran's" are Kiran). Exact words only: this is
 * a refusal's trigger, and a near miss must not refuse a group change.
 */
/** The refusal when a named person is missing from a call's scope. */
function personDropped(matched, said, except) {
  // Held back by any part of their name: "except kiran" holds Kiran Vale.
  const heldText = (except ?? []).join(' ');
  const named = [...new Set(matched.map((r) => r.person_name).filter(Boolean))]
    .filter((n) => !namedIn(heldText, n) && namedIn(said, n));
  if (named.length === 0 || !matched.some((r) => !named.includes(r.person_name))) return null;
  return `NOTHING HAS BEEN CHANGED. They named ${listOf(named)}, and this call has no person in `
    + `it, so it would reach ${matched.length} deals across the sheet. Call it again with `
    + `perPerson [{ person: "${named[0]}", allDeals: true, ... }] (or \`people\` [names], which a `
    + 'percentage raise takes) so only their deals change.';
}

function namedIn(said, name) {
  if (personMentionedIn(said, name)) return true;
  const first = String(name).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (first.length < 3) return false;
  return String(said ?? '').toLowerCase().split(/[^a-z0-9']+/)
    .map((w) => w.replace(/'?s$/, ''))
    .includes(first);
}

const ONE_PERSONS_OWN = new Set(['phone', 'doorNumber', 'postcode', 'acceptingPostals', 'bankDetails', 'accountNumber', 'sortCode']);

const PER_PERSON = {
  personName: 'a name belongs to one person',
  personId: 'a name belongs to one person',
  phone: 'a phone number belongs to one person',
  doorNumber: 'an address belongs to one person',
  postcode: 'an address belongs to one person',
  acceptingPostals: 'that is about one person\'s address',
  bankDetails: 'paying many people into one account is how money goes to the wrong person',
  accountNumber: 'paying many people into one account is how money goes to the wrong person',
  sortCode: 'paying many people into one account is how money goes to the wrong person',
  // The boss's own free text. Every switch in the CRM writes the override
  // pair instead, and mass-writing his column would overwrite what he said.
  shouldBePaid: 'that is the boss\'s own column: use the should-be-paid switch',
  paid: 'that is the boss\'s own column: use the paid switch',
  // The identity key is built from the group, the company and the role, so
  // moving rows between them by filter splits a deal into two.
  groupName: 'moving rows between groups changes their identity, so it is a row at a time',
  company: 'moving rows between companies changes their identity, so it is a row at a time',
};

/**
 * ===============================
 * * NAMED DEALS, NEVER A FILTER. Migration 064.
 * ===============================
 * Both move one deal's money for the month. Over a filter the admin would
 * agree to a count, not to the deals. Named in `perPerson`, each deal is its
 * own line with its figure, from and to. Several at once was asked for
 * 2026-09-25; the rule that each deal is seen is what stays.
 */
const NAMED_DEALS_ONLY = {
  payableAmount: 'this month\'s payable amount is set per named deal',
  specialCaseDeal: 'paying a deal for a month its dates exclude is decided per named deal',
};

/** "a, b and c". A comma run made three fields read as one long value. */
/**
 * THE WORD THEY TYPED THAT IS A SLIP OF THIS NAME, or null. Null when they
 * wrote the name properly, or wrote no word near it at all ("how much is
 * he owed" points at the screen and is not a typo). Two letters of slack,
 * which is what "kirna" for "kiran" is: a swap reads as two edits.
 */
function typoFor(rawSaid, name) {
  // A possessive is the name: "felix's monthly" is Felix, not a typo of him.
  const said = String(rawSaid ?? '').replace(/['’]s\b/gi, '');
  if (!said || !name || personMentionedIn(said, name)) return null;
  const words = String(said).split(/[^A-Za-z'-]+/).filter((w) => w.length >= 3);
  for (const part of String(name).split(/\s+/).filter((p) => p.length >= 3)) {
    const want = fold(part);
    // A SWAP IS ONE SLIP ("drwe", "kirna"), and a short word gets only one:
    // with two, "owed" reached "Rowe" and "drwe" offered four people. 2026-09-30.
    const hit = words.find((w) => {
      const f = fold(w);
      return f !== want && Math.abs(f.length - want.length) <= 1
        && slips(f, want) <= (want.length <= 4 ? 1 : 2);
    });
    if (hit) return hit;
  }
  return null;
}

/** Edits between two words, a swap of neighbours counting as one. */
function slips(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const listOf = (parts) => {
  const kept = parts.filter(Boolean);
  if (kept.length < 2) return kept.join('');
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`;
};

// How many rows a single total may be computed over. Well clear of the
// whole sheet; past it the tool refuses rather than adding up a page.
const TOTAL_ROW_LIMIT = 2000;

/**
 * ***************************************************
 * * The rules a figure was worked out under
 * ***************************************************
 *
 * She could total correctly and still not say WHY a row was left out, or
 * what would change if the end date counted, because nothing told her the
 * setting existed. The totals tool read it; she could not.
 *
 * READ ONLY. Changing a setting moves every figure in the CRM at once, so
 * it stays a decision somebody makes on the Settings page in front of the
 * preview that shows what it does.
 */
const explainRules = {
  name: 'explain_preset_rules',
  description:
    'Explain how a figure was worked out: which rows count toward a month, what the payment start '
    + 'colours mean, and whether the end date currently takes part. Use it when the admin asks '
    + '"why is that row not counted", "why is it red/amber/green", "what does the preset do", '
    + '"does the end date count", or disagrees with a total and wants to know the rule behind it. '
    + 'ALSO THE ONLY PLACE THE SPECIAL CASE RULE IS WRITTEN DOWN: "what is the rule for special '
    + 'cases", "why is there a special case", "what does that switch do". Those ask for a RULE, '
    + 'not a figure and not one row: a total answers neither. Read only: it changes nothing.',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const useEndDate = Boolean((await settingsRepo.get())?.color_uses_end_date);
    const endDateLine = useEndDate
      ? 'End dates are currently included through the payment period rule.'
      : 'End dates are currently ignored because Include end date is off.';
    // The WHOLE chain, not just its last step. Asked "why does hers start
    // in July" she had no answer above the payable amount, because the two
    // links off the appointment date were nowhere in her prompt.
    /**
     * ===============================
     * * THE GENERAL ANSWER, and it is NOT the terminal reply
     * ===============================
     * It was a `computedReply`, so this paragraph became the WHOLE answer
     * to anything that reached this tool. Asked "why is RICHARD not payable
     * this month" she recited the general rule word for word and never
     * mentioned him, twice in one conversation: the harness flagged it as a
     * repeat, which is what it was.
     *
     * A tool that computes a FIGURE hands back the finished sentence. This
     * one computes no figure, it explains a rule, and which part of the
     * rule answers the question depends on the question. The summary below
     * already says "answer the question they actually asked, do not recite
     * all of this", and a computed reply made reciting it the only
     * possible outcome.
     *
     * So it stays here as the wording for the GENERAL question, inside the
     * summary, and she picks. Found by talking to her, 2026-09-17.
     */
    const general = 'What goes into a month\'s total, both must be true: '
      + 'the payment start is not after the end of that month'
      + `${useEndDate ? ', and the end date is not before the month starts' : ''}, `
      + 'and the row is marked for that month by its preset. '
      + 'A row with no preset is counted every month. '
      + 'Then the figure itself: payable amount = monthly amount ÷ days in the preset month × payable days. '
      + `Payment start determines payable days, and the payment start is itself the appointment date + ${PAYMENT_START_OFFSET_DAYS} days. `
      + 'UNLESS THE APPOINTMENT IS IN THE FIRST WEEK OF ITS MONTH, meaning on or before that '
      + "month's first Friday. Then the payment start is the LAST FRIDAY OF THE THIRD MONTH and "
      + 'the whole of that third month is owed, not a part month: waiting four months for a first '
      + 'payment is what that rule exists to prevent. '
      + 'The end date is the appointment date + one year, in both cases. '
      + 'A deal with no preset uses the full monthly amount. '
      + endDateLine;
    return {
      summary: 'THE RULES AS THEY ARE SET RIGHT NOW. Answer from these, never from memory.\n\n'
        + 'WHAT COUNTS TOWARD A MONTH. Two questions, both must be yes:\n'
        + '  1. Is anything owed? The payment start must not be after the end of the preset month'
        + `${useEndDate ? ', AND the end date must not be before the preset month starts' : ''}.\n`
        + "  2. Is the row marked for that month? That is its preset date. A row with NO preset is\n"
        + '     the standing roster and is owed every month.\n\n'
        + 'WHERE THE DATES COME FROM. The admin types ONE of them, the appointment date, and\n'
        + `the sheet's own formulas give the other two: payment start = appointment + ${PAYMENT_START_OFFSET_DAYS} days,\n`
        + 'end date = appointment + one year. Change the appointment and the payment start, the\n'
        + 'end date, the payable days and the payable amount all move with it. A date somebody\n'
        + 'typed by hand is left alone instead.\n\n'
        + 'THE FIRST WEEK EXCEPTION, and it is about WHEN SOMEBODY IS FIRST PAID.\n'
        + `  Appointed on or before the FIRST FRIDAY of their month: + ${PAYMENT_START_OFFSET_DAYS} days\n`
        + '  would tip them past the end of the third month, so they would wait FOUR months for\n'
        + '  any money. Instead their payment start is the LAST FRIDAY OF THE THIRD MONTH and the\n'
        + '  WHOLE of that month is owed, not a part month. Appointed the 3rd of August, they\n'
        + '  start 30 October and are paid the full October amount at the end of October.\n'
        + '  Appointed after the first Friday: nothing changes, + 90 days and a part month.\n'
        + '  The payday itself is the last Friday of the month, every month, for everyone.\n\n'
        + 'THE PAYMENT START COLOUR, which is the boss\'s own rule from his sheet. Only two cells\n'
        + 'decide it, the payment start and the preset. Not the amount, not the payable days:\n'
        + '  RED    the payment start is after the end of the preset month, so nothing is owed yet\n'
        + '  AMBER  the payment start falls inside the preset month, so it is a part month\n'
        + '  GREEN  the payment start is before the preset month, so the whole month is owed\n'
        + '  A blank payment start means "Ongoing" and is green.\n\n'
        + `THE END DATE SETTING IS CURRENTLY ${useEndDate ? 'ON' : 'OFF'}.\n`
        + (useEndDate
          ? '  So a deal that ended before its preset month is RED and out of the total, and one\n'
            + '  ending inside the month is AMBER. Turning it off would put both back in.\n'
          : '  So an end date on its own NEVER drops a row: a deal that ended on the 26th is still\n'
            + '  paid for the whole month, which is what the boss\'s own sheets do. Turning it on\n'
            + '  would drop deals that ended before their month.\n')
        /**
         * ===============================
         * * THE SPECIAL CASE RULE, WHICH SHE COULD NOT QUOTE
         * ===============================
         * Live 2026-09-24. "Explain why there's a special case" ran the
         * TOTALS tool and answered "Mayah is owed GBP 1,000". "What's the
         * rule for these special cases" restated Mayah's status a second
         * time. Neither is a rule, and neither was wrong on the facts:
         * the rule existed in her prompt as BEHAVIOUR and nowhere as
         * something she could read out.
         */
        + `\nTHE ${SPECIAL_CASE_LABEL.toUpperCase()} SWITCH, which is the ONE thing that overrides all of the above.\n`
        + `  On screen it reads "${SPECIAL_CASE_SWITCH}", on the payment start cell's own popup.\n`
        + '  It says: this deal is paid for its preset month ANYWAY, although the payment start\n'
        + '  says nothing is owed. The cell goes GREEN and the WHOLE month is owed, never a part\n'
        + '  month, because counted from a start after the month it would be zero.\n'
        + '  IT IS A PERSON\'S DECISION, never a consequence of the dates. Nothing derives it,\n'
        + '  no upload sets it, and the payment start, the preset and the end date do not move.\n'
        + '  A STOP STILL BEATS IT: a deal somebody ended is over whatever this says.\n'
        + '  To undo one, turn it off; the payable days and amount go back on their own.\n\n'
        + 'TWO PERCENTAGES, OPPOSITE DIRECTIONS, and they must never be swapped:\n'
        + '  AN ADD ON IS ADDED to what is owed. 10% on a 500 deal is 550 in total.\n'
        + '  A FEE IS DEDUCTED from the total after that. 2% on 550 leaves 539.\n'
        + 'Each one stacks: a rate on the PERSON plus a rate on that DEAL.\n\n'
        + 'Answer the question they actually asked in one or two sentences. Do not recite all of\n'
        + 'this. Say which setting is on only if it bears on their question.\n\n'
        + 'IF THEY ASKED THE GENERAL QUESTION, what decides which deals go into a total, say '
        + `exactly this and stop:\n  ${general}\n\n`
        + 'IF THEY ASKED ABOUT ONE ROW OR ONE PERSON, that paragraph is NOT the answer. Say which '
        + 'of the two conditions that row fails and what its own dates are. Look the row up if you '
        + 'do not have it.',
      // So a later turn can say what it was without asking again.
      endDateCounts: useEndDate,
    };
  },
};

/**
 * ***************************************************
 * * One change, many rows
 * ***************************************************
 *
 * "Set every INDIGO preset to August" was thirty round trips or nothing.
 *
 * IT TAKES A FILTER, NEVER A LIST OF IDS. She must not guess a row id, and
 * a mass write off guessed ids is the worst version of that: ids are not
 * sequential by person, so row 30 is Nicola and 28, 29 and 31 are three
 * other people. Naming the SET is the same act as narrowing the page.
 *
 * TWO CALLS, AND THE FIRST WRITES NOTHING. The same shape the upload has,
 * for the same reason: a sentence is a loose way to describe thirty rows,
 * so the admin sees exactly which rows and exactly what moves before any
 * of it lands. `confirmed` is the second call.
 */
/**
 * ===============================
 * * A WHOLE SHEET CHANGE IS A REAL REQUEST
 * ===============================
 * This was 60, and 60 refused the one job the boss actually does: rolling
 * every preset to the new month. "Update all the groups to September 1"
 * came back "96 rows, too many to change at once, narrow it down", twice,
 * for something perfectly ordinary.
 *
 * THE OLD REASON WAS SOUND AND THE FIX WAS WRONG. "A partial mass edit is
 * worse than none: nobody can tell which half ran." True, so the answer is
 * to SHOW which ran, not to refuse the job. Every row now reports itself as
 * it goes, and the final count is on screen beside the names.
 *
 * The ceiling stays, well above the sheet, because a filter matching
 * thousands is a mistake rather than a request. The CONFIRM is the guard
 * that matters, and it has always named the exact count first.
 */
const BULK_MAX = 500;

/**
 * Past this it is worth watching rather than waiting. Below it, a bar that
 * appears and vanishes is noise.
 *
 * MEASURED, not guessed: one write is ~209ms against Supabase (the update
 * plus its change log row). Ten rows meant two seconds of nothing on
 * screen before the bar appeared, which is exactly the silence it exists
 * to fill. Five is about a second, and under a second a bar really is a
 * flash. Naming three people is often seven or eight rows.
 */
const PROGRESS_FROM = 5;
const BULK_TRANSACTION_FROM = 20;

// THEY MEANT THE WHOLE SHEET, not this group. Deliberately about GROUPS and
// not about "all deals", which is a fair way to say "all of NEXUS".
const WHOLE_SHEET = /\b(all|every|each)\b(\s+(the|of\s+the|single))?\s+groups?\b|\b(whole|entire|full)\s+(sheet|master\s*sheet)\b|\bacross\s+(all\s+)?groups?\b/i;

/**
 * ***************************************************
 * * ONE MESSAGE, DIFFERENT VALUES, ONE CONFIRMATION
 * ***************************************************
 *
 * "Gloria 10 days, Paddy 0, Nathan's preset to September" is three
 * different values. The bulk tool sets ONE value across many rows and the
 * single tool does one row per call, so this was three writes, three
 * confirmations, three chances to stop half way, and no single act to undo
 * afterwards. The admin dictates like this constantly.
 *
 * ITS OWN PATH because none of the single value logic applies: there is no
 * one `what` to describe, no `except` (naming somebody IS the scope), and
 * the preview has to show a line PER PERSON or it cannot be checked.
 *
 * EVERY GUARD THE OTHER PATH HAS, applied per entry: the per person column
 * refusals, the derived field refusal, the guessed year, and one
 * `confirmFirst` over the lot.
 */
/**
 * ===============================
 * * PER DEAL, WHEN THE CHANGE IS ONE DEAL'S MONEY
 * ===============================
 * "Make Orla's Co B deal and Bram's Co B deal a special case", "add 500 to
 * Suki's payable and 750 to Ines's". Each is one named deal, shown with its
 * figure from and to. 2026-09-25.
 */
// What an amount may be ADDED to, and the column the current value is read from.
const ADDABLE = Object.freeze({
  payableAmount: 'payable_amount', monthlyAmount: 'monthly_amount', payableDays: 'payable_days',
  // A RATE CAN MOVE BY AN AMOUNT TOO: "give everyone in otter a 2% add on"
  // came as addonPercentDelta on four people, which the per person path
  // did not know, and nothing was set. 2026-10-03.
  addonPercent: 'addon_percent', feePercent: 'fee_percent',
});

// The one deal tool's relative rate keys, read the same way everywhere.
const DELTA_KEYS = Object.freeze({ addonPercentDelta: 'addonPercent', feePercentDelta: 'feePercent' });
function takeDeltas(obj = {}) {
  const rest = {};
  const add = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (DELTA_KEYS[k]) add[DELTA_KEYS[k]] = v;
    else rest[k] = v;
  }
  return { rest, add };
}
const MONEY_FIELDS = new Set(['payableAmount', 'monthlyAmount']);

/** `add` checked: known keys, real numbers. */
function addsOf(raw) {
  const values = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!ADDABLE[key]) return { error: `"${key}" cannot be added to. Only ${listOf(Object.keys(ADDABLE))} can.` };
    const n = Number(value);
    if (!Number.isFinite(n)) return { error: `"${value}" is not an amount to add. Ask them what they meant.` };
    values[key] = n;
  }
  return { values };
}

/**
 * The deals an entry reaches. Narrowed by `company` when given; a change to
 * one deal's money on a person holding several asks WHICH, and writes nothing.
 */
/**
 * A company the admin never said, on someone holding several deals, is HER guess.
 * "750 on Ines" landed on ZZ Rate Co A with nobody asked. 2026-09-25.
 */
const guessedDeal = (rows, company, saidRecent) => rows.length > 1 && Boolean(company)
  && saidRecent != null && !fold(saidRecent).includes(fold(company));

/**
 * A deal's money is moved only for a person THEY named. "Make every ZZTEST deal a
 * special case" went one person at a time and proposed Suki's 3,000 alone. 2026-09-25.
 */
const namedBy = (saidRecent, name) => saidRecent == null
  || String(name ?? '').split(/\s+/).some((part) => part.length >= 3 && personMentionedIn(saidRecent, part));

const notNamedAsk = (who) => ({
  summary: `NOTHING HAS BEEN CHANGED. ${listOf(Object.values(NAMED_DEALS_ONLY))}, and they did not `
    + `name ${who}. Ask which deals they mean, by person and company.`,
});

const whichDealAsk = (who, rows) => ({
  summary: `NOTHING HAS BEEN CHANGED, for anyone. ${who} holds ${rows.length} deals: `
    + `${dealsTheyHold(rows)}. They did not say which, so ask WHICH, then send that entry again `
    + 'with its company.',
  ambiguous: true,
});

function oneDealFor(entry, rows, fields, add, saidRecent) {
  const who = displayPersonName(rows[0]?.person_name ?? entry.person);
  let reach = rows;
  if (entry.company && rows.length > 0) {
    reach = rows.filter((r) => fold(r.company) === fold(entry.company) || fold(r.group_name) === fold(entry.company));
    if (reach.length === 0) {
      return {
        ask: {
          summary: `NOTHING HAS BEEN CHANGED. ${who} holds no deal on ${entry.company}. Their deals are: `
            + `${dealsTheyHold(rows)}. Name those and ask which one they meant.`,
        },
      };
    }
  }
  // "BOTH" IS AN ANSWER. "add 100 to both zayn deals" was asked which of the
  // two, and "both" to that had nowhere to go. Live 2026-10-05.
  if (entry.allDeals && !entry.company) {
    const live = rows.filter((r) => !r.stopped_on);
    return { rows: live.length > 0 ? live : rows };
  }
  const oneDeal = Object.keys(add).length > 0 || Object.keys(fields).some((k) => NAMED_DEALS_ONLY[k]);
  if (oneDeal && guessedDeal(rows, entry.company, saidRecent)) return { ask: whichDealAsk(who, rows) };
  if (oneDeal && reach.length > 1) {
    return {
      ask: {
        summary: `NOTHING HAS BEEN CHANGED, for anyone. ${who} holds ${reach.length} deals: `
          + `${dealsTheyHold(reach)}. This moves one deal's money, so ask WHICH, then send that `
          + 'entry again with its company.',
        ambiguous: true,
      },
    };
  }
  return { rows: reach };
}

const round2 = (n) => Math.round(n * 100) / 100;

// "both", "all of them", "his deals": every deal the person holds.
const ALL_THEIR_DEALS = /\b(?:both|all|every|each|deals)\b/i;

/**
 * The sentence carrying the instruction: this one if it holds a figure, else
 * the one before. "the ZZ Rate Co A one" answered "add 500", and read alone
 * it let 500 through as a set. 2026-09-25.
 */
const instructionOf = (args) => (/\d/.test(String(args?.said ?? '')) ? args.said : (args?.saidRecent ?? args?.said));

/**
 * ===============================
 * * A PLAN THAT ASKED "WHICH DEAL?" WAITS FOR THE ANSWER
 * ===============================
 * "add 500 to Suki and 750 to Ines" asked which of Ines's deals. The answer
 * went to the one deal tool, and Suki's 500 was never proposed. 2026-09-25.
 * Ten minutes, like a pending: older than that is a question forgotten.
 */
const OPEN_ASK_MS = 10 * 60 * 1000;
const openAsk = {
  held: null,
  set(entries, person) { this.held = { entries, person, at: Date.now() }; },
  /** The whole plan with this person's deal filled in, or null. */
  answer(rows, args) {
    const held = this.held;
    if (!held || Date.now() - held.at > OPEN_ASK_MS) return null;
    const who = rows[0]?.person_name;
    if (fold(who) !== fold(held.person) && !fold(who).startsWith(fold(held.person))) return null;
    const company = args.targetCompany
      ?? rows.find((r) => fold(r.company).length > 2 && fold(args.said).includes(fold(r.company)))?.company;
    if (!company) return null;
    this.held = null;
    return held.entries.map((e) => (fold(e.person) === fold(held.person) ? { ...e, company } : e));
  },
};

/** An amount they said to ADD, arriving as a SET on this row. Every write door asks. */
function amountOverwrite(fields, row, said) {
  for (const key of Object.keys(ADDABLE)) {
    if (fields?.[key] === undefined) continue;
    const refusal = overwroteAnAmount({
      field: key, label: FIELD_LABELS[key] ?? key, value: fields[key], current: row?.[ADDABLE[key]], said,
    });
    if (refusal) return refusal;
  }
  return null;
}

/**
 * ***************************************************
 * * A MONTH THEY ASKED FOR THAT THIS WRITE CANNOT REACH
 * ***************************************************
 *
 * Live 2026-09-29. "okay for october only please add an additional 100 aed"
 * came back as "this would change Zayn's deal for September 2026". Told it
 * was wrong, she showed his deals instead of saying what had happened.
 *
 * TWO FAULTS IN ONE SENTENCE, and the second is the dangerous half:
 *
 *   1. The month was the ROW'S preset, never compared with the one they
 *      said. She read September off the deal and printed it as though it
 *      answered the request.
 *   2. There is no per month amount to set. `monthly_amount` is the deal's,
 *      and `payable_amount` is this row's, for whatever month the row is
 *      marked. A write asked for "October only" cannot be honoured by
 *      either, so agreeing to it would have been doing something else.
 *
 * SO IT REFUSES, rather than previewing. No `pending`, so a yes cannot
 * replay it: there is nothing to say yes to.
 *
 * "FOR <month>" and nothing looser, the same rule `checkMonths` uses for a
 * money claim. "He started in October" names a month and asks for nothing.
 */
function wrongMonthAsked(said, actingOn) {
  const on = monthNumberOf(actingOn);
  if (!on) return null;
  const asked = [...forMonthsIn(said)].map(monthNumberOf).filter(Boolean);
  if (asked.length !== 1 || asked[0] === on) return null;

  // The bare month name, never a year: they named a month, and inventing a
  // year to print beside it is the guess this whole file refuses to make.
  const wanted = MONTH_WORDS[asked[0] - 1];
  return `THEY ASKED FOR ${String(wanted).toUpperCase()} AND THIS WRITE CANNOT REACH IT. `
    + `This deal is marked for ${monthName(actingOn)}, and an amount on a deal is not stored `
    + 'per month: changing it changes the DEAL, not one month of it. NOTHING HAS BEEN CHANGED '
    + 'and nothing is waiting for a yes. Tell them which month the deal is marked for, tell '
    + 'them there is no per month amount to set, and ask what they want instead. Do not call '
    + 'this again for this request until they answer.';
}

/**
 * A PAYABLE AMOUNT SET BY HAND moves the month's total, so it asks first,
 * from and to, as a special case does. It was written at once. 2026-09-25.
 */
function confirmAmounts(args, before, fields, added = []) {
  /**
   * THE MONEY AS IT WILL BE, not as she typed it. "set his payable days to
   * 20" took GBP 3,000 to 2,000 with no preview, because the payable is
   * derived AFTER this check and only a typed payable was ever looked at.
   * Same for a monthly amount or a date. A probe, so nothing is written.
   */
  const probe = { ...fields };
  if (probe.payableAmount === undefined) recomputePayable(before ?? {}, probe);
  const derivedMove = fields.payableAmount === undefined && probe.payableAmount !== undefined
    && Number(before?.payable_amount) !== Number(probe.payableAmount);
  const shown = derivedMove ? probe : fields;
  const payableMoved = shown.payableAmount !== undefined
    && Number(before?.payable_amount) !== Number(shown.payableAmount);
  // An ADD moves money whichever amount it lands on, so it asks too.
  if (!payableMoved && added.length === 0) return null;
  const actingOn = monthOf(before?.preset_on) ?? currentMonth();
  const refused = wrongMonthAsked(args.said, actingOn);
  if (refused) return { summary: refused };
  const month = monthName(actingOn);
  // EVERY FIELD THIS CALL MOVES, from and to: a preview naming the payable
  // alone let a monthly amount change through unseen. 2026-09-25.
  const others = Object.keys(fields).filter((k) => ADDABLE[k] && k !== 'payableAmount');
  return confirmFirst(args.confirmed, {
    act: `change this deal for ${month}`,
    count: 1,
    lines: [dealLine(before, shown).trim()],
    keeps: others.length === 0 && !derivedMove
      ? 'The monthly amount and the payable days are not touched: this figure is set by hand.'
      : '',
  });
}

/**
 * ===============================
 * * TWO EDITS THAT MOVE MONEY WITHOUT TOUCHING AN AMOUNT
 * ===============================
 * Live sweep 2026-09-29, both written with no preview:
 *   an END DATE in the past, which ended the deal on the spot, and
 *   a CURRENCY, which turned GBP 1,500 into AED 1,500 in one word.
 * Same two call shape as every other money edit, so auto mode still skips
 * it exactly as it skips those.
 */
const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));
function confirmEndingOrCurrency(args, before, fields) {
  const bits = [];
  const today = currentDay();
  if (fields.endOn && fields.endOn < today && !(isoDay(before?.end_on) && isoDay(before.end_on) < today)) {
    bits.push(`end date ${isoDay(before?.end_on) || 'none'} to ${fields.endOn}, which has already passed: `
      + 'the deal ENDS and is owed nothing after it');
  }
  if (fields.currency && fold(fields.currency) !== fold(before?.currency)) {
    bits.push(`currency ${before?.currency || 'none'} to ${fields.currency}: the same figures are then `
      + `${fields.currency}, not ${before?.currency || 'what they were'}`);
  }
  if (bits.length === 0) return null;
  return confirmFirst(args.confirmed, {
    act: 'change this deal',
    count: 1,
    lines: [`${displayPersonName(before?.person_name)} at ${before?.company || 'no company'}: ${bits.join('; ')}`],
  });
}

/** The patch for one row: what was set, plus what was added to what it holds. */
function patchFor(plan, row) {
  const patch = { ...plan.fields };
  for (const [key, n] of Object.entries(plan.add ?? {})) {
    patch[key] = round2((Number(row[ADDABLE[key]]) || 0) + n);
  }
  return patch;
}

/**
 * A field sent at the value it already holds is not a change. A preview
 * listing "fee % to 5" on a 5% deal reads as one, and writing it marks the
 * cell as set by hand. The amounts and switches are left to their own
 * rules, which already compare. 2026-09-29.
 */
function sameAsStored(row, k, v) {
  const was = row?.[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)];
  if (was === undefined || ADDABLE[k] || SWITCH_WORDS[k] || k === 'specialCaseDeal') return false;
  // Nothing sent onto nothing held is no change: "seat: null" on a Director.
  const blank = (x) => x === null || x === '';
  if (blank(v) || blank(was)) return blank(v) && blank(was);
  if (was instanceof Date) return false;
  if (typeof v === 'number' || (v !== '' && !Number.isNaN(Number(v)) && was !== '' && !Number.isNaN(Number(was)))) {
    return Number(was) === Number(v);
  }
  return String(was) === String(v);
}

/** One deal, every change on it FROM and TO. */
function dealLine(row, patch) {
  const currency = row.currency || 'GBP';
  const bits = Object.entries(patch).filter(([k, v]) => k !== 'reviewReason' && !sameAsStored(row, k, v)).map(([key, value]) => {
    if (key === 'specialCaseDeal') {
      const { month, figure } = specialCaseFigure(row, value);
      return value ? `special case ON for ${month}, adding ${figure} to that month`
        : `special case OFF, taking ${figure} back out of ${month}`;
    }
    if (SWITCH_WORDS[key]) return switchLine(key, value, row);
    const label = FIELD_LABELS[key] ?? key;
    if (ADDABLE[key]) {
      const unit = MONEY_FIELDS.has(key) ? `${currency} ` : '';
      const from = Number(row[ADDABLE[key]]) || 0;
      return `${label} ${unit}${from.toLocaleString('en-GB')} to ${unit}${Number(value).toLocaleString('en-GB')}`;
    }
    return `${label} to "${value}"`;
  });
  // THE GROUP TOO: Zayn's two deals both read "Zayn at Workforce". 2026-10-05.
  const where = `${row.company || 'no company'}${row.group_name ? ` in ${row.group_name}` : ''}`;
  return `  ${displayPersonName(row.person_name)} at ${where}: ${bits.join(', ')}`;
}

/**
 * ===============================
 * * "RAISE EVERYONE IN MANBAT BY 5%"
 * ===============================
 * Had no route: `set` writes ONE value to every row, so she tried to set
 * the monthly to 1.05 and a guard caught it. 2026-09-30. Each row's new
 * monthly is worked out HERE, from its own monthly, previewed line by line,
 * and written in one batch so one undo takes it all back.
 */
async function raiseMonthly(args) {
  const pct = Number(args.raiseMonthlyPercent);
  if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 100) {
    return { summary: 'NOTHING HAS BEEN CHANGED. The percentage has to be a number between -100 and 100, and not 0.' };
  }
  // THEIR number, never hers: "5%" or "5 percent" in what they said.
  const n = String(Math.abs(pct)).replace('.', '\\.');
  if (!args.confirmed && !new RegExp(`(?:^|[^\\d.])${n}\\s*(?:%|per\\s?cent)`, 'i').test(`${args.said ?? ''}\n${args.saidRecent ?? ''}`)) {
    return { summary: `NOTHING HAS BEEN CHANGED. They never said ${Math.abs(pct)}%. Ask what percentage they want.` };
  }
  const scoped = await resolveDealScope(args);
  if (scoped.question) return { summary: scoped.question };
  const { rows: matched, total } = await repo.findAll({
    ...filtersIn(scoped.args), group: scoped.args.group || undefined, page: 1, pageSize: BULK_MAX,
  });
  if (total > matched.length) return { summary: `${total} rows match, more than I change at once. Ask them to narrow it by group.` };
  // THE NAMED PEOPLE, and only them. This ignored `people` entirely, so
  // "raise kiran 10%" with Kiran named raised every deal it matched.
  // gpt-4.1 bulk sweep, 2026-10-06.
  const onlyThese = (args.people ?? []).filter(Boolean);
  let inScope = matched;
  if (onlyThese.length > 0) {
    const wanted = rowsForNames(matched, onlyThese, args.said);
    if (wanted.unknown.length > 0 || wanted.unclear.length > 0) {
      return { summary: nameTrouble(wanted, 'change'), ambiguous: wanted.unclear.length > 0 };
    }
    inScope = wanted.rows;
  } else if (!args.confirmed) {
    const dropped = personDropped(matched, args.said, args.except);
    if (dropped) return { summary: dropped };
  }
  const rows = inScope.filter((r) => Number(r.monthly_amount) > 0);
  if (rows.length === 0) return { summary: 'No deal there has a monthly amount to raise. Say so; nothing was changed.' };

  const round2 = (v) => Math.round(v * 100) / 100;
  const changes = rows.map((r) => {
    const patch = { monthlyAmount: round2(Number(r.monthly_amount) * (1 + pct / 100)) };
    recomputePayable(r, patch);
    return { id: r.id, fields: patch, row: r };
  });
  const verb = pct > 0 ? `raise the monthly by ${pct}%` : `cut the monthly by ${Math.abs(pct)}%`;
  const where = onlyThese.length > 0 ? ` for ${listOf([...new Set(rows.map((r) => r.person_name))])}`
    : scoped.args.group ? ` in ${scoped.args.group}` : ' across every group';
  const pending = confirmFirst(args.confirmed, {
    act: `${verb} on every deal${where}`,
    count: changes.length,
    identity: `${verb}${where}`,
    lines: changes.map(({ row, fields }) => `${row.person_name} at ${row.company || 'no company'}: monthly `
      + `${row.currency || 'GBP'} ${Number(row.monthly_amount).toLocaleString('en-GB')} to ${fields.monthlyAmount.toLocaleString('en-GB', Number.isInteger(fields.monthlyAmount) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
  });
  if (pending) return pending;

  const saved = await repo.updateMany(changes.map(({ id, fields }) => ({ id, fields })), 'diane', { derived: ['payable_amount'], batchId: randomUUID() }).catch(() => []);
  if (saved.length !== changes.length) {
    return { summary: `${saved.length} of ${changes.length} deals took the new monthly. Say which did not, and that the rest is unchanged.` };
  }
  broadcast(null, 'master-sheet:changed', { action: 'bulk-updated', ids: saved.map((r) => r.id), via: 'agent' });
  return {
    summary: `Done: ${changes.length} deals${where} have their monthly ${pct > 0 ? 'raised' : 'cut'} by ${Math.abs(pct)}%, `
      + 'and their payable follows. One undo takes it all back. Say it in one sentence.',
    rows: saved.map(summarizeRow),
  };
}

async function perPersonUpdate(args) {
  const entries = args.perPerson.filter((e) => e && e.person);
  if (entries.length === 0) {
    return { summary: 'Nothing to change. Ask which people they mean and what each one is changing to.' };
  }

  // REFUSED BY NAME, never dropped in silence, and checked across EVERY
  // entry before anything is read: a bank account on one of five people is
  // still a bank account written from a list.
  const asked = [...new Set(entries.flatMap((e) => Object.keys(e.set ?? {})))];
  // ONE PERSON'S OWN FACTS ARE FINE HERE. Every entry is one named person,
  // so "postcode M1 1AA on all of kiran's deals" puts HIS postcode on HIS
  // deals: nobody else's row is reached. It was refused as "an address
  // belongs to one person", which is exactly what it was. gpt-4.1 bulk
  // sweep, 2026-10-06. Identity (name, group, company) and the boss's own
  // paid columns stay refused: they are not facts about the person.
  const refused = asked.filter((k) => PER_PERSON[k] && !ONE_PERSONS_OWN.has(k));
  if (refused.length > 0) {
    return {
      summary: `NOTHING HAS BEEN CHANGED. ${listOf(refused.map((k) => `${FIELD_LABELS[k] ?? k} (${PER_PERSON[k]})`))}. `
        + 'Say why in one sentence and offer to change it on ONE row instead, by name.',
    };
  }
  for (const entry of entries) {
    const derivedAsk = derivedFieldAsked(entry.set ?? {});
    if (derivedAsk) return { summary: derivedAsk };
  }

  const { rows: matched, total } = await repo.findAll({
    group: args.group || undefined, page: 1, pageSize: BULK_MAX,
  });
  if (total > matched.length) {
    return {
      summary: `${total} rows match that, more than I change in one go. Tell the admin to `
        + 'narrow it, by group, and try again.',
    };
  }

  /**
   * ONE RESOLVER, the same `rowsForNames` the other path uses, so a name
   * here tolerates the typos a lookup tolerates and stops on the ambiguity
   * it stops on. A name that misses is invisible in a count, so nothing is
   * written until every one of them resolves.
   */
  /**
   * ===============================
   * * THE SENTENCE ONLY HELPS ONE NAME
   * ===============================
   * `said` recovers a name she SHORTENED by taking the longest one in the
   * sentence. Resolving one entry at a time made every entry look like a
   * single name, so "gloria 10 days, paddy 0" resolved BOTH to Gloria and
   * the preview offered to set Paddy's value on Gloria's row. Twice before
   * on other paths, which is why `saidFor` exists.
   */
  // A HAND OVER carries full names off resolved rows: the sentence, naming
  // everyone, would pull a lone entry onto the wrong person. 2026-09-25.
  const heard = args.handedOver ? '' : saidFor(entries.map((e) => e.person), args.said);

  const plan = [];
  const unknown = [];
  const unclear = [];
  for (const entry of entries) {
    const found = rowsForNames(matched, [entry.person], heard);
    unknown.push(...found.unknown);
    unclear.push(...found.unclear);
    const split = takeDeltas(entry.set ?? {});
    const fields = normalizeFields(split.rest);
    const add = addsOf({ ...(entry.add ?? {}), ...split.add });
    if (add.error) return { summary: `NOTHING HAS BEEN CHANGED. ${add.error}` };
    if (Object.keys(fields).length === 0 && Object.keys(add.values).length === 0) {
      return {
        summary: `NOTHING HAS BEEN CHANGED. Nothing was given to set on ${entry.person}. `
          + 'Ask what each person is changing to, by name.',
      };
    }
    // A GUESSED YEAR ON ONE ENTRY is a guessed year. Checked per entry,
    // because each carries its own preset.
    const offMonth = farOffPreset(fields, `${args.said ?? ''}\n${args.saidRecent ?? ''}`);
    if (offMonth) return { summary: offMonth };
    if (fields.needsReview === false) fields.reviewReason = '';
    const movesMoney = Object.keys(add.values).length > 0 || Object.keys(fields).some((k) => NAMED_DEALS_ONLY[k]);
    // A confirmed replay stands on the lines they agreed to, not on words two turns back.
    if (movesMoney && !args.confirmed && !namedBy(args.saidRecent, found.rows[0]?.person_name ?? entry.person)) {
      return notNamedAsk(displayPersonName(found.rows[0]?.person_name ?? entry.person));
    }
    const deals = oneDealFor(entry, found.rows, fields, add.values, args.confirmed ? null : args.saidRecent);
    if (deals.ask) {
      openAsk.set(entries, entry.person);
      return deals.ask;
    }
    plan.push({ person: entry.person, rows: deals.rows, fields, add: add.values });
  }
  if (unknown.length > 0 || unclear.length > 0) {
    return { summary: nameTrouble({ unknown, unclear }, 'change'), ambiguous: unclear.length > 0 };
  }
  // Every deal is known now, so no earlier question is still open.
  openAsk.held = null;

  for (const p of plan) {
    for (const row of p.rows) {
      const overwrite = amountOverwrite(p.fields, row, instructionOf(args));
      if (overwrite) return { summary: overwrite };
    }
  }

  // ONE LINE PER DEAL, from and to: a person's line hid which deal moved.
  const lines = plan.flatMap((p) => p.rows.map((row) => dealLine(row, patchFor(p, row))));
  const rowCount = plan.reduce((n, p) => n + p.rows.length, 0);

  /**
   * ===============================
   * * WHAT THIS TURN ALREADY WROTE IS NOT PENDING, AND MUST NOT READ AS IT
   * ===============================
   * THE INCIDENT, 2026-09-23, found by driving her on scratch rows. Told
   * "set quillon marsh to 10 days, tarn vessey to 0 and odile prang to 25",
   * she edited Tarn Vessey through the single row tool FIRST, which is an
   * ordinary unguarded write and correctly needs no confirmation. Only on
   * the SECOND person did `secondPersonInTurn` send her here.
   *
   * So one row was already saved, and her summary then offered all three
   * as "would have", including the one already done. The admin is being
   * asked to approve a change that has happened.
   *
   * THE GUARD CANNOT FIRE EARLIER. It has no way to know a sentence names
   * three people until the second call arrives, and holding every first
   * single row edit for confirmation would make an ordinary one cell edit
   * a two step act, which is the thing this page is built not to do.
   *
   * SO THE SUMMARY CARRIES IT. Said HERE rather than in the refusal
   * message, because a sentence telling her to mention it is the kind of
   * guard this codebase has learned not to trust: the line is in the text
   * the admin reads whatever she narrates around it.
   */
  const already = args.turn?.wrote?.get('__person');
  const done = already && !plan.some((p) => p.rows.some((r) => personKey(r) === already.who))
    ? `\nALREADY SAVED THIS TURN, not part of this: ${already.name}. Say so.\n`
    : '';

  // THE LINES GO AS A LIST, so the relay guard holds her to every one: given
  // as prose she answered with a total and "yes" matched nothing. 2026-09-25.
  const pending = confirmFirst(args.confirmed, {
    // ONE PERSON'S DEALS, one change: "a DIFFERENT value on each of them"
    // said of "add 100 to both zayn deals" was simply untrue. 2026-10-05.
    act: `${plan.length === 1 ? `change ${displayPersonName(plan[0].person)}'s deals` : 'set a DIFFERENT value on each of them'}${done ? ` (${done.trim()})` : ''}`,
    count: rowCount,
    noun: 'row',
    keeps: 'Read every line back. A count on its own hides which deal moved, so nobody could '
      + 'tell one wrong value from the rest.',
    lines: lines.map((l) => l.trim()),
  });
  if (pending) return pending;

  const updated = [];
  const failed = [];
  const batchId = randomUUID();
  for (const p of plan) {
    for (const row of p.rows) {
      const patch = patchFor(p, row);
      // The same recompute every other door does, so the payable amount
      // follows its own inputs whichever way the edit arrived.
      const derived = recomputePayable(row, patch);
      // eslint-disable-next-line no-await-in-loop
      const saved = await repo.update(row.id, patch, 'diane', { derived, batchId }).catch(() => null);
      if (saved) updated.push(saved.id); else failed.push(row.id);
    }
  }

  // A ROW THAT DID NOT TAKE IS NAMED, never averaged into a success count.
  if (failed.length > 0) {
    return {
      summary: `${updated.length} of ${rowCount} rows were changed and ${failed.length} DID NOT `
        + `TAKE: ids ${failed.join(', ')}. Say both numbers and name the ones that failed. Do NOT `
        + 'report this as done.',
    };
  }

  broadcast(null, 'master-sheet:changed', { action: 'bulk-updated', ids: updated, via: 'agent' });
  return {
    summary: `Done. ${plan.length} ${plan.length === 1 ? 'person' : 'people'}, ${updated.length} `
      + `${updated.length === 1 ? 'row' : 'rows'}:\n${lines.join('\n')}\n\n`
      + (plan.length === 1 ? 'Say what each deal got, one line each, by company and group.'
        : 'Say what each person got, one line each. They are different changes.'),
    // EVERY LINE, from the tool: told to "say each one", she reported four of
    // Nathan's five deals. Clone 2026-10-05.
    reply: `Done.\n${lines.map((l) => l.trim()).join('\n')}`,
    computedReply: true,
  };
}

const bulkUpdate = {
  name: 'bulk_update_master_sheet',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    'Change the SAME field on every row matching a filter: "set every ALPHA preset to August", '
    + '"mark all the BETA cash rows as paid", "put every row in this group on 31 payable days". '
    + 'EVERY GROUP AT ONCE IS ONE CALL: leave `group` out entirely and it covers the whole sheet. '
    + 'Do NOT go group by group and do NOT ask which group when they said all of them. '
    + 'To hold rows back, name them in `except`: "all the presets except Alex Example and Blake Example". '
    + 'ONE DEAL\'S MONEY PER PERSON (a special case, this month\'s payable amount, or an amount '
    + 'ADDED like "add 500 to her payable") is perPerson, one entry per deal with its company. '
    + 'Takes a filter, never row ids. CALL IT TWICE: the first call writes nothing and comes back '
    + 'with the exact rows and the exact change, which you read to the admin and ask them to '
    + 'confirm; only then call it again with confirmed true. Never pass confirmed on the first '
    + 'call, and never pass it because you assume they would say yes.',
  parameters: {
    type: 'object',
    properties: {
      // The same narrowing the page and filter_master_sheet use, so a set
      // she can describe is a set she can change.
      group: { type: 'string', description: 'ONE group. LEAVE IT OUT for the whole sheet, which is what "all groups" means: do not loop over the groups one at a time.' },
      /**
       * HOLD ROWS BACK BY NAME.
       *
       * "Update all the presets except Nathan and Gloria" had no route:
       * every filter is positive, so the only way was to do it and fix
       * them after. Resolved against the MATCHED SET only, so a name that
       * is not in it is said out loud rather than silently ignored.
       */
      except: {
        type: 'array',
        items: { type: 'string' },
        description: 'People to leave UNCHANGED, as the admin says them. Use it for "all of them except X and Y". Every held back row is named back to them before anything is written.',
      },
      /**
       * NAMED PEOPLE, IN ONE CALL.
       *
       * "Update Zayn, Paddy and Gloria's end date" had no route: every
       * filter here is a property of a row, never a list of people, so the
       * only way was three separate single row edits. Three confirmations,
       * three chances to stop half way, and no one act to undo afterwards.
       */
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'The ONLY people to change, as the admin says them. Use this whenever they '
          + 'name two or more: "update Blake Example, Jordan Example and Alex Example". EVERY deal those people hold is '
          + 'changed unless a filter narrows it further. Never call this once per person. A name '
          + 'that matches nobody, or that could be two people, refuses the whole change.',
      },
      /**
       * ===============================
       * * THE SAME FILTERS THE LOOKUP HAS. ONE DEFINITION.
       * ===============================
       * This declared its own shorter list, so she could DESCRIBE a set she
       * could not then change: "set payable days to 0 for everyone at
       * Northstar Care" had no company filter here, and neither did an
       * amount range, an end month, a tier or a role. The answer was to go
       * row by row, which is the loop every bulk guard here exists to stop.
       *
       * `FILTER_PARAMS` mirrors `repo.findAll`, and this handler spreads
       * what it was given straight into that same call, so a filter added
       * there reaches all three tools at once. Two lists for one question is
       * how they drifted apart in the first place.
       *
       * `group` stays its own, because this tool has its own warning about
       * looping over groups one at a time.
       */
      ...FILTER_PARAMS_SHORT,
      /**
       * WHAT TO SET, and it is EVERY column a set of rows can share.
       *
       * It was a short list and the missing ones were simply unreachable:
       * asked to put an appointment date or a note on a whole group there
       * was no route, and `normalizeFields` dropped the key without a word,
       * so the answer was "nothing to set" on a request that made sense.
       *
       * The ones NOT here are refused BY NAME in the handler, never
       * silently: see `PER_PERSON`. A bank account written to thirty rows
       * is thirty people paid into one account.
       */
      set: {
        type: 'object',
        description: 'The change to apply to every matching row. Every column a group can share '
          + 'is here. A fact that belongs to ONE person (their name, phone, postcode or bank '
          + 'details) is not, and asking for one is refused by name rather than ignored.',
        properties: {
          presetOn: { type: 'string', description: 'YYYY-MM-DD. The period marker, "this row is for August".' },
          paymentStartOn: { type: 'string', description: 'YYYY-MM-DD' },
          assignedOn: { type: 'string', description: 'YYYY-MM-DD. The appointment date.' },
          endOn: { type: 'string', description: 'YYYY-MM-DD. Clears to ongoing with an empty string.' },
          payableDays: { type: 'number' },
          monthlyAmount: { type: 'number' },
          paymentMethod: { type: 'string', enum: ['cash', 'bank', 'crypto'] },
          currency: { type: 'string' },
          location: { type: 'string' },
          roleLabel: { type: 'string', description: 'As the sheet writes it: "Mid 1", "Director".' },
          notes: { type: 'string', description: 'REPLACES the note on every matching row. It does not append.' },
          label: { type: 'string' },
          addonPercent: { type: 'number', description: 'ADDED to the payable amount. Stacks with the rate on the person.' },
          feePercent: { type: 'number', description: 'DEDUCTED after the add on. Stacks with the rate on the person.' },
          overrideShouldBePaid: { type: 'boolean', description: 'The should-be-paid SWITCH' },
          overridePaid: { type: 'boolean', description: 'The paid SWITCH' },
          needsReview: { type: 'boolean' },
          reviewReason: { type: 'string' },
        },
      },
      /**
       * A DIFFERENT VALUE PER PERSON, in ONE call and one confirmation.
       * "Gloria 10 days, Paddy 0, Nathan's preset to September" was three
       * writes and three confirmations before this.
       */
      perPerson: {
        type: 'array',
        description: 'Use this INSTEAD of `set` when the people are getting DIFFERENT values. One '
          + 'entry per person. Never call this tool once per person: the whole point is one '
          + 'confirmation showing every line.',
        items: {
          type: 'object',
          properties: {
            person: { type: 'string', description: 'Their name, as the admin said it.' },
            company: {
              type: 'string',
              description: 'ONE of their deals, by its company (or group). Needed when the person '
                + 'holds several deals and the change is about one: a special case, a payable '
                + 'amount, or an amount added.',
            },
            allDeals: {
              type: 'boolean',
              description: 'Every live deal this person holds, when they said "both", "all" or '
                + '"his deals". Leave company out with it.',
            },
            set: {
              type: 'object',
              description: 'What THIS person changes TO. The same columns `set` takes, plus '
                + '`specialCaseDeal` and `payableAmount` (this month), which are per named deal, '
                + 'plus THEIR OWN details on all their deals: phone, doorNumber, postcode, '
                + 'acceptingPostals, bankDetails, accountNumber, sortCode.',
            },
            add: {
              type: 'object',
              description: 'An amount ADDED to what the deal holds now: "add 500 to her payable '
                + 'amount". Keys: payableAmount, monthlyAmount, payableDays. Negative takes off. '
                + 'Never work the new figure out yourself.',
            },
          },
          required: ['person'],
        },
      },
      raiseMonthlyPercent: {
        type: 'number',
        description: '"raise everyone in MANBAT by 5%": each matching deal\'s OWN monthly goes up by this '
          + 'percentage (negative cuts it). Use this INSTEAD of `set` for a percentage, never set '
          + 'monthlyAmount to 1.05. The new figures are worked out for you.',
      },
      confirmed: { type: 'boolean', description: 'Only on the SECOND call, after the admin agreed.' },
    },
    // NEITHER is required on its own: `set` for one value across many rows,
    // `perPerson` for a different value each. The handler refuses if both
    // are missing, with the reason.
  },
  async handler(args) {
    // ONE MESSAGE, ONE CONFIRMATION, even when every row gets a different
    // value. Its own path because none of the single value logic below
    // applies: see perPersonUpdate.
    /**
     * A PERCENTAGE IN THE PER PERSON SHAPE IS THE PERCENT RAISE. "bump kirans
     * monthly by 10% on all of them" came as perPerson with no figure the
     * shape can hold, and was answered "the CRM needs the new monthly for each
     * deal". The percent tool works the figures out: hand it those people.
     * gpt-4.1 sweep, 2026-10-06.
     */
    // A GROUP IN THE PER PERSON SHAPE IS THE GROUP: "zap all of corvid's
    // notes" came as perPerson [{ person: 'corvid' }]. One entry, a group
    // name, a plain set: it is the group filter. 2026-10-06.
    if (Array.isArray(args.perPerson) && args.perPerson.length === 1 && !args.group) {
      const [only] = args.perPerson;
      const groups = (await peopleRepo.filterOptions().catch(() => null))?.groups ?? [];
      const group = groups.find((g) => fold(g) === fold(only?.person ?? ''));
      if (group && only.set && !only.add) {
        const { perPerson, ...rest } = args;
        args = { ...rest, group, set: { ...(rest.set ?? {}), ...only.set } };
      }
    }
    if (Array.isArray(args.perPerson) && args.perPerson.length > 0) {
      const heard = `${args.said ?? ''}\n${args.saidRecent ?? ''}`;
      const pct = args.raiseMonthlyPercent ?? (heard.match(/(-?\d+(?:\.\d+)?)\s*(?:%|per\s?cent)/i) ?? [])[1];
      const onMonthly = /\b(?:monthly|raise|bump|increase|cut|lower|reduce)\b/i.test(heard)
        && !/\b(?:fee|add[\s-]?on)\b/i.test(heard);
      const holdsFigure = args.perPerson.some((e) => Object.keys(e.add ?? {}).length > 0
        || Object.entries(e.set ?? {}).some(([k, v]) => k !== 'monthlyAmount' || Number(v) !== Number(pct)));
      if (pct != null && onMonthly && !holdsFigure) {
        const { perPerson, ...rest } = args;
        return raiseMonthly({ ...rest, raiseMonthlyPercent: Number(pct), people: perPerson.map((e) => e.person) });
      }
      return perPersonUpdate(args);
    }
    /**
     * A PERCENT ON A RATE IS THE RATE. "give everyone in otter a 2% add on"
     * came as raiseMonthlyPercent 2 and raised four MONTHLY amounts. When
     * their words name the add on or the fee, the percent moves that rate.
     */
    if (args.raiseMonthlyPercent != null) {
      const heardRate = `${args.said ?? ''}\n${args.saidRecent ?? ''}`;
      const rateKey = /\badd[\s-]?ons?\b/i.test(heardRate) ? 'addonPercentDelta'
        : /\bfees?\b/i.test(heardRate) ? 'feePercentDelta' : null;
      if (!rateKey) return raiseMonthly(args);
      const { raiseMonthlyPercent: pct, ...restArgs } = args;
      // eslint-disable-next-line no-param-reassign
      args = { ...restArgs, set: { ...(restArgs.set ?? {}), [rateKey]: Number(pct) } };
    }

    // A company sent as a group is re-homed, as every read already does.
    const scoped = await resolveDealScope(args);
    if (scoped.question) return { summary: scoped.question };
    args = scoped.args;

    /**
     * A VALUE SENT AS A FILTER IS THE CHANGE. "set currency to aed for
     * everyone in otter except kiran" came with currency AED as a FILTER and
     * nothing to set: "nothing to set", then told them everyone was "already
     * AED", which nothing had checked. A filter whose value their words say
     * to set TO ("currency to aed") is the set. gpt-4.1 messy sweep, 2026-10-06.
     */
    if (!args.set || Object.keys(args.set).length === 0) {
      const heardTo = `${args.said ?? ''}\n${args.saidRecent ?? ''}`;
      const moved = {};
      for (const [k, v] of Object.entries(args)) {
        if (!ROW_FIELDS[k] || typeof v !== 'string' || !v.trim() || k === 'groupName') continue;
        const esc = v.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\bto\\s+${esc}\\b`, 'i').test(heardTo)) moved[k] = v;
      }
      if (Object.keys(moved).length > 0) {
        const rest = { ...args };
        for (const k of Object.keys(moved)) delete rest[k];
        args = { ...rest, set: moved };
      }
    }
    const {
      set, confirmed, except, people, onProgress, said, open, ...filter
    } = args;
    /**
     * ===============================
     * * REFUSED BY NAME, never dropped in silence
     * ===============================
     *
     * `normalizeFields` keeps the keys it knows and discards the rest, so
     * "put this phone number on the whole group" came back as "nothing to
     * set" on a request that was perfectly clear. The admin then has no
     * idea whether the CRM misunderstood them or refused them.
     *
     * These are the columns a SET of rows cannot share: one person's
     * identity, and the details money is paid into. A bank account written
     * to thirty rows is thirty people paid into one account.
     */
    const asked = Object.keys(set ?? {});
    const refused = asked.filter((k) => PER_PERSON[k]);
    if (refused.length > 0) {
      return {
        summary: `NOTHING HAS BEEN CHANGED. ${listOf(refused.map((k) => `${FIELD_LABELS[k] ?? k} (${PER_PERSON[k]})`))}. `
          + 'Say why in one sentence and offer to change it on ONE row instead, by name.',
      };
    }
    const namedOnly = asked.filter((k) => NAMED_DEALS_ONLY[k]);
    if (namedOnly.length > 0) {
      return {
        summary: `NOTHING HAS BEEN CHANGED. ${listOf(namedOnly.map((k) => `${FIELD_LABELS[k] ?? k} (${NAMED_DEALS_ONLY[k]})`))}. `
          + 'Call this again with `perPerson`, one entry per deal: the person, the company, and '
          + 'the value. If they did not say which deals, ask.',
      };
    }

    // BEFORE the write, and before the row count, so a bulk ask for a
    // derived field is refused with its real reason rather than counting
    // rows it was never going to change. See NOT_SETTABLE.
    const derivedSet = derivedFieldAsked(set ?? {});
    if (derivedSet) return { summary: derivedSet };

    const groupSplit = takeDeltas(set ?? {});
    const fields = normalizeFields(groupSplit.rest);
    const groupAdd = addsOf(groupSplit.add);
    if (groupAdd.error) return { summary: `NOTHING HAS BEEN CHANGED. ${groupAdd.error}` };

    /**
     * "BUMP EVERYONE 100" IS AN ADD, never a set. It was previewed as "set
     * the monthly amount to 100 on 14 deals": every person's pay replaced by
     * a hundred, one yes away. gpt-4.1 messy sweep, 2026-10-06. Their words
     * moved a figure BY an amount ("bump", "raise", "up", "add" and no "to
     * N"), so a money column SET to that amount is refused here, in code.
     */
    const heardBy = `${said ?? ''}\n${args.saidRecent ?? ''}`;
    const byAmount = /\b(?:bump|raise|increase|add|up|top\s*up|plus|knock|take|deduct|minus|cut|lower|reduce)\b/i.test(heardBy)
      && !/\bto\s+(?:[£$€]|gbp|aed|usd|eur)?\s*\d/i.test(heardBy);
    const setMoney = ['monthlyAmount', 'payableAmount'].filter((k) => fields[k] != null
      && new RegExp(`(?:^|[^\\d.])${String(Number(fields[k])).replace('.', '\\.')}(?![\\d%])`).test(heardBy));
    if (byAmount && setMoney.length > 0) {
      return {
        summary: `NOTHING HAS BEEN CHANGED. They said to move it BY ${fields[setMoney[0]]}, not to make it `
          + `${fields[setMoney[0]]}, and setting it would replace every deal's figure. Adding an amount is `
          + 'done per person: if they named people, call again with perPerson, each { person, allDeals: true, '
          + `add: { ${setMoney[0]}: ${fields[setMoney[0]]} } }. If they did not, ask ONE short question: which `
          + 'people should get it, or did they mean a new fixed figure.',
        reply: `Just to be sure, nothing has changed: should ${fields[setMoney[0]]} be ADDED to what they `
          + `get, or did you mean a new fixed figure of ${fields[setMoney[0]]}? Adding an amount goes `
          + 'person by person, so tell me who it is for.',
        computedReply: true,
      };
    }

    // A GUESSED YEAR ACROSS EVERY ROW. This is where it actually happened:
    // 96 rows set to 2024-09-01 from the word "September". See farOffPreset.
    const offMonth = farOffPreset(fields, `${said ?? ''}\n${args.saidRecent ?? ''}`);
    if (offMonth) return { summary: offMonth };

    if (Object.keys(fields).length === 0 && Object.keys(groupAdd.values).length === 0) {
      // Everything they asked for was a field this tool does not know at
      // all, which is a different failure from asking for nothing.
      const unknown = asked.filter((k) => !ROW_FIELDS[k]);
      return {
        summary: unknown.length > 0
          ? `NOTHING HAS BEEN CHANGED: ${listOf(unknown)} ${unknown.length === 1 ? 'is not a column' : 'are not columns'} `
            + 'on a deal. Say so and ask which field they meant.'
          : 'NOTHING HAS BEEN CHANGED AND NOTHING WAS CHECKED: no field was given to set. Do NOT say '
            + 'anything is already set. Ask the admin which field they want changed, and to what.',
      };
    }
    if (fields.needsReview === false) fields.reviewReason = '';

    /**
     * ===============================
     * * SHE PICKED THE FIELD THEY NEVER NAMED
     * ===============================
     * Live 2026-09-24, one yes away from writing. She asked "which field
     * and what value", was answered with a LIST OF DEALS, and filled the
     * unanswered half in herself: `overrideShouldBePaid = false`, which
     * takes a row out of every payout total.
     *
     * A list of deals answers WHICH ROWS. It is not a field and it is not
     * a value. See bulkIntent.js.
     */
    // THE PROPOSAL was checked against their instruction. A confirmed call is
    // that proposal agreed to, and its sentence is only "yes". 2026-09-25.
    // THEIR LAST TWO MESSAGES, as its banner says: "mark Dov paid", "which deal?", "both
    // of them" was refused as a field never named, one message too short. 2026-09-28.
    const invented = confirmed ? null : fieldNotNamed(args.saidRecent ?? said, Object.keys(fields), FIELD_LABELS);
    if (invented) return { summary: invented };

    /**
     * ASKED FOR EVERY GROUP, SHE DID ONE. PROMPTING IS NOT A GUARD.
     *
     * "update all the preset dates" became eight confirmations, one group
     * at a time, each looking like the whole job. The cap is 500 rows and
     * the sheet is 96, so there was never a reason to split it.
     *
     * The sentence is the evidence, and it is injected rather than passed,
     * so she cannot narrow it on the way through.
     */
    if (filter.group && WHOLE_SHEET.test(String(said ?? ''))) {
      return {
        summary: `NOTHING HAS BEEN CHANGED. They said every group, and this call names only `
          + `${filter.group}. Call this again with NO group at all, which covers the whole `
          + 'sheet in one go, and add `except` for anyone they want left out. Do not loop.',
      };
    }

    /**
     * A GROUP SENT AS A PERSON. "zap all of corvid's notes" came as people
     * ["corvid"] and was refused as "nobody called corvid". CORVID is a
     * group: it is the filter, not a name. gpt-4.1 messy sweep, 2026-10-06.
     */
    let peopleNamed = (people ?? []).filter(Boolean);
    if (peopleNamed.length > 0 && !filter.group) {
      const groups = (await peopleRepo.filterOptions().catch(() => null))?.groups ?? [];
      const asGroups = peopleNamed.map((n) => groups.find((g) => fold(g) === fold(n))).filter(Boolean);
      if (asGroups.length === 1) {
        filter.group = asGroups[0];
        peopleNamed = peopleNamed.filter((n) => fold(n) !== fold(asGroups[0]));
      }
    }

    const { rows: matched, total } = await repo.findAll({ ...filter, page: 1, pageSize: BULK_MAX });

    /**
     * HELD BACK BY NAME, and every one of them said out loud.
     *
     * An exclusion is invisible in a way a filter is not: a count alone
     * would let somebody approve a change without knowing what was
     * skipped. So both numbers are reported, and a name that matches
     * NOTHING in the set is an error rather than a silent no-op, because
     * a misspelt exception means the row gets changed after all.
     */
    /**
     * ===============================
     * * NAMED IN, NAMED OUT, one resolver
     * ===============================
     *
     * `people` and `except` are the same act pointing opposite ways, so
     * they share `rowsForNames`: the same typo tolerance, the same stop on
     * an ambiguous name, and the same refusal for one that matches nobody.
     * Two resolvers would drift, and the one that drifted would be the one
     * deciding whose row got changed.
     */
    const onlyThese = peopleNamed;
    const wanted = rowsForNames(matched, onlyThese, said);
    if (wanted.unknown.length > 0 || wanted.unclear.length > 0) {
      return { summary: nameTrouble(wanted, 'change'), ambiguous: wanted.unclear.length > 0 };
    }

    // NARROWED BEFORE ANYTHING ELSE, so `except` and the count are about
    // the people asked for and not about the whole sheet.
    const inScope = onlyThese.length > 0 ? wanted.rows : matched;

    /**
     * ===============================
     * * THEY NAMED SOMEBODY, SO THE CHANGE IS THEIRS
     * ===============================
     * gpt-4.1 bulk sweep, 2026-10-06: "bump kirans monthly by 10% on all of
     * them" was called with no person at all. The preview reached all 14
     * deals on the sheet while her sentence said "Kiran holds three", and
     * the yes raised all fourteen. A name in the request with no name in
     * the scope is a dropped argument, never a wider change: refused here,
     * in code, before any preview, whatever she wrote around it.
     */
    if (onlyThese.length === 0 && !confirmed) {
      const dropped = personDropped(matched, said, except);
      if (dropped) return { summary: dropped };
    }

    const { held, unknown: missed, unclear } = rowsForNames(inScope, (except ?? []).filter(Boolean), said);
    // Held back by being stopped already: "except Dov" after his deals ended
    // was refused as "nobody called Dov". 2026-09-25.
    const stoppedAlready = unclear.length === 0 ? await stoppedAmong(missed, filter, said) : [];
    const unknown = missed.filter((n) => !stoppedAlready.includes(n));
    if (unknown.length > 0 || unclear.length > 0) {
      return { summary: nameTrouble({ unknown, unclear }, 'hold back'), ambiguous: unclear.length > 0 };
    }
    const heldIds = new Set(held.map((r) => r.id));
    const rows = inScope.filter((r) => !heldIds.has(r.id));

    /**
     * ===============================
     * * A SCOPE NARROWER THAN WHAT THEY NAMED
     * ===============================
     * They named Reliapay, KP and Kryptonia; the call was scoped to
     * Reliapay, so the preview said "2 deals" and read as the whole job.
     * A count is only checkable against something, and the admin has
     * nothing but their own memory of the sentence they just said.
     *
     * READ OFF THE SHEET'S OWN COMPANY NAMES, never a list typed here:
     * the next company is named by an upload, not by us.
     */
    const onSheet = [...new Set((matched ?? []).map((r) => r.company).filter(Boolean))];
    const short = confirmed ? null : scopeMissesNamed(said, rows, onSheet);
    if (short) return { summary: short };

    if (rows.length === 0) {
      return {
        summary: held.length > 0
          ? 'Every row that matched is on the exception list, so there is nothing left to change. '
            + 'Say so and ask whether they meant to hold that many back.'
          : 'No rows match that, so there is nothing to change. Say so and offer to widen it.',
      };
    }
    // A CAP THAT REFUSES, never one that quietly does the first sixty. A
    // partial mass edit is worse than none: nobody can tell which half ran.
    // Against what the FILTER matched, not what survived the exceptions: a
    // held back row was fetched, so excluding it is not a page that got cut.
    if (total > matched.length) {
      return {
        summary: `${total} rows match that, more than I change in one go. Tell the admin to `
          + 'narrow it, by group or by preset month, and try again.',
      };
    }

    for (const row of rows) {
      const overwrite = amountOverwrite(fields, row, instructionOf(args));
      if (overwrite) return { summary: overwrite };
    }

    const what = Object.entries(fields)
      .filter(([k]) => k !== 'reviewReason')
      .map(([k, v]) => (SWITCH_WORDS[k] ? switchLine(k, v) : `${FIELD_LABELS[k] ?? k} to "${v}"`))
      .join(', ');
    // A RATE SAYS WHERE EACH ROW IS COMING FROM, as the other two doors do:
    // "to 1" over a row on 3% is a cut nobody was shown. See rateChange.js.
    const rateFrom = (r) => Object.entries(RATE_FIELDS)
      .filter(([field]) => fields[field] !== undefined)
      .map(([field, rate]) => `DEAL ${rate.label} ${Number(r[rate.column]) || 0}% to ${Number(fields[field])}%`);
    const who = rows.map((r) => [`  ${r.person_name}`, r.company || 'no company', r.group_name, ...rateFrom(r)]
      .join(' · '));

    if (!confirmed) {
      return {
        summary: `NOTHING HAS BEEN CHANGED YET. This would set ${what} on ${rows.length} `
          + `${rows.length === 1 ? 'row' : 'rows'}:\n\n${who.join('\n')}\n\n`
          // BOTH NUMBERS, AND THE NAMES. An exclusion cannot be seen in a
          // count the way a filter can, so approving "93 rows" without
          // knowing which three were skipped is approving blind.
          + (held.length > 0
            ? `HELD BACK, unchanged: ${held.length} of ${matched.length} `
              + `(${[...new Set(held.map((r) => r.person_name))].join(', ')}). `
              + 'You MUST say both numbers and name every row you are holding back, or they are '
              + 'agreeing to something they cannot see.\n\n'
            : '')
          + (stoppedAlready.length > 0
            ? `${listOf(stoppedAlready)}: every deal already stopped, so nothing of theirs moves. Say so.\n\n`
            : '')
          // A SHORT LIST IS READ BACK, every line: "3 deals at co B" hid who. 2026-09-25.
          + (rows.length <= NAMES_IN_SUMMARY
            ? 'Tell the admin the change, then read EVERY line above back, one per line, and ask them '
              + 'to confirm.'
            : 'Tell the admin the COUNT and the change in one sentence, name the group, and ask them '
              + 'to confirm. Do not list every row unless they ask.')
          + ' If they agree, call this again with exactly the same filter, the same except list, and '
          + 'confirmed true.',
        rows: rows.map(summarizeRow),
        // A PENDING LIKE ANY OTHER. Unmarked, the runtime could neither replay
        // a "yes" nor allow her confirm, and "yes" asked again. 2026-09-25.
        // The VALUE and who is held back; the call's own shape pins the filter.
        pending: true,
        // WHO, when they were named: "paid to true" alone has nothing to check.
        confirming: `set ${what}`
          + ((people ?? []).length > 0 ? ` for ${[...new Set(rows.map((r) => r.person_name))].join(', ')}` : '')
          + (held.length > 0 ? `, holding back ${[...new Set(held.map((r) => r.person_name))].join(', ')}` : ''),
      };
    }

    /**
     * IT REPORTS ITSELF AS IT GOES, which is what lets the cap be high.
     *
     * A mass edit that says nothing until it finishes is indistinguishable
     * from one that has hung, and if it fails half way nobody can tell
     * which half ran. Ninety six rows is several seconds of silence.
     *
     * `onProgress` is injected by runAgent, never a model argument. Absent
     * (a test, another caller) it simply does nothing.
     */
    const show = rows.length >= PROGRESS_FROM ? args.onProgress : null;
    show?.({ done: 0, total: rows.length, what, label: 'Updating' });

    // The union across the batch, because the claim the repo writes is one
    // array for every row in it. Same two keys on every row in practice.
    const derivedKeys = new Set();
    const changes = rows.map((row) => {
      const patch = { ...fields };
      // A relative rate lands per deal, on what THAT deal holds now.
      for (const [key, n] of Object.entries(groupAdd.values)) {
        patch[key] = round2((Number(row[ADDABLE[key]]) || 0) + n);
      }
      // The same recompute the page's own bulk edit does, so changing the
      // days or the rate moves the payable amount with it rather than
      // leaving a figure that no longer follows from its own inputs.
      recomputePayable(row, patch).forEach((key) => derivedKeys.add(key));
      return { id: row.id, fields: patch };
    });
    const derived = [...derivedKeys];

    const updated = [];
    const failed = [];
    // ONE id for the whole edit, whichever path writes it, so History and
    // undo see one change rather than guessing it back together by time.
    const batchId = randomUUID();
    if (changes.length >= BULK_TRANSACTION_FROM) {
      const saved = await repo.updateMany(changes, 'diane', { derived, batchId }).catch(() => []);
      const savedIds = new Set(saved.map((row) => row.id));
      updated.push(...changes.filter(({ id }) => savedIds.has(id)).map(({ id }) => id));
      failed.push(...changes.filter(({ id }) => !savedIds.has(id)).map(({ id }) => id));
      show?.({
        done: changes.length,
        total: changes.length,
        what,
        label: 'Updating',
        failed: failed.length,
      });
    } else {
      for (const change of changes) {
        // eslint-disable-next-line no-await-in-loop
        const saved = await repo.update(change.id, change.fields, 'diane', { derived, batchId }).catch(() => null);
        if (saved) updated.push(saved.id); else failed.push(change.id);
        const row = rows.find((item) => item.id === change.id);
        show?.({
          done: updated.length + failed.length,
          total: rows.length,
          what,
          label: 'Updating',
          row: `${row?.person_name ?? 'row'} · ${row?.company || 'no company'} · ${row?.group_name}`,
          failed: failed.length,
        });
      }
    }

    // A ROW THAT DID NOT TAKE IS NAMED, never averaged into a success
    // count. This is the half-ran case the old cap existed to prevent, and
    // saying so is the thing that replaces it.
    if (failed.length > 0) {
      return {
        summary: `${updated.length} of ${rows.length} rows now have ${what}, and ${failed.length} `
          + `DID NOT TAKE: ids ${failed.join(', ')}. Say both numbers and name the ones that `
          + 'failed. Do NOT report this as done.',
        rows: [],
      };
    }

    broadcast(null, 'master-sheet:changed', { action: 'bulk-updated', ids: updated, via: 'agent' });
    return {
      summary: `Done. ${updated.length} ${updated.length === 1 ? 'row' : 'rows'} now have ${what}.`
        + (held.length > 0
          ? ` ${held.length} left UNCHANGED as asked: ${[...new Set(held.map((r) => r.person_name))].join(', ')}.`
          : '')
        + ' Say the count and the change in one sentence, and name anything you held back. '
        + 'It is on screen, so do not list the rest.',
      rows: [],
    };
  },
};

/**
 * ***************************************************
 * * The Active company list, asked for out loud
 * ***************************************************
 *
 * The same table the export prints on every group tab and the same one his
 * own sheets carry: company, director, mid, tier, and now his old group.
 * `activeCompanies` is shared with the workbook builder rather than copied,
 * so what she reads out and what the file prints cannot disagree.
 *
 * A COMPANY IS LIVE IF ANY ONE DEAL ON IT IS. An ended deal does not put a
 * company on this table and does not take one off either.
 */

/**
 * ***************************************************
 * * Every percentage on somebody, and which way it goes
 * ***************************************************
 *
 * READ ONLY, and one answer rather than three lookups. She could set a
 * person's rates and read none of them, which is the wrong way round.
 *
 * THE DIRECTION IS NEVER OPTIONAL. "Gloria is on 5%" is useless: 5% added
 * and 5% taken off are ten percent apart. Every line this returns carries
 * the word, and the summary says so again.
 */
// `resolvePerson` moved to ./resolvePerson.js when the export tool needed
// it: a second tools file must not have to require this 2,600 line one.

/**
 * ***************************************************
 * * What the rate is, and where it came from
 * ***************************************************
 *
 * READ ONLY. She said she had no access to exchange rates while the CRM
 * had a live feed the export uses every month.
 *
 * THE FULL RATE, NOT 1.36. The conversions have always used six decimals
 * and only the printed cell was short; a reader checking 9,275 GBP against
 * a two decimal rate lands twenty dollars out. She quotes what was used.
 *
 * PROVENANCE IS NOT OPTIONAL. "Live" and "the fallback because the feed
 * was down" are the same number until somebody asks, and they are worth
 * telling apart when a payment is being reconciled.
 */
const fxTool = {
  name: 'exchange_rate',
  description:
    'The exchange rate the CRM is using right now: the full six decimal USD per GBP, the AED '
    + 'peg, where the rate came from and when it was published. Use it for "what is the rate", '
    + '"what are you converting at", "is that live". READ ONLY, and it converts nothing: to '
    + 'convert a total use total_master_sheet with convertTo. '
    + 'For a follow-up to a conversion, pass only the currencies shown in the previous answer. '
    + 'For a rate in a PAST month, pass that month: a saved month carries the rate it was '
    + 'converted at, which is not today\'s. '
    + 'ALWAYS say the rate to six decimals and ALWAYS say whether it is live or a fallback.',
  parameters: {
    type: 'object',
    properties: {
      currencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only the source currencies relevant to the conversion being discussed. '
          + 'For a follow-up, copy the currency codes from the previous answer. Omit only when '
          + 'there is no prior conversion context.',
      },
      month: {
        type: 'string',
        description: 'YYYY-MM, when they asked about a specific PAST month ("what was August\'s '
          + 'rate"). Omit for the current rate.',
      },
    },
  },

  async handler(args = {}) {
    /**
     * ===============================
     * * THE RATE IS NOT A CONVERSION, AND SHE REACHED FOR IT TWICE
     * ===============================
     * "convert it to usd" came back as the rate table and no figure, twice
     * in one conversation. The description already said this tool converts
     * nothing; a sentence in a description is not a guard. Asked to
     * convert, it refuses and names the tool that does it.
     */
    // A TARGET CURRENCY is what makes it a conversion request. Without it,
    // "what did you convert august at" is a question about the RATE and
    // must fall through, not be sent away to a totals tool.
    if (asksToConvert(args.said)) {
      return {
        summary: 'They asked you to CONVERT a figure, not what the rate is. This tool converts '
          + 'nothing. Call total_master_sheet or compare_months with convertTo USD for the SAME '
          + 'scope and month as the answer they are pointing at, and give them the figure.',
      };
    }

    /**
     * ===============================
     * * A PAST MONTH HAS ITS OWN SAVED RATE
     * ===============================
     * She converted August "using that month's saved rate", was asked what
     * that rate was, and answered with today's. Then repeated it twice more
     * to "i asked august" and "august exchange rate not september". The
     * rate is in the snapshot; nothing could read it back.
     */
    // REPAIRED, not trusted. She sent 2025-08 for "and last august?" and
    // this answered "no saved rate for August 2025" about a year nobody
    // said. Same repair every other read applies.
    const month = MONTH_RE.test(String(args.month ?? ''))
      ? (monthForRead(String(args.month), args.said) ?? null)
      : null;
    if (month && month < currentMonth()) {
      const [snapshot] = await snapshotsRepo.findMany([month]);
      const savedFx = snapshot?.totals?.fx ?? null;
      if (!savedFx?.usdPerGbp) {
        return {
          summary: `There is no saved rate for ${monthName(month)}: that month has no snapshot, `
            + 'or the snapshot was taken while the feed was down. Say that plainly. Do NOT give '
            + "today's rate instead, because a rate for the wrong month is a wrong rate.",
        };
      }
      const savedRate = Number(savedFx.usdPerGbp);
      const asOf = savedFx.asOf ? `, published ${savedFx.asOf}` : '';
      const savedReply = `The rate saved with ${monthName(month)}:\n`
        + `1 GBP = ${savedRate.toFixed(6)} USD.\n`
        + `1 USD = ${AED_PER_USD} AED, fixed peg.\n`
        + `Source: ${savedFx.source ?? 'unknown'}${asOf}.`;
      return {
        summary: `${monthName(month)} was converted at ${savedRate.toFixed(6)} USD per GBP, the `
          + 'rate stored with that snapshot. This is NOT the current rate and must not be '
          + 'described as one. Say the figure to SIX DECIMALS.',
        usdPerGbp: savedRate,
        aedPerUsd: AED_PER_USD,
        source: savedFx.source ?? null,
        month,
        reply: savedReply,
        computedReply: true,
      };
    }

    const fx = await fxRates.usdPerGbp();
    const live = fx.source === 'live' || fx.source === 'cache';
    const rate = Number(fx.usdPerGbp);
    const covered = Object.keys(fx.perUsd ?? {}).length;

    // A FALLBACK IS NOT A RATE, it is a constant standing in for one, and
    // saying so is the whole reason `source` travels.
    const provenance = live
      ? `It is ${fx.source === 'cache' ? 'the current cached rate' : 'live'}`
        + `${fx.asOf ? `, published ${fx.asOf}` : ''}.`
      : `It is NOT live: ${fx.source}. Say that out loud, because a stale rate and a live one `
        + 'look identical in a figure.';

    const priorSource = String(args.priorAnswer ?? '').split(/(?:Combined )?In USD:/i)[0];
    /**
     * ONE NAME PER CURRENCY: the sheet writes EURO, the rate table EUR. The
     * rate was looked up under EURO and said "no exchange rate available",
     * and the AED line ignored the saved rate for the peg, so the rate she
     * stated was not the one the totals used. 2026-10-03.
     */
    const perUsd = normalizeRates(fx.perUsd ?? {});
    const spellings = (code) => (code === 'EUR' ? 'EUR(?:OS?)?' : code);
    const priorCurrencies = Object.keys(perUsd)
      .filter((currency) => {
        if (currency === 'USD') return false;
        const code = spellings(currency.replace(/[^A-Z]/g, ''));
        const beforeAmount = new RegExp(`\\b${code}\\s+[-+]?\\d`);
        const afterAmount = new RegExp(`[-+]?\\d[\\d,.]*\\s+${code}\\b`);
        return beforeAmount.test(priorSource) || afterAmount.test(priorSource);
      });
    const explicit = (Array.isArray(args.currencies) ? args.currencies : [])
      .map((currency) => codeFor(currency))
      .filter(Boolean);
    // WHAT THE SHEET PAYS IN when nothing narrower was asked: GBP and AED
    // alone left out the euro deals.
    const onSheet = [...new Set((await repo.liveCurrencies().catch(() => [])).map(codeFor))];
    const currentSaid = String(args.said ?? '');
    const relevantExplicit = priorCurrencies.length > 0
      ? explicit.filter((currency) => priorCurrencies.includes(currency)
        || new RegExp(`\\b${currency}\\b`).test(currentSaid))
      : explicit;
    // USD IS WHAT EVERYTHING CONVERTS INTO, never a rate of its own: "GBP to USD"
    // printed "1 USD = 1 USD". 2026-09-28.
    const notUsd = (list) => list.filter((currency) => currency !== 'USD');
    const wanted = [...new Set(
      (notUsd(relevantExplicit).length > 0
        ? notUsd(relevantExplicit)
        : (notUsd(priorCurrencies).length > 0 ? notUsd(priorCurrencies)
          : (notUsd(onSheet).length > 0 ? notUsd(onSheet) : ['GBP', 'AED']))),
    )];
    // The rate the conversions USE: a saved AED rate beats the peg there, so it does here.
    const savedAed = Number(perUsd.AED);
    const aedPerUsd = Number.isFinite(savedAed) && savedAed > 0 ? savedAed : AED_PER_USD;
    const rateLines = [];
    for (const currency of wanted) {
      if (currency === 'GBP') rateLines.push(`1 GBP = ${rate.toFixed(6)} USD.`);
      else if (currency === 'AED') {
        rateLines.push(aedPerUsd === AED_PER_USD
          ? `1 USD = ${AED_PER_USD} AED, fixed peg.`
          : `1 USD = ${aedPerUsd.toLocaleString('en-GB', { maximumFractionDigits: 6 })} AED, saved rate.`);
      } else {
        const per = Number(perUsd[currency]);
        rateLines.push(Number.isFinite(per) && per > 0
          ? `1 USD = ${per.toLocaleString('en-GB', { maximumFractionDigits: 6 })} ${currency}.`
          : `${currency}: no exchange rate available.`);
      }
    }
    const sourceLine = live
      ? `${fx.source === 'cache' ? 'Current cached rate' : 'Current live rate'}${fx.asOf ? `, published ${fx.asOf}` : ''}.`
      : `Fallback rate, not live: ${fx.source}.`;
    /**
     * THE PAIR THEY ASKED FOR, answered. "what's the aed to gbp rate" got
     * the two USD rates and left the division to them. 2026-09-30. Worked
     * through USD from the same two figures, so it cannot disagree.
     */
    const usdPer = (code) => {
      if (code === 'USD') return 1;
      if (code === 'GBP') return rate;
      if (code === 'AED') return 1 / aedPerUsd;
      const per = Number(perUsd[code]);
      return Number.isFinite(per) && per > 0 ? 1 / per : null;
    };
    const pair = /\b([A-Za-z]{3,5})\s*(?:to|into|in|per|vs|against|->|\/)\s*([A-Za-z]{3,5})\b/i.exec(currentSaid);
    const [from, to] = pair ? [codeFor(pair[1]), codeFor(pair[2])] : [];
    const pairLines = pair && from !== to && usdPer(from) && usdPer(to)
      ? [`1 ${from} = ${(usdPer(from) / usdPer(to)).toFixed(6)} ${to}.`, `1 ${to} = ${(usdPer(to) / usdPer(from)).toFixed(6)} ${from}.`]
      : [];
    const reply = pairLines.length
      ? `${pairLines.join('\n')}\nWorked from:\n${rateLines.join('\n')}\n${sourceLine}`
      : `Here are the current exchange rates:\n${rateLines.join('\n')}\n${sourceLine}`;

    return {
      summary: `USD per GBP is ${rate.toFixed(6)}. ${provenance} `
        + (aedPerUsd === AED_PER_USD
          ? `AED is pegged at ${AED_PER_USD} per USD, fixed since 1997, so it does not move and `
            + 'does not depend on the feed. '
          : `AED is at the saved rate of ${aedPerUsd} per USD, which is what every total uses. `)
        + `${covered} ${covered === 1 ? 'currency has' : 'currencies have'} a rate; anything `
        + 'else cannot be converted at all and is never converted at par.\n\n'
        + 'Say the rate to SIX DECIMALS exactly as written above. Rounding it to 1.36 is what '
        + 'makes a converted total impossible to check by hand.',
      usdPerGbp: rate,
      aedPerUsd,
      source: fx.source,
      live,
      asOf: fx.asOf ?? null,
      currenciesCovered: covered,
      reply,
      computedReply: true,
    };
  },
};

const checkRates = {
  name: 'check_rates',
  description:
    'What percentages apply to somebody: their standing add on and fee, the rates on each of '
    + 'their deals, and the crypto charge if any of those deals is paid in coin. Use it for '
    + '"what is Alex Example on", "does Casey Example have a fee", "what is the crypto rate", "what percentage '
    + 'is on this deal". READ ONLY. An ADD ON is added to what is owed, a FEE is deducted from '
    + 'it after that, and the two levels STACK: a person on 5% with 3% on one row is 8% there. '
    + 'Never state a percentage without saying which way it goes.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Their name as the admin said it. Leave out to ask about the crypto rate alone.' },
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'SEVERAL names, when they asked about more than one. Use this INSTEAD of '
          + '`person`. Rates are PER PERSON and they stack differently on each, so one person\'s '
          + 'answer is never another\'s.',
      },
      group: { type: 'string', description: 'Narrow to one group, if they named one' },
      company: {
        type: 'string',
        description: 'EVERYONE ON ONE COMPANY: "what are the rates at Workforce". Each person on it '
          + 'is answered on their own. Never pass a company as the group.',
      },
    },
  },
  async handler(given) {
    // A company sent as a group is re-homed by the shared resolver.
    const scoped = given.group ? (await resolveDealScope(given)).args ?? given : given;
    const rawArgs = { ...scoped, company: [scoped.company].flat()[0] };
    const people = listAsked(rawArgs.people);

    /**
     * EVERYONE ON A COMPANY, person by person. Asked "the rates on everyone at
     * ZZ Rate Co B" she sent the company as a group, and three real people
     * came back "nobody matches". 2026-09-25.
     */
    if (rawArgs.company && !rawArgs.person && people.length === 0) {
      const { rows: onIt } = await repo.findAll({ company: rawArgs.company, page: 1, pageSize: TOTAL_ROW_LIMIT });
      const names = [...new Set((onIt ?? []).map((r) => r.person_name).filter(Boolean))];
      if (names.length === 0) {
        return { summary: (await unknownCompanyFilter(rawArgs.company, rawArgs.said)) ?? `No deal is on ${rawArgs.company}.` };
      }
      // THE COMPANY TRAVELS ON, so each person is answered for its deals only.
      const { company } = rawArgs;
      return names.length === 1
        ? checkRates.handler({ ...rawArgs, person: names[0] })
        : answerEach({
          values: names,
          singular: 'person',
          plural: 'people',
          args: rawArgs,
          handler: checkRates.handler,
          guidance: `${names.length} PEOPLE ON ${company}, each checked on their own. Give EACH `
            + 'person their own rates: they differ per person and per deal.',
        });
    }

    if (people.length > 1) {
      return answerEach({
        values: people,
        singular: 'person',
        plural: 'people',
        args: rawArgs,
        handler: checkRates.handler,
        guidance: `${people.length} SEPARATE PEOPLE, each checked on their own. Give EACH person `
          + 'their own rates. Do NOT carry one person\'s percentage across to another, and do '
          + 'not describe them as being "on the same" unless every figure matches.',
      });
    }

    // One name in the plural argument is just the singular question.
    const args = people.length === 1 ? { ...rawArgs, person: people[0] } : rawArgs;

    const settings = await settingsRepo.get();
    const cryptoPercent = Number(settings?.crypto_percent ?? 0);
    const cryptoLine = `The crypto charge is ${cryptoPercent}%, ADDED to any row paid in coin. `
      + 'It is one rate for the whole system, set in Settings, and you cannot change it.';

    /**
     * A GROUP GETS THE SAME RULE AS A PERSON: the crypto charge is
     * mentioned only where a row is actually paid in coin.
     *
     * Asked "what's the percentage rate?" about NEXUS she answered "the
     * crypto charge for NEXUS is 1%" and had to be told NEXUS has no crypto
     * payments. The per-person branch was already fixed for exactly this;
     * this branch still returned the line unconditionally.
     */
    if (!args.person) {
      if (!args.group) return { summary: cryptoLine };

      const inGroup = await repo.findAll({ group: args.group, page: 1, pageSize: TOTAL_ROW_LIMIT });
      // "Nothing in X is paid in coin" about a group that does not exist is
      // a fact she has invented about a name.
      if ((inGroup.rows ?? []).length === 0) {
        const wrong = await notAGroup(args.group, args.said);
        if (wrong) return { summary: wrong };
      }
      const coin = (inGroup.rows ?? []).filter((r) => r.payment_method === 'crypto');
      if (coin.length === 0) {
        return {
          summary: `Nothing in ${args.group} is paid in coin, so the crypto charge does not `
            + 'apply and you must NOT mention it. If they asked about rates, the add ons and '
            + 'fees are per PERSON: ask which person, or name the ones in the group who carry '
            + 'a rate.',
        };
      }
      return {
        summary: `${cryptoLine} ${coin.length} ${coin.length === 1 ? 'row' : 'rows'} in `
          + `${args.group} ${coin.length === 1 ? 'is' : 'are'} paid in coin.`,
      };
    }

    const found = await repo.searchFuzzy({ q: args.person, group: args.group });
    if (found.length === 0) {
      return {
        summary: (await notAPerson(args.person))
          ?? `Nobody matches "${args.person}". Ask them to check the spelling.`,
      };
    }

    // SHARED, so the exit can never be forgotten again. Without it "Gloria"
    // also matched "Gloria difference", and answering "Gloria" re-ran the
    // same fuzzy search and asked the same question, forever.
    const picked = resolvePerson(found, args.person, args.said);
    if (picked.ambiguous) {
      return {
        summary: `"${args.person}" is more than one person: ${picked.names.join(', ')}. Ask which `
          + 'ONE, giving the names EXACTLY as written above, and say nothing about their rates '
          + 'yet. Answering with one of those names resolves it.',
        ambiguous: true,
      };
    }
    // ON ONE COMPANY, only its deals: Bram's three read as three deals "there".
    const rows = rawArgs.company
      ? picked.rows.filter((r) => fold(r.company) === fold(rawArgs.company))
      : picked.rows;
    if (rows.length === 0) {
      return { summary: `${displayPersonName(picked.rows[0]?.person_name)} holds no deal on ${rawArgs.company}. Say so.` };
    }

    const held = (await peopleRepo.rateMap()).get(rows[0].person_id) ?? {};
    const person = { addon: Number(held.addon) || 0, fee: Number(held.fee) || 0 };

    // PER DEAL, because the effective rate differs per row once a deal
    // carries its own. One number for the person would be wrong the moment
    // it does.
    const deals = rows.map((r) => {
      const rate = ratesFor(r, new Map([[r.person_id, person]]), { cryptoPercent });
      return {
        company: r.company,
        group: r.group_name,
        method: r.payment_method,
        addonPercent: rate.addon,
        feePercent: rate.fee,
        cryptoPercent: rate.crypto,
        // The STACKED figures above are what applies. These two are the
        // deal's own half, which she may legitimately name on its own.
        dealAddonPercent: Number(r.addon_percent) || 0,
        dealFeePercent: Number(r.fee_percent) || 0,
      };
    });

    /**
     * ===============================
     * * THE ARITHMETIC, WORKED, not described
     * ===============================
     * "What does 5% on each deal actually mean" had no answer here: the
     * tool handed back the rates and the words ADDED and DEDUCTED, and the
     * order was left to a sentence at the bottom for her to apply herself.
     *
     * ORDER IS THE ARITHMETIC. 500 at 8% add on then 2% fee is 529.20, not
     * 529.00, because the fee comes off the amount PLUS what was added.
     * `amountWithRates` is the one definition of that, shared with the
     * breakdown and the totals, so what she says and what the export prints
     * cannot disagree.
     */
    /**
     * ===============================
     * * A STACKED RATE PRINTED AS THE DEAL'S OWN
     * ===============================
     * These are EFFECTIVE figures, person plus deal, and the heading said
     * so once at the top. Each line then read "Workforce in INDIGO: 5% add
     * on", so she said "their deal at INDIGO has a 5% add on" when that
     * deal carries 0% and the 5% is the person's. Live 2026-09-24, and
     * again one line down as "their deal at MILKMAN has an 8% add on"
     * where the deal held 3%.
     *
     * A heading is not a label. Every line now carries its own split, so
     * there is no figure here that can be read as belonging to one level
     * when it belongs to both.
     */
    const split = (total, own, label, direction) => `${label} ${total}% `
      + `(person ${label === 'add on' ? person.addon : person.fee}% + deal ${own}%) ${direction}`;

    const lines = deals.map((d, i) => {
      const parts = [
        split(d.addonPercent, d.dealAddonPercent, 'add on', 'added'),
        split(d.feePercent, d.dealFeePercent, 'fee', 'deducted'),
      ];
      if (d.cryptoPercent > 0) parts.push(`${d.cryptoPercent}% crypto (added)`);

      const sums = amountWithRates(rows[i], new Map([[rows[i].person_id, person]]), { cryptoPercent });
      // A row owed nothing this month has no arithmetic worth printing, and
      // "0 becomes 0" reads as a fault rather than as an explanation.
      const worked = sums.amount > 0
        // LABELLED PAYABLE. Unlabelled she called it "Monthly amount 2,000"
        // on a 1,250 monthly deal. 2026-09-30.
        ? `\n    payable this month ${amount2dp(sums.amount)} ${SIGN_WORD.add} ${amount2dp(sums.addon + sums.crypto)} added, `
          + `${SIGN_WORD.less} ${amount2dp(sums.fee)} fee, so ${amount2dp(sums.net)}`
        : '';
      return `  ${d.company} in ${d.group}: ${parts.join(', ')}${worked}`;
    });

    // ONLY WHERE IT APPLIES. It used to be appended to every answer, so she
    // told them about the crypto charge on a person paid entirely in cash.
    // Asked to stop she agreed, and could not: the tool handed it to her
    // again on the next turn. A promise is not a guard.
    const anyCrypto = deals.some((d) => d.cryptoPercent > 0);

    /**
     * ===============================
     * * THE RANGE, WORKED, so she does not derive one from the lines
     * ===============================
     * Live 2026-09-24. Asked about two people at once she summarised the
     * cards herself: "Nicola's deals range from 700 to 1,400" when the
     * lowest is 500, which was on the card she had just drawn.
     *
     * A tool that computes a figure hands back the finished sentence. The
     * count and the range are figures.
     *
     * PER CURRENCY, because they are never added: one person holds AED
     * and GBP rows and a single span across them means nothing.
     */
    const byCurrency = new Map();
    for (const r of rows) {
      const code = String(r.currency || 'GBP').trim().toUpperCase();
      // RATED, what they are paid: it said 700 to 900 for a 686 to 882 person. 2026-09-28.
      const amount = partsOf(Number(r.monthly_amount) || 0,
        ratesFor(r, new Map([[r.person_id, person]]), { cryptoPercent })).net;
      const seen = byCurrency.get(code) ?? { min: amount, max: amount };
      byCurrency.set(code, { min: Math.min(seen.min, amount), max: Math.max(seen.max, amount) });
    }
    const spans = [...byCurrency.entries()].map(([code, { min, max }]) => (
      min === max
        ? `${code} ${amount2dp(min)}`
        : `${code} ${amount2dp(min)} to ${amount2dp(max)}`
    ));
    const span = `They hold ${rows.length} deal${rows.length === 1 ? '' : 's'}, `
      + `${spans.join(' and ')} a month. Use those figures; do not work a range out of the lines.`;

    const name = rows[0].person_name;
    // A YES OR NO WAS ASKED, so the answer opens with one, worked in code.
    const asked = asksRateCheck(rawArgs.said);
    // Narrowed to a company, the verdict says so: it is about those deals only.
    const where = rawArgs.company ? ` at ${rawArgs.company}` : '';
    const verdict = asked
      ? rateVerdict({ name: `${displayPersonName(name)}${where}`, asked, person, deals })
      : null;
    return {
      verdict,
      // THE SENTENCE ONLY is word for word: told so of the whole block, she
      // read the directions below out too.
      summary: (verdict ? `OPEN YOUR ANSWER WITH THIS SENTENCE, word for word: "${verdict.line}" `
        + 'Then answer the rest in a line or two of your own.\n\n' : '')
        + `${span}\n\n${name} carries ${person.addon}% add on and ${person.fee}% fee on their PROFILE, `
        + 'which applies to every deal they hold. A rate on a DEAL stacks on top of it, never '
        + `replacing it.\n\nEffective per deal:\n${lines.join('\n')}\n\n`
        /**
         * SILENT, NOT TOLD TO BE SILENT. This used to end "None of their
         * deals is paid in coin, so do NOT mention the crypto charge at
         * all", and she said the first half of that sentence out loud to
         * an admin who had not asked. Live 2026-09-24.
         *
         * An instruction not to mention something, with the words
         * supplied, is prompting doing a guard's job. The words are not
         * supplied.
         */
        + (anyCrypto ? `${cryptoLine}\n\n` : '')
        + 'Say the figures exactly as above. EACH ONE IS PERSON PLUS DEAL: never call an '
        + 'effective figure the deal\'s own rate, and never call the person\'s rate the deal\'s. '
        + 'Add ons are applied first; the fee comes off the total after them.',
      person: { name, ...person },
      deals,
      cryptoPercent,
    };
  },
};

const activeCompaniesFor = {
  name: 'active_companies',
  description:
    "The ACTIVE COMPANY LIST for a group: each company with its director, mid, tier and old "
    + 'group. Use it for "show me the active companies", "which companies are in ALPHA", "which companies are live in ALPHA", '
    + '"who is the director on X", or anything about the company table rather than the deals. '
    + 'A company is live while ANY one of its deals is still in its payment period. ASK FOR THE '
    + 'GROUP if they have not said one: across every group this is thirty-odd companies and the '
    + 'answer is a list nobody can hold in their head.',
  parameters: {
    type: 'object',
    properties: {
      group: { type: 'string', description: 'One group, e.g. ALPHA. Ask for it before listing every group.' },
      month: { type: 'string', description: 'YYYY-MM. Narrows to companies with a deal marked for that month. Omit for all of them.' },
      months: {
        type: 'array',
        items: { type: 'string' },
        description: 'SEVERAL months, YYYY-MM each, when they asked about more than one. Use '
          + 'this INSTEAD of `month` and never one call per month: a company live in August may '
          + 'be gone in September, and one month\'s list is not the other\'s.',
      },
    },
  },
  async handler(args) {
    const months = monthsAsked(args);

    if (months.length > 1) {
      return answerEach({
        values: months,
        singular: 'month',
        plural: 'months',
        args,
        handler: activeCompaniesFor.handler,
        heading: monthName,
        mark: 'months',
        guidance: `${months.length} SEPARATE MONTHS, each listed on its own. Give EACH month its `
          + 'own list. Do NOT merge them into one list: a company on one and not the other is '
          + 'the answer, not a detail to tidy away. Say plainly which months differ.',
      });
    }

    // A GUESSED YEAR HERE ANSWERS "no companies", which reads as a fact
    // about the business rather than about the year she picked. Same rule
    // as the totals: see farOffMonth.
    const single = months.length === 1 ? months[0] : args.month;
    const wanted = isMonth(String(single ?? '')) ? single : undefined;
    const month = monthForRead(wanted, args.said);
    const [found, tiers, held] = await Promise.all([
      repo.findAll({ group: args.group, page: 1, pageSize: TOTAL_ROW_LIMIT }),
      companiesRepo.tierMap(),
      companiesRepo.findAllPlain(),
    ]);

    // The month narrows by the row's own PRESET, the same question the
    // master sheet asks. A company with no deal marked for that month is
    // not on that month's list.
    const rows = month ? found.rows.filter((r) => isForMonth(r, month)) : found.rows;
    if (rows.length === 0) {
      // The group may not exist at all, in which case "no companies" is a
      // statement about the business and not about the name they used.
      if (args.group) {
        const wrong = await notAGroup(args.group, args.said);
        if (wrong) return { summary: wrong };
      }
      return {
        summary: `No deals${args.group ? ` in ${args.group}` : ''}`
          + `${month ? ` marked for ${monthName(month)}` : ''}, so no companies. Say so plainly.`,
      };
    }

    const oldGroups = new Map(
      held.filter((c) => c.old_group).map((c) => [String(c.name).trim().toLowerCase(), c.old_group]),
    );
    const byName = new Map();
    for (const r of rows) {
      const key = String(r.company ?? '').trim().toLowerCase();
      if (key) byName.set(key, (byName.get(key) ?? 0) + 1);
    }

    const companies = activeCompanies(rows, tiers).map((c) => ({
      ...c,
      oldGroup: oldGroups.get(c.company.trim().toLowerCase()) ?? '',
      dealCount: byName.get(c.company.trim().toLowerCase()) ?? 0,
    }));

    if (companies.length === 0) {
      return {
        summary: `Every company${args.group ? ` in ${args.group}` : ''} has finished its payment `
          + 'period, so none are active. Say so, and offer to list them anyway.',
      };
    }

    const where = `${args.group ?? 'the whole sheet'}${month ? `, ${monthName(month)}` : ''}`;
    const lines = companies.map((c) => `  ${c.company} · ${c.tier || 'no tier'}`
      + ` · director ${c.director || 'not held'} · mid ${c.mid || 'not held'}`
      + `${c.oldGroup ? ` · old group ${c.oldGroup}` : ''}`);

    /**
     * ===============================
     * * THE EXCEPTIONS, COUNTED, so she cannot generalise over them
     * ===============================
     *
     * Asked how many companies there are she said "25 active companies,
     * EACH WITH A DIRECTOR AND ONE OR MORE MIDS". Two of the twenty five
     * hold neither, and both said "not held" in the list she was reading.
     *
     * "What they have in common" is an invitation to invent one, so the
     * count of what they do NOT have goes in the same breath. Same rule as
     * the filter's denominator: a count without its exceptions is the shape
     * she turns into a claim about all of them.
     */
    const noDirector = companies.filter((c) => !c.director).length;
    const noMid = companies.filter((c) => !c.mid).length;
    // She reads these aloud, so the verb has to agree with the number.
    const holds = (n) => `${n} ${n === 1 ? 'holds' : 'hold'}`;
    const gaps = [
      noDirector > 0 ? `${holds(noDirector)} NO director` : null,
      noMid > 0 ? `${holds(noMid)} NO mid` : null,
    ].filter(Boolean);

    // THE FINISHED SENTENCE, because "do not generalise" produced "each
    // with various directors and mids assigned", which is the same claim
    // in softer words. A rule she has to apply is a rule she can dodge.
    const careful = gaps.length > 0
      ? `\n\nNOT ALL OF THEM ARE THE SAME: ${gaps.join(' and ')}. SAY IT LIKE THIS, in your own `
        + `voice: "${companies.length} active companies, and ${gaps.join(', ')}." Do NOT say they `
        + 'each have a director or a mid, in any words. If you describe what they share, it has '
        + 'to be true of every single one.'
      : '';

    /**
     * ONE LIST, in the sheet check's format (his call 2026-09-30), rather
     * than a card per company, and past twelve rather than nothing drawn.
     */
    const ckey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const groupsOf = new Map();
    for (const r of rows) {
      const key = ckey(r.company);
      if (!key || !r.group_name) continue;
      if (!groupsOf.has(key)) groupsOf.set(key, new Set());
      groupsOf.get(key).add(r.group_name);
    }
    const count = `${companies.length} active ${companies.length === 1 ? 'company' : 'companies'}`;
    return {
      summary: `${count} in ${where}, ALREADY LISTED ON SCREEN with director, mid and tier. Do NOT `
        + 'read the list back. Say the COUNT and one sentence about them, then STOP.\n\n'
        + `For your reference only:\n${lines.join('\n')}${careful}`,
      list: {
        kind: 'companies',
        title: `${count} in ${where}`,
        rows: companies.map((c) => ({
          id: c.company,
          name: c.company,
          status: 'active',
          statusLabel: 'Active',
          groups: [...(groupsOf.get(ckey(c.company)) ?? [])].join(', '),
          dealsText: `${c.dealCount} ${c.dealCount === 1 ? 'deal' : 'deals'}, director ${c.director || 'not held'}, mid ${c.mid || 'not held'}`,
          amount: '',
          tier: c.tier ?? '',
          oldGroup: c.oldGroup ?? '',
          href: `/companies/${encodeURIComponent(ckey(c.company))}`,
        })),
      },
    };
  },
};

/**
 * ***************************************************
 * * A person's own profile
 * ***************************************************
 *
 * She could delete a person and not correct one. `tb_people` is thin on
 * purpose: display name, email, notes and two percentages. Everything else
 * about them belongs to their DEALS and is edited there.
 *
 * A PROFILE NAME IS NOT THE SHEET'S NAME, and this is the trap. The deals
 * carry `person_name` and the People page shows
 * COALESCE(profile name, the name on their deals), so setting a display
 * name changes what the CRM SHOWS and rewrites nothing on the master sheet.
 * The company rename is the opposite and does rewrite every row, so the two
 * must never be described in the same words.
 */

/**
 * "REPLACE OR ON TOP?" HELD WITH ITS TWO ANSWERS. Asked for Dov on 2%, "on top"
 * came back as 2% to 1% and a "yes" wrote it. 2026-09-25.
 */
const FEE_ASK_MS = 10 * 60 * 1000;
const ON_TOP = /\b(?:on top|top of|add(?:ed)? to it|stack|plus|both|extra)\b/i;
const REPLACE = /\b(?:replace\w*|instead|swap|change it to|just that)\b/i;
const feeAsk = {
  held: null,
  set(who, options) { this.held = { who: fold(who), options, at: Date.now() }; },
  answer(names, said) {
    const held = this.held;
    if (!held || Date.now() - held.at > FEE_ASK_MS) return null;
    if (!names.some((n) => held.who.includes(fold(n)) || fold(n).includes(held.who))) return null;
    const onTop = ON_TOP.test(String(said ?? ''));
    const replace = REPLACE.test(String(said ?? ''));
    if (onTop === replace) return null;
    this.held = null;
    return onTop ? held.options.onTop : held.options.replace;
  },
};

const updatePerson = {
  name: 'update_person',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    "Correct a person's own profile: the name the CRM shows for them, their email, notes, or "
    + `their add on or fee percentage. ${RATE_DIRECTIONS} Changing the display name only `
    + 'changes what the CRM shows; it does NOT '
    + 'rewrite their name on the master sheet rows, which is update_master_sheet_row per deal. '
    + 'It cannot create a person: somebody exists because a deal names them, so use add_deal.',
  parameters: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'ONE person, their name as the admin said it. Resolved here, so do NOT look up ids first.' },
      /**
       * ===============================
       * * SEVERAL PEOPLE, ONE ACT
       * ===============================
       * Two names was two calls, two pending summaries and two chances to
       * stop half way. It went wrong both ways in one session: she refused
       * to do both, then did both and only one was written. 2026-09-24.
       */
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'SEVERAL people in ONE act, each name as the admin said it. Use this whenever '
          + 'they name more than one person: it is one confirmation and one change, and every name '
          + 'is resolved before anything is written. Never send this AND person.',
      },
      // ADDED WITH THE RATE CONFIRM, and missed the first time: the guard
      // returned a pending summary for a tool whose schema had no way to
      // answer it, so `knownArgs` refused the confirmed call and she told
      // the admin it was done anyway. Live 2026-09-24.
      confirmed: { type: 'boolean', description: 'True only after they have agreed to a change this tool said was pending.' },
      group: { type: 'string', description: 'Narrow to one group, if they named one' },
      displayName: { type: 'string', description: 'What the CRM shows. Does not touch the master sheet rows.' },
      email: { type: 'string' },
      notes: { type: 'string' },
      addonPercent: { type: 'number', description: `0 to ${MAX_PERCENT}. ADDED on top of what the group sends us. 0 means none.` },
      feePercent: { type: 'number', description: `0 to ${MAX_PERCENT}. DEDUCTED from their total. 0 means none.` },
      // ===============================
      // * "ADD ANOTHER 3%" HAS ITS OWN ARGUMENT
      // ===============================
      // The two above are ABSOLUTE. Told "add 3%" on a profile holding 5%
      // she sent 3, which is a cut, and said "is now 3%" without ever
      // saying it had been 5%. Live 2026-09-24.
      addonPercentDelta: { type: 'number', description: 'ADD this to the add on they already have. Use it for "add another 3%", "3% more", "increase it by 3". Never work the new total out yourself from a figure you remember: send the increment and the tool reads the current value.' },
      feePercentDelta: { type: 'number', description: 'ADD this to the fee they already have. Negative takes it off. Same rule as addonPercentDelta.' },
    },
  },
  async handler(rawPersonArgs) {
    /**
     * "EVERYONE IN OTTER" IS THE OTTER DEALS, never their profiles. Live
     * 2026-10-03: "give everyone in otter a 2% add on" raised four PROFILES,
     * which also moved Kiran Vale's BAKER and CORVID deals. A group named
     * as the scope is a change to that group's deals.
     */
    const scopeSaid = String(rawPersonArgs?.said ?? '');
    const groupScope = /\b(?:everyone|everybody|all|each|every(?: deal| one)?)\b[^.?!]*\b(?:in|on|at)\s+([a-z][\w ]{1,30}?)(?:[.?!,]|\s+(?:a|an|to|by|with)\b|$)/i.exec(scopeSaid);
    if (groupScope && !/\b(?:profile|across (?:all|every) (?:his|her|their) deals)\b/i.test(scopeSaid)) {
      const named = groupScope[1].trim().toLowerCase();
      const groups = (await peopleRepo.filterOptions().catch(() => null))?.groups ?? [];
      const group = groups.find((g) => String(g).toLowerCase() === named);
      if (group) {
        return {
          summary: `NOTHING HAS BEEN CHANGED. They named the GROUP ${group}, so this is a change to the deals `
            + `in ${group}, not to anyone's profile (a profile rate reaches their deals in OTHER groups too). `
            + `Call bulk_update_master_sheet with group ${group} and the same change (addonPercentDelta or `
            + 'feePercentDelta inside `set` for "add N%").',
        };
      }
    }
    // READ THE REQUEST FIRST, like every other door. "add 5% to zayn
    // milkman" arrives here as one name that is a person AND a group.
    const args = await scopeArgs(rawPersonArgs, peopleRepo);
    const {
      person, people, group, confirmed, saidRecent, turn,
    } = args;
    // ONLY THE FIELDS THIS TOOL DECLARES. Listing the runtime's injected arguments
    // by hand missed the next one added; update_company read them back. 2026-09-28.
    const NOT_FIELDS = new Set(['person', 'people', 'group', 'confirmed']);
    const fields = Object.fromEntries(
      Object.keys(updatePerson.parameters.properties)
        .filter((k) => !NOT_FIELDS.has(k) && args[k] !== undefined && args[k] !== null)
        .map((k) => [k, args[k]]),
    );
    if (Object.keys(fields).length === 0) {
      return { summary: 'Nothing to change. Ask which of the name, email, notes, add on or fee they mean.' };
    }

    const asked = namesAsked(person, people);
    if (asked.error) return { summary: asked.error };
    // THEIR ANSWER to "replace or on top?" decides the rate, whatever she sent.
    const chosen = confirmed ? null : feeAsk.answer(asked.names, args.said);
    if (chosen) {
      for (const k of RATE_ARG_KEYS) delete fields[k];
      Object.assign(fields, chosen);
    }
    /**
     * A DISPLAY NAME IS ONE PERSON'S. Setting the same one on three people
     * would give three humans one name, which is not an edit anybody means.
     */
    if (asked.names.length > 1 && fields.displayName !== undefined) {
      return {
        summary: 'A display name belongs to ONE person, so it cannot be set on several at once. '
          + 'Say that and ask which one they mean.',
      };
    }
    // VALIDATED HERE TOO. This does not go through the route that guards it,
    // and a typo in a percentage lands in every export's breakdown.
    for (const [field, label] of [['addonPercent', 'An add on'], ['feePercent', 'A fee']]) {
      if (fields[field] === undefined) continue;
      const n = Number(fields[field]);
      if (!Number.isFinite(n) || n < 0 || n > MAX_PERCENT) {
        return { summary: `${label} percentage has to be between 0 and ${MAX_PERCENT}. Ask them again.` };
      }
      fields[field] = n;
    }

    /**
     * ===============================
     * * EVERY NAME RESOLVES BEFORE ANYTHING IS WRITTEN
     * ===============================
     * One unknown or ambiguous name stops the WHOLE act. A half applied
     * rate change is the failure this shape exists to remove, and the
     * admin cannot see which half ran.
     */
    const resolved = [];
    const missing = [];
    const unsure = [];
    // NO SENTENCE ACROSS A LIST, and a name must be part of the person's:
    // "Bram Quennell" became Orla Quennell, twice in one preview. 2026-09-25.
    const heard = saidFor(asked.names, args.said);
    const askedFor = new Map();
    for (const name of asked.names) {
      // eslint-disable-next-line no-await-in-loop
      const found = await repo.searchFuzzy({ q: name, group });
      // rowsForNames: the bulk tool's resolver, exits and all, shared.
      const hit = rowsForNames(found, [name], heard);
      if (hit.unclear.length > 0) { unsure.push({ name, names: hit.unclear[0].names }); continue; }
      if (hit.rows.length === 0) { missing.push(name); continue; }
      const id = String(hit.rows[0].person_id ?? '').trim();
      // TWO NAMES, ONE PERSON is not two changes: ask who the other one was.
      if (askedFor.has(id)) {
        return {
          summary: `"${askedFor.get(id)}" and "${name}" are both ${displayPersonName(hit.rows[0].person_name)}. `
            + 'NOTHING HAS BEEN CHANGED, for any of them. Say so and ask who the other person is.',
          ambiguous: true,
        };
      }
      askedFor.set(id, name);
      resolved.push(hit.rows);
    }

    if (unsure.length > 0) {
      const which = unsure
        .map((u) => `"${u.name}" is more than one person: ${u.names.join(', ')}`)
        .join('. ');
      return {
        summary: `${which}. NOTHING HAS BEEN CHANGED, for any of them. List them and ask which `
          + 'ONE, giving their names EXACTLY as written above. Change nothing yet.',
        ambiguous: true,
      };
    }
    if (missing.length > 0) {
      const only = missing.length === 1 && asked.names.length === 1
        ? await notAPerson(missing[0])
        : null;
      // WHO WAS FOUND, said: left out, she told them Orla was missing too.
      const found = resolved.map((rows) => displayPersonName(rows[0].person_name));
      return {
        summary: only ?? `Nobody on the sheet matches ${missing.map((m) => `"${m}"`).join(', ')}. `
          + (found.length > 0 ? `${listOf(found)} ${found.length === 1 ? 'was' : 'were'} found. ` : '')
          + 'NOTHING HAS BEEN CHANGED, for any of them. Say so plainly and ask them to check the '
          + 'spelling of the one that missed.',
      };
    }

    /**
     * ===============================
     * * A COMPANY NAMED IS THAT COMPANY'S DEALS, never the profile
     * ===============================
     * "Give everyone at ZZ Rate Co A a 5% fee" became a PROFILE fee on four
     * people, reaching 7 deals where 4 were on that company. 2026-09-25.
     * The same rule as the single deal tool: a named deal is the deal.
     */
    const rateAsked = Object.keys(fields).some((k) => RATE_ARG_KEYS.includes(k));
    const theirs = [...new Set(resolved.flat().map((r) => r.company).filter(Boolean))];
    const namedCompany = theirs.find((c) => fold(c).length > 2 && fold(args.said).includes(fold(c)));
    if (rateAsked && namedCompany && resolved.some((rows) => rows.some((r) => fold(r.company) !== fold(namedCompany)))) {
      return {
        summary: `NOTHING HAS BEEN CHANGED. They named ${namedCompany}, so this rate is for the DEALS on it, `
          + 'and a profile rate would also reach their deals on other companies. Call '
          + `bulk_update_master_sheet with company "${namedCompany}" instead.`,
      };
    }

    /**
     * ===============================
     * * A RATE IS READ BEFORE IT IS WRITTEN, NEVER REMEMBERED
     * ===============================
     * "Add 3%" on a profile holding 5% was written as 3 and reported as
     * "is now 3%". Live 2026-09-24, 160 AED out of a month in silence.
     *
     * The current values come off the row, so a delta has something real
     * to add to and the confirm has a FROM to name.
     *
     * ONE SET OF FIELDS PER PERSON. `settleRates` resolves a delta against
     * the person in front of it and writes the answer back into what it is
     * given, so a shared object would put the first person's new total on
     * everyone after them.
     */
    /**
     * AND A GROUP NAMED IS THAT DEAL TOO. "kiran baker fee 5%" became a
     * PROFILE fee, previewed as "their only deal" for somebody holding
     * three: the rows had been narrowed to BAKER first. 2026-09-29.
     */
    if (rateAsked && resolved.length === 1) {
      const known = (await peopleRepo.filterOptions().catch(() => null))?.groups ?? [];
      const namedGroup = groupsHeardIn(args.said, known)
        .find((g) => !fold(resolved[0][0]?.person_name).includes(fold(g)));
      const all = await repo.findByPersonId?.(String(resolved[0][0]?.person_id ?? ''))?.catch?.(() => null);
      const live = (all ?? []).filter((r) => !r.stopped_on);
      if (namedGroup && live.some((r) => fold(r.group_name) !== fold(namedGroup))) {
        return {
          summary: `NOTHING HAS BEEN CHANGED. They named ${namedGroup}, so this rate is for their DEAL in `
            + `${namedGroup}, and a profile rate would also reach their deals in other groups. Call `
            + `update_master_sheet_row with targetPerson and targetGroup "${namedGroup}" instead.`,
        };
      }
    }

    const plan = [];
    for (const rows of resolved) {
      const personId = String(rows[0].person_id ?? '').trim();
      // EVERY DEAL THEY HOLD, whatever the lookup was narrowed to: a profile
      // rate reaches all of them, and the preview says how many.
      // eslint-disable-next-line no-await-in-loop
      const reach = (await repo.findByPersonId?.(personId)?.catch?.(() => null))
        ?.filter((r) => !r.stopped_on).length || rows.length;
      // eslint-disable-next-line no-await-in-loop
      const held = await peopleRepo.findById?.(personId) ?? null;
      const current = {
        addonPercent: Number(held?.addon_percent ?? rows[0].person_addon_percent) || 0,
        feePercent: Number(held?.fee_percent ?? rows[0].person_fee_percent) || 0,
      };
      const mine = { ...fields };
      /**
       * ===============================
       * * AND IT TAKES THE TWO CALL SHAPE, because it moves every total
       * ===============================
       * A profile rate reaches EVERY deal the person holds. The preview
       * names the level, the from and the to, which is the sentence the
       * admin refuses: "PROFILE add on 5% to 3%".
       */
      const settled = settleRates({
        fields: mine,
        current,
        said: args.said,
        max: MAX_PERCENT,
        level: 'profile',
        who: displayPersonName(rows[0].person_name),
        deals: reach,
        /**
         * THE OTHER LEVEL. A profile write's counterpart is the DEALS' own
         * rates, and they differ per row, so the highest one is named: if
         * any deal carries a rate, "back to" has somewhere else it could
         * mean. See rateChange.js.
         */
        other: {
          addonPercent: Math.max(...rows.map((r) => Number(r.addon_percent) || 0), 0),
          feePercent: Math.max(...rows.map((r) => Number(r.fee_percent) || 0), 0),
        },
      });
      if (settled.error) {
        if (settled.feeAsk) feeAsk.set(rows[0].person_name, settled.feeAsk);
        return { summary: `NOTHING HAS BEEN CHANGED. ${settled.error}` };
      }
      /**
       * ===============================
       * * ALREADY ON IT IS NOT A CHANGE, AND MUST STILL BE SAID
       * ===============================
       * `rateChangeLines` drops a rate that is already the value asked for,
       * so a person in a list of three who is on 5% already produced no
       * line: the preview named two people where three were asked about,
       * and the admin cannot see who was left out. Found by its own test.
       *
       * Only where the whole write is RATES. An email or a note produces no
       * line either and is a real change.
       */
      const rateOnly = Object.keys(mine).every((k) => RATE_FIELD_KEYS.has(k));
      plan.push({
        personId,
        name: displayPersonName(rows[0].person_name),
        fields: mine,
        asFee: settled.asFee,
        lines: settled.lines,
        deals: rows.length,
        noChange: rateOnly && settled.lines.length === 0,
      });
    }

    const changing = plan.filter((p) => !p.noChange);
    const already = plan.filter((p) => p.noChange);
    if (changing.length === 0) {
      return {
        summary: `${already.map((p) => p.name).join(', ')}: already on those rates, so there is `
          + 'nothing to change. NOTHING HAS BEEN CHANGED. Say so plainly in one sentence.',
      };
    }

    const lines = [
      ...changing.flatMap((p) => p.lines),
      // NAMED, not dropped. A list of three that previews two reads as a
      // change to two people and nobody can see which one was left out.
      ...already.map((p) => `${p.name}: already on those rates, nothing to change`),
    ];
    if (lines.length > 0) {
      const pending = confirmFirst(confirmed, {
        act: 'change a rate that reaches every deal they hold',
        // The deals it TOUCHES. A person who is already on the rate is
        // named above and none of their deals move.
        count: changing.reduce((n, p) => n + p.deals, 0),
        keeps: 'Rates on the DEALS themselves are not touched, and they STACK with this one.',
        lines,
      });
      // "Take 1% off" shown as a fee is REMEMBERED as that fee: replayed on
      // "yes" as the minus she sent, it cut the add on instead. 2026-09-25.
      const asFee = plan.find((p) => p.asFee != null)?.asFee;
      const replayRates = chosen ?? (asFee != null ? { feePercent: asFee } : null);
      if (pending && replayRates) {
        const kept = Object.fromEntries(Object.entries(fields).filter(([k]) => !RATE_ARG_KEYS.includes(k)));
        // THEIR CHOICE SAID PLAINLY, figure included: her "1% on top" was
        // refused as a rate no tool gave, and the preview came back muddled. 2026-09-25.
        const choiceLine = chosen?.feePercentDelta != null
          ? `${chosen.feePercentDelta}% goes on top of the fee they already pay.\n\n`
          : chosen ? `${chosen.feePercent}% replaces the fee they pay now.\n\n` : '';
        return {
          ...pending,
          summary: `${choiceLine}${pending.summary}`,
          redirect: {
            name: 'update_person',
            args: { ...(person ? { person } : {}), ...(people ? { people } : {}), ...(group ? { group } : {}), ...kept, ...replayRates },
          },
        };
      }
      if (pending) return pending;
    }

    const saved = [];
    // ONE ACT, ONE BATCH, so "undo that" puts every person back in one press.
    const stamp = { via: 'diane', batchId: randomUUID() };
    for (const one of changing) {
      // eslint-disable-next-line no-await-in-loop
      const out = await peopleRepo.upsert({ personId: one.personId, ...one.fields }, stamp);
      saved.push({
        ...one,
        shown: out?.display_name || one.name,
        rates: { addonPercent: Number(out?.addon_percent) || 0, feePercent: Number(out?.fee_percent) || 0 },
      });
      broadcast(null, 'people:changed', { action: 'updated', personId: one.personId, via: 'agent' });
    }
    // Both rates feed every export's breakdown, so the sheet's views go
    // too. Read off the PLAN: a delta has been resolved into an absolute
    // there, and `fields` still carries it as the increment it arrived as.
    if (changing.some((p) => p.fields.feePercent !== undefined || p.fields.addonPercent !== undefined)) {
      broadcast(null, 'master-sheet:changed', { action: 'rate-changed', via: 'agent' });
    }

    const changes = (of) => Object.entries(of)
      .map(([k, v]) => (k === 'feePercent' || k === 'addonPercent'
        ? `${k === 'feePercent' ? 'fee' : 'add on'} to ${v}%`
        : `${k === 'displayName' ? 'name' : k} to ${v === '' ? 'nothing' : `"${v}"`}`))
      .join(', ');
    // THE REACH, per person: without it she guessed, and said 3 for a person on 1.
    const reach = (n) => ` (${n === 1 ? 'their only deal' : `all ${n} of their deals`})`;
    // A rate done says FROM and TO, as its preview did: "fee to 1%" let her
    // say "fee reduced by 1%" and nothing could tell. 2026-09-25.
    const doneLine = (p) => {
      const rates = p.lines.map((l) => l.slice(l.lastIndexOf(': ') + 2));
      const others = Object.fromEntries(Object.entries(p.fields).filter(([k]) => !RATE_FIELD_KEYS.has(k)));
      return [...rates, changes(others)].filter(Boolean).join(', ');
    };
    return {
      // WHAT EACH PROFILE NOW HOLDS, as data: a rate only in prose could not
      // be checked by kind, so her correct "2% add on" was refused. 2026-09-25.
      people: saved.map((p) => ({ name: p.shown, ...p.rates })),
      summary: `${saved.map((p) => `${p.shown}: ${doneLine(p)}${reach(p.deals)}.`).join(' ')} `
        + (already.length > 0
          ? `${already.map((p) => p.name).join(', ')}: already on those rates, unchanged. `
          : '')
        + (saved.length > 1
          ? `All ${saved.length} are done. Say what changed in one short sentence and NAME EVERY `
            + 'ONE of them: leaving a name out reads as that person being missed.'
          : 'Say what changed in one short sentence.')
        + (fields.displayName !== undefined
          ? ' This is the name the CRM shows. Their master sheet rows still carry the old one, so '
            + 'say that if it matters to them.'
          : ''),
    };
  },
};

/**
 * ***************************************************
 * * Correcting a company, never inventing one
 * ***************************************************
 *
 * She could DELETE a company and not fix one, which is the wrong half:
 * renaming is the Companies page's actual job, "assigning and cleaning the
 * datas" in the boss's own words.
 *
 * RENAMING IS THE MERGE. The grouping key is the folded name, so renaming
 * "Relia Pa" to "Relia PA" makes both spellings one company and carries the
 * correction onto every deal that named it. That is a large consequence for
 * one sentence, so it is confirmed first.
 *
 * SHE CANNOT CREATE ONE. A company exists because a deal names it, so
 * creating one always means creating a deal underneath: that is add_deal.
 * A bare company row nothing points at is how the list grows names that
 * mean nothing.
 */
const renameCompany = {
  name: 'rename_company',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    'Correct a company\'s spelling everywhere at once. This is also how two spellings become one '
    + 'company: renaming "Relia Pa" to "Relia PA" merges them, because every deal carrying either '
    + 'is rewritten to the new name. Use when the admin says rename, fix the spelling, or that two '
    + 'entries are the same company. ALWAYS confirm first, saying the old name, the new name and '
    + 'how many deals it touches. It cannot create a company: a company exists because a deal '
    + 'names it, so use add_deal for one that is not there.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The company as it is spelled now.' },
      newName: { type: 'string', description: 'The spelling it should have everywhere.' },
      confirmed: { type: 'boolean', description: 'Only on the SECOND call, after the admin agreed.' },
    },
    required: ['name', 'newName'],
  },
  async handler(args) {
    const from = String(args.name ?? '').trim();
    const to = String(args.newName ?? '').trim();
    if (!to) return { summary: 'A company name cannot be empty. Ask what it should be called.' };
    // EXACT, never folded. A case-only rename is the commonest real one:
    // "Relia Pa" to "Relia PA" is how two spellings become one company, and
    // comparing them lowercased refused exactly that.
    if (from === to) {
      return { summary: `"${from}" is already spelled that way. Say so; nothing was changed.` };
    }

    // IT REWRITES EVERY DEAL CARRYING THE NAME, and renaming onto an
    // existing spelling MERGES two companies. Both are too wide to do on
    // one call, whatever the description used to promise.
    const carrying = await repo.findAll({ company: from, page: 1, pageSize: TOTAL_ROW_LIMIT });
    /**
     * ===============================
     * * A NAME NOTHING CARRIES IS USUALLY A TYPO
     * ===============================
     * Audit 2026-09-30: "rename Acqa to Acqua Ltd" previewed a rename of 0
     * deals, which a yes would have written as a new company row nothing
     * points at. No deal and no company row means the name is not real, so
     * it gets the same "did you mean" as every company read.
     */
    if (countOf(carrying) === 0
      && !(await companiesRepo.findByKey(from.replace(/\s+/g, ' ').toLowerCase()))) {
      const wrong = await notACompany(from, args.said);
      if (wrong) return { summary: `NOTHING HAS BEEN CHANGED. ${wrong}` };
    }
    const merges = await repo.findAll({ company: to, page: 1, pageSize: 1 });
    const pending = confirmFirst(args.confirmed, {
      act: `rename the company "${from}" to "${to}"`,
      count: countOf(carrying),
      keeps: countOf(merges) > 0
        ? `"${to}" ALREADY EXISTS, so this MERGES the two into one company. Say that outright.`
        : 'Every amount, role and handler on those deals is unchanged.',
    });
    if (pending) return pending;

    const result = await companiesRepo.rename(from, to);
    broadcast(null, 'companies:changed', { action: 'renamed', company: to, via: 'agent' });
    broadcast(null, 'master-sheet:changed', { action: 'renamed', company: to, via: 'agent' });
    broadcast(null, 'people:changed', { action: 'renamed', via: 'agent' });
    return {
      summary: `Renamed "${from}" to "${result.renamed}", and ${result.dealsUpdated} `
        + `${result.dealsUpdated === 1 ? 'deal now carries' : 'deals now carry'} the new name. `
        + 'Say the old name, the new one and the count in one sentence. If it was 0 deals, say '
        + 'that too: the company row was renamed but nothing pointed at the old spelling.',
    };
  },
};

const updateCompany = {
  name: 'update_company',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    'Change what the CRM holds ABOUT a company: its tier (the boss\'s "Status" column, free text '
    + 'like T2, TBC, Top co), its old group (his own earlier naming, Milky or Wallaby 1, never one '
    + 'of our groups), its notes, its liquidation total (the agreed settlement figure), or its '
    + 'status. Closing is how a company is retired, and it is reversible. Use rename_company to '
    + 'change its NAME, and bulk_close_companies for several companies at once.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The company, as spelled on the rows.' },
      tier: { type: 'string', description: 'Free text, as the sheet writes it. Empty string clears it back to "nobody has said".' },
      oldGroup: { type: 'string', description: "His own earlier group name. NOT one of our groups. Empty string clears it." },
      notes: { type: 'string' },
      /**
       * ===============================
       * * THE ENUM IS THE REPO'S, never a copy of it
       * ===============================
       * Audit 2026-09-30: four values written out here while the repo had
       * six, so "put Acqua on monthly review" had no argument to send and
       * going concern could only be set on the page. list_companies has
       * read the list off COMPANY_STATUS since review was added; this
       * does the same, so the next status reaches both at once.
       */
      status: {
        type: 'string',
        enum: Object.values(companiesRepo.COMPANY_STATUS),
        description: 'active is trading. going_concern is trading with no end date, paid exactly '
          + 'like active. review is STILL PAYING and asked about every month. liquidation is '
          + 'winding down and STILL PAYING, at amounts set per deal. closed and dissolved both END '
          + 'it and stop every deal on it. Only closed and dissolved stop anything.',
      },
      /**
       * THE SETTLEMENT, which the repo and undo held and she could not set.
       * A string, because '' is the clear: "nobody has agreed a number" is
       * a different fact from zero. Added 2026-09-30.
       */
      liquidationTotal: {
        type: 'string',
        description: 'The agreed liquidation settlement for the WHOLE company, as a plain number '
          + 'like 12500. Empty string clears it. It changes NO deal\'s amount. Always previewed first.',
      },
      confirmed: {
        type: 'boolean',
        description: 'Needed to close or dissolve, and to set a liquidation total. False first, '
          + 'true after they agree.',
      },
    },
    required: ['name'],
  },
  async handler(args) {
    const { name, confirmed } = args;
    // ONLY THE FIELDS THIS TOOL DECLARES. Every other key was taken as one, so the
    // runtime's said, saidRecent, turn and onProgress were read back as changes. 2026-09-28.
    const editable = Object.keys(updateCompany.parameters.properties).filter((k) => k !== 'name' && k !== 'confirmed');
    // Undefined is "not mentioned"; an empty string is "clear it". Both are
    // real, and the repo keeps them apart, so only drop what was absent.
    const fields = Object.fromEntries(
      editable.filter((k) => args[k] !== undefined && args[k] !== null).map((k) => [k, args[k]]),
    );
    // An undo of a LOGGED detail is the undo tool's. A status is not logged, so reopening stays here.
    const logged = Object.keys(fields).some((k) => COMPANY_LOGGED_FIELD[k]);
    if (logged && fields.status === undefined && asksUndo(undoSentence(args))) return { summary: USE_UNDO };
    if (Object.keys(fields).length === 0) {
      return { summary: 'Nothing to change. Ask which of tier, old group, notes, liquidation total or status they mean.' };
    }
    // A FIGURE OR THE CLEAR, nothing else. "about 12k" written into a
    // numeric column fails in SQL after the preview promised it.
    if (fields.liquidationTotal !== undefined) {
      const raw = String(fields.liquidationTotal).replace(/[,\s]/g, '');
      const n = Number(raw);
      if (raw !== '' && (!Number.isFinite(n) || n < 0)) {
        return {
          summary: `NOTHING HAS BEEN CHANGED. "${fields.liquidationTotal}" is not an amount. Ask for `
            + 'the liquidation total as a plain number.',
        };
      }
      fields.liquidationTotal = raw === '' ? '' : String(n);
    }

    /**
     * A STATUS NOBODY ASKED FOR. "Set the liquidation total for Pinecrest to
     * 12,500" also put Pinecrest INTO liquidation: the word was in the
     * sentence, as part of "liquidation total". A status changes only when
     * their words name one. 2026-09-30.
     */
    if (fields.status !== undefined && args.said !== undefined) {
      const heard = `${args.said ?? ''}\n${args.saidRecent ?? ''}`.replace(/liquidation\s+total/gi, '');
      const STATUS_SAID = {
        active: /\b(?:active|reopen|re-open|open it|back on)\b/i,
        going_concern: /\bgoing\s+concern\b/i,
        liquidation: /\bliquidat\w*/i,
        review: /\breview\w*/i,
        dissolved: /\bdissolv\w*/i,
        closed: /\bclos\w*|\bshut\b/i,
      };
      if (STATUS_SAID[fields.status] && !STATUS_SAID[fields.status].test(heard)) {
        return {
          summary: `NOTHING HAS BEEN CHANGED. They never asked to change ${name}'s status to `
            + `${fields.status}. Call this again WITHOUT status, with only what they asked for.`,
        };
      }
    }

    const ckey = String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

    /**
     * ===============================
     * * CLOSING A COMPANY STOPS EVERY DEAL ON IT, AND THIS ASKED NOTHING
     * ===============================
     * Its only guard was the words "Confirm before closing" in a parameter
     * description, which is the exact shape `confirmFirst` exists to
     * replace: PROMPTING IS NOT A GUARD, least of all about money.
     *
     * And it called the repo DIRECTLY, so the cascade in the PATCH route
     * never ran: closing on the page stopped everybody and closing by
     * asking her stopped nobody. Both fixed 2026-09-17, one definition in
     * shared/companyStatus.helper.js.
     *
     * ONLY ON THE WAY IN. Liquidation and active stop nothing, and a
     * company already closed being given a note must not re-ask about a
     * cascade that already happened.
     */
    const before = await companiesRepo.findByKey(ckey);
    if (!before) {
      // A TYPO GETS "DID YOU MEAN". Flat "No company called Acqa" was the
      // answer one letter from Acqua. Audit 2026-09-30.
      const wrong = await notACompany(name, args.said);
      return { summary: wrong ? `NOTHING HAS BEEN CHANGED. ${wrong}` : `No company called "${name}".` };
    }

    /**
     * ===============================
     * * WHICH STATUSES ASK FIRST
     * ===============================
     * Only an ENDING, on the way in. going_concern and review stop nothing,
     * exactly like liquidation and active, so they write straight away: a
     * confirm on a harmless change is the click that teaches people not to
     * read them. Any of the four on a CLOSED company reopens it, which the
     * cascade does and the reply reports, as setting it active always has.
     */
    const ending = fields.status !== undefined
      && companiesRepo.isTerminal(fields.status)
      && !companiesRepo.isTerminal(before.status);

    const acts = [];
    const keeps = [];
    if (ending) {
      const ahead = await wouldStop(before.name);
      acts.push(`${fields.status === 'dissolved' ? 'dissolve' : 'close'} ${before.name} and STOP `
        + `${ahead.count} live ${ahead.count === 1 ? 'deal' : 'deals'} on it, `
        + `${ahead.currency} ${Number(ahead.money).toLocaleString('en-GB', {
          minimumFractionDigits: 2, maximumFractionDigits: 2,
        })} a month`);
      keeps.push('Every row is kept and moves to the Archive. Months already paid are untouched, '
        + 'and setting it back to active brings the deals back together.');
    }
    /**
     * ===============================
     * * A SETTLEMENT FIGURE IS PREVIEWED, and says what it does NOT do
     * ===============================
     * Added 2026-09-30. The figure is the company's agreed total and
     * nothing reads it into a deal: every deal keeps its own monthly
     * amount (docs/closure.md section 6). Said before the write, because
     * "set the liquidation total to 12,500" sounds like it cuts somebody's
     * pay, and a yes given on that belief is a yes to something else.
     */
    if (fields.liquidationTotal !== undefined) {
      const currencies = Object.keys(before.monthly_totals ?? {});
      const unit = currencies.length === 1 ? `${currencies[0]} ` : '';
      const was = before.liquidation_total != null ? `${unit}${amount2dp(before.liquidation_total)}` : 'nothing agreed';
      acts.push(fields.liquidationTotal === ''
        ? `clear ${before.name}'s liquidation total (now ${was})`
        : `set ${before.name}'s liquidation total to ${unit}${amount2dp(fields.liquidationTotal)} (now ${was})`);
      keeps.push('It does NOT change any per deal amount: every deal on it keeps its own monthly '
        + 'amount, and a reduced amount is set on the deal itself.');
    }
    if (acts.length > 0) {
      const pending = confirmFirst(confirmed, {
        act: acts.join(', and '),
        count: 1,
        noun: 'company',
        plural: 'companies',
        keeps: keeps.join(' '),
      });
      if (pending) return pending;
    }

    // Logged as hers, so History and undo say who changed it.
    const { company, deals, reviewQueueChanged } = await applyCompanyStatus(ckey, { ...fields, via: 'diane' });
    if (!company) return { summary: `No company called "${name}".` };

    broadcast(null, 'companies:changed', { action: 'updated', company: company.name, via: 'agent' });
    // `reviewQueueChanged` too: liquidation moves the review queue without
    // changing a single row, so `deals` alone left the Review button stale.
    if (deals || reviewQueueChanged) {
      broadcast(null, 'master-sheet:changed', { action: 'company-status', key: ckey });
    }

    const FIELD_WORD = { oldGroup: 'old group', liquidationTotal: 'liquidation total' };
    const what = Object.entries(fields)
      .map(([k, v]) => `${FIELD_WORD[k] ?? k} to ${v === '' ? 'nothing' : `"${v}"`}`)
      .join(', ');
    // WHAT IT DID TO THE DEALS, because that is the part nobody can see
    // from the sentence "status to closed".
    const moved = deals?.stopped?.length
      ? ` ${deals.stopped.length} deal${deals.stopped.length === 1 ? '' : 's'} stopped and moved to the Archive.`
      : (deals?.resumed?.length
        ? ` ${deals.resumed.length} deal${deals.resumed.length === 1 ? '' : 's'} came back onto the master sheet.`
        : '');
    /**
     * REVIEW AND LIQUIDATION TICK NO DEAL. Which of a company's deals are
     * reviewed monthly is chosen per deal on its status screen (the repo's
     * REVIEWED_MONTHLY), and she has no checklist, so she must not let
     * "put it on review" sound like every deal joined the queue.
     */
    const entersReview = reviewQueueChanged && companiesRepo.isReviewedMonthly(fields.status) === true;
    const reviewNote = entersReview
      ? ' No deal was ticked for the monthly review: that is chosen per deal on the company\'s status screen, so say so.'
      : '';
    const settled = fields.liquidationTotal !== undefined ? ' No deal\'s amount changed.' : '';
    return {
      summary: `${company.name}: ${what}.${moved}${settled}${reviewNote} Say what changed in one short sentence`
        + `${moved ? ', and say how many deals moved' : ''}.`,
    };
  },
};

/**
 * ***************************************************
 * * Concerns, and undoing a change
 * ***************************************************
 *
 * BOTH ARE ANSWERS, NEVER OFFERS. She reaches for these when asked and not
 * otherwise: nobody wants "by the way, there are four open concerns" in the
 * middle of a question about an amount, and an undo she suggests is an undo
 * somebody did not ask for.
 */
const listConcerns = {
  name: 'list_concerns',
  description:
    'What people have raised through WhatsApp, newest first. ONLY when the admin asks: "are there '
    + 'any concerns", "anything to review", "has anyone raised anything", "what is open". Never '
    + 'bring it up unprompted and never mention it while answering something else.',
  parameters: {
    type: 'object',
    properties: {
      group: { type: 'string', description: 'One group, if they named one' },
      status: pluralFilter({
        type: 'string',
        enum: ['open', 'in_progress', 'resolved'],
        description: 'Defaults to open, which is what "anything to review" means.',
      }),
    },
  },
  async handler(args) {
    const allowed = ['open', 'in_progress', 'resolved'];
    const statuses = Array.isArray(args.status)
      ? [...new Set(args.status.filter((value) => allowed.includes(value)))]
      : [];
    const status = statuses.length > 0
      ? statuses
      : (allowed.includes(args.status) ? args.status : 'open');
    const statusWords = Array.isArray(status) ? status.join(' or ') : status;
    const { rows, total } = await concernsRepo.listGrouped({
      status, groupName: args.group, limit: CONCERN_LIMIT, offset: 0,
    });
    if (rows.length === 0) {
      // "Nothing open in X" is a reassurance, and reassuring somebody about
      // a group that does not exist is the worst version of this answer.
      if (args.group) {
        const wrong = await notAGroup(args.group, args.said);
        if (wrong) return { summary: wrong };
      }
      return {
        summary: `Nothing ${statusWords}${args.group ? ` in ${args.group}` : ''}. Say so in one short `
          + 'sentence. Do not offer to look at anything else.',
      };
    }
    const lines = rows.map((r) => `  ${r.person_name || r.person_id} · ${r.group_name} · `
      + `${r.concern_count} ${r.concern_count === 1 ? 'flag' : 'flags'} · ${r.latest_category || 'no category'}: `
      + `"${String(r.latest_message ?? '').slice(0, 140)}"`);
    return {
      summary: `${total} ${total === 1 ? 'person has' : 'people have'} something ${statusWords}`
        + `${args.group ? ` in ${args.group}` : ''}`
        + `${rows.length < total ? `, the ${rows.length} most recent listed` : ''}:\n\n${lines.join('\n')}\n\n`
        + 'Say the COUNT and who, in one sentence. Read a message out only if they ask for it. '
        + 'You cannot resolve these; that is done on the Concerns page.',
    };
  },
};

/**
 * ===============================
 * * PUTTING A WHOLE MASS EDIT BACK
 * ===============================
 *
 * 96 rows undone one id at a time is 96 confirmations, so in practice a
 * bulk update had no way back. The batch is recovered from the log by the
 * repo; this decides nothing about which rows belong to it.
 *
 * IT NAMES THE BATCH BEFORE IT TOUCHES IT, same as the single undo, and
 * for the same incident: an id is the one argument she cannot check, and a
 * batch multiplies whatever the id got wrong by a hundred.
 */
// Only this reaches an undo itself; "undo that" after an undo offered the undo again. 2026-09-25.
const REDO = /\b(?:redo|undo (?:the|that|my) undo|put (?:it|that) back again)\b/i;

/**
 * ===============================
 * * "UNDO THE FEE CHANGE" IS THE FEE CHANGE
 * ===============================
 * Live 2026-10-03: asked to undo a fee change on six NEXUS deals, the
 * preview said "fee 5% back to 0%", and the yes reverted the 1 October
 * month roll on the same six people. Nothing looked at the field asked for.
 */
/**
 * "Who's getting the most", "top 3 in usd", "smallest earners": the number
 * of places, signed: negative ranks from the least. Null when not a ranking.
 */
const RANK_WORDS = /\b(?:who(?:'s| is| are|s)?|which (?:person|people|one)|top|biggest|highest|largest|most|least|lowest|smallest)\b/i;
const RANK_SUPERLATIVE = /\b(?:top\s*\d+|most|highest|biggest|largest|least|lowest|smallest|bottom\s*\d+)\b/i;
const MONEY_WORDS = /\b(?:owed|paid|money|earn\w*|getting|gets|make|makes|income|pay|usd|gbp|aed)\b/i;
function rankAskedIn(said) {
  const text = String(said ?? '');
  if (!RANK_WORDS.test(text) || !RANK_SUPERLATIVE.test(text) || !MONEY_WORDS.test(text)) return null;
  if (/\bmost recent\b/i.test(text)) return null;
  // "the smallest DEAL" orders deals, not people: see sortBy on the filter.
  if (/\bdeals?\b/i.test(text) && !/\b(?:owed|earners?)\b/i.test(text)) return null;
  const n = Number((/\b(?:top|bottom)\s*(\d+)\b/i.exec(text) ?? /\b(\d+)\s+(?:biggest|highest|largest|smallest|lowest|people|earners)\b/i.exec(text) ?? [])[1]) || 5;
  return /\b(?:least|lowest|smallest|bottom)\b/i.test(text) ? -n : n;
}

const UNDO_FIELD_WORDS = [
  // A person's rate is logged under its own name: both count as "the fee".
  [/\bfees?\b/i, 'feePercent'],
  [/\bfees?\b/i, 'personFeePercent'],
  [/\badd[\s-]?ons?\b/i, 'addonPercent'],
  [/\badd[\s-]?ons?\b/i, 'personAddonPercent'],
  [/\bmonthl(?:y|ies)\b/i, 'monthlyAmount'],
  [/\bpayable days\b/i, 'payableDays'],
  [/\bpayable(?: amount)?\b(?! days)/i, 'payableAmount'],
  [/\bpresets?\b/i, 'presetOn'],
  [/\bend(?:ing)? dates?\b/i, 'endOn'],
  [/\bpayment start\b/i, 'paymentStartOn'],
  [/\bcurrenc(?:y|ies)\b/i, 'currency'],
];
const undoFieldsAsked = (said) => new Set(UNDO_FIELD_WORDS
  .filter(([pattern]) => pattern.test(String(said ?? ''))).map(([, field]) => field));

// A WHOLE name, not letters that happen to run together once every space is
// folded away: "Abe, Dewell" folds into a run that held other people's names.
const namesPerson = (text, person) => Boolean(person) && new RegExp(
  `(?:^|[^a-z0-9])${String(person).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`,
).test(String(text ?? '').toLowerCase());

/**
 * ===============================
 * * THE YES UNDOES WHAT THE PREVIEW SHOWED
 * ===============================
 * The batch used to be chosen again from scratch on the confirmed call,
 * off a `priorAnswer` that had changed in between. So what the admin agreed
 * to and what was put back could differ. The preview pins its change ids
 * here and the confirmed call reverts exactly those, or refuses.
 *
 * In memory and short lived on purpose: a pin is only good for the yes
 * that follows it, and a restart asks again rather than guessing.
 */
const UNDO_PIN_MS = 15 * 60 * 1000;
let undoPin = null;

// "the last 2 changes", "past three updates", "previous 2 edits".
const LAST_N = /\b(?:last|past|previous|recent)\s+(\d+|two|three|four|five)\s+(?:changes?|updates?|edits?|things?)\b/i;
const WORD_N = { two: 2, three: 3, four: 4, five: 5 };

async function undoLast(args, count) {
  const every = await repo.findChangeBatches({ hours: UNDO_HOURS });
  // THE PERSON THEY NAMED, even when she left `people` out: "the past 2
  // updates made for zayn" must never undo somebody else's two.
  let names = (args.people ?? []).filter(Boolean);
  if (names.length === 0) {
    const said = undoSentence(args);
    names = [...new Set(every.flatMap((b) => (b.changes ?? []).map((c) => c.person)).filter(Boolean))]
      .filter((p) => namedIn(said, p));
  }
  const theirs = (b) => (b.changes ?? []).filter((c) => repo.isUndoableField(c.field) && (names.length === 0
    || names.some((nm) => fold(c.person).includes(fold(nm)) || fold(nm).includes(fold(c.person)))));
  const picked = every.filter((b) => !b.undoes && b.deals > 0 && theirs(b).length > 0).slice(0, count);
  // Their names as the sheet spells them, not as they were typed.
  const real = [...new Set(picked.flatMap((b) => theirs(b).map((c) => c.person)).filter(Boolean))];
  const who = names.length ? ` for ${listOf(real.length ? real : names)}` : '';
  if (picked.length === 0) {
    return { summary: `Nothing${who} in the last ${UNDO_HOURS / 24} days is left to undo. NOTHING was put back. Say so plainly.` };
  }
  // Each change WITH its figures, newest first: "payable amount 4,100 → 3,950".
  const fmt = (v) => (v == null || v === '' ? 'blank' : Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-GB') : String(v));
  const label = (b) => {
    const fields = [...new Set(theirs(b).map((c) => c.field))];
    return listOf(fields.map((f) => {
      const v = (b.field_values ?? []).find((x) => x.field === f);
      const name = FIELD_LABELS[f] ?? f;
      return v ? `${name} ${fmt(v.value)} back to ${fmt(v.was)}` : name;
    }));
  };
  const ids = picked.flatMap((b) => theirs(b).map((c) => c.id));
  const deals = new Set(picked.flatMap((b) => theirs(b).map((c) => c.rowId))).size;
  const short = picked.length < count ? ` Only ${picked.length} ${picked.length === 1 ? 'change is' : 'changes are'} left to undo${who}, so that is all this reaches.` : '';
  const pending = confirmFirst(args.confirmed, {
    act: `undo the last ${picked.length} changes${who}, newest first`,
    lines: picked.map((b) => `${label(b)}`),
    count: deals,
    noun: 'deal',
    keeps: `NAME EACH CHANGE (the field) and the person when you ask.${short}`,
  });
  if (pending) return pending;
  const { done, failed } = await repo.revertChangeBatch(ids, null, { via: 'diane', batchId: randomUUID() });
  broadcast(null, 'master-sheet:changed', { action: 'reverted', via: 'agent' });
  broadcast(null, 'people:changed', { action: 'reverted' });
  broadcast(null, 'companies:changed', { action: 'reverted' });
  if (failed.length > 0) {
    return {
      summary: `${done.length} of ${ids.length} changes went back, and ${failed.length} DID NOT: `
        + `${failed.map((f) => `#${f.id} (${f.reason})`).join(', ')}. Say both numbers and do NOT report this as done.`,
    };
  }
  return {
    summary: `Put back. The last ${picked.length} changes${who} are undone: ${picked.map((b) => label(b)).join(', then ')}, `
      + `on ${deals} ${deals === 1 ? 'deal' : 'deals'}. Say which changes went back, in one sentence.${short}`,
    reply: `Done, the last ${picked.length} changes${who} are undone: ${picked.map((b) => label(b)).join(', then ')}.`,
    computedReply: true,
  };
}

async function undoBatch(args) {
  const everyBatch = await repo.findChangeBatches({ hours: UNDO_HOURS });
  const unundone = REDO.test(String(args.said ?? '')) ? everyBatch : everyBatch.filter((b) => !b.undoes);
  const fieldsAsked = undoFieldsAsked(args.said);
  const batches = fieldsAsked.size > 0
    ? unundone.filter((b) => (b.fields ?? []).some((f) => fieldsAsked.has(f)))
    : unundone;
  if (fieldsAsked.size > 0 && batches.length === 0 && args.changeId == null) {
    return {
      summary: `Nothing in the last ${UNDO_HOURS / 24} days changed the `
        + `${listOf([...fieldsAsked].map((f) => FIELD_LABELS[f] ?? f))} that is still undoable. `
        + 'NOTHING has been put back. Say so plainly.',
    };
  }
  const asRows = (list) => list.map((c) => ({ ...c, person_name: c.person, id: c.id }));
  /**
   * "UNDO THAT" RIGHT AFTER SHE NAMED SOMEBODY is "undo it for them". A
   * delete made seconds earlier shared the batch, and the whole batch was
   * refused as "a deletion" though the answer she had just given was
   * undoable. Only with no id, no names and no group of their own.
   */
  let askedFor = (args.people ?? []).filter(Boolean);
  /**
   * A GROUP SENT AS A PERSON is the group. Live 2026-09-30: "undo that"
   * after raising CORVID by 10% arrived as people ["CORVID"], and the undo
   * answered "CORVID is not a person's name".
   */
  const groupsHeld = new Set(batches.flatMap((b) => b.groups ?? []).map(fold));
  const asGroup = askedFor.find((n) => groupsHeld.has(fold(n)));
  if (asGroup && !args.group) {
    // eslint-disable-next-line no-param-reassign
    args = { ...args, group: batches.flatMap((b) => b.groups ?? []).find((g) => fold(g) === fold(asGroup)) };
    askedFor = askedFor.filter((n) => fold(n) !== fold(asGroup));
  }
  if (askedFor.length === 0 && args.changeId == null && !args.group && args.priorAnswer) {
    // ONLY WHEN SHE NAMED ONE. Her preview of a 5 deal raise listed all five,
    // the first was taken, and "undo that" put back 1 deal of 5. 2026-09-30.
    const named = [...new Set(batches.flatMap((b) => b.changes ?? []).map((c) => c.person)
      .filter((p) => namesPerson(args.priorAnswer, p)))];
    if (named.length === 1) askedFor = named;
  }
  const namedOnly = askedFor;

  /**
   * ===============================
   * * "UNDO THAT" NEEDS NO ID
   * ===============================
   *
   * It did, and that is how a real revert failed: she carried an id from
   * earlier in a long conversation, that change had already been put back,
   * and the answer was "the bulk change is no longer undoable" followed by
   * an offer to do 96 rows one at a time. Which is not an undo.
   *
   * The most recent batch IS what "undo that" means, the same way
   * `recent_master_sheet_changes` returns the newest first. An id still
   * works and still wins when given.
   */
  let batch = null;
  if (args.changeId != null) {
    const change = await repo.peekFieldChange(Number(args.changeId));
    if (!change) return { summary: `There is no change #${args.changeId}. Say so and look again.` };
    // An id SHE picked off the list may be the undo itself: that means the change before it.
    const isUndo = !REDO.test(String(args.said ?? '')) && everyBatch.some((b) => b.undoes && b.ids.includes(change.id));
    batch = isUndo ? (batches[0] ?? null) : everyBatch.find((b) => b.ids.includes(change.id));
    // SAY WHICH IT IS. "Not undoable" covers both an id that was already
    // put back and one that never existed, and they need different answers.
    if (!batch && change.reverted_at) {
      return {
        summary: `Change #${change.id} has already been put back, so there is nothing left to undo `
          + 'there. Say so, and offer to undo the most recent change instead by calling this again '
          + 'with no changeId.',
      };
    }
  } else if (namedOnly.length > 0) {
    /**
     * "UNDO IT FOR INES ONLY" MEANS THE CHANGE INES IS IN. 2026-09-25: the
     * newest was Dov's, so she was told Ines was not on the sheet at all.
     */
    const holds = (b) => {
      const hit = rowsForNames(asRows(b.changes ?? []), namedOnly, args.said);
      return hit.unknown.length === 0 && hit.unclear.length === 0;
    };
    // An edit before a deletion: a deleted row has nothing to put back onto.
    // Live deals too: an older batch on deleted ones answered "undo Orla's". 2026-09-25.
    // THEIR PART of the batch, not all of it: a delete a few seconds before
    // "answer yes for nell" joined her batch, and "undo that" was refused as
    // "a deletion" though her answer was undoable. 2026-09-29.
    const theirs = (b) => (b.changes ?? []).filter((c) => namedOnly.some(
      (n) => fold(c.person).includes(fold(n)) || fold(n).includes(fold(c.person)),
    ));
    const undoable = (b) => !b.undoes && b.deals > 0 && theirs(b).length > 0
      && theirs(b).every((c) => repo.isUndoableField(c.field));
    batch = batches.find((b) => holds(b) && undoable(b)) ?? null;
    // NOTHING OF THEIRS LEFT is said as that: falling back to a deletion answered
    // "undo that" after Ines's undo with "that was a deletion". 2026-09-25.
    if (!batch && everyBatch.some(holds)) {
      return {
        summary: `Nothing of ${listOf(namedOnly)}'s is left to undo in the last ${UNDO_HOURS / 24} days: `
          + 'their latest change was already put back, or was a deletion. Say so plainly.',
      };
    }
    // A name in no change at all is refused as unknown, further down.
    if (!batch) batch = batches[0] ?? null;
  } else {
    // "UNDO THAT" AFTER AN UNDO is the change before it, never the undo itself. 2026-09-25.
    batch = batches[0] ?? null;
    /**
     * "THAT" IS WHAT THIS CONVERSATION JUST DID, not the newest change in
     * the CRM. After "answer yes for nell arden", "undo that" reached a
     * delete made earlier and said "that was a deletion". The newest batch
     * whose person she just named wins; with none, the newest stands.
     */
    // A FIELD THEY NAMED already chose the batch: the newest one touching it.
    if (args.priorAnswer && fieldsAsked.size === 0) {
      const aboutIt = batches.find((b) => (b.changes ?? [])
        .some((c) => namesPerson(args.priorAnswer, c.person)));
      if (aboutIt) batch = aboutIt;
    }
  }

  if (!batch) {
    return {
      summary: `Nothing has been changed in the last ${UNDO_HOURS / 24} days that is still `
        + 'undoable. Say so plainly and do not offer to try again.',
    };
  }

  /**
   * A DELETE IS NOT A FIELD, so there is nothing to write back onto. Said
   * once, rather than discovered as every row in the batch refusing.
   *
   * ASKED OF THE REPO, which is what actually decides it. This read
   * `!FIELD_LABELS[f]`, a map of pretty WORDINGS, so every field nobody
   * had written a label for was reported to the admin as a deletion and
   * refused: `assignedOn` (the date the whole chain derives from),
   * `specialCaseDeal`, `endNote`, `reviewMonthly`, `stoppedOn`, `role`.
   *
   * Live 2026-09-24: "revert what you've done" on a special case toggle
   * got "that was a deletion, so it cannot be reverted". It was a boolean
   * on one row, and the repo would have put it back.
   */
  /**
   * ONLY A BATCH THAT IS NOTHING BUT DELETIONS refuses. A delete made seconds
   * before an ordinary edit shares its batch, and the whole thing was refused
   * as "a deletion", which reached the admin as "a review answer cannot be
   * undone". The deletions have nothing to write onto, so they drop out and
   * the rest goes back as usual. 2026-09-29.
   */
  const restorable = (batch.changes ?? []).filter((c) => repo.isUndoableField(c.field));
  if ((batch.fields ?? []).every((f) => !repo.isUndoableField(f)) || restorable.length === 0) {
    return {
      summary: 'That was a deletion, not a field edit, so it cannot be put back from the change '
        + 'log. Say so plainly and do not offer to try.',
    };
  }
  if (batch.fields.some((f) => !repo.isUndoableField(f))) {
    batch = {
      ...batch,
      changes: restorable,
      fields: [...new Set(restorable.map((c) => c.field))],
      ids: restorable.map((c) => c.id),
      field_values: (batch.field_values ?? []).filter((v) => repo.isUndoableField(v.field)),
      people: [...new Set(restorable.map((c) => c.person).filter(Boolean))],
    };
  }

  // Deleting a deal nulls `row_id` on its log entries, so there is nothing
  // left to write the old value onto.
  if (batch.deals === 0) {
    return {
      summary: 'Every deal in that change has since been deleted, so there is nothing left to put '
        + 'back. Say so plainly.',
    };
  }

  /**
   * ===============================
   * * A REVERT IS NARROWED THE WAY A BULK EDIT IS
   * ===============================
   *
   * "Put MILKMAN back but leave the rest" had no answer: it was the whole
   * batch or one row at a time. So the same two handles the bulk update
   * has, `group` and `except`, and for the same reason: an admin thinks in
   * groups and people, never in change ids.
   *
   * A GROUP THAT IS NOT IN THE BATCH REFUSES. Silently reverting nothing
   * and reporting success is the failure mode to avoid.
   */
  const all = batch.changes ?? [];
  const wantGroup = String(args.group ?? '').trim();
  let picked = all;

  if (wantGroup) {
    picked = all.filter((c) => fold(c.group) === fold(wantGroup));
    if (picked.length === 0) {
      return {
        summary: `Nothing in that change touched ${wantGroup}. It covered `
          + `${listOf(batch.groups ?? [])}. NOTHING has been put back: say which groups it `
          + 'actually covered and ask which they meant.',
      };
    }
  }

  /**
   * NAMED PEOPLE, the same as the bulk edit takes them.
   *
   * "Put Zayn and Paddy back but leave the rest" had no route: it was the
   * whole batch, one group, or one change id. `rowsForNames` is shared with
   * the bulk update, so a name resolves the same way whichever end of the
   * change it is on.
   */
  if (namedOnly.length > 0) {
    const want = rowsForNames(asRows(picked), namedOnly, args.said);
    if (want.unknown.length > 0 || want.unclear.length > 0) {
      return { summary: nameTrouble(want, 'put back', 'PUT BACK'), ambiguous: want.unclear.length > 0 };
    }
    const keep = new Set(want.rows.map((c) => c.id));
    picked = picked.filter((c) => keep.has(c.id));
  }

  const out = rowsForNames(asRows(picked), (args.except ?? []).filter(Boolean), args.said);
  if (out.unknown.length > 0 || out.unclear.length > 0) {
    return { summary: nameTrouble(out, 'put back', 'PUT BACK'), ambiguous: out.unclear.length > 0 };
  }
  const held = out.rows;

  const heldIds = new Set(held.map((c) => c.id));
  const ids = picked.filter((c) => !heldIds.has(c.id)).map((c) => c.id);
  const deals = new Set(picked.filter((c) => !heldIds.has(c.id)).map((c) => c.rowId)).size;
  const heldPeople = [...new Set(held.map((c) => c.person).filter(Boolean))];

  if (ids.length === 0) {
    return {
      summary: 'Everything in that change is on the exception list, so there is nothing left to '
        + 'put back. Say so and ask whether they meant to hold that many back.',
    };
  }

  // WHAT IS PUT BACK, not the whole batch: undoing Zayn's add on said label,
  // monthly, notes and four more had gone back too. Clone 2026-10-06.
  const backFields = [...new Set(picked.filter((c) => !heldIds.has(c.id)).map((c) => c.field).filter(Boolean))];
  const label = listOf((backFields.length > 0 ? backFields : batch.fields).map((f) => FIELD_LABELS[f] ?? f));

  // Field by field. Flattened, one batch setting three of them read as
  // "set to 1000, 2026-09-01, 30", which says nothing about which is which.
  /**
   * FROM WHAT, BACK TO WHAT. It said only `fee % to "3.00"`, the value the
   * change SET, and she read that as where the undo lands: "back to its
   * previous value of 3.00%", when it goes back to 0. 2026-09-30.
   */
  const byField = new Map();
  for (const { field, value, was } of batch.field_values ?? []) {
    if (!byField.has(field)) byField.set(field, new Set());
    if (value || was) byField.get(field).add(`from "${value ?? 'blank'}" back to "${was || 'blank'}"`);
  }
  const values = listOf([...byField].map(([field, set]) => {
    const some = [...set].slice(0, VALUES_SHOWN);
    return `${FIELD_LABELS[field] ?? field} ${some.join(', ')}`
      + (set.size > some.length ? ' and others' : '');
  }));

  // Named off what is ACTUALLY being reverted, not off the whole batch: a
  // revert narrowed to MILKMAN must not read back NEXUS names.
  const everyone = [...new Set(picked.filter((c) => !heldIds.has(c.id)).map((c) => c.person))]
    .filter(Boolean);
  const named = everyone.slice(0, NAMES_SHOWN);

  /**
   * EACH PERSON WITH THEIR OWN CHANGE. A plan that set Zayn's monthly and
   * Paddy's days read back as "monthly ..., payable days ..., on Zayn and
   * Paddy", and she paired them the wrong way round when she worded it.
   * A few people: every one named with exactly what goes back for them.
   */
  const reverting = picked.filter((c) => !heldIds.has(c.id));
  const perPerson = everyone.length > 1 && everyone.length <= NAMES_SHOWN && reverting.every((c) => 'value' in c)
    ? everyone.map((who) => {
      const own = reverting.filter((c) => c.person === who);
      const bits = [...new Map(own.map((c) => [c.field, `${FIELD_LABELS[c.field] ?? c.field} from "${c.value ?? 'blank'}" back to "${c.was || 'blank'}"`])).values()];
      return `${who}: ${bits.join(', ')}`;
    }).join('; ')
    : null;

  const pending = confirmFirst(args.confirmed, {
    // "and the rest" only when there IS a rest. The names are capped, so on
    // a small batch that phrase invents rows that do not exist.
    // PEOPLE against PEOPLE: two names holding three deals is everyone.
    // NAMED PEOPLE ARE A PART too: "for Bram only" read "the whole change".
    act: `undo ${wantGroup ? `the ${wantGroup} part of `
      : namedOnly.length > 0 ? `${listOf(named)}'s part of ` : 'the whole '}change: `
      + (perPerson ?? `${values}, on ${listOf(named)}${named.length < everyone.length ? ' and the rest' : ''}`),
    count: deals,
    noun: 'deal',
    // WHO AND WHICH FIELDS, never the time: "1m ago" moved between two calls,
    // so a "yes" could never confirm it. The fields keep a fee preview from
    // confirming a preset revert on the same people. 2026-10-03.
    identity: `undo the ${label} change on ${listOf(named)}`,
    keeps: `Made ${timeAgo(batch.changed_at)}. ` + (wantGroup
      ? `Only ${wantGroup} goes back. The rest of that change, across `
        + `${listOf((batch.groups ?? []).filter((g) => fold(g) !== fold(wantGroup)))}, stays as it is. `
      : '')
      + (heldPeople.length > 0
        ? `HELD BACK, staying as they are: ${listOf(heldPeople)}. You MUST name every one of them. `
        : '')
      + (perPerson ? 'READ EACH PERSON\'S CHANGE BACK EXACTLY AS LISTED, with their own name: never move a field to another person. ' : '')
      + 'SAY THE COUNT AND THE FIELDS when you ask. Each row goes back to the value it had '
      + 'before that edit, which is not the same value for every row.',
  });
  if (pending) {
    undoPin = { ids, at: Date.now() };
    return pending;
  }
  // The yes reverts what the preview listed. A selection that drifted
  // since is refused rather than applied to something nobody saw.
  if (!args.changeId && undoPin && Date.now() - undoPin.at < UNDO_PIN_MS) {
    const pinned = undoPin.ids;
    undoPin = null;
    const same = pinned.length === ids.length && pinned.every((id) => ids.includes(id));
    if (!same) {
      return {
        summary: 'NOTHING HAS BEEN PUT BACK. What would be undone now is not the change you showed '
          + 'them, so it was not applied. Say so in one line and ask which change they meant, '
          + 'naming the field.',
      };
    }
  }

  /**
   * IT REPORTS ITSELF AS IT GOES, exactly as the mass edit does.
   *
   * A revert is the same shape of work: a couple of hundred single writes,
   * several seconds of it, and silence is indistinguishable from a hang.
   */
  const show = ids.length >= PROGRESS_FROM ? args.onProgress : null;
  show?.({ done: 0, total: ids.length, what: label, label: 'Putting back' });

  // Diane's, and ONE change: so History says who, and it can itself be undone.
  const { done, failed } = await repo.revertChangeBatch(ids, (n, change) => show?.({
    done: n,
    total: ids.length,
    what: label,
    label: 'Putting back',
    row: `${change?.person ?? 'row'} · ${change?.group ?? ''}`,
  }), { via: 'diane', batchId: randomUUID() });
  show?.({ done: ids.length, total: ids.length, what: label, label: 'Putting back', failed: failed.length });

  broadcast(null, 'master-sheet:changed', { action: 'reverted', via: 'agent' });
  broadcast(null, 'people:changed', { action: 'reverted' });
  broadcast(null, 'companies:changed', { action: 'reverted' });

  // A half-undone mass edit is exactly what nobody can see, so it is said
  // first and the count is never reported on its own.
  if (failed.length > 0) {
    return {
      summary: `${done.length} of ${ids.length} changes went back, and ${failed.length} DID NOT: `
        + `${failed.map((f) => `#${f.id} (${f.reason})`).join(', ')}. Say both numbers and do NOT `
        + 'report this as done.',
    };
  }
  // A FINISHED SENTENCE, so the yes that applies it needs no second model
  // round to say so: that round was most of a 30 second "yes". 2026-09-30.
  const reply = `Done, ${deals} ${deals === 1 ? 'deal is' : 'deals are'} back on their previous `
    + `${label}${wantGroup ? `, in ${wantGroup} only` : ''}.`
    + (heldPeople.length > 0 ? ` ${listOf(heldPeople)} left as ${heldPeople.length === 1 ? 'it was' : 'they were'}.` : '');
  return {
    summary: `Put back. ${deals} ${deals === 1 ? 'deal is' : 'deals are'} on their previous `
      + `${label} again${wantGroup ? `, in ${wantGroup} only` : ''}.`
      + (heldPeople.length > 0 ? ` ${listOf(heldPeople)} left as ${heldPeople.length === 1 ? 'it was' : 'they were'}.` : '')
      + ' Say the count and the field in one sentence, and name anything you held back.',
    reply,
    computedReply: true,
  };
}

/**
 * ===============================
 * * A COMPANY DETAIL, PUT BACK ONTO THE COMPANY
 * ===============================
 * Logged once per deal, so the most recent ACT is one company (or several, when
 * she set many at once) and one field. The confirm names each one, old and new.
 */
async function undoCompanyDetail(args, named, asked) {
  const fields = COMPANY_UNDO_WORDS.filter(([words]) => words.test(asked)).map(([, field]) => field);
  if (fields.length === 0) {
    return {
      summary: 'NOTHING HAS BEEN PUT BACK. A company STATUS is not undone from the log: closing is '
        + 'undone by setting it back to active with update_company, which brings its deals back. '
        + 'Say so, and ask whether to do that.',
    };
  }
  const labels = listOf(fields.map((f) => FIELD_LABELS[f]));
  const logged = await repo.findFieldChanges({
    hours: UNDO_HOURS,
    limit: CHANGE_LIMIT,
    company: named ?? null,
    q: fields.length === 1 ? fields[0] : null,
  });
  const changes = logged.filter((c) => fields.includes(c.field) && c.company);
  if (changes.length === 0) {
    return {
      summary: `NOTHING HAS BEEN PUT BACK. No ${labels} change on ${named ?? 'any company'} in the `
        + `last ${UNDO_HOURS / 24} days is still open to undo. Say so plainly.`,
    };
  }

  // THE MOST RECENT ACT, whole: every company it touched, one entry each per field.
  const latest = String(changes[0].changed_at);
  const act = changes.filter((c) => String(c.changed_at) === latest);
  const one = act.filter((c, i) => act.findIndex((o) => fold(o.company) === fold(c.company) && o.field === c.field) === i);
  const lines = one.map((c) => `${c.company}: ${FIELD_LABELS[c.field]} back from `
    + `"${changeValue(c.field, c.new_value)}" to "${changeValue(c.field, c.old_value)}"`);
  const companies = [...new Set(one.map((c) => c.company))];

  const pending = confirmFirst(args.confirmed, {
    act: `undo the ${labels} change: ${lines.join('; ')}`,
    count: companies.length,
    noun: 'company',
    plural: 'companies',
    identity: `undo the ${labels} change on ${listOf(companies)}`,
    keeps: 'Only the company detail goes back. No deal stops and no money moves.',
  });
  if (pending) return pending;

  const failed = [];
  const done = [];
  for (const change of one) {
    // eslint-disable-next-line no-await-in-loop
    const out = await repo.revertFieldChange(Number(change.id), { via: 'diane' });
    if (out?.ok) done.push(change); else failed.push(`${change.company} (${out?.reason ?? 'it could not be written'})`);
  }
  if (done.length > 0) {
    broadcast(null, 'companies:changed', { action: 'reverted', via: 'agent' });
    broadcast(null, 'master-sheet:changed', { action: 'reverted', via: 'agent' });
  }
  const back = done.map((c) => `${c.company}: ${FIELD_LABELS[c.field]} is back to ${changeValue(c.field, c.old_value)}.`);
  if (failed.length > 0) {
    return {
      summary: `${done.length} of ${one.length} went back. NOT put back: ${failed.join(', ')}. `
        + `${back.join(' ')} Say both halves and do NOT report this as done.`,
    };
  }
  const reply = back.join('\n');
  return { summary: reply, reply, computedReply: true };
}

const undoChange = {
  name: 'undo_master_sheet_change',
  // IT CHANGES DATA. Read by runAgent: a turn that only LOOKED
  // something up may not end on the tool's own sentence when the admin
  // gave an instruction. See setIntent.js.
  writes: true,
  description:
    'Put a change back to what it was. ONE ROW by default, with a changeId from '
    + 'recent_master_sheet_changes. Set `batch` true to put back a WHOLE MASS EDIT, which is what '
    + '"undo that" means after you changed many rows at once. '
    + 'WITH `batch` YOU NEED NO ID AT ALL: leave changeId out and it takes the most recent change, '
    + 'which is what "undo that" and "revert what you just did" mean. Narrow it with `group` for '
    + 'one group, leave `group` out for every group, and hold people back with `except`. '
    + 'NEVER go row by row through a mass edit. '
    + 'IT ALSO PUTS BACK A COMPANY DETAIL (tier, old group, notes or liquidation total): no id needed, '
    + 'the field and the company come from their words. '
    + 'ONLY when the admin asks to undo, revert or put something back. Never suggest it, never do '
    + 'it because a value looks wrong to you, and never undo anything you were not pointed at. '
    + 'IT PUTS BACK THE PREVIOUS VALUE, whatever that was. It cannot set some other value they '
    + 'name: if they ask to revert TO a specific month, say what the previous value actually is '
    + 'and let them choose, or use bulk_update_master_sheet instead.',
  parameters: {
    type: 'object',
    properties: {
      changeId: {
        type: 'integer',
        description: 'The change id, from recent_master_sheet_changes. Never guessed. Leave it OUT '
          + 'with `batch` true to undo the most recent change.',
      },
      batch: {
        type: 'boolean',
        description: 'Undo a WHOLE mass edit, not one row. Use it whenever they undo something '
          + 'changed in bulk: "undo that", "put them all back", "revert BETA". Every row is '
          + 'counted and the change is named before anything is written.',
      },
      group: {
        type: 'string',
        description: 'ONE group, to put back only that group\'s part of the change. LEAVE IT OUT '
          + 'for every group, which is what "undo all of it" means.',
      },
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'The ONLY people to put back, as the admin says them: "undo it for Blake Example and '
          + 'Jordan Example". Everyone else in that change stays as it is. A name that matches nobody, or '
          + 'that could be two people, refuses the whole revert.',
      },
      except: {
        type: 'array',
        items: { type: 'string' },
        description: 'People to LEAVE as they are, as the admin says them. For "put it all back '
          + 'except X". Every one is named back to them before anything is written.',
      },
      last: {
        type: 'integer',
        description: 'HOW MANY of the most recent changes to put back, newest first: "undo the last 2 '
          + 'changes", "revert the past 3 updates for Alex Example" (with people [Alex Example]). One preview, one yes. '
          + 'Leave it out for just the latest.',
      },
      confirmed: { type: 'boolean', description: 'Only on the SECOND call, after they agreed to THAT row.' },
    },
    // NOT required: a batch undo with no id means the most recent change,
    // which is what "undo that" says. A single row undo still refuses
    // without one, in the handler, where the reason can be said.
    required: [],
  },
  async handler(args) {
    // A COMPANY'S OWN DETAIL goes back onto the company, never a deal: "undo the tier
    // change" once fell through and proposed two deals' stop dates instead. 2026-09-28.
    // On a "yes" or an "undo that", the field was named one message back.
    const said = undoSentence(args);
    // "THE PAST 2 UPDATES" IS TWO CHANGES, not two deals. It undid the
    // latest only and called it done. gpt-4.1 sweep, 2026-10-06.
    const spokenN = (String(said).match(LAST_N) ?? [])[1];
    const lastN = Number(args.last) || Number(spokenN) || WORD_N[String(spokenN).toLowerCase()] || 0;
    if (lastN >= 2 && args.changeId == null) return undoLast(args, Math.min(lastN, 10));
    /**
     * SCHEDULED A MOMENT AGO, SO "CANCEL THAT" MEANS THE SCHEDULE. Clone
     * 2026-10-04: after parking a closure, "dont close it, cancel that"
     * reached here and offered to revert two review answers from the day
     * before, which a yes then did. A generic undo while something was just
     * parked is pointed at cancel_parked_work instead.
     */
    if (!args.confirmed && !/\b(?:fee|add[\s-]?on|monthly|payable|preset|end date|payment start|currency|review|stop(?:ped)?|resume)\b/i.test(said)) {
      // eslint-disable-next-line global-require
      const parked = await require('../../repos/scheduledActions.repo').upcoming(currentMonth()).catch(() => []);
      // NEWER THAN THE LAST REAL CHANGE, or "undo that" after a change made
      // since is that change (the suite caught this: three undos refused).
      // eslint-disable-next-line global-require
      const lastChange = (await require('../../../configs/db')
        .query('SELECT max(changed_at) AS at FROM tb_mastersheet_changes WHERE reverted_at IS NULL')
        .catch(() => null))?.rows?.[0]?.at;
      const fresh = parked.filter((p) => Date.now() - new Date(p.parked_at).getTime() < 15 * 60 * 1000
        && (!lastChange || new Date(p.parked_at) > new Date(lastChange)));
      if (fresh.length > 0) {
        return {
          summary: 'NOTHING HAS BEEN UNDONE. The last thing done was SCHEDULING, not a change: '
            + `${fresh.map((p) => `"${p.said}" for ${p.due_month}`).join('; ')}. To call that off, `
            + 'call cancel_parked_work now. Do not offer to undo any other change.',
        };
      }
    }
    if (COMPANY_FIELD.test(said)) {
      const companies = (await peopleRepo.filterOptions().catch(() => null))?.companies ?? [];
      const named = companies.find((c) => String(c).length > 2 && fold(said).includes(fold(c)));
      if (named || COMPANY_ONLY_FIELD.test(said) || /\bcompany\b/i.test(said)) {
        return undoCompanyDetail(args, named, said);
      }
    }
    // Narrowing by group or by person is only meaningful across a set, so
    // either of those means they meant the batch whatever the flag says.
    // AND SO DOES NO ID AT ALL. "undo that" arrived with neither, was sent
    // off to find a change id, and the turn ended on a list with the 1,600
    // still in place. The most recent change IS "that", and undoBatch
    // previews it like any other. 2026-10-03.
    if (args.batch || args.group || args.changeId == null
      || (args.except ?? []).length > 0 || (args.people ?? []).length > 0) return undoBatch(args);
    /**
     * IT NAMES THE ROW BEFORE IT TOUCHES IT.
     *
     * A live run reverted the wrong deal: asked to undo the last change in
     * a scratch group she passed an id belonging to a REAL row, and Pino's
     * preset moved from August to July. Silently out of the August payout,
     * with nothing on screen to say so.
     *
     * An id is the one argument she cannot sanity check herself, so the
     * admin checks it: the row, the person and the field, by name.
     */
    const change = await repo.peekFieldChange(Number(args.changeId));
    if (!change) return { summary: `There is no change #${args.changeId}. Say so and look again.` };
    if (change.reverted_at) return { summary: 'That change has already been undone. Say so plainly.' };
    if (!change.row_exists) return { summary: 'The deal that change belonged to has been deleted.' };

    // A profile rate is the PERSON's, so naming one deal would undersell it.
    const onProfile = isProfileRateField(change.field);
    const pending = confirmFirst(args.confirmed, {
      act: onProfile
        ? `undo change #${change.id}: put ${change.person_name ?? 'their'}'s ${FIELD_LABELS[change.field]} `
          + `back from ${change.new_value}% to ${change.old_value}%, which reaches EVERY deal they hold`
        : `undo change #${change.id}: put ${FIELD_LABELS[change.field] ?? change.field} on `
        + `${change.person_name ?? 'that row'} (${change.company || 'no company'}, `
        + `${change.group_name}) back from "${change.new_value}" to "${change.old_value}"`,
      count: 1,
      noun: 'row',
      keeps: 'NAME THE PERSON AND THE GROUP when you ask. If that is not the row they meant, '
        + 'this is the moment it gets caught.',
    });
    if (pending) return pending;

    const result = await repo.revertFieldChange(Number(args.changeId), { via: 'diane' });
    // A refusal is a real answer: the change was already undone, or the
    // deal has gone. Said as what happened, not as a failure.
    if (!result?.ok) {
      return { summary: `That one cannot be undone: ${result?.reason ?? 'it is no longer there'}. Say so plainly.` };
    }
    broadcast(null, 'master-sheet:changed', { action: 'reverted', id: result.row?.id, via: 'agent' });
    broadcast(null, 'people:changed', { action: 'reverted' });
    broadcast(null, 'companies:changed', { action: 'reverted' });
    const row = result.row?.id ? await repo.findById(result.row.id) ?? result.row : result.row;
    const value = row && Object.prototype.hasOwnProperty.call(row, change.field)
      ? formatValue(row[change.field])
      : formatValue(change.old_value);
    const field = FIELD_LABELS[change.field] ?? change.field;
    const reply = `${displayPersonName(row?.person_name ?? change.person_name)} at ${row?.company ?? change.company}: ${field} is now ${value}.`;
    return {
      summary: `Put back. ${result.row?.person_name ?? 'That row'} is on its previous value again. `
        + 'Say what went back and to what, in one sentence.',
      rows: row ? [summarizeRow(row)] : [],
      reply,
      computedReply: true,
    };
  },
};

const recentChanges = {
  name: 'recent_master_sheet_changes',
  description:
    'List rows recently added or edited on the master sheet, most recent first, INCLUDING the specific field(s) that changed and their old/new values for anything edited (not for rows that only synced from the sheet unchanged, or were newly added, since there is nothing to diff there). Use this when the admin asks what was recently changed, what you just did, wants a recap, or specifically asks what exactly got edited/updated on a row. If the admin names people, pass `person` or `people` to return only their deals.',
  parameters: {
    type: 'object',
    properties: {
      hours: { type: 'integer', description: 'How far back to look, in hours. Defaults to 24.' },
      person: { type: 'string', description: 'Optional person name. Return only this person\'s recent deal changes.' },
      people: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional person names. Return their combined recent deal changes.',
      },
    },
  },
  async handler(args) {
    const hours = Number.isInteger(args.hours) && args.hours > 0 ? args.hours : 24;
    const person = typeof args.person === 'string' && args.person.trim() ? args.person.trim() : null;
    const people = listAsked(args.people);
    const names = people.length > 0 ? people : person ? [person] : [];
    const scopeText = names.length > 0 ? ` for ${listOf(names)}` : '';
    // Was 25 rows and 200 changes, both silent. A busy day ran past both:
    // the admin was read back twenty-five of forty with nothing saying so.
    const [{ rows, total }, fieldChanges] = await Promise.all([
      repo.findRecentlyUpdated({
        hours, limit: ROW_LIMIT, person: names.length === 1 ? names[0] : null, people: names.length > 1 ? names : null,
      }),
      repo.findFieldChanges({
        hours, limit: CHANGE_LIMIT, person: names.length === 1 ? names[0] : null, people: names.length > 1 ? names : null,
      }),
    ]);
    if (rows.length === 0) {
      /**
       * ===============================
       * * THE CHANGE LOG IS NOT THE ROW LIST
       * ===============================
       * A DELETED row leaves its changes in tb_mastersheet_changes and
       * disappears from findRecentlyUpdated, so this said "nothing has been
       * added or edited" while the dashboard listed five logged changes,
       * two of them inside the same window.
       */
      if (fieldChanges.length > 0) {
        const many = fieldChanges.length === 1 ? 'change' : 'changes';
        return { summary: `No deal ON THE SHEET was added or edited${scopeText} in the last `
          + `${hours} hour(s), but ${fieldChanges.length} logged ${many} in that window belong to `
          + 'rows that are no longer on it, usually because they were deleted. Say BOTH halves: '
          + 'the sheet is unchanged and the log is not empty.' };
      }

      /**
       * ===============================
       * * THE DASHBOARD LOOKS BACK A WEEK AND SHE LOOKED BACK A DAY
       * ===============================
       * Live 2026-09-07: "recent changes" answered "nothing in the last 24
       * hours" while Recent Changes on screen listed five, two of them
       * inside a day and the rest older. Both were correct;
       * `RECENT_CHANGE_HOURS` is 168 there and the default here is 24.
       *
       * True and contradicted by the screen is the same problem as wrong.
       * So an empty day looks once at the panel's own window and says
       * which one found them. Imported rather than re-declared: one number,
       * and the two cannot drift apart again.
       */
      if (hours < RECENT_CHANGE_HOURS) {
        const wider = await repo.findRecentlyUpdated({
          hours: RECENT_CHANGE_HOURS,
          limit: ROW_LIMIT,
          person: names.length === 1 ? names[0] : null,
          people: names.length > 1 ? names : null,
        });
        if (wider.total > 0) {
          const days = Math.round(RECENT_CHANGE_HOURS / 24);
          return { summary: `Nothing was added or edited${scopeText} in the last ${hours} `
            + `hour(s), but ${wider.total} ${wider.total === 1 ? 'deal was' : 'deals were'} in the `
            + `last ${days} days, which is the window the dashboard's Recent Changes panel uses. `
            + 'Say BOTH: nothing today, and what there is further back. Offer to list them.' };
        }
      }

      return { summary: names.length > 0
        ? `Nothing's been added or edited${scopeText} in the last ${hours} hour(s).`
        : `Nothing's been added or edited on the master sheet in the last ${hours} hour(s).` };
    }

    const changesByRow = new Map();
    for (const c of fieldChanges) {
      if (!changesByRow.has(c.row_id)) changesByRow.set(c.row_id, []);
      changesByRow.get(c.row_id).push(c);
    }

    // Built as the finished, ready-to-relay text on purpose — one line per
    // row with every field the admin actually asked for (name, group,
    // when, what kind of change, and now the real field diff when there
    // is one). The model's job is to hand this over close to verbatim,
    // not compress it back down to bare names to save words. A middot
    // between fields, not a dash — the "no dashes" rule in the system
    // prompt is about a dash standing in for a pause in a sentence; this
    // is tabular data, not prose, and read as one long comma-run it was
    // hard to tell where one field ended and the next began.
    const lines = rows.map((r) => {
      const action = r.source === 'manual' && !r.was_edited ? 'added by hand' : r.was_edited ? 'edited' : 'synced from the sheet';
      const head = `${r.person_name} · ${r.company ?? 'no company'} · ${r.group_name} · ${action} · ${timeAgo(r.updated_at)}`;
      const diffs = changesByRow.get(r.id);
      if (!diffs || diffs.length === 0) return head;
      const diffText = diffs
        .map((c) => `  ${FIELD_LABELS[c.field] ?? c.field}: "${changeValue(c.field, c.old_value)}" -> "${changeValue(c.field, c.new_value)}"`)
        .join('\n');
      return `${head}\n${diffText}`;
    });
    // THE TRUE COUNT, not the page's. It reported `rows.length`, so a day
    // with forty edits was read back as twenty-five and the admin had no
    // way to know fifteen were missing.
    const cut = total > rows.length
      ? ` Only the ${rows.length} most recent are listed, so TELL THE ADMIN there are ${total - rows.length} more and offer a narrower window.`
      : '';

    /**
     * ===============================
     * * PAST A CERTAIN SIZE, SHE MUST NOT BE ASKED TO READ IT OUT
     * ===============================
     *
     * 96 changed rows is 24,000 characters and 676 lines. Told to relay
     * every one of them verbatim she did the only thing a model does with
     * that: she summarised, into five bullets of "cycling through August to
     * October", and the dates the question was about were gone. She was not
     * cut off, so no length retry fired. She simply refused a task nobody
     * should have set her.
     *
     * PROMPTING IS NOT A GUARD, and "do NOT compress this" is a prompt.
     * Above `LIST_FROM` the rows go ON SCREEN as a list, exactly as a big
     * filter result does, and she gets one SHORT computed sentence to say
     * instead. Below it, relaying verbatim is right and stays.
     */
    const LIST_FROM = 12;

    // A named person is a deliberate request for deal-level detail, even
    // when the result is small enough to relay. Keep it in the searchable
    // card container so the same interaction works for one or many deals.
    if (rows.length > LIST_FROM || names.length > 0) {
      // COUNTED, not characterised. "A dance of adjustments" is what she
      // says when nothing hands her the real shape of it.
      // DEALS PER FIELD, not log entries: "17 rows changed" sat beside "on
      // 91" once a profile rate moved thirty times. A deleted row has no id
      // left to count, so each of its entries is one deal.
      const dealsByField = new Map();
      for (const c of fieldChanges) {
        // An EDIT on a deal since deleted is not a deal changed today.
        if (c.row_id == null && c.field !== 'deleted') continue;
        if (!dealsByField.has(c.field)) dealsByField.set(c.field, new Set());
        dealsByField.get(c.field).add(c.row_id ?? `gone:${c.id}`);
      }
      // REMOVED DEALS ARE NOT A FIELD OF THE LISTED ONES: "deleted on 138" beside two
      // live deals was read out as "one was deleted". Said apart. 2026-09-25.
      const removed = dealsByField.get('deleted')?.size ?? 0;
      dealsByField.delete('deleted');
      const removedText = removed > 0
        ? `\nSeparately, ${removed} ${removed === 1 ? 'deal was' : 'deals were'} removed from the sheet `
          + 'in that time. They are not among the deals listed and no longer exist: never describe a '
          + 'listed deal as deleted.'
        : '';
      const byField = new Map([...dealsByField].map(([f, ids]) => [f, ids.size]));
      const byGroup = new Map();
      for (const r of rows) {
        byGroup.set(r.group_name, (byGroup.get(r.group_name) ?? 0) + 1);
      }

      const fieldBits = [...byField.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${FIELD_LABELS[f] ?? f} on ${n}`);
      const groupBits = [...byGroup.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${g} ${n}`);

      return {
        summary: `${total} ${total === 1 ? 'row' : 'rows'} changed${scopeText} in the last ${hours} `
          + `${hours === 1 ? 'hour' : 'hours'}${cut}, ALREADY LISTED ON SCREEN with every field `
          + 'and both values. Do NOT list them again in text and do NOT summarise the dates: '
          + 'the screen has them.\n\n'
          + `Changed: ${listOf(fieldBits) || 'nothing on the listed deals'}.\nGroups: ${listOf(groupBits)}.${removedText}\n\n`
          + 'Say ONE sentence with the count and which fields moved, then offer to undo it or '
          + 'to open any row by name. Every figure above is computed: use them exactly.',
        list: {
          kind: 'recent-changes',
          title: `${total} ${total === 1 ? 'deal' : 'deals'} changed${scopeText} in the last ${hours}h`,
          subtitle: [listOf(fieldBits), rows.length < total ? `showing the first ${rows.length}` : '',
            removed > 0 ? `${removed} removed` : ''].filter(Boolean).join(' · '),
          // The DIFF is the point of this list, not the amount, so each
          // row says what actually moved rather than what it is worth.
          rows: rows.map((r) => {
            const diffs = changesByRow.get(r.id) ?? [];
            return {
              ...listRow(r),
              amount: null,
              preset: null,
              where: [r.company, r.group_name].filter(Boolean).join(' · '),
              // CAPPED, because the row renders on one truncated line and
              // five edits to the same cell would push the newest off the
              // end. Newest first, which is the one being asked about.
              changes: diffs.slice(0, DIFFS_SHOWN).map((c) => ({
                field: c.field,
                label: FIELD_LABELS[c.field] ?? c.field,
                oldValue: c.old_value ?? '',
                newValue: c.new_value ?? '',
              })),
              changeCount: diffs.length,
              role: diffs.length === 0
                ? 'no value changed'
                : diffs
                  .slice(0, DIFFS_SHOWN)
                  .map((c) => `${FIELD_LABELS[c.field] ?? c.field} ${c.old_value ?? 'blank'} → ${c.new_value ?? 'blank'}`)
                  .join(' · ')
                  + (diffs.length > DIFFS_SHOWN ? ` · +${diffs.length - DIFFS_SHOWN} more` : ''),
            };
          }),
        },
        rows: rows.map(summarizeRow),
      };
    }

    return {
      // A blank line between rows, not just a line break — user's own
      // call, denser one-per-line was hard to scan for 25 rows.
      //
      // VERBATIM, AND DATES IN FULL. Asked to relay thirty rows she wrote
      // prose instead: "extended into March and beyond in March and April
      // of following years respectively", which loses the very dates the
      // question was about. The instruction says so explicitly now, and
      // the reply budget was the real cause (see runAgent's length retry).
      // THIS IS A WINDOW, NOT A TRANSCRIPT, and she framed it as one.
      // Asked "recap everything you changed" she returned three rows
      // somebody else had edited that morning and called all of it "what I
      // changed". It cannot know what this conversation did, so it says so
      // rather than leaving the frame to her.
      summary: `${total} row(s) changed in the last ${hours} hour(s).${cut} SAY "in the last ${hours} hour(s)", NEVER "what I changed" or "in this conversation": this is everything that touched the sheet in that window, including edits by another admin, by whatbot and by an import, and you cannot tell those apart from your own. Relay EVERY line below to the admin, one per row with a blank line between each, including the indented field-change lines exactly as given where present. Do NOT compress this into a list of names, and do NOT reword a date: write every date exactly as it is given here, never as "that year", "next year" or "following years".\n\n${lines.join('\n\n')}\n\nRows with no indented lines under them were added or synced with no value actually changing, there is nothing more specific to report for those.`,
      rows: rows.map(summarizeRow),
    };
  },
};

// ORDERING, not filtering: the filter reads these itself and never hands
// them to the repo. Pinned in knownArgs.test.js.
const ORDERING_KEYS = Object.freeze(['sortBy', 'sortOrder', 'limit']);

module.exports = {
  ORDERING_KEYS,
  rankAskedIn,
  masterSheetTools: [
    // FIRST on purpose. It was fourth and the model never once chose it
    // unprompted across five live turns; ordering is the cheapest lever
    // there is on which tool gets considered at all.
    say,
    fillForm,
    // Next, because it answers "show me X" in a single round instead of
    // three.
    findAndShow,
    // perGroup: "INDIGO and MILKMAN" is one question and two answers. See
    // answerEach.js. Wrapped here rather than inside each handler so the
    // argument and the loop have ONE definition between the six of them.
    perGroup(filterRows),
    perGroup(summarizeDeals),
    perGroup(activeCompaniesFor),
    // Before totalFor: "what is Gloria on" is a rate question, not a
    // money one, and she reached for the total tool for both.
    perGroup(checkRates),
    fxTool,
    perGroup(totalFor),
    perGroup(compareMonths),
    // A report, never an export session. It accepts several groups itself
    // because the workbook-equivalent sections belong in one answer.
    historicalBreakdown,
    backupStatus,
    // READ ONLY, and it opens a panel rather than building anything. Above
    // the writes for the same reason findAndShow is: it is the common ask.
    exportSheet,
    perGroup(recallConversations),
    perGroup(showPastConversation),
    perGroup(deletePastConversations),
    rowDetails,
    editDealForm,
    createRow,
    updateRow,
    // One change over a whole filtered set. After updateRow on purpose: the
    // single-row edit is the ordinary case and should be reached for first.
    bulkUpdate,
    deleteRow,
    updatePerson,
    // Renaming IS the merge, and it is the Companies page's actual job.
    renameCompany,
    updateCompany,
    auditRows,
    recentChanges,
    // Why a figure is what it is, including whether the end date counts.
    explainRules,
    // BOTH REACTIVE. She answers with these; she never offers them.
    perGroup(listConcerns),
    undoChange,
  ],
  // The arithmetic on its own, so it can be tested without a database.
  // It is the part that was wrong on a real answer, so it is the part
  // that needs pinning.
  moneyTotals,
  // ONE ROW AS A CARD, for the route that backs Diane's deal modal.
  // Exported rather than reimplemented: the browser draws this shape and
  // rebuilding it there would be a second definition of what a deal card
  // is, which is exactly what the shape existing at all is meant to stop.
  dealCard,
  // Which months a total was asked for. Exported to be tested without a
  // database; the handler around it reads the whole sheet.
  monthsAsked,
};

