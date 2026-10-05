const pool = require('../../configs/db');
const logger = require('../../configs/logger');
const { createCache } = require('../shared/cache.helper');
const { asText, sameStoredValue } = require('../masterSheet/compareValues');
// The two columns an upload must never take straight from the file: they
// are computed, so they follow whichever inputs survive the override guard.
const {
  resolveDerived, INPUT_COLUMNS, DERIVED_COLUMNS,
} = require('../shared/resolveDerived.helper');
// The month is decided in ONE place and passed in, never asked of the
// database: Supabase is UTC and the business is not.
const { currentMonth } = require('../shared/presetMonth.helper');
const { personRatesSql } = require('../shared/personRates.helper');
const peopleRepo = require('./people.repo');
const { isProfileRateField } = require('../shared/profileRateLog.helper');
const { isCompanyField } = require('../shared/companyFieldLog.helper');
const { isReviewAnswerField } = require('../shared/reviewAnswerLog.helper');
const companiesRepo = require('./companies.repo');
// His word for a deal with no end date. The tick on the status screen IS
// this string, so it is read from the one file that defines his phrases.
const { GOING_CONCERN } = require('../shared/endNote.helper');
// Deal Status is a NAME for review_monthly and end_note, never a third
// column. See its banner.
const {
  dealStatusWrites, dealStatusSql, DEAL_STATUS_VALUES,
} = require('../shared/dealStatus.helper');

/**
 * tb_mastersheet — the deals. One row is one person, on one company, in
 * one role, for one monthly amount. The boss's own word for that is a
 * DEAL, and it is the vocabulary the whole CRM now uses.
 *
 * This is the source of truth and the only table that holds them. The
 * People and Companies pages are two different groupings of exactly this
 * data (by person_id, by company); they never hold their own copy.
 *
 * The mutual-require dance that used to live here is gone with the tables
 * it served: `assignments` and `calculator_overrides` were both deleted
 * in migration 022, so there is no longer a second table holding the same
 * override that had to be mirrored back and forth. override_should_be_paid
 * and override_paid live here and only here.
 */

/**
 * Read cache for this table.
 *
 * Measured reason for existing: a warm query to Supabase in ap-south-1
 * takes ~500ms — that's network latency, not query time, so no index will
 * fix it. Diane makes two or three per turn, and asking the same question
 * twice in a conversation is normal.
 *
 * ONLY reads used by Diane and the page's own lookups go through it, and
 * EVERY write in this file calls cache.invalidate() (see `invalidated by`
 * comments below). A stale payable amount is worse than a slow one, so the
 * invalidation is deliberately blunt: any write drops the whole cache.
 */
const cache = createCache({ ttlMs: 30_000 });

// Every column, in the order the boss's own master sheet lays them out —
// so a SELECT here, the page's table, and the exported xlsx all agree
// without three separate orderings to keep in step.
// The two reasons a deal can be incomplete, as fixed strings so the same
// text is written, matched and removed by one definition. The UI turns
// them into the guidance an admin actually reads (helpers/reviewFields.js);
// these are what lives in the column.
const ORPHAN_PERSON_REASON = 'the handler was removed';
const ORPHAN_COMPANY_REASON = 'the company was removed';

const { paymentPeriodSql } = require('../shared/paymentPeriod.helper');

// ===============================
// * ENDING A DEAL, AND THE FOUR WAYS IT HAPPENS
// ===============================
// The closed set migration 056's CHECK also pins. Here so a route cannot
// invent a fifth the Archive would print as a blank cell on a row nobody
// could then un-stop.
const STOPPED_REASON = Object.freeze({
  BY_HAND: 'stopped_by_hand',
  REVIEW_NO: 'review_no',
  REVIEW_FINAL: 'review_final',
  COMPANY_CLOSED: 'company_closed',
});

// A company closing stopped these, so un-stopping one by hand would put a
// deal back on a company that is gone. Reopen the company instead.
const REOPEN_THE_COMPANY = STOPPED_REASON.COMPANY_CLOSED;

/**
 * A list of row ids off the wire, reduced to the ones that could BE a row.
 *
 * POSITIVE INTEGERS ONLY. `Number(null)` is 0 and `Number.isInteger(0)` is
 * true, so the obvious `.map(Number).filter(Number.isInteger)` turned a
 * null in the list into an id of zero. Harmless today, because no row is 0,
 * and exactly the kind of thing that stops being harmless.
 */
function rowIds(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => (typeof id === 'number' || typeof id === 'string' ? Number(id) : NaN))
    .filter((id) => Number.isInteger(id) && id > 0);
}

const COLUMNS = `id, sync_key, source, person_id, person_name, phone,
  role, seat, role_label, group_name, company,
  assigned_on, payment_start_on, preset_on, end_on,
  -- Somebody said this deal is over. Not end_on, which is the sheet's own
  -- provisional formula. Carried on every read so the tint can repaint.
  stopped_on, stopped_reason,
  -- Somebody said this month pays it, whatever the start derives. The
  -- mirror of stopped_on, and read by the same predicate, so the total,
  -- the tint and the badge all follow it together. Migration 064.
  special_case_deal,
  payable_days, monthly_amount, payable_amount,
  currency, payment_method, location,
  door_number, postcode, label, should_be_paid, paid, notes,
  bank_details, account_number, sort_code, accepting_postals,
  status, needs_review, review_reason,
  -- Two rates on the DEAL, stacking with the person's own. See
  -- shared/rates.helper.js: an add on is added, a fee is deducted.
  addon_percent, fee_percent,
  -- The PERSON's own two, carried so a cell can warn that the pair stack.
  -- One definition, shared: see shared/personRates.helper.js.
  ${personRatesSql()},
  -- THE COMPANY'S STATUS, so a deal row can badge a company in liquidation.
  -- A BADGE, NEVER A STATUS: three things have been called status already
  -- and this is a fact about the deal's COMPANY, not about the deal. It
  -- does NOT move the payment start tint, which answers a different
  -- question (is payment running this month) and in liquidation it is,
  -- just for less. Same subselect shape as the person's rates above.
  (SELECT c.status FROM tb_companies c
    WHERE lower(regexp_replace(btrim(c.name), '\\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(tb_mastersheet.company), '\\s+', ' ', 'g'))
  ) AS company_status,
  -- status above is the STORED value, still written and still filtered on.
  -- payment_period is the one the pages show: the same fact worked out
  -- against today, so it cannot go stale between uploads, and a hand-set
  -- value still wins. See shared/paymentPeriod.helper.js.
  ${paymentPeriodSql('')} AS payment_period,
  orphaned_person, orphaned_company,
  -- HIS WORD FROM THE END DATE COLUMN, and what the CRM does about it.
  -- Two columns on purpose: the note only ever displays, the flag is read
  -- by the review queue's SQL. See migration 059.
  end_note, review_monthly,
  payment_outcome, payment_replied_at, payment_note,
  override_should_be_paid, override_paid, override_paid_at,
  manually_overridden_fields,
  created_at, updated_at`;

// camelCase in (what every route and whatbot speak) -> snake_case column.
// One map, used by both create() and update(), so a field can never be
// writable by one and silently ignored by the other.
const COLUMN_FOR = {
  personId: 'person_id',
  personName: 'person_name',
  phone: 'phone',
  role: 'role',
  seat: 'seat',
  roleLabel: 'role_label',
  groupName: 'group_name',
  company: 'company',
  assignedOn: 'assigned_on',
  paymentStartOn: 'payment_start_on',
  presetOn: 'preset_on',
  endOn: 'end_on',
  // The switch on the payment start cell's own popup. Editable on purpose:
  // it is the only way to say this month pays a deal its start date says
  // is not running yet. Migration 064.
  specialCaseDeal: 'special_case_deal',
  payableDays: 'payable_days',
  monthlyAmount: 'monthly_amount',
  payableAmount: 'payable_amount',
  currency: 'currency',
  paymentMethod: 'payment_method',
  location: 'location',
  // The four columns master.xlsx has always carried and the importer used
  // to drop on the floor. Text, never numeric — the real values include
  // "Will never be bank", "In person meet" and "20 - 82 - 23".
  doorNumber: 'door_number',
  postcode: 'postcode',
  acceptingPostals: 'accepting_postals',
  accountNumber: 'account_number',
  sortCode: 'sort_code',
  label: 'label',
  shouldBePaid: 'should_be_paid',
  paid: 'paid',
  notes: 'notes',
  bankDetails: 'bank_details',
  status: 'status',
  // Editable on purpose: clearing the flag is how an admin says "I looked
  // at this and it's fine now" — the whole point of surfacing it.
  needsReview: 'needs_review',
  reviewReason: 'review_reason',
  // The admin's structured decision, distinct from the sheet's own raw
  // text columns above (should_be_paid / paid, which hold whatever the
  // boss typed). One home only now — the People page writes these same
  // columns rather than a parallel overrides table, so there is nothing
  // left to mirror and nothing that can drift out of step.
  overrideShouldBePaid: 'override_should_be_paid',
  overridePaid: 'override_paid',
  // whatbot writes this from the person's own payday reply
  // (applyPaydayOutcome, below) and an admin can now correct it in place
  // on the Master Sheet page — the admin is the final word on this table,
  // same rule as every other column here. `payment_replied_at` and
  // `payment_note` stay out on purpose: those are facts about whatbot's
  // conversation ("they answered at 14:02, saying this"), not a decision
  // anyone should be able to type over.
  paymentOutcome: 'payment_outcome',
  // This DEAL's own rates. They stack with the person's, never replace
  // them, which is what the cell warning on each says.
  addonPercent: 'addon_percent',
  feePercent: 'fee_percent',
};

/**
 * ===============================
 * * NEITHER OF THESE IS A CELL SOMEBODY TYPES INTO
 * ===============================
 * `end_note` and `review_monthly` are deliberately NOT in COLUMN_FOR, so
 * no row PATCH can carry them.
 *
 *   end_note        arrives from HIS SHEET. It is his word, and the CRM's
 *                   job is to keep it, not to let somebody invent one.
 *   review_monthly  is set from the company status screen, across a whole
 *                   company at once, or by the import from his word.
 *
 * The upsert writes both (they are in UPSERT_COLUMNS) and
 * `setReviewMonthlyForCompany` writes the flag. Putting them in COLUMN_FOR
 * would make them look hand editable, and `editableFields.test.js` would
 * then demand the route parse a field no form sends.
 */
const EDITABLE = Object.keys(COLUMN_FOR);

/**
 * ===============================
 * * WHAT AN UNDO MAY PUT BACK THAT NOBODY MAY TYPE
 * ===============================
 * The company cascade writes these three, and none of them is a cell
 * somebody edits: the status screen sets them across a whole company at
 * once, or the import does from his sheet. They are therefore NOT in
 * COLUMN_FOR, and `revertFieldChange` refused every one of them until
 * this list existed, so "undo that status change" undid nothing.
 *
 * The TYPE is here because the change log stores every value as text, and
 * a date column will not take '2026-12-31' nor a boolean 'true' without
 * being told which it is.
 */
const RESTORABLE = Object.freeze({
  endNote: 'end_note',
  reviewMonthly: 'review_monthly',
  stoppedOn: 'stopped_on',
});

const RESTORABLE_TYPE = Object.freeze({
  endNote: 'text',
  reviewMonthly: 'boolean',
  stoppedOn: 'date',
});

/**
 * ===============================
 * * WHAT AN UNDO CAN PUT BACK, ASKED ONCE
 * ===============================
 * `revertFieldChange` decides this with `COLUMN_FOR[f] ?? RESTORABLE[f]`,
 * and Diane's undo tool asked a DIFFERENT question to decide the same
 * thing: whether it had a pretty LABEL for the field.
 *
 * So every field nobody had written a label for was reported to the admin
 * as "That was a deletion, not a field edit", and refused. On 2026-09-24
 * that was `assignedOn` (the appointment date, which the whole date chain
 * derives from), `specialCaseDeal`, `endNote`, `reviewMonthly`, `stoppedOn`
 * and `role`. A label is wording; it was deciding whether money could be
 * put back.
 *
 * `deleted` and `recovered` are the ones genuinely outside it: there is no
 * column to write an old value onto.
 */
// A PROFILE rate goes back onto tb_people, never the row. See revertProfileRate.
// A company detail goes back onto tb_companies the same way. See revertCompanyField.
const isUndoableField = (field) => Boolean(COLUMN_FOR[field] ?? RESTORABLE[field])
  || isProfileRateField(field) || isCompanyField(field) || isReviewAnswerField(field);

// The same map read backwards. The change log stores camelCase field names
// because that is what update() has always written and what HistoryModal's
// labels are keyed on, so an upload logging 'end_on' would print raw where
// an admin's edit prints "end date".
const FIELD_FOR_COLUMN = Object.fromEntries(
  Object.entries(COLUMN_FOR).map(([field, column]) => [column, field]),
);

// Group first (the sheet's own blocks), then person, then company — the
// order a human reads the printed sheet in. id last so two otherwise
// identical rows (the same person twice on one company, which is legal
// here) keep a stable order between renders.
const ORDER = 'ORDER BY group_name, person_name, company NULLS FIRST, id';

// The Archive reads as a log, so the newest stop is at the top. Same tail
// as ORDER so ties still resolve the same way.
const ORDER_STOPPED = 'ORDER BY stopped_on DESC, group_name, person_name, company NULLS FIRST, id';

// How far ahead "ending soon" reaches. Long enough to act on a notice
// period, short enough that the answer is a shortlist and not the sheet.
const ENDING_SOON_MONTHS = 3;
const COMPANY_KEY_SQL = (value = 'company') => (
  `lower(regexp_replace(btrim(${value}), '\\s+', ' ', 'g'))`
);

// A scalar is the browser contract; an array is Diane asking one wider
// question. Empty and invalid array entries narrow nothing.
function listValues(raw, allowed = null) {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.map((value) => String(value ?? '').trim()).filter((value) => (
    value !== '' && (!allowed || allowed.includes(value))
  )))];
}

/**
 * The admin page's paginated view. `group`/`source` are exact filters;
 * `q` searches the four things an admin actually looks a row up by.
 * Both the page's rows and the unfiltered total come from one round trip.
 */
async function findAll({
  group, company, roleLabel, tier, source, needsReview, status, shouldBePaid, paid,
  missingPerson, missingCompany, missingPhone, missingBank, presetWhen, paymentStartWhen, endWhen, endSoonMonths, appointmentWhen,
  acceptingPostals, label, paymentOutcome, oldGroup, sheetShouldBePaid, sheetPaid,
  amountField, amountMin, amountMax, amountMinStrict = false, amountMaxStrict = false, payableVsMonthly, q, searchField,
  currency, paymentMethod, stopped = false, stoppedFrom, stoppedTo, stoppedReason,
  companyStatus, dealStatus, specialCaseDeal,
  page = 1, pageSize = 50,
} = {}) {
  const where = [];
  const params = [];

  /**
   * ===============================
   * * STOPPED ROWS ARE SOMEWHERE ELSE, AND THE DEFAULT IS LIVE
   * ===============================
   * The master sheet is what is running; the Archive page is the same rows
   * read as history, `stopped: true`. One filter, never a copied table:
   * two records of one deal drift on the first edit.
   *
   * TWO STATES, NOT THREE. There is no "both": mixing finished deals into
   * the working sheet is how one gets edited by accident, which is exactly
   * what Archive being read only prevents.
   *
   * DEFAULT FALSE, so every existing caller keeps the rows it always had
   * minus the ones somebody has since ended.
   */
  where.push(stopped ? 'stopped_on IS NOT NULL' : 'stopped_on IS NULL');

  // HALF OPEN, like every other date range here: `< the day after` rather
  // than `<= the day`, so an index is usable and no time can be lost.
  if (stoppedFrom) {
    params.push(stoppedFrom);
    where.push(`stopped_on >= $${params.length}::date`);
  }
  if (stoppedTo) {
    params.push(stoppedTo);
    where.push(`stopped_on < ($${params.length}::date + 1)`);
  }
  // "What have I still to set" in one click, once a company is winding
  // down. Its own filter and not a search: a closed set of four.
  if (companyStatus) {
    params.push(companyStatus);
    where.push(`EXISTS (
      SELECT 1 FROM tb_companies c
      WHERE ${COMPANY_KEY_SQL('c.name')} = ${COMPANY_KEY_SQL()}
        AND COALESCE(c.status, 'active') = $${params.length}
    )`);
  }
  /**
   * Deal Status is the PAIR read by priority, never a stored column, so
   * every fragment comes from the helper that defines it.
   *
   * ONE OR MANY. Her filter is plural like the rest, and a list arrives as
   * an array: taking only a string would drop it, and a filter that is
   * dropped runs UNFILTERED and answers with the whole sheet.
   */
  const dealStatuses = listValues(dealStatus, DEAL_STATUS_VALUES)
    ?? listValues([dealStatus], DEAL_STATUS_VALUES);
  if (dealStatuses?.length) {
    const parts = dealStatuses.map((s) => `(${dealStatusSql(s)})`);
    where.push(`(${parts.join(' OR ')})`);
  }
  /**
   * ===============================
   * * SPECIAL CASE: A DEAL PAID A MONTH ITS DATES EXCLUDE
   * ===============================
   * The column existed and nothing could narrow by it, so "show me the
   * special cases" was refused while every row carried the answer. Found
   * in her own transcript 2026-09-24.
   *
   * A REAL BOOLEAN, so `false` has to reach the query: `if (specialCaseDeal)`
   * would silently drop "show me the ones that are NOT" and answer with
   * the whole sheet, which is the failure the dealStatus note above is
   * about.
   */
  if (specialCaseDeal !== undefined && specialCaseDeal !== null && specialCaseDeal !== '') {
    params.push(specialCaseDeal === true || specialCaseDeal === 'true');
    where.push(`COALESCE(special_case_deal, false) = $${params.length}`);
  }
  const stoppedReasons = listValues(stoppedReason, Object.values(STOPPED_REASON));
  if (stoppedReasons?.length) {
    params.push(stoppedReasons);
    where.push(`stopped_reason = ANY($${params.length}::text[])`);
  } else if (stoppedReason && !Array.isArray(stoppedReason)
    && Object.values(STOPPED_REASON).includes(stoppedReason)) {
    params.push(stoppedReason);
    where.push(`stopped_reason = $${params.length}`);
  }

  if (group) {
    // Case-insensitive — the agent (and a human typing into search) may
    // say "All Books" where the sheet's own header wrote "ALL BOOKS", same
    // spelling drift mapSheetRow.js already normalizes on the calculator
    // side. An exact-case filter here silently returned zero rows for a
    // real group.
    params.push(group);
    where.push(`upper(group_name) = upper($${params.length})`);
  }
  const companies = listValues(company)?.map((value) => value.replace(/\s+/g, ' ').toLowerCase());
  if (companies?.length) {
    params.push(companies);
    where.push(`${COMPANY_KEY_SQL()} = ANY($${params.length}::text[])`);
  } else if (company && !Array.isArray(company)) {
    params.push(company);
    where.push(`${COMPANY_KEY_SQL()} = ${COMPANY_KEY_SQL(`$${params.length}`)}`);
  }
  const roles = listValues(roleLabel)?.map((value) => value.toLowerCase());
  if (roles?.length) {
    params.push(roles);
    where.push(`lower(btrim(role_label)) = ANY($${params.length}::text[])`);
  } else if (roleLabel && !Array.isArray(roleLabel)) {
    params.push(roleLabel);
    where.push(`lower(btrim(role_label)) = lower(btrim($${params.length}))`);
  }
  const tiers = listValues(tier)?.map((value) => value.toLowerCase());
  if (tiers?.length) {
    params.push(tiers);
    where.push(`EXISTS (
      SELECT 1 FROM tb_companies c
      WHERE ${COMPANY_KEY_SQL('c.name')} = ${COMPANY_KEY_SQL()}
        AND lower(btrim(c.tier)) = ANY($${params.length}::text[])
    )`);
  } else if (tier && !Array.isArray(tier)) {
    params.push(tier);
    where.push(`EXISTS (
      SELECT 1 FROM tb_companies c
      WHERE ${COMPANY_KEY_SQL('c.name')} = ${COMPANY_KEY_SQL()}
        AND lower(btrim(c.tier)) = lower(btrim($${params.length}))
    )`);
  }
  const sources = listValues(source);
  if (sources?.length) {
    params.push(sources);
    where.push(`source = ANY($${params.length}::text[])`);
  } else if (source && !Array.isArray(source)) {
    params.push(source);
    where.push(`source = $${params.length}`);
  }
  // Both are CLOSED SETS off the sheet's own values, which is why they are
  // filters and not search fields. Folded on case for the same reason group
  // is: the sheet spells one currency "EURO" and canonical.js has had to fix
  // its casing before, and an exact-case filter silently returns nothing.
  const currencies = listValues(currency)?.map((value) => value.toUpperCase());
  if (currencies?.length) {
    params.push(currencies);
    where.push(`upper(currency) = ANY($${params.length}::text[])`);
  } else if (currency && !Array.isArray(currency)) {
    params.push(currency);
    where.push(`upper(currency) = upper($${params.length})`);
  }
  const paymentMethods = listValues(paymentMethod)?.map((value) => value.toLowerCase());
  if (paymentMethods?.length) {
    params.push(paymentMethods);
    where.push(`lower(payment_method) = ANY($${params.length}::text[])`);
  } else if (paymentMethod && !Array.isArray(paymentMethod)) {
    params.push(paymentMethod);
    where.push(`lower(payment_method) = lower($${params.length})`);
  }
  if (needsReview !== undefined) {
    params.push(needsReview);
    where.push(`needs_review = $${params.length}`);
  }
  const statuses = listValues(status);
  if (statuses?.length) {
    params.push(statuses);
    where.push(`${paymentPeriodSql('')} = ANY($${params.length}::text[])`);
  } else if (status && !Array.isArray(status)) {
    params.push(status);
    // The SAME derived expression the row shows, not the stored column.
    // Filtering on `status` meant a list narrowed to "ended" could omit
    // rows the page itself was printing as ended, because the stored value
    // only caught up on the next upload.
    where.push(`${paymentPeriodSql('')} = $${params.length}`);
  }
  // TWO FILTERS, NOT ONE "orphaned".
  //
  // Both are separate from needsReview: that one is a value a sheet got
  // wrong, these are a missing half to reassign. And they are separate
  // from EACH OTHER because the fix differs — one needs a handler picked,
  // the other needs a company — so somebody tidying up after deleting a
  // company should not have to read past every row that lost a person.
  //
  // Independent clauses, so ticking both narrows to the rows that lost
  // both sides, which is what "narrow to this" means for every other
  // filter here.
  if (missingPerson !== undefined) {
    where.push(missingPerson ? 'orphaned_person' : 'NOT orphaned_person');
  }
  if (missingBank !== undefined) {
    const none = "(COALESCE(trim(bank_details), '') = '' AND COALESCE(trim(account_number), '') = '')";
    where.push(missingBank ? none : `NOT ${none}`);
  }
  if (missingPhone !== undefined) {
    where.push(missingPhone ? "COALESCE(trim(phone), '') = ''" : "COALESCE(trim(phone), '') <> ''");
  }
  if (missingCompany !== undefined) {
    where.push(missingCompany ? 'orphaned_company' : 'NOT orphaned_company');
  }
  /**
   * A FIGURE, BETWEEN TWO BOUNDS.
   *
   * AN ALLOW-LIST, NOT THE COLUMN NAME FROM THE QUERY STRING. `amountField`
   * arrives from the browser and would otherwise be interpolated into SQL.
   * Anything not on this list is ignored rather than rejected: a stale link
   * naming a column that has since gone should return the unfiltered list,
   * not a 500.
   *
   * EITHER BOUND ALONE IS A FILTER. "More than 1,000" has no upper bound.
   * The bounds are parameters, so only the column name is ever pasted in,
   * and it can only be one of these four.
   */
  const AMOUNT_COLUMNS = {
    monthlyAmount: 'monthly_amount',
    payableAmount: 'payable_amount',
    payableDays: 'payable_days',
    // THE TWO RATES, so "who is on an add on" is a range like any other
    // figure rather than a column with no filter at all. They are opposite
    // directions and are never one field: see rates.helper.js.
    addonPercent: 'addon_percent',
    feePercent: 'fee_percent',
  };
  const amountColumn = AMOUNT_COLUMNS[amountField];
  if (amountColumn) {
    // Number(), so an empty string is not read as 0. A blank bound means
    // unbounded, and 0 is a real payable amount somebody hunts for.
    const lo = amountMin === '' || amountMin == null ? null : Number(amountMin);
    const hi = amountMax === '' || amountMax == null ? null : Number(amountMax);
    if (Number.isFinite(lo)) {
      params.push(lo);
      where.push(`${amountColumn} ${amountMinStrict ? '>' : '>='} $${params.length}`);
    }
    if (Number.isFinite(hi)) {
      params.push(hi);
      where.push(`${amountColumn} ${amountMaxStrict ? '<' : '<='} $${params.length}`);
    }
  }
  /**
   * PAYABLE AGAINST MONTHLY, one column against the other. "Which deals
   * have a payable above their monthly" had no filter, so Diane listed 70
   * deals off some other filter and said all 70 were above. A closed set,
   * never interpolated from the caller. 2026-09-30.
   */
  const VERSUS = { above: '>', below: '<', equal: '=' };
  if (VERSUS[payableVsMonthly]) {
    where.push(`payable_amount ${VERSUS[payableVsMonthly]} monthly_amount`);
  }
  /**
   * WHICH MONTH THE ROW IS FOR, against the month we are in now.
   *
   * The preset is the boss's own period marker, and only rows marked for
   * the current month count toward an export's total. So "which of mine
   * are still set to last month" is the question that decides whether a
   * payout file comes out nearly empty, and until now it could only be
   * answered by reading ninety-six rows.
   *
   *   current   this calendar month. What a run today pays.
   *   future    a month that has not started. Real, and not yet due.
   *   old       a month already gone. Usually a sheet nobody re-dated.
   *
   * A ROW WITH NO PRESET IS IN NONE OF THE THREE. The twelve "NA" roster
   * rows are owed every month and belong to no single one, so filing them
   * under any of these would be a lie.
   *
   * `date_trunc` on both sides, so this is a date comparison rather than
   * string maths on a formatted month.
   */
  /**
   * THIS MONTH COMES FROM JS, never from `current_date`.
   *
   * Supabase runs in UTC and the business does not, so between midnight
   * and 7am UTC the database and the code disagreed about the date, and at
   * a month boundary about the MONTH: the total said August while this
   * filter said September, off one screen. The session zone cannot be set
   * either, because the Supabase pooler swallows startup options.
   *
   * So the month is a PARAMETER. One authority, `presetMonth.helper`,
   * and SQL stops having an opinion about what day it is.
   */
  const thisMonth = `${currentMonth()}-01`;

  const presetWhens = listValues(presetWhen, ['current', 'future', 'old']);
  if (presetWhens?.length) {
    params.push(thisMonth);
    const month = `$${params.length}::date`;
    const clauses = presetWhens.map((value) => {
      const op = { current: '=', future: '>', old: '<' }[value];
      return 'preset_on IS NOT NULL AND '
        + `date_trunc('month', preset_on) ${op} date_trunc('month', ${month})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  } else if (presetWhen && !Array.isArray(presetWhen)) {
    const op = { current: '=', future: '>', old: '<' }[presetWhen];
    if (op) {
      params.push(thisMonth);
      where.push(
        `preset_on IS NOT NULL AND date_trunc('month', preset_on) ${op} date_trunc('month', $${params.length}::date)`,
      );
    }
  }

  /**
   * WHEN THE MONEY STARTS, as opposed to which month a row is FOR.
   *
   * These are two different columns and they were being confused for each
   * other. Asked "which MILKMAN people have a payment start in a future
   * month" she had no filter for it, so she improvised: first she used
   * `presetWhen` and answered ONE, then she used a "still running" filter
   * and answered TEN. The truth was EIGHT.
   *
   * BY MONTH, NOT BY DAY, which is what was actually asked and what the
   * sheet means: a start on the 30th of this month has started.
   */
  const paymentStartWhens = listValues(paymentStartWhen, ['past', 'this-month', 'future']);
  if (paymentStartWhens?.length) {
    params.push(thisMonth);
    const month = `$${params.length}::date`;
    const clauses = paymentStartWhens.map((value) => {
      const op = { 'this-month': '=', future: '>', past: '<' }[value];
      return 'payment_start_on IS NOT NULL AND '
        + `date_trunc('month', payment_start_on) ${op} date_trunc('month', ${month})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  } else if (paymentStartWhen && !Array.isArray(paymentStartWhen)) {
    const op = { 'this-month': '=', future: '>', past: '<' }[paymentStartWhen];
    if (op) {
      params.push(thisMonth);
      where.push(
        'payment_start_on IS NOT NULL AND '
        + `date_trunc('month', payment_start_on) ${op} date_trunc('month', $${params.length}::date)`,
      );
    }
  }

  /**
   * ===============================
   * * WHEN THE DEAL ENDS, which had NO FILTER AT ALL
   * ===============================
   *
   * Asked "whose deals are ending soon" she answered "no deals are marked
   * as ended right now". True, and about a different column: `status` is
   * what a row IS, `end_on` is when it stops. Rows ending this month and
   * next were sitting on the sheet while the answer was none.
   *
   * A question with no filter is the fault. She does not refuse, she
   * reaches for the nearest column that exists, and the answer is
   * confident and wrong. Same shape as the `paymentStartWhen` incident.
   *
   * BY MONTH like the two above, and `none` is a real answer: no end date
   * means ONGOING, never "ends today".
   */
  const endWhens = listValues(endWhen, ['soon', 'this-month', 'future', 'past', 'none']);
  if (endWhens?.length) {
    // THE MONTH ONLY WHEN A CLAUSE READS IT. "no end date" alone pushed a
    // parameter no SQL used, and Postgres refused it: "could not determine
    // data type of parameter $1". Every "which deals have no end date" failed.
    // 2026-10-04.
    let month = null;
    const monthParam = () => {
      if (!month) {
        params.push(thisMonth);
        month = `$${params.length}::date`;
      }
      return month;
    };
    let soonHorizon = null;
    const clauses = endWhens.map((value) => {
      if (value === 'none') return 'end_on IS NULL';
      monthParam();
      if (value === 'soon') {
        if (!soonHorizon) {
          params.push(Number(endSoonMonths) > 0 ? Number(endSoonMonths) : ENDING_SOON_MONTHS);
          soonHorizon = `$${params.length}::int`;
        }
        return 'end_on IS NOT NULL '
          + `AND date_trunc('month', end_on) >= date_trunc('month', ${month}) `
          + `AND date_trunc('month', end_on) <= date_trunc('month', ${month}) `
          + `+ make_interval(months => ${soonHorizon})`;
      }
      const op = { 'this-month': '=', future: '>', past: '<' }[value];
      return 'end_on IS NOT NULL AND '
        + `date_trunc('month', end_on) ${op} date_trunc('month', ${month})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  } else if (endWhen && !Array.isArray(endWhen)) {
    if (endWhen === 'none') {
      where.push('end_on IS NULL');
    } else if (endWhen === 'soon') {
      params.push(thisMonth);
      const from = `$${params.length}::date`;
      params.push(Number(endSoonMonths) > 0 ? Number(endSoonMonths) : ENDING_SOON_MONTHS);
      where.push(
        `end_on IS NOT NULL AND date_trunc('month', end_on) >= date_trunc('month', ${from}) `
        + `AND date_trunc('month', end_on) <= date_trunc('month', ${from}) `
        + `+ make_interval(months => $${params.length}::int)`,
      );
    } else {
      const op = { 'this-month': '=', future: '>', past: '<' }[endWhen];
      if (op) {
        params.push(thisMonth);
        where.push(
          'end_on IS NOT NULL AND '
          + `date_trunc('month', end_on) ${op} date_trunc('month', $${params.length}::date)`,
        );
      }
    }
  }

  /**
   * ===============================
   * * WHEN THEY WERE APPOINTED, the one date with no filter
   * ===============================
   * The preset, the payment start and the end date all had one; the
   * APPOINTMENT did not, and it is the date the other two are DERIVED
   * from. "Who did we take on in August" had nowhere to go.
   *
   * By month, like the three above. `none` is a real answer: the sheet has
   * rows with no appointment at all, and they are the ones whose payment
   * start nobody can check.
   */
  const appointmentWhens = listValues(appointmentWhen, ['this-month', 'future', 'past', 'none'])
    ?? (appointmentWhen && !Array.isArray(appointmentWhen) ? [appointmentWhen] : null);
  if (appointmentWhens?.length) {
    /**
     * PUSHED ONLY WHERE IT IS USED. `none` is the one value with no month
     * in it, so asking for `none` alone left an unreferenced parameter and
     * Postgres answered "could not determine data type of parameter $1"
     * rather than returning the rows. Same lazy push as `soon` above.
     */
    let month = null;
    const monthParam = () => {
      if (!month) {
        params.push(thisMonth);
        month = `$${params.length}::date`;
      }
      return month;
    };
    const clauses = appointmentWhens.map((value) => {
      if (value === 'none') return 'assigned_on IS NULL';
      const op = { 'this-month': '=', future: '>', past: '<' }[value];
      return op
        ? 'assigned_on IS NOT NULL AND '
          + `date_trunc('month', assigned_on) ${op} date_trunc('month', ${monthParam()})`
        : null;
    }).filter(Boolean);
    if (clauses.length > 0) where.push(`(${clauses.join(' OR ')})`);
  }

  /**
   * ===============================
   * * THE COLUMNS THAT HAD NO FILTER AT ALL
   * ===============================
   * Each of these was a question she could not answer and would not
   * refuse: "who accepts postals", "who is labelled X", "who confirmed on
   * WhatsApp", "who is in old group Milky". A filter that does not exist
   * is IGNORED by the query, so the answer was the whole sheet described
   * as something narrower. See knownArgs.js.
   *
   * `accepting_postals` and the boss's two paid columns are FREE TEXT the
   * team typed ("Yes", "No", "Handled Internally"), so they match on the
   * folded value rather than on an enum nobody enforces.
   */
  const textIn = (column, raw) => {
    const values = listValues(raw) ?? (raw ? [String(raw)] : null);
    if (!values?.length) return;
    params.push(values.map((v) => v.trim().toLowerCase()));
    where.push(`lower(btrim(${column})) = ANY($${params.length}::text[])`);
  };

  textIn('accepting_postals', acceptingPostals);
  textIn('label', label);
  textIn('payment_outcome', paymentOutcome);
  textIn('should_be_paid', sheetShouldBePaid);
  textIn('paid', sheetPaid);

  // HIS OWN earlier group name, on the COMPANY, never one of ours. The
  // deals carry no such column, so it joins the way companyStatus does.
  if (oldGroup) {
    params.push(String(oldGroup).trim().toLowerCase());
    where.push(`EXISTS (
      SELECT 1 FROM tb_companies c
      WHERE ${COMPANY_KEY_SQL('c.name')} = ${COMPANY_KEY_SQL()}
        AND lower(btrim(COALESCE(c.old_group, ''))) = $${params.length}
    )`);
  }
  // The admin's decision, filtered the way the page RENDERS it, not the
  // way it is stored. An untouched row is NULL, and both pages show that
  // as the default (should be paid yes, paid no) rather than a third
  // state — so "Paid" ticked has to mean "shows as paid", which includes
  // every row nobody has touched when the default is what you asked for.
  // COALESCE here is the same default OverrideToggle falls back to; without
  // it, filtering returned a handful of rows on a table where the column
  // looks fully populated.
  if (shouldBePaid !== undefined) {
    params.push(shouldBePaid);
    where.push(`COALESCE(override_should_be_paid, true) = $${params.length}`);
  }
  if (paid !== undefined) {
    params.push(paid);
    where.push(`COALESCE(override_paid, false) = $${params.length}`);
  }
  if (q) {
    // WHICH COLUMNS A SEARCH MAY NAME. Same rule as AMOUNT_COLUMNS above: a
    // column name off the query string is never interpolated, it is looked
    // up here, and an unknown key falls back to ANY rather than erroring, so
    // a stale link still returns a list.
    //
    // Only fields no FILTER can reach. Group, payment period, preset month
    // and the three amounts have controls in the panel; a second way to ask
    // the same question is two things to keep in step.
    const SEARCH_COLUMNS = {
      location: ['location'],
      postcode: ['postcode'],
      bankDetails: ['bank_details'],
      accountNumber: ['account_number'],
      sortCode: ['sort_code'],
      notes: ['notes'],
      doorNumber: ['door_number'],
      // Added for the agent: retiring search_master_sheet took away the only
      // way to ask 'everyone at Acqua', and a set question belongs on a
      // filter anyway. The web picker has its own list and is unchanged.
      company: ['company'],
    };

    params.push(`%${q}%`);
    const text = `$${params.length}`;
    const askedFields = listValues(searchField);
    const picked = askedFields
      ? [...new Set(askedFields.flatMap((field) => SEARCH_COLUMNS[field] ?? []))]
      : SEARCH_COLUMNS[searchField];

    if (picked?.length) {
      where.push(`(${picked.map((c) => `${c} ILIKE ${text}`).join(' OR ')})`);
    } else {
      // ANY: the four the box has always covered. Unchanged, and still the
      // default, so nobody's habit breaks.
      //
      // Phones are stored `+447480373790`; people search `07480373790`.
      // Both sides to digits, trunk zero off the query. Only for queries that
      // look numeric, or "Nathan" would strip to nothing.
      const digits = String(q).replace(/\D/g, '');
      let phoneClause = `phone ILIKE ${text}`;
      if (digits.length >= 4) {
        params.push(`%${digits.replace(/^0+/, '')}%`);
        phoneClause = `(${phoneClause} OR regexp_replace(phone, '\\D', '', 'g') ILIKE $${params.length})`;
      }

      where.push(
        `(person_name ILIKE ${text} OR company ILIKE ${text} OR role_label ILIKE ${text} OR ${phoneClause})`,
      );
    }
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const result = await pool.query(
    `WITH filtered AS (SELECT ${COLUMNS} FROM tb_mastersheet ${whereSql})
     SELECT
       (SELECT count(*)::int FROM filtered) AS total,
       COALESCE(
         (SELECT json_agg(f) FROM (SELECT * FROM filtered ${stopped ? ORDER_STOPPED : ORDER} LIMIT $${limitParam} OFFSET $${offsetParam}) f),
         '[]'
       ) AS rows`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: result.rows[0].rows, total: result.rows[0].total };
}

/**
 * The polishing agent's lookup — same idea as findAll's `q`, but ranked by
 * trigram similarity (pg_trgm, migration 014) so a typo like "deivivas"
 * still surfaces "Deividas" as a top candidate instead of finding nothing.
 * Plain ILIKE substring is OR'd in alongside it, so an exact/partial
 * spelling still matches even if trgm's similarity score is too low to
 * clear its own threshold.
 *
 * Falls back to plain ILIKE-only if pg_trgm isn't installed yet (migration
 * 014 not run) — degrades to the old behaviour rather than a 500.
 */
/**
 * ===============================
 * * AN ENDED DEAL IS NOT ONE OF THEIR DEALS
 * ===============================
 * This had no `stopped_on` filter, so every lookup that resolves a PERSON
 * counted their archive. Live 2026-09-24: Nathan came back as SEVEN deals,
 * five live and two stopped on 22 September, and one of the stopped ones
 * carries 3,000.
 *
 * She then said "their deals range from 700 to 3,000" about money nobody
 * is owed, and a profile rate confirm offered to change "all 7 of their
 * deals". The count an admin agrees to has to be the count that exists.
 *
 * DEFAULT FALSE, the same word and the same default `findAll` uses, so
 * "the archive is one flag" stays true of both. Every caller today is one
 * of Diane's lookups and wants the live rows; the Archive page reads
 * through `findAll({ stopped: true })` and never comes here.
 */
async function searchFuzzy(options) {
  // Cached under the exact arguments, and dropped by any write — so a deal
  // added seconds ago is findable immediately, cache or no cache. THE FLAG
  // IS IN THE KEY: left out, the first caller's answer would be served to
  // the other and the archive would leak back in through the cache.
  const {
    q, group, limit = 10, loose = false, stopped = false,
  } = options;
  return cache.wrap(
    `search:${q}|${group ?? ''}|${limit}|${loose}|${stopped}`,
    () => runSearchFuzzy(options),
  );
}

async function runSearchFuzzy({
  q, group, limit = 10, loose = false, stopped = false,
}) {
  const groupSql = group ? 'AND upper(group_name) = upper($2)' : '';
  const liveSql = stopped ? 'AND stopped_on IS NOT NULL' : 'AND stopped_on IS NULL';
  const params = group ? [q, group] : [q];

  try {
    // The `%` operator uses pg_trgm's session similarity threshold, which
    // defaults to 0.3 — and that is too strict for short names, which is
    // where typos actually happen. Real case: "Zine" vs "Zane" scores 0.25,
    // because a four-letter word only has five trigrams and two differ. The
    // admin got "no rows matched" for a one-letter mishearing.
    //
    // So the threshold is scored explicitly rather than left to the
    // operator, and it scales with the length of what was typed: forgiving
    // on short names, stricter on long ones where a low score really does
    // mean a different person.
    // `loose` is the second pass, run only when the normal one found
    // nothing at all. A dead end ("no rows matched") is the least useful
    // answer available — the admin knows the person exists, they just said
    // the name badly. At 0.08 almost anything with a shared syllable comes
    // back, which is worthless as a MATCH but exactly right as a "did you
    // mean". The caller is responsible for presenting it as a guess.
    const threshold = loose
      ? 0.08
      : q.length <= 5 ? 0.18 : q.length <= 8 ? 0.26 : 0.3;

    const result = await pool.query(
      `SELECT ${COLUMNS},
              greatest(similarity(person_name, $1), similarity(coalesce(company, ''), $1)) AS name_score
       FROM tb_mastersheet
       WHERE (
               similarity(person_name, $1) >= ${threshold}
               OR similarity(coalesce(company, ''), $1) >= ${threshold}
               OR person_name ILIKE '%' || $1 || '%'
               OR company ILIKE '%' || $1 || '%'
             )
       ${groupSql}
       ${liveSql}
       ORDER BY greatest(similarity(person_name, $1), similarity(coalesce(company, ''), $1)) DESC
       LIMIT ${limit}`,
      params,
    );
    return result.rows;
  } catch (err) {
    // 42883 = undefined function/operator — pg_trgm's % and similarity()
    // aren't installed. Any other error is a real problem, not a fallback case.
    if (err.code !== '42883') throw err;
    const likeSql = `AND (person_name ILIKE '%' || $1 || '%' OR company ILIKE '%' || $1 || '%')`;
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM tb_mastersheet WHERE true ${likeSql} ${groupSql} ${liveSql} LIMIT ${limit}`,
      params,
    );
    return result.rows;
  }
}

/**
 * whatbot's payday write, landing directly on the deal.
 *
 * Used to be a mirror: whatbot wrote a `payment_status` row keyed to an
 * `assignments` row, and this copied the outcome across. Both of those
 * tables are gone (migration 022), so there is nothing to mirror from —
 * the outcome IS the deal's own column now, which is one fewer place for
 * the same fact to disagree with itself.
 *
 * Three columns move together:
 *   payment_outcome      what they said. Admin-editable (see COLUMN_FOR).
 *   payment_replied_at   when they said it. whatbot's record, never edited.
 *   payment_note         their words verbatim. whatbot's, never edited.
 *
 * And `override_paid` follows the outcome when the outcome actually says
 * something about whether money arrived — 'confirmed' and 'partial' turn
 * it on, 'not_received' turns it off, 'sent' and 'no_response' leave it
 * exactly as the admin set it. Passing `paid: undefined` is how the
 * caller says "this outcome tells us nothing about that".
 *
 * Deliberately NOT routed through update(), because update() now claims
 * every column it touches as a manual override. whatbot is not a human
 * and must never freeze a column against the next uploaded sheet. Logged
 * as changedVia 'sync' for the same reason.
 */
async function applyPaydayOutcome(id, { outcome, note, repliedAt, paid }) {
  // Invalidates the read cache: this writes rows.
  cache.invalidate();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      'SELECT id, person_name, payment_outcome FROM tb_mastersheet WHERE id = $1',
      [id],
    );
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const old = before.rows[0];

    // override_paid_at is a real timestamp, set the moment paid turns
    // true and cleared when it turns false — not just a boolean's shadow.
    const paidSql =
      paid === undefined
        ? ''
        : ', override_paid = $5, override_paid_at = CASE WHEN $5 THEN now() ELSE NULL END';
    const params = [id, outcome, note ?? null, repliedAt ?? new Date()];
    if (paid !== undefined) params.push(paid);

    const after = await client.query(
      `UPDATE tb_mastersheet
          SET payment_outcome = $2, payment_note = $3, payment_replied_at = $4${paidSql},
              updated_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      params,
    );
    const row = after.rows[0];

    // Only a genuine change is logged. whatbot re-sending the same
    // outcome (a retry, a duplicate reply) must not fill the history with
    // entries where nothing moved.
    if (String(old.payment_outcome) !== String(row.payment_outcome)) {
      await client.query(
        `INSERT INTO tb_mastersheet_changes (row_id, person_name, field, old_value, new_value, changed_via)
         VALUES ($1, $2, 'paymentOutcome', $3, $4, 'sync')`,
        [id, row.person_name, old.payment_outcome, row.payment_outcome],
      );
    }

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Rows that are the SAME ARRANGEMENT as the one described — same person,
 * company, role and seat, however any of it was spelled.
 *
 * Runs before a row is hand-added so nobody types out something the sheet
 * already contains. Returns every match rather than a boolean: the caller
 * shows them, because one person legitimately holding the same role on
 * one company twice is real (different payable days) and refusing it
 * outright would break a genuine case.
 */
function findMatchingDeals({ groupName, company, role, seat, personId }) {
  return pool
    .query(
      `SELECT ${COLUMNS} FROM tb_mastersheet
       WHERE regexp_replace(lower(group_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower($1), '[^a-z0-9]', '', 'g')
         AND regexp_replace(lower(coalesce(company, '')), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce($2, '')), '[^a-z0-9]', '', 'g')
         AND regexp_replace(lower(role), '[^a-z0-9]', '', 'g') = regexp_replace(lower($3), '[^a-z0-9]', '', 'g')
         AND coalesce(seat, -1) = coalesce($4::int, -1)
         AND regexp_replace(lower(person_id), '[^a-z0-9]', '', 'g') = regexp_replace(lower($5), '[^a-z0-9]', '', 'g')
       ${ORDER}`,
      [groupName ?? '', company ?? '', role ?? '', seat ?? null, personId ?? ''],
    )
    .then((r) => r.rows);
}

/** One deal by its own identity — what whatbot's payday write keys on. */
function findBySyncKey(syncKey) {
  return pool
    .query(`SELECT ${COLUMNS} FROM tb_mastersheet WHERE sync_key = $1`, [syncKey])
    .then((r) => r.rows[0] ?? null);
}

/** Every deal one person holds — the person detail page and whatbot both. */
function findByPersonId(personId) {
  return pool
    .query(`SELECT ${COLUMNS} FROM tb_mastersheet WHERE person_id = $1 ${ORDER}`, [personId])
    .then((r) => r.rows);
}

/**
 * "What did you just change?" — for the polishing agent's recent-activity
 * tool. `created_at !== updated_at` is the "edited, not just created" cue
 * (both get stamped `now()` on insert — see `create()` above — so they
 * start out equal and only drift apart once `update()` touches the row).
 * "Which rows changed" only — no old/new values here. See
 * findFieldChanges() below for the actual per-field before/after.
 */
/**
 * THE TRUE COUNT TRAVELS WITH THE PAGE.
 *
 * It returned the capped rows and nothing else, and the caller reported
 * `rows.length` as "N rows changed": a day with forty edits was read back
 * to the admin as twenty-five, with fifteen silently missing and no sign
 * that anything had been dropped. A cap you cannot see is worse than a
 * smaller one you can.
 */
async function findRecentlyUpdated({ hours = 24, limit = 200, person = null, people = null } = {}) {
  const names = listValues(people);
  const { rows } = await pool.query(
    `WITH recent AS (
       SELECT ${COLUMNS}, (updated_at > created_at + interval '5 seconds') AS was_edited
       FROM tb_mastersheet
       WHERE updated_at > now() - ($1 || ' hours')::interval
         AND (($3::text IS NULL AND $4::text[] IS NULL)
           OR ($3::text IS NOT NULL AND
             regexp_replace(lower(coalesce(person_name, '')), '[^a-z0-9]', '', 'g') =
             regexp_replace(lower($3), '[^a-z0-9]', '', 'g'))
           OR EXISTS (
           SELECT 1 FROM unnest(coalesce($4::text[], ARRAY[]::text[])) AS asked(name)
           WHERE regexp_replace(lower(coalesce(person_name, '')), '[^a-z0-9]', '', 'g') =
             regexp_replace(lower(asked.name), '[^a-z0-9]', '', 'g')
         ))
     )
     SELECT
       (SELECT count(*)::int FROM recent) AS total,
       COALESCE(
         (SELECT json_agg(r) FROM (
            SELECT * FROM recent ORDER BY updated_at DESC LIMIT $2
          ) r),
         '[]'
       ) AS rows`,
     [hours, limit, person, names],
  );
  return { rows: rows[0].rows, total: rows[0].total };
}

/**
 * The actual "what got edited" answer — real field-level before/after,
 * from tb_mastersheet_changes (migration 015). Carries edits made through
 * update() (the admin's form, Diane's update tool) and, since migration
 * 033, whatever an upload changed on a row that already existed. A row an
 * upload CREATED does not appear: nothing was edited, it did not exist
 * before.
 */
/**
 * DID A HUMAN TOUCH THESE FIELDS SINCE A GIVEN MOMENT?
 *
 * For parked work: a change agreed in October must not overwrite an edit he
 * made himself in December. The change LOG is the only record with a time
 * on it — `manually_overridden_fields` says a column was claimed but not
 * when, so it cannot answer "after this was parked".
 *
 * 'sync' and 'scheduled' are excluded on purpose. An import is the sheet
 * restating itself, and a scheduled write is this very mechanism; neither
 * is him changing his mind.
 */
function editedByHandSince({ rowId, fields = [], since }) {
  if (!rowId || fields.length === 0 || !since) return Promise.resolve(null);
  return pool
    .query(
      `SELECT field, old_value, new_value, changed_via, changed_at
         FROM tb_mastersheet_changes
        WHERE row_id = $1
          AND field = ANY($2::text[])
          AND changed_at > $3
          AND changed_via NOT IN ('sync', 'scheduled')
          AND reverted_at IS NULL
        ORDER BY changed_at DESC
        LIMIT 1`,
      [Number(rowId), fields, since],
    )
    .then((r) => r.rows[0] ?? null);
}

function findFieldChanges({
  hours = 24,
  limit = 100,
  rowId = null,
  personId = null,
  person = null,
  people = null,
  company = null,
  includeReverted = false,
  rowIds = null,
  q = null,
  offset = 0,
  withTotal = false,
  field = null,
} = {}) {
  const names = listValues(people);
  const scopedRowIds = Array.isArray(rowIds)
    ? [...new Set(rowIds.map(Number).filter(Number.isInteger))]
    : null;
  return pool
    .query(
      `WITH scoped AS (
       SELECT c.id, c.row_id, c.person_name, c.field, c.old_value, c.new_value,
              c.changed_via, c.changed_at, c.reverted_at,
              -- Whether the row is still there to undo onto. A change
              -- against a deleted deal can be read but never reverted, and
              -- the panel needs to say so rather than offer a button that
              -- 404s.
              (m.id IS NOT NULL) AS row_exists,
               m.person_id, m.company, m.group_name
       FROM tb_mastersheet_changes c
       LEFT JOIN tb_mastersheet m ON m.id = c.row_id
       WHERE c.changed_at > now() - ($1 || ' hours')::interval
         AND ($3::int IS NULL OR c.row_id = $3::int)
         AND ($4::boolean OR c.reverted_at IS NULL)
          AND ($5::text IS NULL OR m.person_id = $5::text)
          AND ($6::text IS NULL OR
            regexp_replace(lower(coalesce(m.company, '')), '[^a-z0-9]', '', 'g') =
            regexp_replace(lower($6), '[^a-z0-9]', '', 'g'))
          AND (($7::text IS NULL AND $8::text[] IS NULL)
            OR ($7::text IS NOT NULL AND
              regexp_replace(lower(coalesce(c.person_name, m.person_name, '')), '[^a-z0-9]', '', 'g') =
              regexp_replace(lower($7), '[^a-z0-9]', '', 'g'))
            OR EXISTS (
            SELECT 1 FROM unnest(coalesce($8::text[], ARRAY[]::text[])) AS asked(name)
            WHERE regexp_replace(lower(coalesce(c.person_name, m.person_name, '')), '[^a-z0-9]', '', 'g') =
              regexp_replace(lower(asked.name), '[^a-z0-9]', '', 'g')
          ))
         AND ($9::int[] IS NULL OR c.row_id = ANY($9::int[]))
         AND ($10::text IS NULL OR concat_ws(' ',
           coalesce(c.person_name, m.person_name, ''),
           coalesce(m.company, ''), coalesce(m.group_name, ''), c.field
         ) ILIKE $10::text)
         AND ($12::text IS NULL OR c.field = $12::text)
      )
      SELECT page.*, totals.total_count
      FROM (SELECT COUNT(*)::int AS total_count FROM scoped) totals
      LEFT JOIN LATERAL (
        SELECT * FROM scoped ORDER BY changed_at DESC LIMIT $2 OFFSET $11
      ) page ON true`,
       [hours, limit, rowId, includeReverted, personId, company, person, names,
         scopedRowIds, q ? `%${q}%` : null, offset, field],
    )
    .then((result) => {
      const total = result.rows[0]?.total_count ?? 0;
      const rows = result.rows.filter((row) => row.id != null)
        /**
         * WHETHER AN UNDO CAN WORK, decided where the rule lives.
         *
         * It refused any field outside COLUMN_FOR, and `end_note` and
         * `review_monthly` are deliberately outside it: an import writes
         * them, no form does. The panel offered Undo on them anyway and
         * every press came back 409, which reads as a broken button rather
         * than as a rule. Found 2026-09-21.
         *
         * THE SET GREW ON 2026-09-22, and this had to grow with it. The
         * company cascade now logs those same columns so its one press
         * undo can put an end date back, so UNDOABLE and HAND EDITABLE are
         * two different questions with two different answers. Left reading
         * COLUMN_FOR alone, History would hide the button on exactly the
         * changes the undo was built for.
         *
         * Sent as a FLAG, not as a field list the browser has to keep in
         * step: `row_exists` above is here for the same reason.
         */
        .map(({ total_count, ...row }) => ({
          ...row,
          revertible: Boolean(row.row_exists) && isUndoableField(row.field),
        }));
      return withTotal ? { rows, total } : rows;
    });
}

/**
 * Put one field back to what it was.
 *
 * Writes through update() rather than straight to the column, so the
 * revert is itself logged, invalidates the same cache, and claims the
 * column against the next upload exactly as any other manual edit does —
 * which matters, because the value being restored is a human's decision
 * just as much as the one that overwrote it.
 *
 * old_value is text (that is what the log stores). Postgres casts it back
 * to numeric, date or boolean on the way in; a genuinely empty old value
 * is restored as NULL rather than as the string "null".
 */
/**
 * WHAT AN UNDO WOULD TOUCH, without touching it.
 *
 * Added after a live run reverted the wrong row. She was asked to undo the
 * last change to a scratch group, passed a change id that belonged to a
 * REAL deal, and Pino's preset month moved from August to July: silently
 * out of the August payout, with nothing on screen to say so.
 *
 * The undo tool now reads this first and makes the admin confirm the ROW
 * and the FIELD by name, so an id that points somewhere unexpected is
 * caught by the person who asked, not discovered in a total.
 */
async function peekFieldChange(changeId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.row_id, c.field, c.old_value, c.new_value, c.reverted_at,
            m.person_name, m.company, m.group_name, (m.id IS NOT NULL) AS row_exists
     FROM tb_mastersheet_changes c
     LEFT JOIN tb_mastersheet m ON m.id = c.row_id
     WHERE c.id = $1`,
    [changeId],
  );
  return rows[0] ?? null;
}

/**
 * ===============================
 * * ONE MASS EDIT IS ONE ACT, so it undoes as one
 * ===============================
 *
 * A bulk update writes up to 500 change rows. Undoing that one id at a
 * time is 500 confirmations, which is not an undo, so the mass edit had no
 * way back at all.
 *
 * There is no batch id on the table and adding one would not help the
 * changes already written, so a batch is RECOVERED: same actor, no gap
 * longer than `BATCH_GAP_SECONDS` between consecutive writes.
 *
 * NOT PARTITIONED BY FIELD. One bulk call setting the preset AND the
 * payable days writes two fields, and splitting them made "undo that" put
 * half of it back. `changed_at` is transaction time, so every row of one
 * loop shares a timestamp and the gap only has to separate two SEPARATE
 * acts, which is why it is seconds rather than minutes.
 */
const BATCH_GAP_SECONDS = 15;

async function findChangeBatches({ hours = 24, limit = 20000 } = {}) {
  const { rows } = await pool.query(
    `WITH c AS (
       SELECT ch.id, ch.row_id, ch.person_name, ch.field, ch.old_value, ch.new_value,
              ch.changed_via, ch.changed_at,
              -- CARRIED DOWN, or the grouping below cannot see it. It was
              -- filtered on here and never selected, so every later CTE
              -- read it off the grouped step, which did not have it, and the whole
              -- query died on "column batch_id does not exist".
              ch.batch_id,
              -- THE GROUP TRAVELS WITH THE CHANGE, so a revert can be
              -- narrowed to one group without a second round trip. The log
              -- does not carry it: it belongs to the row.
              m.group_name,
              -- AN UNDO, logged in the transaction that marked what it undid,
              -- so "undo that" never reaches for the undo itself.
              EXISTS (SELECT 1 FROM tb_mastersheet_changes o
                       WHERE o.reverted_at = ch.changed_at AND o.field = ch.field
                         AND o.row_id IS NOT DISTINCT FROM ch.row_id) AS undoes
       FROM tb_mastersheet_changes ch
       LEFT JOIN tb_mastersheet m ON m.id = ch.row_id
       WHERE ch.changed_at > now() - ($1 || ' hours')::interval
         AND ch.reverted_at IS NULL
         /**
          * ===============================
          * * A BATCH IS WHOLE OR IT IS NOT OFFERED
          * ===============================
          * The LIMIT below cuts at a row, not at a batch boundary, so the
          * oldest batch in range comes back with some of its changes
          * missing. Undo it and half a cascade is restored while the rest
          * stays where it was, which is worse than not offering it.
          *
          * Harmless while the window was a week and the limit was never
          * reached. At a month it is reachable, so a recorded batch is
          * taken in FULL or left out: if any of its rows falls outside the
          * window, none of them are listed.
          *
          * A PART UNDONE BY NAME leaves the rest offered. Dropping the whole
          * batch sent "undo Orla's" to an older one on deleted deals. 2026-09-25.
          *
          * Nothing to do for the guessed ones. A gap batch has no identity
          * to check against, which is the other reason to record them.
          */
         AND (
           ch.batch_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM tb_mastersheet_changes older
              WHERE older.batch_id = ch.batch_id
                AND older.changed_at <= now() - ($1 || ' hours')::interval
           )
         )
       ORDER BY ch.changed_at DESC
       LIMIT $2
     ), gapped AS (
       SELECT *, CASE WHEN lag(changed_at) OVER w - changed_at
                        > ($3 || ' seconds')::interval THEN 1 ELSE 0 END AS starts
       FROM c WINDOW w AS (PARTITION BY changed_via ORDER BY changed_at DESC, id DESC)
     ), grouped AS (
       SELECT *, sum(starts) OVER (PARTITION BY changed_via ORDER BY changed_at DESC, id DESC
                                   ROWS UNBOUNDED PRECEDING) AS batch
       FROM gapped
     ), keyed AS (
       /**
        * A RECORDED BATCH BEATS A GUESSED ONE.
        *
        * The gap above is how a batch was recovered while nothing stored
        * one, and it stays for every change written before migration 062.
        * It has two silent failures a cascade cannot afford: a write
        * slower than the gap splits into two rows, so undoing one puts
        * half the deals back, and two unrelated edits inside the gap merge
        * into one, so undoing that reverts something nobody pointed at.
        *
        * batch_id is the same act saying so itself, so it wins whenever
        * it is there.
        */
       SELECT *, COALESCE(batch_id::text, 'gap:' || batch::text) AS batch_key FROM grouped
     )
     SELECT changed_via, count(*)::int AS rows,
            count(DISTINCT row_id)::int AS deals,
            bool_and(undoes) AS undoes,
            max(changed_at) AS changed_at,
            array_agg(id ORDER BY id) AS ids,
            array_agg(DISTINCT field) AS fields,
            array_agg(DISTINCT group_name) FILTER (WHERE group_name IS NOT NULL) AS groups,
            (array_agg(DISTINCT person_name))[1:6] AS people,
            -- EVERY CHANGE, so a revert can be narrowed by group or hold a
            -- person back without asking the database a second time. One
            -- mass edit is a couple of hundred small objects, not a table.
            jsonb_agg(jsonb_build_object(
              'id', id, 'rowId', row_id, 'person', person_name, 'group', group_name, 'field', field
            ) ORDER BY id) AS changes,
            -- Per field, because one batch can set three of them and a
            -- flat list of values reads as "set to 1000, 2026-09-01, 30".
            jsonb_agg(DISTINCT jsonb_build_object('field', field, 'value', new_value, 'was', old_value)) AS field_values
     FROM keyed
     GROUP BY changed_via, batch_key
     ORDER BY max(changed_at) DESC`,
    [hours, limit, BATCH_GAP_SECONDS],
  );
  return rows;
}

/**
 * Every id in the batch, one at a time through the same single revert, so
 * a batch undo and a hand undo cannot drift apart. A row that refuses is
 * NAMED rather than averaged into a count: a half-undone mass edit is the
 * thing this exists to avoid being invisible.
 */
async function revertChangeBatch(ids, onEach = null, { via = 'admin', batchId = null } = {}) {
  const done = [];
  const failed = [];
  // A profile revert closes its sibling entries itself, so they are done.
  const covered = new Set();
  for (const id of ids) {
    if (covered.has(Number(id))) {
      done.push({ ok: true, covered: true });
      onEach?.(done.length + failed.length, {});
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const out = await revertFieldChange(Number(id), { via, batchId }).catch(() => null);
    for (const c of out?.covers ?? []) covered.add(Number(c));
    if (out?.ok) done.push(out); else failed.push({ id, reason: out?.reason ?? 'it could not be written' });
    // Row by row, so a couple of hundred writes is watched rather than
    // waited out. Absent (a test, another caller) it does nothing.
    onEach?.(done.length + failed.length, { person: out?.row?.person_name, group: out?.row?.group_name });
  }
  return { done, failed };
}

/**
 * `via` says WHO undid it: Diane's undo was logged as 'admin'. `batchId`
 * makes a batch undo one change in History, and one an undo can reverse.
 */
async function revertFieldChange(changeId, { via = 'admin', batchId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT c.id, c.row_id, c.field, c.old_value, c.new_value, c.reverted_at, c.changed_at,
            (m.id IS NOT NULL) AS row_exists
     FROM tb_mastersheet_changes c
     LEFT JOIN tb_mastersheet m ON m.id = c.row_id
     WHERE c.id = $1`,
    [changeId],
  );
  const change = rows[0];
  if (!change) return { ok: false, reason: 'That change no longer exists.' };
  if (change.reverted_at) return { ok: false, reason: 'That change has already been undone.' };
  if (!change.row_exists) return { ok: false, reason: 'The deal it belonged to has been deleted.' };
  /**
   * ===============================
   * * UNDOABLE IS NOT THE SAME SET AS HAND EDITABLE
   * ===============================
   * This refused anything outside COLUMN_FOR, and `end_note`,
   * `review_monthly` and `stopped_on` are deliberately outside it: they
   * are not cells somebody types into. The moment the company cascade
   * started logging them, every one of its changes came back
   * "not an editable field" and the one-press undo undid nothing.
   *
   * Found 2026-09-22 by the drill, before it shipped. Putting them in
   * COLUMN_FOR would have been the wrong fix twice over: it would make
   * them look typeable and `editableFields.test.js` would then demand a
   * route parse a field no form sends.
   *
   * So a SECOND list, and it says exactly what it is: fields a cascade
   * writes and an undo may put back.
   */
  if (isProfileRateField(change.field)) {
    cache.invalidate();
    const back = await peopleRepo.revertProfileRate(change, { via });
    if (!back.ok) return back;
    return { ...back, row: await findById(change.row_id) };
  }
  if (isCompanyField(change.field)) {
    cache.invalidate();
    const back = await companiesRepo.revertCompanyField(change, { via });
    if (!back.ok) return back;
    return { ...back, row: await findById(change.row_id) };
  }
  if (isReviewAnswerField(change.field)) {
    // Required here, not at the top: that repo requires this one.
    const back = await require('./monthlyReview.repo').revertAnswer(change);
    if (back.ok) await pool.query('UPDATE tb_mastersheet_changes SET reverted_at = now() WHERE id = $1', [changeId]);
    return back;
  }

  const column = COLUMN_FOR[change.field] ?? RESTORABLE[change.field];
  if (!column) return { ok: false, reason: `"${change.field}" is not an editable field.` };

  if (COLUMN_FOR[change.field]) {
    // NOT a claim: putting a value back is not somebody deciding the column.
    const restored = await update(
      change.row_id, { [change.field]: change.old_value ?? null }, via, { batchId, claim: false },
    );
    /**
     * STAMPED WITH THE UNDO'S OWN TIME. `undoes` in findChangeBatches
     * matches `reverted_at` to the undo row's `changed_at`; `now()` here
     * is a later transaction, so the undo was never recognised as one and
     * a second "undo that" put the 550 straight back. 2026-10-03.
     */
    await pool.query(
      `UPDATE tb_mastersheet_changes
          SET reverted_at = COALESCE((
            SELECT u.changed_at FROM tb_mastersheet_changes u
             WHERE u.row_id = $2 AND u.field = $3 AND u.id > $1
             ORDER BY u.id DESC LIMIT 1
          ), now())
        WHERE id = $1`,
      [changeId, change.row_id, change.field],
    );
    return { ok: true, row: restored, field: change.field, value: change.old_value };
  }

  /**
   * THE CASCADE FIELDS GO BACK BY COLUMN, and the revert is logged like
   * any other so the trail says who undid what. `update()` cannot carry
   * them precisely because they are not in its map.
   *
   * CAST FROM TEXT, because the log stores every value as text: a date
   * column will not take '2026-12-31' without being told what it is, and a
   * boolean will not take 'true'.
   */
  cache.invalidate();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /**
     * A STOP IS TWO COLUMNS, and the table requires both or neither. Putting
     * back only the date ("undo that" after a resume, or after a stop)
     * broke that pair and the revert failed every time. 2026-10-03.
     */
    const pairSql = change.field === 'stoppedOn'
      ? `, stopped_reason = CASE WHEN $2::text IS NULL THEN NULL
                               ELSE COALESCE(stopped_reason, '${STOPPED_REASON.BY_HAND}') END`
      : '';
    const back = await client.query(
      `UPDATE tb_mastersheet
          SET ${column} = $2::text::${RESTORABLE_TYPE[change.field]}${pairSql}, updated_at = now()
        WHERE id = $1
      RETURNING ${COLUMNS}`,
      [change.row_id, change.old_value ?? null],
    );
    await client.query(
      `INSERT INTO tb_mastersheet_changes
         (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)`,
      [change.row_id, back.rows[0]?.person_name, change.field, change.new_value, change.old_value, via, batchId],
    );
    await client.query(
      'UPDATE tb_mastersheet_changes SET reverted_at = now() WHERE id = $1',
      [changeId],
    );
    await client.query('COMMIT');
    return { ok: true, row: back.rows[0], field: change.field, value: change.old_value };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * "What should I clean up?" — for the polishing agent's audit tool. Every
 * check here is a genuine gap or a POSSIBLE issue flagged as such, never a
 * definite one presented as fact — a duplicate name+company+role can be
 * two real payments (whatbot's own rule: different payable days on the
 * same role is legitimate, not a mistake), so it's surfaced for a human to
 * judge, not auto-corrected.
 *
 * Returns both the counts AND the actual rows behind each one
 * (`jsonb_agg` per category, uncapped — the table is ~150 rows total, so
 * even every row landing in one category is a small payload). The counts
 * are what the tool leads with; the row lists are there so "give me the
 * full breakdown" as a follow-up can be answered from THIS SAME call's
 * data without a separate round trip — see tools.js's auditRows handler.
 */
async function auditSummary() {
  const result = await pool.query(`
    SELECT
      count(*) FILTER (WHERE needs_review) AS needs_review,
      count(*) FILTER (WHERE payable_amount = 0 AND monthly_amount > 0) AS zero_payable,
      -- More paid than the deal is worth in a month: nearly always a hand typed payable.
      count(*) FILTER (WHERE payable_amount > monthly_amount) AS payable_over_monthly,
      coalesce(jsonb_agg(jsonb_build_object('name', person_name, 'company', company, 'group', group_name))
        FILTER (WHERE payable_amount > monthly_amount), '[]') AS payable_over_monthly_rows,
      count(*) FILTER (WHERE payment_start_on IS NULL) AS missing_payment_start,
      count(*) FILTER (WHERE company IS NULL AND group_name NOT IN ('ALL GROUPS', 'TAKEOFF')) AS missing_company,
      count(*) FILTER (WHERE phone = '' OR phone IS NULL) AS missing_phone,
      count(*) FILTER (WHERE currency IS NULL OR currency = '') AS missing_currency,
      -- THE DATES TRAVEL WITH IT: a zero is only wrong on a deal owed this
      -- month, which the caller decides with isOwedThisMonth. No SQL here
      -- may ask what month it is (see configs/db.js).
      coalesce(jsonb_agg(jsonb_build_object('name', person_name, 'company', company, 'group', group_name,
        'preset_on', preset_on, 'payment_start_on', payment_start_on, 'end_on', end_on,
        'special_case_deal', special_case_deal, 'stopped_on', stopped_on))
        FILTER (WHERE payable_amount = 0 AND monthly_amount > 0), '[]') AS zero_payable_rows,
      coalesce(jsonb_agg(jsonb_build_object('name', person_name, 'company', company, 'group', group_name))
        FILTER (WHERE payment_start_on IS NULL), '[]') AS missing_payment_start_rows,
      coalesce(jsonb_agg(jsonb_build_object('name', person_name, 'company', company, 'group', group_name))
        FILTER (WHERE company IS NULL AND group_name NOT IN ('ALL GROUPS', 'TAKEOFF')), '[]') AS missing_company_rows,
      coalesce(jsonb_agg(jsonb_build_object('name', person_name, 'company', company, 'group', group_name))
        FILTER (WHERE phone = '' OR phone IS NULL), '[]') AS missing_phone_rows,
      coalesce(jsonb_agg(jsonb_build_object('name', person_name, 'company', company, 'group', group_name))
        FILTER (WHERE needs_review), '[]') AS needs_review_rows,
      coalesce(jsonb_agg(jsonb_build_object('name', person_name, 'company', company, 'group', group_name))
        FILTER (WHERE currency IS NULL OR currency = ''), '[]') AS missing_currency_rows
    FROM tb_mastersheet
    -- A ROW OFF THE SHEET HAS NOTHING TO FIX. This lists what needs
    -- attention, and an archived deal's missing phone is not work.
    WHERE stopped_on IS NULL
  `);

  // Grouped rather than counted — "3 people share a name+company+role" is
  // useful to list by name; a bare count isn't actionable on its own.
  const dupes = await pool.query(`
    SELECT person_name, company, group_name, role_label, count(*)::int AS n
    FROM tb_mastersheet
    WHERE stopped_on IS NULL
    GROUP BY person_name, company, group_name, role_label
    HAVING count(*) > 1
    ORDER BY n DESC
    LIMIT 15
  `);

  return { ...result.rows[0], possibleDuplicates: dupes.rows };
}

/**
 * Every LIVE row, unpaginated — for whatbot's 5-min pull and the xlsx
 * export, both of which need the whole sheet or nothing. Realistic scale
 * is the current master sheet (~100 rows), not a growing log.
 *
 * ===============================
 * * ARCHIVED IS OFF THE SHEET, AND THIS IS THE SHEET
 * ===============================
 * It had no `stopped_on` filter, so every reader of "the whole sheet" got
 * the archived deals back: the export wrote 43 INDIGO rows against his 41
 * and 29 MILKMAN against his 27, the dashboard summed them into its
 * figures under a variable called `liveRows`, and whatbot pulled them to
 * message about. Found on the exported file 2026-09-22.
 *
 * Archiving a deal is the admin taking it off the sheet. Nothing that asks
 * for the sheet wants it back. The Archive page reads the paged query with
 * `stopped: true`, which is the one place that does.
 */
/**
 * ***************************************************
 * * WHAT A PERSON'S OTHER DEALS ALREADY KNOW ABOUT THEM
 * ***************************************************
 *
 * A handler's phone, address and bank details are facts about the PERSON,
 * so every deal they hold carries the same eight columns and one of them
 * is usually the most complete. Typing them again on a new deal is how a
 * postcode ends up on one row and not the other.
 *
 * PERSON FACTS ONLY, his call 2026-09-23. Not the monthly amount, not the
 * method, not the dates: 20 of the 28 multi-handler companies pay their
 * handlers different negotiated amounts, so a copied wage is silently
 * wrong on the row nobody re-reads.
 *
 * TWO CANDIDATES, LIVE AND ARCHIVED, because they answer different
 * questions. A live deal is what the person looks like now; an archived
 * one is the last thing anybody knew, which is the only answer left for
 * somebody whose other deals have all ended.
 */
const PERSON_FILL_COLUMNS = [
  'phone', 'location', 'door_number', 'postcode', 'accepting_postals',
  'bank_details', 'account_number', 'sort_code',
];

/**
 * The best donor on each side, or null.
 *
 * "Best" is the MOST FILLED, then the most recently updated. A sentinel
 * counts as filled: `Will never be bank` and `Handled internally` are the
 * sheet's way of saying the fact is not held, which is an answer and not a
 * gap. See the SENTINELS note in masterSheet/canonical.js.
 *
 * @param {string} personId
 * @param {number|null} excludeId the row being edited, which cannot fill
 *   itself and would otherwise always win on a complete row.
 */
async function personFill(personId, { excludeId = null } = {}) {
  if (!personId) return { live: null, archive: null };
  // Allow listed above, never a caller's string, so building the sum by
  // hand cannot reach the query as anything but these eight names.
  const filled = PERSON_FILL_COLUMNS
    .map((c) => `(CASE WHEN nullif(btrim(coalesce(${c}, '')), '') IS NOT NULL THEN 1 ELSE 0 END)`)
    .join(' + ');

  const { rows } = await pool.query(
    `WITH theirs AS (
       SELECT id, company, group_name, updated_at, stopped_on,
              ${PERSON_FILL_COLUMNS.join(', ')},
              ${filled} AS filled
         FROM tb_mastersheet
        WHERE person_id = $1
          AND ($2::int IS NULL OR id <> $2::int)
     ), ranked AS (
       SELECT *, row_number() OVER (
                   PARTITION BY (stopped_on IS NULL)
                   ORDER BY filled DESC, updated_at DESC NULLS LAST
                 ) AS rn
         FROM theirs
        WHERE filled > 0
     )
     SELECT * FROM ranked WHERE rn = 1`,
    [personId, excludeId],
  );

  const pick = (live) => {
    const row = rows.find((r) => (r.stopped_on === null) === live);
    if (!row) return null;
    return {
      id: row.id,
      company: row.company,
      groupName: row.group_name,
      updatedAt: row.updated_at,
      stoppedOn: row.stopped_on,
      filled: Number(row.filled),
      // camelCase out, the same shape the form and every route speak.
      fields: Object.fromEntries(
        PERSON_FILL_COLUMNS
          .filter((c) => String(row[c] ?? '').trim() !== '')
          .map((c) => [FIELD_FOR_COLUMN[c], row[c]]),
      ),
    };
  };

  return { live: pick(true), archive: pick(false) };
}

function findAllRows() {
  return pool
    .query(`SELECT ${COLUMNS} FROM tb_mastersheet WHERE stopped_on IS NULL ${ORDER}`)
    .then((result) => result.rows);
}

function findById(id) {
  return cache.wrap(`byId:${id}`, () => pool
    .query(`SELECT ${COLUMNS} FROM tb_mastersheet WHERE id = $1`, [id])
    .then((result) => result.rows[0] ?? null));
}

// Header counts — always across the WHOLE table, never the current filter.
// "12 need review" has to stay true while you're looking at one group, or
// it's a number that changes meaning depending on where you're standing.
function counts() {
  return pool
    .query(
      /**
       * ===============================
       * * THE SAME SHEET THE PAGE IS SHOWING, ARCHIVED ROWS AND ALL
       * ===============================
       * It had no `stopped_on` filter while `findAllRows` gained one, so
       * the header read "92 from the sheet, 3 added by hand" over a table
       * saying 91 deals: 95 against 91, the four archived rows counted in
       * one place and not the other. Reported on sight 2026-09-23.
       *
       * A count that disagrees with the rows underneath it is worse than
       * no count. Both questions are "what is on this sheet", so both
       * exclude what was taken off it.
       */
      `SELECT
         count(*) FILTER (WHERE source = 'synced')::int AS synced,
         count(*) FILTER (WHERE source = 'manual')::int AS manual,
         count(*) FILTER (WHERE needs_review)::int AS needs_review
       FROM tb_mastersheet
       WHERE stopped_on IS NULL`,
    )
    .then((result) => result.rows[0]);
}

/**
 * An admin adding a deal the sheet missed — from the Master Sheet page,
 * from People ("assign this person to a company"), or from Companies
 * ("assign a handler"). All three write here; there is no second table
 * and therefore nothing to mirror into any more.
 *
 * `source` is forced to 'manual' rather than accepted from the caller —
 * it's what protects the row from being deleted by the next sync, so it's
 * never the caller's to set.
 */
function create(fields) {
  // Invalidates the read cache: this writes rows.
  cache.invalidate();
  const cols = ['sync_key', 'source'];
  const values = [fields.syncKey, 'manual'];

  for (const key of EDITABLE) {
    if (fields[key] === undefined) continue;
    cols.push(COLUMN_FOR[key]);
    values.push(fields[key]);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  return pool
    .query(
      `INSERT INTO tb_mastersheet (${cols.join(', ')}) VALUES (${placeholders}) RETURNING ${COLUMNS}`,
      values,
    )
    .then((result) => result.rows[0]);
}

/**
 * Wholesale-editable, unlike companies.repo.js's notes-only EDITABLE_FIELDS.
 * That restriction exists because a company's other fields have a sheet
 * behind them that sync overwrites anyway; here the admin's edit IS the
 * final version — that's the entire point of this table.
 *
 * `source` and `sync_key` are deliberately absent from EDITABLE: identity
 * and delete-protection aren't editable data.
 *
 * Reads the row first, applies the update, then logs one
 * tb_mastersheet_changes row per field that actually changed value —
 * a field present in `fields` but set to the same value it already held
 * doesn't get logged, since that's not a real edit. `changedVia` ('admin'
 * from the page's form, 'diane' from the polishing agent's tool) is what
 * lets "what did you just do" answer with real detail instead of only
 * "this row was touched" — see tools.js's recentChanges.
 */
/**
 * `batchId` makes several calls ONE change in History and to undo: a bulk
 * edit was six separate rows with no id, and undo had to guess them back
 * together by time. `claim: false` is for a revert, which puts a value
 * back and is not a person deciding the column.
 */
async function update(id, fields, changedVia = 'admin', { derived = [], batchId = null, claim = true } = {}) {
  // Invalidates the read cache: this writes rows.
  cache.invalidate();
  const sets = [];
  const params = [id];
  const touchedKeys = [];

  for (const key of EDITABLE) {
    if (!(key in fields)) continue;
    params.push(fields[key]);
    sets.push(`${COLUMN_FOR[key]} = $${params.length}`);
    touchedKeys.push(key);
  }
  /**
   * ===============================
   * * TYPING A REAL END DATE CLEARS HIS WORD
   * ===============================
   * `end_note` explains why the cell is BLANK. Once somebody puts a date
   * in it the note is stale, and leaving it would print "Going concern"
   * over a real date: the cell would be saying two different things about
   * the same fact.
   *
   * THE REVIEW FLAG IS LEFT ALONE. That is a decision made on the company
   * screen or by the import, not a description of this cell, and a deal
   * can legitimately have both an end date and a monthly review.
   */
  if ('endOn' in fields && fields.endOn) sets.push('end_note = NULL');

  if (sets.length === 0) return findById(id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(`SELECT ${COLUMNS} FROM tb_mastersheet WHERE id = $1`, [id]);
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const oldRow = before.rows[0];

    sets.push('updated_at = now()');

    // THE OVERRIDE GUARD. A human editing a column here claims it: the
    // next uploaded sheet will skip that column on this row instead of
    // overwriting the correction (see syncUpsert below).
    //
    // Without this, correcting Nathan from £1,000 to £3,000 lasts exactly
    // until the next upload still carrying £1,000, and it reverts with no
    // warning and no trace. That silent revert is the single worst thing
    // this table could do, because the number looks authoritative either
    // way.
    //
    // Only human edits claim a column. `changedVia: 'sync'` is the upload
    // writing through this same function, and an upload must never mark
    // its own values as manually protected — that would freeze the row
    // permanently after one sync.
    //
    // array_cat + a dedupe rather than a plain append: the same column
    // edited twice must not accumulate duplicates in the array.
    //
    // A DERIVED VALUE IS NOT A HUMAN'S CLAIM. recomputePayable adds
    // payableDays/payableAmount to the patch, and claiming those froze them
    // against every later upload while their own inputs kept moving.
    //
    // The length check matters: a patch of nothing but derived keys leaves
    // the array alone, and array_agg over no rows is NULL, which the
    // column forbids.
    const derivedKeys = new Set(derived);
    const claimed = touchedKeys.filter((k) => !derivedKeys.has(k)).map((k) => COLUMN_FOR[k]);
    if (changedVia !== 'sync' && claim && claimed.length > 0) {
      params.push(claimed);
      sets.push(`manually_overridden_fields = (
        SELECT array_agg(DISTINCT c)
        FROM unnest(array_cat(manually_overridden_fields, $${params.length}::text[])) AS c
      )`);
    }

    const after = await client.query(
      `UPDATE tb_mastersheet SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`,
      params,
    );
    const newRow = after.rows[0];

    for (const key of touchedKeys) {
      const column = COLUMN_FOR[key];
      // Both sides through the same coercion — comparing a number to a
      // string it happens to equal (30 vs "30") would otherwise log a
      // change that never actually happened.
      const oldValue = logValue(oldRow[column]);
      const newValue = logValue(newRow[column]);
      if (oldValue === newValue) continue;
      await client.query(
        `INSERT INTO tb_mastersheet_changes (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)`,
        [id, newRow.person_name, key, oldValue, newValue, changedVia, batchId],
      );
    }

    await client.query("COMMIT");

    return newRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateMany(changes, changedVia = 'admin', { derived = [], batchId = null } = {}) {
  cache.invalidate();
  const touchedKeys = EDITABLE.filter((key) => changes.some(({ fields }) => key in fields));
  if (changes.length === 0 || touchedKeys.length === 0) return [];
  const columns = touchedKeys.map((key) => COLUMN_FOR[key]);
  const ids = [...new Set(changes.map(({ id }) => Number(id)).filter(Number.isInteger))];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const beforeResult = await client.query(
      `SELECT ${COLUMNS} FROM tb_mastersheet WHERE id = ANY($1::int[])`,
      [ids],
    );
    const before = new Map(beforeResult.rows.map((row) => [row.id, row]));
    const records = changes.flatMap(({ id, fields }) => {
      const old = before.get(Number(id));
      if (!old) return [];
      const record = { id: Number(id) };
      for (const key of touchedKeys) {
        const column = COLUMN_FOR[key];
        record[column] = key in fields ? fields[key] : old[column];
      }
      return [record];
    });
    if (records.length === 0) {
      await client.query('ROLLBACK');
      return [];
    }

    const sets = columns.map((column) => `${column} = incoming.${column}`);
    sets.push('updated_at = now()');
    const params = [JSON.stringify(records)];
    // The same rule as update(): a value recomputePayable derived is written
    // but never claimed, or one bulk edit freezes the amount on every row it
    // touched. `derived` is the union across the batch, since the claim is.
    const derivedColumns = new Set(derived.map((key) => COLUMN_FOR[key] ?? key));
    const claimed = columns.filter((column) => !derivedColumns.has(column));
    if (changedVia !== 'sync' && claimed.length > 0) {
      params.push(claimed);
      sets.push(`manually_overridden_fields = (
        SELECT array_agg(DISTINCT column_name)
        FROM unnest(array_cat(tb_mastersheet.manually_overridden_fields, $2::text[])) AS column_name
      )`);
    }

    const afterResult = await client.query(
      `UPDATE tb_mastersheet
          SET ${sets.join(', ')}
         FROM jsonb_populate_recordset(NULL::tb_mastersheet, $1::jsonb) AS incoming
        WHERE tb_mastersheet.id = incoming.id
        RETURNING tb_mastersheet.*`,
      params,
    );

    const history = [];
    for (const row of afterResult.rows) {
      const old = before.get(row.id);
      for (const key of touchedKeys) {
        const column = COLUMN_FOR[key];
        const oldValue = logValue(old[column]);
        const newValue = logValue(row[column]);
        if (oldValue === newValue) continue;
        history.push([row.id, row.person_name, key, oldValue, newValue, changedVia, batchId]);
      }
    }
    if (history.length > 0) {
      const values = history.flat();
      const tuples = history.map((_, index) => {
        const offset = index * 7;
        return `(${Array.from({ length: 7 }, (__, part) => `$${offset + part + 1}${part === 6 ? '::uuid' : ''}`).join(', ')})`;
      });
      await client.query(
        `INSERT INTO tb_mastersheet_changes
          (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         VALUES ${tuples.join(', ')}`,
        values,
      );
    }

    await client.query('COMMIT');
    return afterResult.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Deleting a deal. Permanent, and now genuinely so: there is no longer a
// second table holding a copy, and no sync that could bring it back. The
// only route back in is the next uploaded sheet. RETURNING the identity
// rather than just the id so callers can broadcast which person and
// company changed without a second round trip.
/**
 * A DELETE IS RECORDED, like every other write.
 *
 * It was not, and that cost something real: six NEXUS deals went on
 * 2026-08-23 and nothing anywhere says when, or by what. `remove` and
 * `removeMany` wrote straight to the table, exactly as uploads did before
 * migration 033.
 *
 * The entry goes in BEFORE the DELETE, so the foreign key is satisfied
 * when it is written; migration 036 then turns `row_id` to NULL as the row
 * goes rather than cascading the entry away with it. findFieldChanges
 * already reports `row_exists` false, so History shows the delete and says
 * the row is gone instead of offering an Undo that would 404.
 *
 * ONE ENTRY PER ROW, not one per column. Thirty-one entries saying a
 * column went from a value to nothing is not thirty-one facts, it is one:
 * the deal was deleted. `old_value` is what it was, in the words the page
 * uses, so the log reads without opening anything.
 */
const DELETED_FIELD = 'deleted';

function describeDeal(r) {
  return [r.person_name, r.company, r.group_name, r.role_label]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' · ');
}

async function logDeletions(client, rows, via = 'admin') {
  if (rows.length === 0) return;
  const params = [];
  const tuples = rows.map((r, i) => {
    params.push(r.id, r.person_name ?? '', DELETED_FIELD, describeDeal(r), '', via);
    const o = i * 6;
    return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`;
  });
  await client.query(
    `INSERT INTO tb_mastersheet_changes
       (row_id, person_name, field, old_value, new_value, changed_via)
     VALUES ${tuples.join(', ')}`,
    params,
  );
}

/**
 * ===============================
 * * WHAT A CHANGE LOG STORES FOR A DATE
 * ===============================
 * `old_value` is text, and UNDO WRITES IT STRAIGHT BACK into the column it
 * came from. `pg` hands a `date` column over as a JS Date, so a bare
 * `String()` stored:
 *
 *   "Thu Aug 06 2026 00:00:00 GMT-0700 (Pacific Daylight Time)"
 *
 * which Postgres then refused on the way back in: `time zone "gmt-0700"
 * not recognized`. Every undo of a date failed, and the History panel read
 * like a stack trace.
 *
 * YYYY-MM-DD. It is what the column holds, what the parser reads and what
 * every other layer passes around, so the value that goes into the log is
 * the value that can come back out of it.
 *
 * THE UPLOAD PATH WAS ALREADY RIGHT: it logs through `asText`, which has
 * handled dates since it was written. Only the hand-edit path had its own
 * coercion, which is why the History showed a JS Date for an admin edit and
 * a clean date for an upload of the same column. This delegates rather than
 * repeating the rule, so there is one answer to "how is a date written
 * down"; the only difference is null, which the log keeps as NULL where a
 * comparison wants an empty string.
 */
function logValue(value) {
  if (value === null || value === undefined) return null;
  return asText(value);
}

/**
 * ===============================
 * * WHEN A HUMAN LAST TOUCHED EACH CLAIMED FIELD
 * ===============================
 * The upload diff marks a cell a person edited by hand, and the mark is
 * only useful with the two facts behind it: WHEN, and what it was BEFORE.
 * Without them the note says "somebody typed this" and leaves the reader
 * with the same decision and no more information.
 *
 * DISTINCT ON, so one row per field: the latest edit is the one the current
 * value came from, and older ones are history rather than context.
 *
 * `changed_via <> 'import'` is what makes it a HUMAN edit. An import
 * writing a column is exactly what the claim exists to resist, so counting
 * one as the claim would say "you set this by hand" about a value that
 * arrived in a file.
 */
async function claimedFieldEdits(rowIds) {
  const ids = (rowIds ?? []).map(Number).filter(Number.isInteger);
  if (ids.length === 0) return new Map();

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (row_id, field) row_id, field, old_value, changed_at
       FROM tb_mastersheet_changes
      WHERE row_id = ANY($1::int[])
        AND changed_via <> 'import'
      ORDER BY row_id, field, changed_at DESC`,
    [ids],
  );
  return new Map(rows.map((r) => [`${r.row_id}:${r.field}`, r]));
}

const DELETE_RETURNING = 'id, person_id, person_name, group_name, company, role_label';

async function deleteRows(ids, { via = 'admin' } = {}) {
  // Invalidates the read cache: this writes rows.
  cache.invalidate();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Read first: after the DELETE there is nothing left to describe.
    const { rows } = await client.query(
      `SELECT ${DELETE_RETURNING} FROM tb_mastersheet WHERE id = ANY($1::int[])`,
      [ids],
    );
    await logDeletions(client, rows, via);
    await client.query('DELETE FROM tb_mastersheet WHERE id = ANY($1::int[])', [ids]);
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function remove(id) {
  return deleteRows([id]).then((rows) => rows[0] ?? null);
}

// The Master Sheet page's bulk-select delete — one round trip for however
// many rows are checked, not one DELETE per row. `ANY($1::int[])` rather
// than building `id IN ($1,$2,...)` so the placeholder count doesn't have
// to match the array length by hand.
// `via` is 'admin' from the table's own bulk select, and 'import' when the
// rows were picked off the upload diff's "Not in this file" tab. Both are a
// human deciding; the label says which document they were looking at, the
// same distinction `changed_via` already draws for writes.
function removeMany(ids, { via } = {}) {
  return deleteRows(ids, { via }).then((rows) => rows.map((r) => r.id));
}

/**
 * Stop a deal. The row STAYS, which is the whole point.
 *
 * A finished deal is stopped, never deleted: its history is payroll, and
 * `tb_month_snapshots` has already stored the months it was paid in.
 *
 * @param {string} on 'YYYY-MM-DD'. The caller decides: today for a hand
 *   stop, the end of the month for a final month, the closure date for a
 *   company. This does not pick a date, because only the caller knows which
 *   of those it is doing.
 */
// `async`, so a bad reason arrives as a REJECTION like every other failure
// in this file. Thrown synchronously it escapes a caller's .catch entirely.
async function stop(id, { on, reason, via = 'admin' }) {
  if (!Object.values(STOPPED_REASON).includes(reason)) {
    throw new Error(`${reason} is not a stop reason`);
  }
  cache.invalidate();
  return pool
    .query(
      `WITH before AS (SELECT id, stopped_on FROM tb_mastersheet WHERE id = $1),
            moved AS (
              UPDATE tb_mastersheet
                 SET stopped_on = $2, stopped_reason = $3, updated_at = now()
               WHERE id = $1
              RETURNING *
            ),
            -- LOGGED, so History shows the stop and an undo can reach it.
            logged AS (
              INSERT INTO tb_mastersheet_changes (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
              SELECT m.id, m.person_name, 'stoppedOn', b.stopped_on::text, m.stopped_on::text, $4, gen_random_uuid()
                FROM moved m JOIN before b ON b.id = m.id
               WHERE b.stopped_on IS DISTINCT FROM m.stopped_on
            )
       SELECT * FROM moved`,
      [id, on, reason, via],
    )
    .then((r) => r.rows[0] ?? null);
}

/**
 * STOP IT ONLY IF IT IS STILL LIVE. For a replayed write, never a person.
 *
 * `stop` above is an unconditional UPDATE: run it twice and `stopped_on`
 * moves to the later date. A human cannot do that by accident — the route
 * is behind a confirm — but a parked closure is replayed by the boot
 * screen, possibly after a retry, with nobody watching. And a stop date
 * decides whether a month was paid, so moving one rewrites a settled
 * month.
 *
 * The guard is in the WHERE, not in a check before the call: a read then a
 * write is two statements with a gap between them. Null back means it was
 * already stopped, which the runner reports rather than treats as failure.
 */
async function stopIfLive(id, { on, reason }) {
  if (!Object.values(STOPPED_REASON).includes(reason)) {
    throw new Error(`${reason} is not a stop reason`);
  }
  cache.invalidate();
  return pool
    .query(
      `UPDATE tb_mastersheet
          SET stopped_on = $2, stopped_reason = $3, updated_at = now()
        WHERE id = $1 AND stopped_on IS NULL
        RETURNING *`,
      [id, on, reason],
    )
    .then((r) => r.rows[0] ?? null);
}

/**
 * The same stop across many rows, in one statement.
 *
 * Closing a company stops every deal on it, and the monthly review answers
 * a batch at once. One round trip and one broadcast, the shape removeMany
 * already set.
 */
async function stopMany(ids, { on, reason }) {
  if (!Object.values(STOPPED_REASON).includes(reason)) {
    throw new Error(`${reason} is not a stop reason`);
  }
  // `> 0`, because Number(null) and Number('') are both 0 and
  // Number.isInteger(0) is true: without it a null in the list became an
  // UPDATE against id 0. Ids are bigserial, so zero is never one.
  const list = [...new Set((ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (list.length === 0) return [];
  cache.invalidate();
  return pool
    .query(
      `UPDATE tb_mastersheet
          SET stopped_on = $2, stopped_reason = $3, updated_at = now()
        WHERE id = ANY($1::int[]) AND stopped_on IS NULL
        RETURNING id`,
      [list, on, reason],
    )
    .then((r) => r.rows.map((row) => row.id));
}

/**
 * Resume. Both columns clear together or the CHECK refuses it, which is
 * the constraint doing its job rather than a rule somebody has to recall.
 *
 * The row was never moved, so nothing has to be put back: it reappears on
 * the master sheet because it stopped matching the Archive's filter.
 *
 * REFUSES A COMPANY CLOSURE, in the WHERE rather than only in the route:
 * putting a deal back on a company that is gone is the one resume that
 * makes the sheet wrong, and a second caller would not think to re-check.
 */
function resume(id, { via = 'admin' } = {}) {
  cache.invalidate();
  return pool
    .query(
      `WITH before AS (SELECT id, stopped_on FROM tb_mastersheet WHERE id = $1),
            moved AS (
              UPDATE tb_mastersheet
                 SET stopped_on = NULL, stopped_reason = NULL, updated_at = now()
               WHERE id = $1 AND stopped_reason IS DISTINCT FROM $2
              RETURNING *
            ),
            logged AS (
              INSERT INTO tb_mastersheet_changes (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
              SELECT m.id, m.person_name, 'stoppedOn', b.stopped_on::text, NULL, $3, gen_random_uuid()
                FROM moved m JOIN before b ON b.id = m.id
               WHERE b.stopped_on IS NOT NULL
            )
       SELECT * FROM moved`,
      [id, REOPEN_THE_COMPANY, via],
    )
    .then((r) => r.rows[0] ?? null);
}

/**
 * Every live deal on one company, stopped because the company closed.
 *
 * Matched on COMPANY_KEY_SQL, the same loose key the rest of this file
 * groups by: two spellings of one company are one company.
 */
/**
 * ===============================
 * * WHICH OF ONE COMPANY'S DEALS ARE REVIEWED MONTHLY
 * ===============================
 * SET AND CLEARED IN ONE STATEMENT, across the whole company. The status
 * screen sends the ticked ids, so an UNTICKED row has to come out of the
 * review as surely as a ticked one goes in: a write that only ever added
 * would make that checklist one-way, and nobody could undo a mistake.
 *
 * Scoped to the company by the same key everything else compares on, so a
 * spelling difference cannot leave half of it behind.
 */
/**
 * ===============================
 * * A CASCADE THAT DOES NOT LOG CANNOT BE UNDONE
 * ===============================
 * This wrote tb_mastersheet and no change entry at all, so a company
 * status change left NOTHING in History: the deals moved and the one
 * screen that answers "what happened, and put it back" had never heard of
 * it. Found 2026-09-22, while giving the cascade its one-press undo.
 *
 * ONE STATEMENT, so the write and its record cannot come apart. The `snap`
 * CTE reads the old value from the same snapshot the UPDATE acts on, which
 * is what makes `old_value` the truth rather than a second read that could
 * see somebody else's edit in between.
 *
 * `batchId` is what makes the whole cascade ONE row in History. See
 * migration 062.
 */
function setReviewMonthlyForCompany(company, ids, { via = 'admin', batchId = null } = {}) {
  cache.invalidate();
  const wanted = rowIds(ids);
  return pool
    .query(
      `WITH snap AS (
         SELECT id, person_name, review_monthly AS was
           FROM tb_mastersheet
          WHERE ${COMPANY_KEY_SQL()} = ${COMPANY_KEY_SQL('$1')}
            AND review_monthly IS DISTINCT FROM (id = ANY($2::int[]))
       ), upd AS (
         UPDATE tb_mastersheet m
            SET review_monthly = (m.id = ANY($2::int[])), updated_at = now()
           FROM snap s WHERE m.id = s.id
         RETURNING m.id, m.review_monthly, s.was, s.person_name
       ), logged AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'reviewMonthly', was::text, review_monthly::text, $3, $4::uuid
           FROM upd
       )
       SELECT id, review_monthly FROM upd`,
      [company, wanted, via, batchId],
    )
    .then((r) => r.rows);
}

/**
 * ===============================
 * * WHICH DEALS CARRY HIS WORD "Going concern"
 * ===============================
 * His call 2026-09-22. The status screen asks it the same way liquidation
 * and review ask theirs: per deal, ticked, never across the whole company.
 *
 * THE TICK IS THE NOTE. There is no second column: a deal is marked when
 * `end_note` holds the phrase. So typing a real end date, which already
 * clears the note, unticks the deal by itself and the two can never
 * disagree.
 *
 * AND IT CLEARS THE DATE, which is the cost. "Going concern" means there
 * IS no end date, so leaving one would print his word over a real date,
 * the exact thing the clear-on-type rule exists to stop. Unticking cannot
 * put the date back, which is why this logs: History and Undo are the way
 * back, and they only work because `old_value` is captured here.
 */
/**
 * ===============================
 * * ONE DEAL'S STATUS, SET FROM THE MASTER SHEET
 * ===============================
 * The same two columns the company checklist writes, for one row. His call
 * 2026-09-22: he wanted to set it per deal without going through a company.
 *
 * NOT IN COLUMN_FOR, so it cannot come through the ordinary row PATCH, and
 * that is deliberate: those two are not cells somebody types into, they are
 * a STATUS somebody picks. Its own door, its own validation, its own log.
 *
 * BOTH COLUMNS, ALWAYS, and the end date too when his word is chosen: a
 * write that set one and left the other is what makes the mixed state the
 * reader has to resolve.
 *
 * LOGGED PER FIELD, so History shows what actually moved and Undo can put
 * an end date back. See RESTORABLE.
 */
function setDealStatus(id, status, { via = 'admin', batchId = null } = {}) {
  const writes = dealStatusWrites(status);
  if (!writes) return Promise.reject(new Error(`${status} is not a deal status`));
  cache.invalidate();
  return pool
    .query(
      `WITH snap AS (
         SELECT id, person_name, end_note AS was_note, end_on AS was_end,
                review_monthly AS was_review
           FROM tb_mastersheet WHERE id = $1
       ), upd AS (
         UPDATE tb_mastersheet m
            SET end_note = $2,
                review_monthly = $3,
                -- Only his word clears the date. The other two leave every
                -- date exactly where it is.
                end_on = CASE WHEN $4 THEN NULL ELSE m.end_on END,
                updated_at = now()
           FROM snap s WHERE m.id = s.id
         RETURNING m.id, m.end_note, m.end_on, m.review_monthly,
                   s.was_note, s.was_end, s.was_review, s.person_name
       ), log_note AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'endNote', was_note, end_note, $5, $6::uuid
           FROM upd WHERE was_note IS DISTINCT FROM end_note
       ), log_review AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'reviewMonthly', was_review::text, review_monthly::text, $5, $6::uuid
           FROM upd WHERE was_review IS DISTINCT FROM review_monthly
       ), log_date AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'endOn', was_end::text, NULL, $5, $6::uuid
           FROM upd WHERE was_end IS NOT NULL AND end_on IS NULL
       )
       SELECT ${COLUMNS} FROM tb_mastersheet WHERE id = $1`,
      [id, writes.endNote, writes.reviewMonthly, writes.clearsEndDate, via, batchId],
    )
    .then((r) => r.rows[0] ?? null);
}

function setGoingConcernForCompany(company, ids, { via = 'admin', batchId = null } = {}) {
  cache.invalidate();
  const wanted = rowIds(ids);
  return pool
    .query(
      `WITH snap AS (
         SELECT id, person_name, end_note AS was_note, end_on AS was_end
           FROM tb_mastersheet
          WHERE ${COMPANY_KEY_SQL()} = ${COMPANY_KEY_SQL('$1')}
            AND (
              (id = ANY($2::int[]) AND (end_note IS DISTINCT FROM $3 OR end_on IS NOT NULL))
              OR (NOT (id = ANY($2::int[])) AND end_note = $3)
            )
       ), upd AS (
         UPDATE tb_mastersheet m
            SET end_note = CASE WHEN m.id = ANY($2::int[]) THEN $3 ELSE NULL END,
                -- Only the ticked ones lose their date. An untick clears
                -- the word and leaves everything else exactly as it is.
                end_on = CASE WHEN m.id = ANY($2::int[]) THEN NULL ELSE m.end_on END,
                updated_at = now()
           FROM snap s WHERE m.id = s.id
         RETURNING m.id, m.end_note, m.end_on, s.was_note, s.was_end, s.person_name
       ), logged_note AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'endNote', was_note, end_note, $4, $5::uuid
           FROM upd WHERE was_note IS DISTINCT FROM end_note
       ), logged_date AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'endOn', was_end::text, NULL, $4, $5::uuid
           FROM upd WHERE was_end IS NOT NULL AND end_on IS NULL
       )
       SELECT id, end_note, end_on FROM upd`,
      [company, wanted, GOING_CONCERN, via, batchId],
    )
    .then((r) => r.rows);
}

/**
 * ===============================
 * * `ids` NARROWS THE CASCADE, and `undefined` is not `[]`
 * ===============================
 * The closure confirm ticks the deals a closure stops, all of them by
 * default, and somebody may untick one that is being settled separately.
 *
 * NOT MENTIONED means every live deal, which is what Diane and every
 * existing caller rely on. An EMPTY ARRAY means none of them, a real
 * answer: unticking the lot closes the company and stops nothing. The two
 * cannot collapse, or a caller that never asked would stop nothing.
 */
// LOGGED, like every other cascade write. A closure stops every deal on a
// company at once, which is the widest write in the CRM, and until
// 2026-09-22 it left no trace in History at all.
function stopCompany(company, { on, ids, via = 'admin', batchId = null }) {
  cache.invalidate();
  const only = Array.isArray(ids) ? rowIds(ids) : null;
  if (only && only.length === 0) return Promise.resolve([]);
  return pool
    .query(
      `WITH snap AS (
         SELECT id, person_name FROM tb_mastersheet
          WHERE ${COMPANY_KEY_SQL()} = ${COMPANY_KEY_SQL('$1')} AND stopped_on IS NULL
            AND ($4::int[] IS NULL OR id = ANY($4::int[]))
       ), upd AS (
         UPDATE tb_mastersheet m
            SET stopped_on = $2, stopped_reason = $3, updated_at = now()
           FROM snap s WHERE m.id = s.id
         RETURNING m.id, s.person_name
       ), logged AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'stoppedOn', NULL, $2::text, $5, $6::uuid FROM upd
       )
       SELECT id FROM upd`,
      [company, on, REOPEN_THE_COMPANY, only, via, batchId],
    )
    .then((r) => r.rows.map((row) => row.id));
}

/**
 * Every deal on one company, put back when the company reopens.
 *
 * Only the ones the closure itself stopped: a deal somebody stopped by hand
 * before the company closed stays stopped, because that was a separate
 * decision about that deal.
 */
function resumeCompany(company, { via = 'admin', batchId = null } = {}) {
  cache.invalidate();
  return pool
    .query(
      `WITH snap AS (
         SELECT id, person_name, stopped_on AS was FROM tb_mastersheet
          WHERE ${COMPANY_KEY_SQL()} = ${COMPANY_KEY_SQL('$1')} AND stopped_reason = $2
       ), upd AS (
         UPDATE tb_mastersheet m
            SET stopped_on = NULL, stopped_reason = NULL, updated_at = now()
           FROM snap s WHERE m.id = s.id
         RETURNING m.id, s.person_name, s.was
       ), logged AS (
         INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via, batch_id)
         SELECT id, person_name, 'stoppedOn', was::text, NULL, $3, $4::uuid FROM upd
       )
       SELECT id FROM upd`,
      [company, REOPEN_THE_COMPANY, via, batchId],
    )
    .then((r) => r.rows.map((row) => row.id));
}

/**
 * Clearing the flag is what makes the row whole again.
 *
 * Called after an edit fills the missing half back in, rather than by a
 * button that only hides the warning: a flag you can dismiss without
 * fixing anything is a flag that stops meaning anything.
 */
function clearOrphanFlags(id) {
  cache.invalidate();
  return pool
    .query(
      // EACH REASON CLEARS ONLY WHEN ITS OWN SIDE IS REFILLED.
      //
      // Stripping both reasons whenever this ran left rows whose flag was
      // still true but whose reason text was gone — the row-level icon
      // still appeared, while the marker on the blank cell (which is
      // driven by the reason text, see helpers/reviewFields.js) quietly
      // did not. The two have to move together or they disagree.
      //
      // Two-argument btrim, not the "both ... from ..." spelling, which
      // belongs to trim() and is a parse error here. It removes the
      // separator left behind when a reason is cut out of the middle or
      // the end of a longer one, so an import flag on the same row
      // survives intact.
      `UPDATE tb_mastersheet
          SET orphaned_person  = orphaned_person  AND person_id IS NULL,
              orphaned_company = orphaned_company AND company IS NULL,
              -- The regexp_replace collapses the ", , " left in the MIDDLE
              -- when a reason is cut out from between two others; btrim
              -- only ever cleans the ends, so without it a row that kept
              -- an import flag read "no currency, , the company was
              -- removed".
              review_reason = btrim(regexp_replace(
                CASE WHEN company IS NOT NULL THEN replace(
                  CASE WHEN person_id IS NOT NULL
                       THEN replace(review_reason, $2, '') ELSE review_reason END, $3, '')
                     WHEN person_id IS NOT NULL THEN replace(review_reason, $2, '')
                     ELSE review_reason END,
                '(,\\s*){2,}', ', ', 'g'), ', '),
              updated_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, ORPHAN_PERSON_REASON, ORPHAN_COMPANY_REASON],
    )
    .then((r) => r.rows[0] ?? null);
}

const UPSERT_COLUMNS = [
  'person_id', 'person_name', 'phone', 'role', 'seat', 'role_label',
  'group_name', 'company', 'assigned_on', 'payment_start_on', 'preset_on', 'end_on',
  'payable_days', 'monthly_amount', 'payable_amount', 'currency', 'payment_method',
  'location', 'door_number', 'postcode', 'accepting_postals',
  'label', 'should_be_paid', 'paid', 'notes',
  'bank_details', 'account_number', 'sort_code', 'status',
  // His word from the end date column, and the review flag it sets. Both
  // travel on an upload: the file is where they come from.
  'end_note', 'review_monthly',
  'needs_review', 'review_reason',
];

function upsertValues(r) {
  return [
    r.syncKey,
    r.personId, r.personName, r.phone ?? '', r.role, r.seat ?? null, r.roleLabel,
    r.groupName, r.company ?? null, r.assignedOn ?? null, r.paymentStartOn ?? null,
    r.presetOn ?? null, r.endOn ?? null,
    r.payableDays ?? 0, r.monthlyAmount ?? 0,
    r.payableAmount ?? 0, r.currency ?? 'GBP', r.paymentMethod ?? 'cash', r.location ?? '',
    r.doorNumber ?? '', r.postcode ?? '', r.acceptingPostals ?? '',
    r.label ?? '', r.shouldBePaid ?? '', r.paid ?? '', r.notes ?? '',
    r.bankDetails ?? '', r.accountNumber ?? '', r.sortCode ?? '', r.status ?? 'active',
    r.endNote ?? null, r.reviewMonthly ?? false,
    r.needsReview ?? false, r.reviewReason ?? '',
  ];
}

/**
 * whatbot's month-start push. One transaction, so a failure halfway can't
 * leave the sheet half-replaced.
 *
 * `origin` decides what happens to a row that already exists, and the two
 * cases are genuinely opposite:
 *
 * - 'import'  — a new human-made sheet. This is new information, so it
 *               WINS on the columns it actually carries, and says nothing
 *               about the ones it doesn't. See `columns` below.
 *
 * - 'repull'  — whatbot is pushing back the copy it pulled FROM here, in a
 *               month nobody uploaded anything. Existing rows are LEFT
 *               ALONE (DO NOTHING), because whatbot's copy is a snapshot
 *               up to one pull interval old and the CRM's own row is by
 *               definition the newer one — overwriting would let a stale
 *               snapshot undo an edit the admin made in that window.
 *               Deletes nothing either. So it inserts exactly what's
 *               missing and no more, which is the case it exists for: a
 *               CRM that lost these rows (a "burn the month" wipe, a
 *               restore) getting them back from whatbot's copy.
 *
 * Neither origin ever writes `source` on an existing row — a manual row
 * whatbot pulled and pushed back stays manual.
 *
 * NEITHER ORIGIN DELETES ANYTHING, EITHER.
 *
 * 'import' used to delete every synced row whose sync_key was absent from
 * the new file, on the reasoning that the sheet is the source of record.
 * That reasoning fails the moment the file is partial: a sheet covering
 * one group, or one the boss trimmed before sending, silently removed
 * every deal it did not mention, and nothing an upload does was recorded
 * anywhere it could be undone from. Rows that really have gone are the
 * admin's call to make, in front of the diff, not a side effect of
 * uploading.
 *
 * @param {string[]} [columns] db columns this file is entitled to write on
 *   an EXISTING row. Absent means all of them, which is what 'repull' and
 *   the older callers mean. New rows always get every column: there is no
 *   existing value to protect.
 */
async function syncUpsert(rows, origin, { columns, respectOverrides = true } = {}) {
  // Invalidates the read cache: this writes rows.
  cache.invalidate();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // THE OVERRIDE GUARD, enforced in SQL rather than in JS.
    //
    // Every column keeps its existing value when a human has claimed it
    // (update() adds the column name to manually_overridden_fields), and
    // takes the uploaded value otherwise. Written as a CASE per column so
    // the decision is made per column per row by Postgres itself — a JS
    // pre-filter would need the current row loaded first, which is a
    // second round trip per deal and a race in between.
    //
    // This is what stops a new sheet silently reverting a correction. The
    // sheet proposes; the CRM decides.
    //
    // EXCLUDED rather than a positional parameter, which is what lets the
    // insert below be batched: in a multi-row VALUES there is no single
    // $n that means "this row's value for this column".
    // TWO GUARDS, AND THEY ANSWER DIFFERENT QUESTIONS.
    //
    //   this filter   did the FILE mention this column at all? A sheet with
    //                 no end date column has no opinion on end dates, and
    //                 writing its blank over a real date is data loss
    //                 dressed up as an update.
    //   the CASE      did a HUMAN claim this column on this row? Then the
    //                 correction stands whatever the sheet says.
    //
    // Absent columns are dropped from the SET rather than filtered in JS,
    // because the decision is per FILE and the same for every row, where
    // the override is per row and belongs in SQL.
    //
    // AND WHY IT CAN BE TURNED OFF. `respectOverrides` defaults to true, so
    // every path keeps the guard unless it says otherwise. The COMMIT of a
    // reviewed upload says otherwise, and only it: by then a human has seen
    // each changed cell beside its current value and picked a side, and a
    // guard that overruled that choice would make the modal a suggestion
    // box. Everything with no human in the loop, whatbot's sync and the
    // one-shot upload included, keeps it.
    const writable = columns ? UPSERT_COLUMNS.filter((c) => columns.includes(c)) : UPSERT_COLUMNS;
    const setSql = writable.map((c) => (respectOverrides
      ? `${c} = CASE WHEN '${c}' = ANY(tb_mastersheet.manually_overridden_fields)
                     THEN tb_mastersheet.${c} ELSE EXCLUDED.${c} END`
      : `${c} = EXCLUDED.${c}`)).join(', ');
    // An empty SET is a syntax error, not a no-op, so a file carrying only
    // the identity columns falls through to DO NOTHING rather than taking
    // the upload down.
    const onConflict =
      origin === 'import' && setSql
        ? `DO UPDATE SET ${setSql}, updated_at = now()`
        : 'DO NOTHING';

    // BATCHED, not one statement per row.
    //
    // This used to loop, and a round trip to Supabase in ap-south-1 costs
    // ~500ms of pure network latency. A 96-row sheet meant ~48 seconds
    // inside one open transaction, which reads as a hung upload: the
    // browser's progress bar hits 100% the moment the bytes land, then
    // nothing happens for a minute. One statement per chunk instead.
    //
    // Chunked rather than one giant statement because Postgres caps a
    // query at 65535 parameters, and 33 columns × 2000 rows would exceed
    // it on a sheet only twice the size of today's.
    const cols = ['sync_key', ...UPSERT_COLUMNS];
    const perRow = cols.length;
    const CHUNK = Math.max(1, Math.floor(60000 / perRow));

    // A batch cannot contain the same key twice — Postgres refuses with
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    // The parser already gives every row a distinct key, so this is a
    // guard against a future caller, not a known case.
    const seen = new Set();
    const unique = rows.filter((r) => {
      if (seen.has(r.syncKey)) return false;
      seen.add(r.syncKey);
      return true;
    });

    // WHAT THIS UPLOAD IS ABOUT TO CHANGE, read before it changes it.
    //
    // Nothing an upload did was ever recorded, so History could not show it
    // and Undo could not reach it. That is why a renamed column quietly
    // wiping every end date had no way back.
    //
    // Read in ONE query and diffed in JS rather than derived from the
    // upsert: Postgres only gained OLD/NEW in RETURNING in 17, and a
    // per-row round trip is the cost this function was rewritten to avoid.
    // READ ONCE, USED TWICE: the derived recompute just below and the change
    // log under it. The read used to be inside the log's own branch, which
    // left the recompute without the claims it has to resolve against.
    const writableSet = new Set(writable);
    const logging = origin === 'import' && Boolean(setSql);
    let before = new Map();
    if (logging || respectOverrides) {
      const selectCols = [...new Set([
        'id', 'sync_key', 'person_name', ...writable, ...INPUT_COLUMNS, ...DERIVED_COLUMNS,
      ])];
      const { rows: existing } = await client.query(
        `SELECT ${selectCols.join(', ')}, manually_overridden_fields
         FROM tb_mastersheet WHERE sync_key = ANY($1::text[])`,
        [unique.map((r) => r.syncKey)],
      );
      before = new Map(existing.map((e) => [e.sync_key, e]));
    }

    // DERIVED COLUMNS FOLLOW THEIR INPUTS. Mutating the row before
    // upsertValues reads it, so the statement, the change log and the stored
    // value are all the same number. See resolveDerived.helper.js.
    if (respectOverrides) {
      for (const r of unique) {
        const old = before.get(r.syncKey);
        const claimed = new Set(old?.manually_overridden_fields ?? []);
        const fixed = resolveDerived(r, old, claimed, writableSet);
        if (!fixed) continue;
        r.payableDays = fixed.payableDays;
        r.payableAmount = fixed.payableAmount;
      }
    }

    const changeRows = [];
    if (logging) {
      for (const r of unique) {
        const old = before.get(r.syncKey);
        if (!old) continue; // a new row is not a change to anything
        const claimed = new Set(old.manually_overridden_fields ?? []);
        // upsertValues is positional over ['sync_key', ...UPSERT_COLUMNS],
        // so this reads the exact value the statement below will write
        // rather than a second guess at it.
        const values = upsertValues(r);
        for (const col of writable) {
          // A claimed column keeps its value, so nothing changed on it —
          // unless the guard is off, in which case it does change and the
          // log has to carry it or History and Undo cannot reach it.
          if (respectOverrides && claimed.has(col)) continue;
          const next = values[UPSERT_COLUMNS.indexOf(col) + 1];
          if (sameStoredValue(old[col], next)) continue;
          changeRows.push([
            old.id, old.person_name, FIELD_FOR_COLUMN[col] ?? col,
            asText(old[col]), asText(next),
          ]);
        }
      }
    }

    let written = 0;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const values = [];
      const tuples = chunk.map((r, rowIndex) => {
        const rowValues = upsertValues(r);
        values.push(...rowValues);
        const offset = rowIndex * perRow;
        // The `$` matters. Without it this builds `(1, 2, 3, …)` — a tuple
        // of literal integers rather than placeholders — and Postgres
        // rejects the first non-integer column it reaches with "column
        // assigned_on is of type date but expression is of type integer".
        return `(${rowValues.map((_, j) => `$${offset + j + 1}`).join(', ')})`;
      });

      const result = await client.query(
        `INSERT INTO tb_mastersheet (${cols.join(', ')})
         VALUES ${tuples.join(', ')}
         ON CONFLICT (sync_key) ${onConflict}`,
        values,
      );
      written += result.rowCount;
    }

    if (changeRows.length > 0) {
      // One statement, same reason the upsert is batched: a 96-row sheet
      // touching four columns each is 384 round trips otherwise.
      const params = [];
      const tuples = changeRows.map((c, i) => {
        params.push(...c);
        const o = i * 5;
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, 'import')`;
      });
      await client.query(
        `INSERT INTO tb_mastersheet_changes
           (row_id, person_name, field, old_value, new_value, changed_via)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    }

    // Rows the file did not mention, counted and reported, never deleted.
    // The admin decides what to do with them; an upload does not get to.
    const absent = await client.query(
      // The same question `findNotInKeys` asks, so the count and the tab
      // it labels cannot disagree.
      `SELECT COUNT(*)::int AS n FROM tb_mastersheet
       WHERE source = 'synced' AND sync_key <> ALL($1::text[])
         AND stopped_on IS NULL`,
      [rows.map((r) => r.syncKey)],
    );

    await client.query('COMMIT');
    // `written` is what actually changed; `received` is what was sent. On a
    // repull they differ by however many rows were already correct, which
    // is the number worth seeing in the log. `notInFile` used to be
    // `deleted`, and the rename is the whole point: it is now a number to
    // look at, not a number of rows that have gone.
    return {
      received: rows.length,
      written,
      notInFile: absent.rows[0]?.n ?? 0,
      columnsWritten: writable.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The stored rows an upload is about to touch, keyed by sync_key.
 *
 * Read once, before anything is written, so the diff and the change log
 * are built from the same snapshot. `manually_overridden_fields` always
 * comes back: a claimed column is not a change and must not be offered as
 * one.
 */
function findBySyncKeys(keys, columns = UPSERT_COLUMNS) {
  const selectCols = [...new Set(['id', 'sync_key', 'person_name', 'company', 'group_name', 'role_label', ...columns])];
  return pool
    .query(
      `SELECT ${selectCols.join(', ')}, manually_overridden_fields
       FROM tb_mastersheet WHERE sync_key = ANY($1::text[])`,
      [keys],
    )
    .then((r) => new Map(r.rows.map((row) => [row.sync_key, row])));
}

/**
 * Rows the CRM holds that this file never mentions.
 *
 * Not a deletion list. An upload deletes nothing; this exists so a partial
 * sheet is obvious. Manual rows are excluded because they were added
 * precisely BECAUSE the sheet was missing them, so a sheet still not
 * mentioning them says nothing new.
 */
/**
 * SCOPED TO THE GROUPS THE FILE ACTUALLY CARRIES.
 *
 * An upload has no opinion about a group it does not mention. An INDIGO
 * sheet saying nothing about NEXUS is not a statement about NEXUS, and
 * listing all 67 other deals as "not in this file" made the tab count
 * disagree with its own list (67 in the tab, 11 on screen) and, far worse,
 * put a select-all above 56 rows the file had never heard of. One tick and
 * a Delete is the exact accident the two-step upload exists to prevent:
 * a one-group extract removing every deal it did not cover.
 *
 * Folded to upper case on both sides because group names arrive from a
 * spreadsheet and "Indigo" and "INDIGO" are the same group.
 *
 * No groups passed means no scoping, which is what a file covering
 * everything should get.
 */
function findNotInKeys(keys, { groups = [], limit = 200 } = {}) {
  const scope = groups.length > 0 ? groups.map((g) => String(g).toUpperCase()) : null;
  return pool
    .query(
      `SELECT id, sync_key, person_name, company, group_name, role_label,
              monthly_amount, currency
       FROM tb_mastersheet
       WHERE source = 'synced'
         AND sync_key <> ALL($1::text[])
         -- ALREADY OFF THE SHEET IS NOT "POTENTIALLY ENDED". An archived
         -- row matches no file, so it was offered on this tab every upload
         -- after it was archived, inviting a delete of something the admin
         -- had already dealt with. Its count below asks the same question.
         AND stopped_on IS NULL
         AND ($3::text[] IS NULL OR upper(group_name) = ANY($3::text[]))
       ORDER BY group_name, person_name
       LIMIT $2`,
      [keys, limit, scope],
    )
    .then((r) => r.rows);
}

/**
 * Every group the CRM currently knows about.
 *
 * Read before an upload is parsed, so a file with no Group column can be
 * matched against groups that already exist rather than inventing one from
 * its own name. UNKNOWN is excluded: it is the parser saying it could not
 * tell, not a group, and matching a filename against it would make the
 * failure self-perpetuating.
 */
/**
 * Every location the sheet actually uses, folded to one spelling each.
 *
 * DERIVED, NEVER STORED, which is the point: the Settings list of places
 * can then never go stale. A location the boss invents next month appears
 * there by itself, so classifying it is a tick rather than something
 * somebody has to remember to add.
 *
 * Folded on lower() because the same place is typed several ways ("Abu
 * Dhabi" on 19 rows, "Abu dhabi" on 2, "South east" and "South East"), and
 * offering both spellings as two separate things to classify is how one of
 * them ends up ticked and the other not. The most-used spelling is the one
 * shown, same rule canonical.js folds by.
 */
function distinctLocations() {
  return pool
    .query(
      `SELECT location, count(*) AS n FROM tb_mastersheet
       WHERE btrim(coalesce(location, '')) <> ''
       GROUP BY location
       ORDER BY count(*) DESC`,
    )
    .then((r) => {
      const byKey = new Map();
      for (const row of r.rows) {
        const key = String(row.location).trim().toLowerCase();
        if (!byKey.has(key)) byKey.set(key, { location: String(row.location).trim(), rows: 0 });
        byKey.get(key).rows += Number(row.n);
      }
      return [...byKey.values()].sort((a, b) => a.location.localeCompare(b.location));
    });
}

function distinctGroups() {
  return pool
    .query(
      `SELECT DISTINCT group_name FROM tb_mastersheet
       WHERE group_name <> '' AND group_name <> 'UNKNOWN'
       ORDER BY group_name`,
    )
    .then((r) => r.rows.map((x) => x.group_name));
}

// Every spelling the sheet already uses, so a new deal can match "kiran vale" to "Kiran Vale".
// The currencies live deals are paid in, as the sheet spells them.
async function liveCurrencies() {
  const { rows } = await pool.query(
    `SELECT DISTINCT upper(btrim(currency)) AS currency FROM tb_mastersheet
      WHERE stopped_on IS NULL AND currency IS NOT NULL AND btrim(currency) <> ''`,
  );
  return rows.map((r) => r.currency);
}

function knownSpellings() {
  return pool
    .query(
      `SELECT array_agg(DISTINCT person_name) FILTER (WHERE person_name <> '') AS people,
              array_agg(DISTINCT company) FILTER (WHERE company <> '') AS companies,
              array_agg(DISTINCT group_name) FILTER (WHERE group_name <> '') AS groups,
              array_agg(DISTINCT role_label) FILTER (WHERE role_label <> '') AS roles
         FROM tb_mastersheet`,
    )
    .then((r) => r.rows[0] ?? {});
}

/**
 * What the upsert would write for one parsed row, keyed by column.
 *
 * Read off `upsertValues` rather than the row's own field names, so the
 * diff a human approves is the value that actually lands. Two ways of
 * working out "the new value" is exactly how a modal ends up promising
 * something the write does not do.
 */
function upsertValuesByColumn(row) {
  const values = upsertValues(row);
  return Object.fromEntries(UPSERT_COLUMNS.map((c, i) => [c, values[i + 1]]));
}

/**
 * Companies whose deals span more than one group.
 *
 * A single-group file cannot say which group its company table meant, so
 * these are flagged rather than guessed. Today that is Workforce alone.
 */
async function companiesInSeveralGroups() {
  const { rows } = await pool.query(
    `SELECT lower(btrim(company)) AS ckey FROM tb_mastersheet
      WHERE company IS NOT NULL AND btrim(company) <> ''
      GROUP BY 1 HAVING count(DISTINCT group_name) > 1`,
  );
  return rows.map((r) => r.ckey);
}

// Live rows whose preset is BEHIND this month, given this month's 1st
// (YYYY-MM-01). Future and empty presets are left alone.
//
// It used to look only one month back, so a row that missed a roll — the
// PATCH 500'd, or nobody signed in that month — stayed behind for good:
// the next month's window had already moved past it. Behind is behind.
async function stalePresetIds(monthStart) {
  const { rows } = await pool.query(
    `SELECT id FROM tb_mastersheet
      WHERE stopped_on IS NULL AND preset_on < $1::date
      ORDER BY id`,
    [monthStart],
  );
  return rows.map((r) => r.id);
}

module.exports = {
  stalePresetIds,
  stopIfLive,
  editedByHandSince,
  companiesInSeveralGroups,
  distinctGroups,
  knownSpellings,
  liveCurrencies,
  distinctLocations,
  claimedFieldEdits,
  findBySyncKeys,
  findNotInKeys,
  upsertValuesByColumn,
  UPSERT_COLUMNS,
  FIELD_FOR_COLUMN,
  COLUMN_FOR,
  findAll,
  searchFuzzy,
  applyPaydayOutcome,
  findBySyncKey,
  findMatchingDeals,
  findByPersonId,
  auditSummary,
  findRecentlyUpdated,
  findFieldChanges,
  peekFieldChange,
  revertFieldChange,
  findChangeBatches,
  revertChangeBatch,
  isUndoableField,
  BATCH_GAP_SECONDS,
  ENDING_SOON_MONTHS,
  findAllRows,
  personFill,
  PERSON_FILL_COLUMNS,
  findById,
  counts,
  create,
  update,
  updateMany,
  remove,
  removeMany,
  stop,
  stopMany,
  stopCompany,
  setReviewMonthlyForCompany, setGoingConcernForCompany, setDealStatus,
  resume,
  resumeCompany,
  STOPPED_REASON,
  REOPEN_THE_COMPANY,
  // For monthlyReview.repo, which writes stopped_on from its own
  // transaction and would otherwise leave this file's cache serving a
  // stopped deal as live.
  invalidateCache: () => cache.invalidate(),
  // For reads DERIVED from this table (the dead list), so every write here
  // drops them too and they can never outlive the deals they are made of.
  readThrough: (key, fn) => cache.wrap(key, fn),
  clearOrphanFlags,
  syncUpsert,
};
