const rowsRepo = require('../repos/masterSheetRows.repo');
const concernsRepo = require('../repos/concerns.repo');
const settingsRepo = require('../repos/settings.repo');
const { dueThisMonth, reviewReason, REVIEW_REASON } = require('./reviewQueue.helper');
const { countsTowardTotal } = require('./owedThisMonth.helper');
const { currentMonth } = require('./presetMonth.helper');
const { ratedRows } = require('./ratedRows.helper');

/**
 * ***************************************************
 * * WHAT SHE SAYS WHEN YOU SIGN IN
 * ***************************************************
 *
 * Four facts, each of which somebody has to act on, said once and then out
 * of the way. Not a lobby: the greeting screen that made you CHOOSE a
 * destination was removed on purpose and stays removed.
 *
 * ===============================
 * * NAMES, NOT TOTALS
 * ===============================
 * It said "30 deals are up for review for September 2026, GBP 39,619.04 a
 * month". His call 2026-09-21: a figure fired at somebody who has just
 * signed in tells them the SIZE of a problem and nothing about WHICH one.
 * The pages already carry the totals, and the review panel carries that
 * one exactly.
 *
 * A COUNT SHE SAYS, EVERY ROW SHE SHOWS. His call 2026-09-28: "and 9 other
 * deals" hid the rows he needed. Each item now carries every row, and the
 * web reads them out batch by batch while they type in.
 *
 * SHE DOES NOT THINK ABOUT IT, SHE READS IT. Every item arrives with its
 * FINISHED SENTENCE, the same rule her figure tools already follow. A
 * model call carries ~30,300 tokens before a word of conversation, and
 * this is the one screen whose whole job is to be quick.
 *
 * NOTHING TO SAY MEANS NOTHING HAPPENS. An empty list is the signal to the
 * frontend to skip the screen entirely.
 *
 * NO ROUTES HERE. Each item carries a `key` and the WEB decides where that
 * lands. Which page shows a thing is the router's business.
 */

// Every flagged person, not a page of them. His call 2026-09-28.
const CONCERNS_LIMIT = 500;

const plural = (n, one, many) => (n === 1 ? one : many);

// One place for every word she says here. A sentence written at the call
// site is a sentence nobody can find when the wording is wrong.
// A COUNT, because the rows themselves follow, each one on screen. Split by
// WHY (his call 2026-09-21): winding down, past a year and ticked need different answers.
const SAY = {
  liquidating: (n) => `${n} ${plural(n, 'deal is on a company', 'deals are on companies')} winding down.`,
  pastYear: (n) => `${n} ${plural(n, 'deal is', 'deals are')} past a year.`,
  // THIS month, his words 2026-09-28: the tick asks for it now, not forever.
  reviewMonthly: (n) => `${n} ${plural(n, 'deal is', 'deals are')} marked for review this month.`,
  // PEOPLE, NOT DEALS (his call 2026-10-07): the boss needs WHO has not
  // been paid, not how many rows. One person, one line, their deals summed.
  unpaid: (n) => `${n} ${plural(n, 'person has', 'people have')} not been marked paid this month.`,
  // PEOPLE, NOT CONCERNS: one person can hold five, and whatbot is named. 2026-09-21.
  // DISTINCT people: a row is a (person, group) pair, so one name in two
  // groups is two rows but one person. The flags are said beside it.
  concerns: (n, flags = n) => `${n} ${plural(n, 'person has', 'people have')} ${flags} ${plural(flags, 'flag', 'flags')} from whatbot, waiting on you.`,
  // NOT "flagged", which is the Flagged PAGE: these are rows the import could not settle.
  needsReview: (n) => `${n} ${plural(n, 'row', 'rows')} came off the last import needing a check.`,
  // CHECKS ON THE DATA ITSELF, his call 2026-09-28.
  specialCase: (n) => `${n} ${plural(n, 'deal still has', 'deals still have')} special case switched on.`,
  payableOver: (n) => `${n} ${plural(n, 'deal is', 'deals are')} payable more than ${plural(n, 'its', 'their')} monthly amount this month.`,
};

/**
 * The live deals this month owes.
 *
 * COUNTED THROUGH `countsTowardTotal`, not rewritten as SQL. That
 * predicate is the one definition of what a month owes.
 */
function owedThisMonth(rows, month, useEndDate) {
  return rows.filter((row) => !row.stopped_on && countsTowardTotal(row, { useEndDate, month }));
}

/** One deal as the screen lists it. The amount is RATED, what they are paid. */
/**
 * THE UNPAID, ONE ROW PER PERSON: their deals counted, their groups named,
 * what they are owed per currency (never added across currencies). The id
 * is the person's, so the page ticks them off once ALL their deals are paid.
 */
function unpaidPeople(rows) {
  const byPerson = new Map();
  for (const r of rows) {
    const key = String(r.person_id ?? r.person_name ?? r.id).trim().toLowerCase();
    const p = byPerson.get(key) ?? {
      id: `person:${key}`, personId: r.person_id ?? null, person: r.person_name || r.company || '(no handler)',
      companies: new Set(), groups: new Set(), deals: 0, owed: new Map(),
    };
    p.deals += 1;
    if (r.company) p.companies.add(r.company);
    if (r.group_name) p.groups.add(r.group_name);
    const cur = r.currency || 'GBP';
    p.owed.set(cur, Math.round(((p.owed.get(cur) ?? 0) + (Number(r.payable_amount) || 0)) * 100) / 100);
    byPerson.set(key, p);
  }
  return [...byPerson.values()]
    .map((p) => {
      const totals = [...p.owed].map(([currency, amount]) => ({ amount, currency }));
      return {
        id: p.id,
        personId: p.personId,
        person: p.person,
        // one company named; several said as a count
        company: p.companies.size === 1 ? [...p.companies][0] : null,
        deals: p.deals,
        group: [...p.groups].sort().join(', ') || null,
        amount: totals[0]?.amount ?? 0,
        currency: totals[0]?.currency ?? 'GBP',
        totals,
        monthly: 0,
      };
    })
    .sort((a, b) => a.person.localeCompare(b.person));
}

function dealRow(row, amountField) {
  return {
    id: String(row.id),
    personId: row.person_id ?? null,
    person: row.person_name || row.company || '(no handler)',
    company: row.company || null,
    group: row.group_name || null,
    amount: Number(row[amountField]) || 0,
    // The monthly beside it, so a payable over it can be shown against it.
    monthly: Number(row.monthly_amount) || 0,
    currency: row.currency || 'GBP',
  };
}

/** One flagged person. Stable id, so a refetch can tell new from sorted. */
function concernRow(row) {
  return {
    id: `${row.group_name}|${row.person_id}`,
    personId: row.person_id ?? null,
    person: row.person_name || row.person_id,
    group: row.group_name || null,
    flags: Number(row.concern_count) || 1,
  };
}

/**
 * @returns {Promise<{ period: string, items: Array<{key, count, sentence, rows}> }>}
 *   Only the items with something in them, in the order she says them:
 *   money owed first, then what somebody has to answer, then the tidying.
 */
async function briefing(period = currentMonth()) {
  const settings = await settingsRepo.get();
  const useEndDate = Boolean(settings?.color_uses_end_date);

  const [due, concerns, rows] = await Promise.all([
    dueThisMonth(period, { answered: false }),
    concernsRepo.listGrouped({ status: 'open', limit: CONCERNS_LIMIT, offset: 0 }),
    rowsRepo.findAllRows(),
  ]);

  // An untouched override is NULL, a real third state, and the resolved
  // default for paid is NO. So "not marked paid" is null or false alike.
  const unpaid = await ratedRows(owedThisMonth(rows, period, useEndDate)
    .filter((row) => row.override_paid !== true));
  const flagged = await ratedRows(rows.filter((row) => row.needs_review && !row.stopped_on));
  const special = await ratedRows(rows.filter((row) => row.special_case_deal === true && !row.stopped_on));
  // RATED BOTH SIDES, so the comparison is the same as raw and the figures match the screen.
  const payableOver = (await ratedRows(owedThisMonth(rows, period, useEndDate)))
    .filter((row) => Number(row.payable_amount) > Number(row.monthly_amount));

  const items = [];
  const add = (key, list, count = list.length, ...more) => {
    if (count === 0) return;
    items.push({ key, count, sentence: SAY[key](count, ...more), rows: list });
  };

  // SPLIT BY WHY, ranked: winding down is the biggest thing that can be
  // happening, his own tick the most specific, a date the ordinary case.
  const by = (reason) => due.filter((row) => reviewReason(row) === reason);
  add('liquidating', by(REVIEW_REASON.LIQUIDATION).map((r) => dealRow(r, 'monthly_amount')));
  add('pastYear', by(REVIEW_REASON.PAST_END).map((r) => dealRow(r, 'monthly_amount')));
  add('reviewMonthly', by(REVIEW_REASON.REVIEW).map((r) => dealRow(r, 'monthly_amount')));
  add('unpaid', unpaidPeople(unpaid));
  // `total` from listGrouped counts (person, group) pairs; the line counts people.
  const concernRows = concerns.rows.map(concernRow);
  const people = new Set(concernRows.map((r) => String(r.person).trim().toLowerCase())).size;
  const flags = concernRows.reduce((sum, r) => sum + r.flags, 0);
  add('concerns', concernRows, people, flags);
  add('needsReview', flagged.map((r) => dealRow(r, 'payable_amount')));
  add('specialCase', special.map((r) => dealRow(r, 'payable_amount')));
  add('payableOver', payableOver.map((r) => dealRow(r, 'payable_amount')));

  return { period, items };
}

module.exports = { briefing, SAY, CONCERNS_LIMIT };
