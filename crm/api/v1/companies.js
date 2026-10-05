const { Router } = require('express');
const companiesRepo = require('./repos/companies.repo');
const rowsRepo = require('./repos/masterSheetRows.repo');
const settingsRepo = require('./repos/settings.repo');
const { parsePagination } = require('./shared/pagination.helper');
const { detailMonthlyTotals } = require('./shared/detailMonthlyTotals.helper');
const { AppError } = require('./middlewares/errors');
const { messages } = require('./shared/messages');
const { COMPANY_TIERS } = require('./shared/companyTiers');
// The status cascade, shared with Diane so one act has one answer.
const { applyCompanyStatus } = require('./shared/companyStatus.helper');
const { broadcast } = require('./sockets/index');

/**
 * The Companies page — the other side of the same act as People.
 *
 * Its job, in the user's words: "assigning and cleaning the datas, and
 * ensuring the exports can identify which companies pay this person and
 * how much". So two things happen here and nothing else:
 *
 *   ASSIGN   attach one or many handlers to a company (creates deals)
 *   CLEAN    rename a company so its spellings collapse into one
 *
 * No merging — the user ruled it out, and rename does the job anyway:
 * renaming "Relia Pa" to "Relia PA" makes both spellings one company,
 * because the grouping key is the normalized name.
 *
 * This page was previously built over the old `companies` table, which
 * was whatbot's 15-minute sync target and tracked an entirely different
 * thing (open/close lifecycle, owner name, last seen). That table is gone
 * with the sync (migration 022). It is rebuilt here over the deals.
 */

const router = Router();

router.get('/companies', async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const cryptoPercent = await settingsRepo.cryptoPercent();
    const [{ rows, total }, tiersUsed, oldGroups] = await Promise.all([
      companiesRepo.findAll({
        cryptoPercent,
        q: req.query.q || undefined,
        group: req.query.group || undefined,
        status: req.query.status || undefined,
        // HIS OWN EARLIER GROUP NAME, never one of ours.
        oldGroup: req.query.oldGroup || undefined,
        page,
        pageSize,
      }),
      companiesRepo.tiersInUse(),
      companiesRepo.oldGroups(),
    ]);
    // The option lists travel with the list rather than as their own
    // request. SUGGESTIONS, not whitelists: the seeded tiers plus whatever
    // the sheet has actually written, so a kind he invents next month is
    // offered without anyone editing a list.
    res.json({
      companies: rows,
      total,
      page,
      pageSize,
      tiers: [...new Set([...COMPANY_TIERS, ...tiersUsed])],
      oldGroups,
    });
  } catch (err) {
    next(err);
  }
});

// For the assign-a-handler picker's search box.
router.get('/companies/names', async (req, res, next) => {
  try {
    res.json({ companies: await companiesRepo.names() });
  } catch (err) {
    next(err);
  }
});

// Keyed on the normalized name, not an id — a company that exists only in
// the deals has no tb_companies row to have an id yet, and the page must
// still be able to open it.
router.get('/companies/:key', async (req, res, next) => {
  try {
    const [company, tiersUsed, oldGroups, settings] = await Promise.all([
      companiesRepo.findByKey(req.params.key),
      companiesRepo.tiersInUse(),
      companiesRepo.oldGroups(),
      settingsRepo.get(),
    ]);
    if (!company) return next(new AppError(404, messages.notFound.company));
    // Same suggestion lists the page's list view gets, so the detail page's
    // two pickers offer what the sheet writes rather than a shorter list.
    res.json({
      company: {
        ...company,
        monthly_totals: detailMonthlyTotals(company.deals, {
          useEndDate: Boolean(settings?.color_uses_end_date),
          cryptoPercent: Number(settings?.crypto_percent ?? 0),
        }),
      },
      tiers: [...new Set([...COMPANY_TIERS, ...tiersUsed])],
      oldGroups,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * THE BULK BAR ON COMPANIES: a tier, or a status, onto every ticked
 * company. Through applyCompanyStatus, one company at a time, the same
 * door the single edit and Diane use.
 *
 * NEVER A CLOSING STATUS. Closing or dissolving asks, per company, which
 * deals stop; there is no honest way to answer that for ten at once.
 */
router.post('/companies/bulk', async (req, res, next) => {
  try {
    const { keys, tier, status } = req.body || {};
    const list = (Array.isArray(keys) ? keys : []).filter((k) => typeof k === 'string' && k);
    if (status !== undefined) {
      if (!Object.values(companiesRepo.COMPANY_STATUS).includes(status)) {
        return next(new AppError(400, messages.notACompanyStatus(status)));
      }
      if (companiesRepo.isTerminal(status)) {
        return next(new AppError(400, 'Close or dissolve companies one at a time, so you can pick which deals stop.'));
      }
    }
    if (tier === undefined && status === undefined) return next(new AppError(400, 'Nothing to set.'));
    const updated = [];
    let cascaded = false;
    for (const key of list) {
      // eslint-disable-next-line no-await-in-loop
      const out = await applyCompanyStatus(key, { tier, status });
      if (out?.company) updated.push(key);
      if (out?.deals || out?.reviewQueueChanged) cascaded = true;
    }
    broadcast(null, 'companies:changed', { action: 'bulk-updated' });
    if (cascaded) broadcast(null, 'master-sheet:changed', { action: 'company-status' });
    res.json({ updated });
  } catch (err) {
    next(err);
  }
});

router.patch('/companies/:key', async (req, res, next) => {
  try {
    const {
      name, status, notes, tier, oldGroup, liquidationTotal, reviewMonthlyDealIds,
      // Which deals a closure stops. Absent means all of them, which is what
      // every caller without a checklist has always done. See the helper.
      stopDealIds,
      // And which carry his word "Going concern", which also clears their
      // end dates. A third question, so a third list: reusing either of the
      // two above would mean one tick doing two different things.
      goingConcernDealIds,
    } = req.body || {};
    // NO WHITELIST ON TIER. It rejected `T2`, `TBC` and `Benched`, every one
    // of which the upload writes into this same column, so a tier the CRM
    // had stored itself could not be edited by hand. See shared/companyTiers.
    //
    // STATUS IS THE OPPOSITE and IS whitelisted: it decides whether every
    // deal on the company stops, so an unknown value would be a cascade
    // nobody asked for or a company stuck in a state no page can read.
    if (status !== undefined && !Object.values(companiesRepo.COMPANY_STATUS).includes(status)) {
      return next(new AppError(400, messages.notACompanyStatus(status)));
    }
    let result = null;

    // A rename touches every deal naming the company, so it runs in its
    // own transaction rather than being folded in with status and notes.
    if (name !== undefined) {
      result = await companiesRepo.rename(req.params.key, name);
    }
    const key = result ? result.renamed : req.params.key;

    /**
     * ===============================
     * * THE CASCADE IS SHARED, NOT THIS ROUTE'S
     * ===============================
     * It lived here, and Diane's `update_company` calls the repo directly,
     * so closing a company on the page stopped every deal and closing the
     * same company by asking her stopped none. One act, two answers, on
     * money going out. See shared/companyStatus.helper.js.
     */
    const {
      company, deals, reviewed, goingConcern, reviewQueueChanged,
    } = await applyCompanyStatus(key, {
      status, notes, tier, oldGroup, liquidationTotal, reviewMonthlyDealIds, stopDealIds,
      goingConcernDealIds,
    });

    // Renaming changes what every page shows, not just this one, so both
    // events fire — one alone only ever refreshed the page the edit came
    // from, which is the bug this codebase already hit once.
    broadcast(null, 'companies:changed', { action: 'updated', key: req.params.key });
    if (result) broadcast(null, 'master-sheet:changed', { action: 'renamed', ...result });
    // A cascade moved rows off the sheet or back onto it, which is a change
    // to the Master Sheet, People and the Archive, not just this page.
    //
    // OR THE REVIEW QUEUE MOVED WITH NO ROW CHANGING: liquidation puts
    // every live deal into the queue by status alone, so `deals` is null
    // and the Review button was never told. See the helper.
    if (deals || reviewQueueChanged) {
      broadcast(null, 'master-sheet:changed', { action: 'company-status', key });
    }
    // The review flag changes what the Review button counts and what the
    // end date cell says, on pages this edit did not come from.
    if (reviewed?.length) {
      broadcast(null, 'master-sheet:changed', { action: 'review-monthly', key });
    }
    // And "Going concern" clears end dates, which moves rows off the review
    // queue and changes the cell on every page that draws it.
    if (goingConcern?.length) {
      broadcast(null, 'master-sheet:changed', { action: 'going-concern', key });
    }

    res.json({ company, deals, reviewed, goingConcern, ...(result || {}) });
  } catch (err) {
    next(err);
  }
});

/**
 * Assign one or many handlers to a company.
 *
 * Each handler becomes a deal. Accepts an array because the real workflow
 * is "this company needs a Director and two Mids", and doing that as
 * three separate requests means three chances to half-finish it.
 *
 * Each handler carries their own monthly amount: 20 of the 28
 * multi-handler companies in the real sheet pay their handlers different
 * amounts, so a single company-wide figure would be wrong more often
 * than right.
 */
router.post('/companies/:key/handlers', async (req, res, next) => {
  try {
    const { personIdOf } = require('./masterSheet/identity');
    const { dealKey } = require('./masterSheet/dealKey');
    const company = await companiesRepo.findByKey(req.params.key);
    if (!company) return next(new AppError(404, messages.notFound.company));

    const handlers = Array.isArray(req.body?.handlers) ? req.body.handlers : [req.body];
    if (handlers.length === 0) return next(new AppError(400, 'No handlers given'));

    const created = [];
    const skipped = [];
    for (const h of handlers) {
      if (!h?.personName) return next(new AppError(400, 'Every handler needs a name'));
      if (!h.groupName) return next(new AppError(400, `${h.personName} needs a group`));

      const personId = h.personId || personIdOf(h.personName);
      const identity = {
        groupName: h.groupName,
        company: company.name,
        role: h.role || 'other',
        seat: h.seat ?? null,
        personId,
      };
      // Skipped rather than refused: assigning four handlers where one is
      // already there should add the three that are new, not fail the
      // whole batch and make somebody work out which one clashed.
      const existing = await rowsRepo.findMatchingDeals(identity);
      if (existing.length > 0 && req.body?.allowDuplicate !== true) {
        skipped.push({ personName: h.personName, reason: 'already on this company' });
        continue;
      }
      created.push(
        await rowsRepo.create({
          syncKey: dealKey(identity, existing.length),
          personId,
          personName: h.personName,
          roleLabel: h.roleLabel || 'Other',
          role: h.role || 'other',
          seat: h.seat ?? null,
          groupName: h.groupName,
          company: company.name,
          monthlyAmount: h.monthlyAmount ?? 0,
          currency: h.currency || 'GBP',
          paymentMethod: h.paymentMethod || 'cash',
          status: 'active',
        }),
      );
    }

    broadcast(null, 'master-sheet:changed', { action: 'created' });
    broadcast(null, 'companies:changed', { action: 'handlers-added', key: req.params.key });
    broadcast(null, 'people:changed', { action: 'deal-created' });

    res.status(201).json({ deals: created, skipped });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
