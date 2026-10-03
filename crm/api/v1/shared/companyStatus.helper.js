const companiesRepo = require('../repos/companies.repo');
const rowsRepo = require('../repos/masterSheetRows.repo');
const { randomUUID } = require('node:crypto');
const { currentDay } = require('./presetMonth.helper');

/**
 * ***************************************************
 * * CHANGING A COMPANY'S STATUS, AND WHAT IT DOES TO ITS DEALS
 * ***************************************************
 *
 * ONE DEFINITION, TWO CALLERS, and it had two. The cascade lived inside
 * the PATCH route, and Diane's `update_company` calls the repo directly:
 * so closing a company through the page stopped every deal on it, and
 * closing the same company by asking her stopped none of them. The same
 * act, two answers, on money going out.
 *
 * Found 2026-09-17, while giving her the confirm she was missing.
 *
 * A TERMINAL STATUS ENDS EVERY LIVE DEAL. Closing or dissolving is the
 * LAST act of a wind down, not the first. Reopening puts back only the
 * deals this closure stopped, so one somebody stopped by hand beforehand
 * stays stopped: that was a separate decision about that deal.
 */

/**
 * @returns {{ company, deals, reviewed, reviewQueueChanged, becameTerminal,
 *   reopened }} `deals` is `{ stopped: id[] }`, `{ resumed: id[] }`, or null
 *   when the status did not cross the line. The caller reports the count; it
 *   is the surprise.
 */
async function applyCompanyStatus(key, fields = {}) {
  const before = await companiesRepo.findByKey(
    String(key ?? '').trim().replace(/\s+/g, ' ').toLowerCase(),
  );

  const asked = fields.status !== undefined;
  const was = companiesRepo.isTerminal(before?.status);
  const now = asked && companiesRepo.isTerminal(fields.status);
  const becameTerminal = now && !was;
  // ONLY ON THE WAY OUT. A company already closed being saved for a notes
  // edit must not re-run a cascade that already happened.
  const reopened = asked && was && !now;

  /**
   * ===============================
   * * ENTERING OR LEAVING LIQUIDATION MOVES THE REVIEW QUEUE
   * ===============================
   * Every live deal on the company joins the queue, or leaves it, with no
   * row on tb_mastersheet changing at all. So `deals` stays null and
   * `reviewed` can be empty, and every caller broadcast on those two: the
   * Review button and Diane's count kept the old number until a reload.
   * Found 2026-09-21 on A J Rayson.
   */
  const reviewQueueChanged = asked
    && companiesRepo.isReviewedMonthly(before?.status)
      !== companiesRepo.isReviewedMonthly(fields.status);

  // ADDED ONLY WHEN IT HAS ONE. `closedOn: undefined` is a key nobody
  // mentioned, and "not mentioned" is a real third state the repo keeps
  // apart from "cleared": spreading it in made every update carry it.
  //
  // '' CLEARS IT. The date and the status are one fact, so a company that
  // is no longer terminal must not keep the day it closed.
  const closedOn = becameTerminal ? currentDay() : (reopened ? '' : undefined);
  /**
   * ===============================
   * * WHICH DEALS ARE REVIEWED MONTHLY, decided in the same press
   * ===============================
   * The status screen asks it under liquidation, as a checklist of the
   * company's own deals, and it arrives here beside the status because the
   * two are ONE act: writing the status and then asking about the deals is
   * how half of it lands and the rest is abandoned on a closed modal.
   *
   * NOT A COLUMN ON THE COMPANY. `review_monthly` is per deal, because his
   * sheet says it per deal: Workforce carries 19 "Going concern" rows, 2
   * "Reviewed monthly" and 2 with a real date, all at once, and no single
   * company value can express that.
   *
   * `undefined` means the question was never asked, and is left alone. An
   * empty array is a real answer meaning none of them.
   */
  /**
   * ===============================
   * * WHICH DEALS A CLOSURE STOPS
   * ===============================
   * The confirm ticks them, all of them by default, because a closure is
   * the last act of a wind down and normally takes the lot. Unticking one
   * is a deliberate exception: a deal settled separately, or one somebody
   * is keeping alive on purpose.
   *
   * `undefined` means every live deal, which is what Diane's
   * `update_company` relies on: she has no checklist, so she must keep the
   * behaviour she has always had. An empty array means none of them.
   */
  /**
   * ===============================
   * * WHICH DEALS CARRY "Going concern"
   * ===============================
   * The third id list, and it asks a DIFFERENT question from the other
   * two: not "which are reviewed" and not "which stop", but which have no
   * end date. Ticking writes his word into the cell and clears the date;
   * unticking clears the word and cannot put the date back, which is why
   * the whole cascade logs.
   */
  const {
    reviewMonthlyDealIds, stopDealIds, goingConcernDealIds, via = 'admin', ...companyFields
  } = fields;

  /**
   * ===============================
   * * ONE ACT, ONE BATCH, ONE ROW IN HISTORY
   * ===============================
   * Every write below stamps the SAME id, so a status change that stops
   * six deals is one entry somebody can undo in one press rather than six
   * they have to find and revert individually. See migration 062.
   *
   * Made here rather than per repo call: the point is that they share it.
   */
  const batchId = randomUUID();
  const stamp = { via, batchId };

  const company = await companiesRepo.update(key, {
    ...companyFields,
    ...(closedOn === undefined ? {} : { closedOn }),
  }, stamp);

  const name = company?.name ?? before?.name ?? key;
  let deals = null;
  if (becameTerminal) {
    deals = {
      stopped: await rowsRepo.stopCompany(name, { on: currentDay(), ids: stopDealIds, ...stamp }),
    };
  }
  else if (reopened) deals = { resumed: await rowsRepo.resumeCompany(name, stamp) };

  // SET AND CLEARED TOGETHER, across the whole company, so unticking a row
  // takes it out of the review as surely as ticking puts it in. A write
  // that only ever added would make the checklist one-way.
  let reviewed = null;
  if (Array.isArray(reviewMonthlyDealIds)) {
    reviewed = await rowsRepo.setReviewMonthlyForCompany(name, reviewMonthlyDealIds, stamp);
  }

  // Same rule, same shape: `undefined` was never asked, `[]` is a real
  // answer meaning none of them.
  let goingConcern = null;
  if (Array.isArray(goingConcernDealIds)) {
    goingConcern = await rowsRepo.setGoingConcernForCompany(name, goingConcernDealIds, stamp);
  }

  return {
    company, deals, reviewed, goingConcern, batchId,
    reviewQueueChanged, becameTerminal, reopened,
  };
}

/**
 * How many LIVE deals a closure would stop, and what they are worth.
 *
 * For a preview, so the count and the money are said BEFORE anything is
 * written. A bulk close that only reports afterwards is a number nobody
 * could have checked.
 */
async function wouldStop(name) {
  const { rows, total } = await rowsRepo.findAll({ company: name, pageSize: 500 });
  const money = rows.reduce((sum, row) => sum + Number(row.monthly_amount ?? 0), 0);
  return { count: total, money, currency: rows[0]?.currency ?? 'GBP' };
}

/**
 * And how many a REOPEN would put back, the same preview in reverse.
 *
 * ONLY WHAT THE CLOSURE STOPPED, which is the same rule `resumeCompany`
 * writes by: a deal stopped by hand beforehand stays stopped. Asking for
 * every stopped deal here would promise back rows the reopen never touches.
 */
async function wouldResume(name) {
  const { rows, total } = await rowsRepo.findAll({
    company: name,
    stopped: true,
    stoppedReason: rowsRepo.REOPEN_THE_COMPANY,
    pageSize: 500,
  });
  const money = rows.reduce((sum, row) => sum + Number(row.monthly_amount ?? 0), 0);
  return { count: total, money, currency: rows[0]?.currency ?? 'GBP' };
}

module.exports = { applyCompanyStatus, wouldStop, wouldResume };
